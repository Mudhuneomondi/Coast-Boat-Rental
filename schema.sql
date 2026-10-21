-- ═════════════════════════════════════════════════════════════════════════
-- CBRDMS — Coast Boat Rental  ·  FULL, HARDENED SCHEMA
-- Run the whole file in the Supabase SQL Editor. It is idempotent: safe on a
-- fresh project AND on top of the old (insecure) schema — re-run any time.
--
-- Covers:  (1) Supabase Auth link   (2) Row Level Security   (4) price +
--          double-booking rules     (5) audit log / triggers / soft deletes
--          (8) atomic payments      + CHECK constraints, least-privilege
--          grants and Storage policies.
-- OWASP mapping lives in SECURITY.md.
-- ═════════════════════════════════════════════════════════════════════════

create extension if not exists btree_gist;     -- needed for the no-overlap constraint

-- ─────────────────────────────────────────────────────────────────────────
-- 1. TABLES  (unchanged business columns; passwords removed; soft-delete added)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.users (            -- staff profile (login lives in auth.users)
  id          serial primary key,
  auth_id     uuid unique references auth.users(id) on delete set null,
  email       text unique not null,
  full_name   text,
  role        text default 'Operator',                -- Admin | Manager | Operator
  phone       text,
  created_at  timestamp default now()
);

create table if not exists public.boats (
  id          serial primary key,
  name        text not null,
  type        text not null,
  capacity    integer not null,
  base_price  integer not null,
  status      text default 'Available',               -- Available | Rented | Maintenance
  photo_urls  text,
  created_at  timestamp default now()
);

create table if not exists public.customers (          -- customer profile (login lives in auth.users)
  id          serial primary key,
  auth_id     uuid unique references auth.users(id) on delete set null,
  full_name   text not null,
  email       text unique not null,
  phone       text,
  id_number   text,
  created_at  timestamp default now()
);

create table if not exists public.bookings (
  id             serial primary key,
  customer_id    integer references public.customers(id),
  boat_id        integer references public.boats(id),
  start_date     date not null,
  end_date       date not null,
  total_amount   integer,
  status         text default 'Pending',              -- Pending | Approved | Rejected | Completed | Cancelled
  payment_status text default 'Unpaid',               -- Unpaid | Partial | Paid
  notes          text,
  approved_by    integer references public.users(id),
  created_at     timestamp default now()
);

create table if not exists public.payments (
  id          serial primary key,
  booking_id  integer references public.bookings(id),
  amount      integer not null,
  method      text not null,                          -- Cash | Card | MPesa | Bank Transfer
  reference   text,
  recorded_by integer references public.users(id),
  created_at  timestamp default now()
);

create table if not exists public.incidents (
  id            serial primary key,
  boat_id       integer references public.boats(id),
  booking_id    integer references public.bookings(id),
  description   text not null,
  photo_urls    text,                                 -- storage PATH in the private 'incidents' bucket
  status        text default 'Reported',              -- Reported | Resolved
  incident_date timestamp default now()
);

-- staff are CREATED BY INVITATION: an Admin invites an e-mail + role; when that
-- person signs up and confirms the e-mail, bootstrap_profile() promotes them.
create table if not exists public.staff_invites (
  id         serial primary key,
  email      text unique not null,
  full_name  text,
  role       text not null default 'Operator',
  phone      text,
  invited_by uuid default auth.uid(),
  created_at timestamptz default now()
);

create table if not exists public.audit_log (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  actor_id      uuid,
  actor_email   text,
  actor_role    text,
  table_name    text not null,
  record_id     text,
  action        text not null,                        -- INSERT | UPDATE | SOFT_DELETE | RESTORE | DELETE
  changed_fields text[],
  old_data      jsonb,
  new_data      jsonb
);

-- ── upgrade path from the old schema ─────────────────────────────────────
alter table public.users     add column if not exists auth_id    uuid references auth.users(id) on delete set null;
alter table public.customers add column if not exists auth_id    uuid references auth.users(id) on delete set null;
create unique index if not exists users_auth_id_uq     on public.users(auth_id)     where auth_id is not null;
create unique index if not exists customers_auth_id_uq on public.customers(auth_id) where auth_id is not null;

-- (A02) passwords are no longer stored by the app at all — Supabase Auth hashes them (bcrypt)
alter table public.users     drop column if exists password_hash;
alter table public.customers drop column if exists password_hash;

-- (5) soft-delete columns
do $$
declare t text;
begin
  foreach t in array array['users','boats','customers','bookings','incidents'] loop
    execute format('alter table public.%I add column if not exists deleted_at timestamptz', t);
    execute format('alter table public.%I add column if not exists deleted_by uuid', t);
  end loop;
end $$;

-- legacy demo staff (plain-text "demo123" accounts) can no longer log in; retire them
update public.users set deleted_at = coalesce(deleted_at, now()) where auth_id is null;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. CONSTRAINTS  (A03/A04 — the database refuses malformed data even if the
--    front end is bypassed). NOT VALID = enforced for new/changed rows.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select * from (values
    ('users',         'users_chk',        $c$ role in ('Admin','Manager','Operator')
                                              and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254
                                              and (full_name is null or length(full_name) between 1 and 100)
                                              and (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$') $c$),
    ('staff_invites','invites_chk',      $c$ role in ('Admin','Manager','Operator')
                                              and email = lower(email)
                                              and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254
                                              and (full_name is null or length(full_name) between 1 and 100)
                                              and (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$') $c$),
    ('boats',        'boats_chk',        $c$ length(name) between 1 and 100
                                              and type in ('Speedboat','Yacht','Fishing','Pontoon','Sailboat')
                                              and capacity between 1 and 200
                                              and base_price between 1 and 10000000
                                              and status in ('Available','Rented','Maintenance')
                                              and (photo_urls is null or length(photo_urls) <= 500) $c$),
    ('customers',    'customers_chk',    $c$ length(full_name) between 1 and 100
                                              and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254
                                              and (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$')
                                              and (id_number is null or length(id_number) <= 30) $c$),
    ('bookings',     'bookings_chk',     $c$ end_date > start_date and end_date - start_date <= 30
                                              and status in ('Pending','Approved','Rejected','Completed','Cancelled')
                                              and payment_status in ('Unpaid','Partial','Paid')
                                              and (total_amount is null or total_amount >= 0)
                                              and (notes is null or length(notes) <= 1000) $c$),
    ('payments',     'payments_chk',     $c$ amount > 0
                                              and method in ('Cash','Card','MPesa','Bank Transfer')
                                              and (reference is null or length(reference) <= 64) $c$),
    ('incidents',    'incidents_chk',    $c$ length(description) between 1 and 2000
                                              and status in ('Reported','Resolved')
                                              and (photo_urls is null or length(photo_urls) <= 500) $c$)
  ) as v(tbl, cname, expr)
  loop
    execute format('alter table public.%I drop constraint if exists %I', r.tbl, r.cname);
    execute format('alter table public.%I add constraint %I check (%s) not valid', r.tbl, r.cname, r.expr);
  end loop;
end $$;

-- (4) DOUBLE-BOOKING: two APPROVED bookings can never overlap on the same boat.
--     [start, end) → a boat returned on the 5th can be taken again on the 5th.
alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (boat_id with =, daterange(start_date, end_date, '[)') with &&)
  where (status = 'Approved' and deleted_at is null);

-- (8) a payment reference (M-Pesa code, receipt no.) can only be used once per method
create unique index if not exists payments_method_reference_uq
  on public.payments (method, reference) where reference is not null and reference <> '';

create index if not exists bookings_customer_idx on public.bookings(customer_id);
create index if not exists bookings_boat_idx     on public.bookings(boat_id, start_date, end_date);
create index if not exists payments_booking_idx  on public.payments(booking_id);
create index if not exists audit_table_idx       on public.audit_log(table_name, record_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. ROLE HELPERS  (SECURITY DEFINER so policies can look up the caller's role
--    without recursion; search_path pinned to defeat search-path hijacking)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.staff_role() returns text
language sql stable security definer set search_path = '' as $$
  select u.role from public.users u
  where u.auth_id = (select auth.uid()) and u.deleted_at is null limit 1
$$;

create or replace function public.staff_id() returns integer
language sql stable security definer set search_path = '' as $$
  select u.id from public.users u
  where u.auth_id = (select auth.uid()) and u.deleted_at is null limit 1
$$;

create or replace function public.my_customer_id() returns integer
language sql stable security definer set search_path = '' as $$
  select c.id from public.customers c
  where c.auth_id = (select auth.uid()) and c.deleted_at is null limit 1
$$;

create or replace function public.is_staff()   returns boolean language sql stable security definer set search_path = '' as $$ select public.staff_role() is not null $$;
create or replace function public.is_manager() returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(public.staff_role() in ('Admin','Manager'), false) $$;
create or replace function public.is_admin()   returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(public.staff_role() = 'Admin', false) $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. bootstrap_profile()  — called by the app right after every login.
--    Decides (server-side!) whether the caller is staff or a customer.
--    The role can NEVER come from the browser or from user_metadata.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.bootstrap_profile() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text; v_confirmed timestamptz; v_meta jsonb;
  s public.users; c public.customers; inv public.staff_invites;
  v_phone text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select u.email, u.email_confirmed_at, u.raw_user_meta_data
    into v_email, v_confirmed, v_meta from auth.users u where u.id = v_uid;
  v_email := lower(v_email);

  -- disabled (soft-deleted) accounts are locked out, never silently re-created
  if exists (select 1 from public.users     where auth_id = v_uid and deleted_at is not null)
  or exists (select 1 from public.customers where auth_id = v_uid and deleted_at is not null) then
    raise exception 'This account has been disabled. Contact the administrator.' using errcode = '42501';
  end if;

  select * into s from public.users where auth_id = v_uid;
  if found then
    return jsonb_build_object('kind','staff','id',s.id,'role',s.role,'name',coalesce(s.full_name, s.email));
  end if;

  select * into c from public.customers where auth_id = v_uid;
  if found then
    return jsonb_build_object('kind','customer','id',c.id,'role','Customer','name',c.full_name);
  end if;

  -- first login: only a CONFIRMED e-mail address may claim anything
  if v_confirmed is null then
    raise exception 'Please confirm your e-mail address first.' using errcode = '42501';
  end if;

  select * into inv from public.staff_invites where email = v_email for update;
  if found then
    insert into public.users (auth_id, email, full_name, role, phone)
    values (v_uid, v_email, inv.full_name, inv.role, inv.phone)
    on conflict (email) do update
      set auth_id = excluded.auth_id, full_name = excluded.full_name, role = excluded.role,
          phone = excluded.phone, deleted_at = null, deleted_by = null
      where public.users.auth_id is null
    returning * into s;
    if s.id is null then
      raise exception 'This e-mail already belongs to another staff account.' using errcode = '42501';
    end if;
    delete from public.staff_invites where id = inv.id;
    return jsonb_build_object('kind','staff','id',s.id,'role',s.role,'name',coalesce(s.full_name, s.email));
  end if;

  v_phone := nullif(trim(v_meta->>'phone'), '');
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{7,20}$' then v_phone := null; end if;

  insert into public.customers (auth_id, email, full_name, phone)
  values (v_uid, v_email,
          left(coalesce(nullif(trim(v_meta->>'full_name'), ''), split_part(v_email,'@',1)), 100),
          v_phone)
  on conflict (email) do update set auth_id = excluded.auth_id where public.customers.auth_id is null
  returning * into c;

  if c.id is null then
    raise exception 'Could not create your profile.' using errcode = '42501';
  end if;
  return jsonb_build_object('kind','customer','id',c.id,'role','Customer','name',c.full_name);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. BUSINESS-RULE TRIGGERS  (price + double-booking + status workflow)
-- ─────────────────────────────────────────────────────────────────────────

-- 5a. NEW booking: the SERVER decides price, status and ownership
create or replace function public.trg_booking_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b public.boats;
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_role text := public.staff_role();
  v_cust integer := public.my_customer_id();
begin
  if v_role is null and (v_cust is null or new.customer_id is distinct from v_cust) then
    raise exception 'You can only create bookings for your own account.';
  end if;

  select * into b from public.boats where id = new.boat_id and deleted_at is null;
  if not found then raise exception 'That boat does not exist.'; end if;
  if b.status = 'Maintenance' then raise exception 'That boat is under maintenance and cannot be booked.'; end if;

  if new.start_date < v_today then raise exception 'The start date cannot be in the past.'; end if;
  if new.end_date <= new.start_date then raise exception 'The end date must be after the start date.'; end if;
  if new.end_date - new.start_date > 30 then raise exception 'A booking cannot be longer than 30 days.'; end if;

  if exists (select 1 from public.bookings x
             where x.boat_id = new.boat_id and x.status = 'Approved' and x.deleted_at is null
               and daterange(x.start_date, x.end_date, '[)') && daterange(new.start_date, new.end_date, '[)')) then
    raise exception 'That boat is already booked for the selected dates.' using errcode = '23P01';
  end if;

  new.total_amount   := (new.end_date - new.start_date) * b.base_price;   -- never trust the browser
  new.status         := 'Pending';
  new.payment_status := 'Unpaid';
  new.approved_by    := null;
  new.deleted_at     := null;
  new.deleted_by     := null;
  new.notes          := nullif(trim(new.notes), '');
  return new;
end $$;

drop trigger if exists bookings_before_insert on public.bookings;
create trigger bookings_before_insert before insert on public.bookings
  for each row execute function public.trg_booking_before_insert();

-- 5b. booking status workflow — who may move a booking where
create or replace function public.trg_booking_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := public.staff_role();
  v_mgr boolean := coalesce(public.staff_role() in ('Admin','Manager'), false);
  v_cust integer := public.my_customer_id();
  v_ok boolean := false;
begin
  if new.notes is distinct from old.notes and not v_mgr then
    raise exception 'Only a manager can edit booking notes.';
  end if;

  if new.status is distinct from old.status then
    if v_mgr then
      v_ok := (old.status, new.status) in
        (('Pending','Approved'),('Pending','Rejected'),('Pending','Cancelled'),
         ('Approved','Completed'),('Approved','Cancelled'));
    elsif v_cust is not null and old.customer_id = v_cust then
      v_ok := (old.status, new.status) = ('Pending','Cancelled');
    end if;
    if not v_ok then
      raise exception 'You cannot change a booking from % to %.', old.status, new.status;
    end if;
    if new.status = 'Completed' and old.payment_status <> 'Paid' then
      raise exception 'A booking must be fully paid before it can be completed.';
    end if;
    if new.status = 'Approved' then
      new.approved_by := public.staff_id();             -- who approved is recorded by the server
    end if;
  end if;
  return new;
end $$;

drop trigger if exists bookings_before_update on public.bookings;
create trigger bookings_before_update before update on public.bookings
  for each row execute function public.trg_booking_before_update();

-- 5c. users: nobody can demote / disable themselves (prevents lock-out)
create or replace function public.trg_users_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.auth_id = auth.uid() and
     (new.role is distinct from old.role or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'You cannot change your own role or remove your own account.';
  end if;
  return new;
end $$;
drop trigger if exists users_guard on public.users;
create trigger users_guard before update on public.users for each row execute function public.trg_users_guard();

-- 5d. customers: only an Admin may soft-delete / restore a customer
create or replace function public.trg_customers_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is distinct from old.deleted_at and not public.is_admin() then
    raise exception 'Only an administrator can remove customers.';
  end if;
  return new;
end $$;
drop trigger if exists customers_guard on public.customers;
create trigger customers_guard before update on public.customers for each row execute function public.trg_customers_guard();

-- 5e. soft-delete stamping: deleted_at/deleted_by are set by the server, not the client
create or replace function public.trg_soft_delete_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_at := now(); new.deleted_by := auth.uid();
  elsif new.deleted_at is null and old.deleted_at is not null then
    if not public.is_admin() then raise exception 'Only an administrator can restore records.'; end if;
    new.deleted_by := null;
  else
    new.deleted_at := old.deleted_at; new.deleted_by := old.deleted_by;
  end if;
  return new;
end $$;

-- 5f. HARD DELETE is impossible (privileges are revoked below) — and this trigger
--     is a second lock for anyone connecting with a privileged role.
create or replace function public.trg_no_hard_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Rows are never hard-deleted — records are archived (soft delete).';
end $$;

-- 5g. payments and the audit log are append-only
create or replace function public.trg_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only: rows cannot be changed or deleted.', tg_table_name;
end $$;

drop trigger if exists payments_append_only on public.payments;
create trigger payments_append_only before update or delete on public.payments
  for each row execute function public.trg_append_only();
drop trigger if exists audit_append_only on public.audit_log;
create trigger audit_append_only before update or delete on public.audit_log
  for each row execute function public.trg_append_only();

do $$
declare t text;
begin
  foreach t in array array['users','boats','customers','bookings','incidents'] loop
    execute format('drop trigger if exists %1$s_soft_delete on public.%1$s', t);
    execute format('create trigger %1$s_soft_delete before update on public.%1$s
                    for each row execute function public.trg_soft_delete_stamp()', t);
    execute format('drop trigger if exists %1$s_no_hard_delete on public.%1$s', t);
    execute format('create trigger %1$s_no_hard_delete before delete on public.%1$s
                    for each row execute function public.trg_no_hard_delete()', t);
  end loop;
end $$;
-- NB: trigger names sort alphabetically; "x_soft_delete" runs after "bookings_before_update".

-- ─────────────────────────────────────────────────────────────────────────
-- 6. AUDIT TRIGGER  — who did what, to which row, when (who = the JWT user)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.trg_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_action text := tg_op;
  v_changed text[];
begin
  if tg_op = 'UPDATE' then
    if v_old = v_new then return null; end if;                       -- no-op update
    select array_agg(k order by k) into v_changed
      from jsonb_object_keys(v_new) k where v_new->k is distinct from v_old->k;
    if v_new->>'deleted_at' is not null and v_old->>'deleted_at' is null then v_action := 'SOFT_DELETE';
    elsif v_new->>'deleted_at' is null and v_old->>'deleted_at' is not null then v_action := 'RESTORE'; end if;
  end if;

  insert into public.audit_log (actor_id, actor_email, actor_role, table_name, record_id,
                                action, changed_fields, old_data, new_data)
  values (auth.uid(), auth.jwt()->>'email', public.staff_role(), tg_table_name,
          coalesce(v_new->>'id', v_old->>'id'), v_action, v_changed, v_old, v_new);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['users','staff_invites','boats','customers','bookings','payments','incidents'] loop
    execute format('drop trigger if exists %1$s_audit on public.%1$s', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s
                    for each row execute function public.trg_audit()', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. record_payment()  — ONE atomic transaction (8)
--    lock booking → validate → insert payment → update booking.payment_status
--    Any failure rolls back everything; concurrent payments queue on the row lock.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.record_payment(
  p_booking_id integer, p_amount integer, p_method text, p_reference text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bk public.bookings;
  v_ref text := nullif(trim(p_reference), '');
  v_paid integer; v_new_paid integer; v_status text;
  v_mgr integer; v_cust integer := public.my_customer_id();
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;

  select * into bk from public.bookings where id = p_booking_id and deleted_at is null for update;
  if not found then raise exception 'Booking not found.'; end if;

  select u.id into v_mgr from public.users u
   where u.auth_id = auth.uid() and u.deleted_at is null and u.role in ('Admin','Manager');
  if v_mgr is null and (v_cust is null or bk.customer_id is distinct from v_cust) then
    raise exception 'You are not allowed to pay for this booking.' using errcode = '42501';
  end if;

  if bk.status <> 'Approved' then raise exception 'Only approved bookings can be paid.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.'; end if;
  if p_method not in ('Cash','Card','MPesa','Bank Transfer') then raise exception 'Unknown payment method.'; end if;
  if p_method = 'MPesa' then
    v_ref := upper(v_ref);
    if v_ref is null or v_ref !~ '^[A-Z0-9]{10}$' then
      raise exception 'Enter the 10-character M-Pesa confirmation code.';
    end if;
  end if;
  if v_ref is not null and length(v_ref) > 64 then raise exception 'Reference is too long.'; end if;

  select coalesce(sum(amount), 0) into v_paid from public.payments where booking_id = bk.id;
  if v_paid + p_amount > bk.total_amount then
    raise exception 'That is more than the outstanding balance (KSh %).', bk.total_amount - v_paid;
  end if;

  insert into public.payments (booking_id, amount, method, reference, recorded_by)
  values (bk.id, p_amount, p_method, v_ref, v_mgr);                  -- duplicate reference → 23505

  v_new_paid := v_paid + p_amount;
  v_status   := case when v_new_paid >= bk.total_amount then 'Paid' else 'Partial' end;
  update public.bookings set payment_status = v_status where id = bk.id;

  return jsonb_build_object('payment_status', v_status, 'paid', v_new_paid,
                            'balance', bk.total_amount - v_new_paid);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7b. archive_record()  — the ONLY way to soft-delete / restore (5)
--     (done server-side so the row stays valid under RLS and clients can never
--      write deleted_at themselves)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.archive_record(p_table text, p_id integer, p_restore boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ok boolean; n integer;
begin
  if    p_table in ('users','customers')            then v_ok := public.is_admin();
  elsif p_table in ('boats','bookings','incidents') then v_ok := public.is_manager();
  else raise exception 'Unknown record type.'; end if;
  if not coalesce(v_ok, false) then
    raise exception 'You are not allowed to do that.' using errcode = '42501';
  end if;
  execute format('update public.%I set deleted_at = %s where id = $1', p_table,
                 case when p_restore then 'null' else 'now()' end) using p_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Record not found.'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. LEAST-PRIVILEGE GRANTS  (anon gets NOTHING; hard DELETE is never granted)
-- ─────────────────────────────────────────────────────────────────────────
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on function
  public.staff_role(), public.staff_id(), public.my_customer_id(), public.is_staff(),
  public.is_manager(), public.is_admin(), public.bootstrap_profile(),
  public.record_payment(integer, integer, text, text), public.archive_record(text, integer, boolean),
  public.trg_booking_before_insert(), public.trg_booking_before_update(), public.trg_users_guard(),
  public.trg_customers_guard(), public.trg_soft_delete_stamp(), public.trg_no_hard_delete(),
  public.trg_append_only(), public.trg_audit()
  from public, anon, authenticated;

grant usage on schema public to authenticated;

grant select                                                       on public.boats     to authenticated;
grant insert (name, type, capacity, base_price, status, photo_urls) on public.boats    to authenticated;
grant update (status)                                              on public.boats     to authenticated;

grant select                                                       on public.customers to authenticated;
grant update (full_name, phone, id_number)                         on public.customers to authenticated;

grant select                                                       on public.bookings  to authenticated;
grant insert (customer_id, boat_id, start_date, end_date, notes)   on public.bookings  to authenticated;
grant update (status, notes)                                       on public.bookings  to authenticated;

grant select                                                       on public.payments  to authenticated;   -- writes only via record_payment()

grant select                                                       on public.incidents to authenticated;
grant insert (boat_id, booking_id, description, photo_urls)        on public.incidents to authenticated;
grant update (status)                                              on public.incidents to authenticated;

grant select                                                       on public.users     to authenticated;
grant update (full_name, phone, role)                              on public.users     to authenticated;

grant select, delete                                               on public.staff_invites to authenticated;
grant insert (email, full_name, role, phone)                       on public.staff_invites to authenticated;

grant select                                                       on public.audit_log to authenticated;

grant usage on sequence public.boats_id_seq, public.bookings_id_seq, public.incidents_id_seq,
                        public.staff_invites_id_seq to authenticated;

grant execute on function public.staff_role(), public.staff_id(), public.my_customer_id(),
                          public.is_staff(), public.is_manager(), public.is_admin(),
                          public.bootstrap_profile(), public.record_payment(integer, integer, text, text),
                          public.archive_record(text, integer, boolean)
  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9. ROW LEVEL SECURITY  — enabled AND forced on every table (2)
--    (old policies are dropped first so nothing permissive survives)
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.users          enable row level security;
alter table public.boats          enable row level security;
alter table public.customers      enable row level security;
alter table public.bookings       enable row level security;
alter table public.payments       enable row level security;
alter table public.incidents      enable row level security;
alter table public.staff_invites  enable row level security;
alter table public.audit_log      enable row level security;

-- users (staff) ----------------------------------------------------------
create policy users_select on public.users for select to authenticated
  using (auth_id = (select auth.uid()) or public.is_admin());
create policy users_update on public.users for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- staff_invites ----------------------------------------------------------
create policy invites_admin on public.staff_invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- boats ------------------------------------------------------------------
create policy boats_select on public.boats for select to authenticated
  using (deleted_at is null or public.is_admin());
create policy boats_insert on public.boats for insert to authenticated
  with check (public.is_manager());
create policy boats_update on public.boats for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- customers --------------------------------------------------------------
create policy customers_select on public.customers for select to authenticated
  using ((deleted_at is null or public.is_admin())
         and (public.is_staff() or auth_id = (select auth.uid())));
create policy customers_update on public.customers for update to authenticated
  using (auth_id = (select auth.uid()) or public.is_admin())
  with check (auth_id = (select auth.uid()) or public.is_admin());

-- bookings ---------------------------------------------------------------
create policy bookings_select on public.bookings for select to authenticated
  using ((deleted_at is null or public.is_admin())
         and (public.is_staff() or customer_id = public.my_customer_id()));
create policy bookings_insert on public.bookings for insert to authenticated
  with check (public.is_staff() or customer_id = public.my_customer_id());
create policy bookings_update on public.bookings for update to authenticated
  using (public.is_manager() or customer_id = public.my_customer_id())
  with check (public.is_manager() or customer_id = public.my_customer_id());

-- payments (read-only for clients; inserts go through record_payment) ----
create policy payments_select on public.payments for select to authenticated
  using (public.is_manager()
         or exists (select 1 from public.bookings b
                    where b.id = booking_id and b.customer_id = public.my_customer_id()));

-- incidents (staff only) -------------------------------------------------
create policy incidents_select on public.incidents for select to authenticated
  using ((deleted_at is null or public.is_admin()) and public.is_staff());
create policy incidents_insert on public.incidents for insert to authenticated
  with check (public.is_staff());
create policy incidents_update on public.incidents for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- audit log (Admin read-only) -------------------------------------------
create policy audit_select on public.audit_log for select to authenticated
  using (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- 10. STORAGE  — size/type limits + who may upload / read
--     boats     : public bucket (marketing photos), only managers upload
--     incidents : PRIVATE bucket (evidence), staff only, read via signed URL
-- ─────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('boats',     'boats',     true,  2097152, array['image/jpeg','image/png','image/webp']),
  ('incidents', 'incidents', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists cbr_boats_insert     on storage.objects;
drop policy if exists cbr_incidents_insert on storage.objects;
drop policy if exists cbr_incidents_select on storage.objects;
-- file names must be "<uuid>.<jpg|png|webp>" — the client generates them; no overwrite (no UPDATE policy)
create policy cbr_boats_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'boats' and public.is_manager()
              and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$');
create policy cbr_incidents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'incidents' and public.is_staff()
              and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$');
create policy cbr_incidents_select on storage.objects for select to authenticated
  using (bucket_id = 'incidents' and public.is_staff());

-- ═════════════════════════════════════════════════════════════════════════
-- FIRST ADMIN (do this once, replace the e-mail with yours):
--   insert into public.staff_invites (email, full_name, role)
--   values ('you@example.com', 'Your Name', 'Admin');
-- then open the app, Sign up with that e-mail, confirm it, sign in.
-- ═════════════════════════════════════════════════════════════════════════
