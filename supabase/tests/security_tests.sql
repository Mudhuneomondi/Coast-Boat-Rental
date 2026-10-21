\set ON_ERROR_STOP on
begin;
create schema t; grant usage on schema t to public;
create table t.results(n serial, name text, ok boolean, detail text); grant all on t.results to public; grant all on sequence t.results_n_seq to public;
create table t.ids(k text primary key, id uuid); grant select on t.ids to public;
create function t.uid(k text) returns uuid language sql stable as $$ select id from t.ids where k=$1 $$;
create function t.as_user(k text) returns void language plpgsql as $$
declare u uuid := t.uid(k); e text;
begin
  select email into e from auth.users where id=u;
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub',u,'email',e,'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function t.as_anon() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','',true); execute 'set local role anon'; end $$;
create function t.as_db() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
-- expect an error matching pattern
create function t.err(nm text, q text, pat text) returns void language plpgsql as $$
begin
  begin execute q; insert into t.results(name,ok,detail) values (nm,false,'NO ERROR (expected /'||pat||'/)');
  exception when others then
    insert into t.results(name,ok,detail) values (nm, sqlerrm ~* pat, case when sqlerrm ~* pat then null else 'got: '||sqlerrm||' ['||sqlstate||']' end);
  end;
end $$;
create function t.ok(nm text, q text) returns void language plpgsql as $$
begin
  begin execute q; insert into t.results(name,ok) values (nm,true);
  exception when others then insert into t.results(name,ok,detail) values (nm,false,'ERROR: '||sqlerrm); end;
end $$;
create function t.val(nm text, q text, expected text) returns void language plpgsql as $$
declare v text;
begin
  begin execute q into v;
    insert into t.results(name,ok,detail) values (nm, v is not distinct from expected, case when v is not distinct from expected then null else 'got '||coalesce(v,'NULL')||' expected '||expected end);
  exception when others then insert into t.results(name,ok,detail) values (nm,false,'ERROR: '||sqlerrm); end;
end $$;

-- ── seed (as superuser) ────────────────────────────────────
insert into t.ids select k, gen_random_uuid() from unnest(array['admin','mgr','op','alice','bob','evil','unconf','newstaff']) k;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select id, case k when 'evil' then 'evil@x.com' else k||'@x.com' end,
       case when k='unconf' then null else now() end,
       case k when 'evil' then '{"full_name":"Evil","role":"Admin","phone":"+254700000000"}'::jsonb
              when 'alice' then '{"full_name":"Alice W","phone":"+254711111111"}'::jsonb
              when 'bob' then '{"full_name":"Bob K"}'::jsonb else '{}'::jsonb end
from t.ids;
update auth.users set email='unconf@x.com' where id=t.uid('unconf');
insert into public.staff_invites(email,full_name,role) values
 ('admin@x.com','Ann Admin','Admin'),('mgr@x.com','Mo Manager','Manager'),('op@x.com','Olu Operator','Operator'),('unconf@x.com','Unconfirmed','Admin');
insert into public.boats(name,type,capacity,base_price,status) values ('T-Boat1','Speedboat',6,1000,'Available'),('T-Boat2','Yacht',12,2000,'Available'),('T-Maint','Pontoon',8,500,'Maintenance');

-- ── 1. anonymous visitors ─────────────────────────────────
select t.as_anon();
select t.err('anon cannot read boats',    'select * from public.boats', 'permission denied');
select t.err('anon cannot read users',    'select * from public.users', 'permission denied');
select t.err('anon cannot read customers','select * from public.customers', 'permission denied');
select t.err('anon cannot read audit_log','select * from public.audit_log', 'permission denied');
select t.err('anon cannot call bootstrap','select public.bootstrap_profile()', 'permission denied');
select t.err('anon cannot call record_payment','select public.record_payment(1,100,''Cash'',null)', 'permission denied');
select t.as_db();

-- ── 2. login bootstrap ─────────────────────────────────────
select t.as_user('unconf');
select t.err('unconfirmed e-mail cannot claim an invite', 'select public.bootstrap_profile()', 'confirm your e-mail');
select t.as_db();
select t.as_user('admin'); select t.val('admin invite -> Admin', $q$select public.bootstrap_profile()->>'role'$q$, 'Admin'); select t.as_db();
select t.as_user('mgr');   select t.val('manager invite -> Manager', $q$select public.bootstrap_profile()->>'role'$q$, 'Manager'); select t.as_db();
select t.as_user('op');    select t.val('operator invite -> Operator', $q$select public.bootstrap_profile()->>'role'$q$, 'Operator'); select t.as_db();
select t.as_user('alice'); select t.val('normal signup -> Customer', $q$select public.bootstrap_profile()->>'kind'$q$, 'customer'); select t.as_db();
select t.as_user('bob');   select t.val('bob -> Customer', $q$select public.bootstrap_profile()->>'kind'$q$, 'customer'); select t.as_db();
select t.as_user('evil');  select t.val('user_metadata role=Admin is ignored', $q$select public.bootstrap_profile()->>'role'$q$, 'Customer'); select t.as_db();
select t.val('invite consumed after claim', 'select count(*)::text from public.staff_invites where email=''admin@x.com''', '0');
select t.as_user('alice'); select t.val('bootstrap is idempotent', $q$select public.bootstrap_profile()->>'name'$q$, 'Alice W'); select t.as_db();

-- ── 3. privilege escalation attempts by a customer ────────
select t.as_user('evil');
select t.val('customer cannot see staff list', 'select count(*)::text from public.users', '0');
select t.val('customer cannot promote self (0 rows)', $q$with u as (update public.users set role='Admin' where true returning 1) select count(*)::text from u$q$, '0');
select t.err('customer cannot insert staff row', $q$insert into public.users(email,role) values ('x@x.com','Admin')$q$, 'permission denied');
select t.err('customer cannot create invites',  $q$insert into public.staff_invites(email,role) values ('z@x.com','Admin')$q$, 'permission denied|row-level security');
select t.val('customer audit_log visible rows = 0', 'select count(*)::text from public.audit_log', '0');
select t.err('customer cannot add boats', $q$insert into public.boats(name,type,capacity,base_price) values ('Hax','Yacht',1,1)$q$, 'row-level security');
select t.val('customer cannot see incidents', 'select count(*)::text from public.incidents', '0');
select t.err('customer cannot hard-delete', 'delete from public.boats', 'permission denied');
select t.as_db();

-- ── 4. staff role boundaries ──────────────────────────────
select t.as_user('op');
select t.err('operator cannot add boats', $q$insert into public.boats(name,type,capacity,base_price) values ('Op','Yacht',1,1)$q$, 'row-level security');
select t.val('operator cannot read payments', 'select count(*)::text from public.payments', '0');
select t.as_db();
select t.as_user('mgr');
select t.ok ('manager can add a boat', $q$insert into public.boats(name,type,capacity,base_price) values ('Mgr-Boat','Fishing',4,3000)$q$);
select t.err('check: capacity 0 rejected',   $q$insert into public.boats(name,type,capacity,base_price) values ('Bad','Yacht',0,100)$q$, 'boats_chk');
select t.err('check: negative price rejected',$q$insert into public.boats(name,type,capacity,base_price) values ('Bad','Yacht',2,-5)$q$, 'boats_chk');
select t.err('check: bad type rejected',     $q$insert into public.boats(name,type,capacity,base_price) values ('Bad','Submarine',2,5)$q$, 'boats_chk');
select t.err('manager cannot read audit log (0 rows)', 'select 1/(select count(*) from public.audit_log)', 'division by zero');
select t.val('manager cannot change staff roles (0 rows)', $q$with u as (update public.users set role='Operator' where auth_id=t.uid('op') returning 1) select count(*)::text from u$q$, '0');
select t.err('manager cannot archive staff via RPC', $q$select public.archive_record('users', 1)$q$, 'not allowed');
select t.err('manager cannot forge deleted_at directly', $q$update public.boats set deleted_at='2000-01-01'$q$, 'permission denied');
select t.as_db();

-- ── 5. booking rules ──────────────────────────────────────
create function t.d(n int) returns date language sql as $$ select ((now() at time zone 'Africa/Nairobi')::date + n) $$;
select t.as_user('alice');
select t.err('client cannot send total_amount', format($q$insert into public.bookings(customer_id,boat_id,start_date,end_date,total_amount) values (public.my_customer_id(),(select id from public.boats where name='T-Boat1'),%L,%L,1)$q$, t.d(10), t.d(13)), 'permission denied');
select t.err('client cannot send status', format($q$insert into public.bookings(customer_id,boat_id,start_date,end_date,status) values (public.my_customer_id(),(select id from public.boats where name='T-Boat1'),%L,%L,'Approved')$q$, t.d(10), t.d(13)), 'permission denied');
select t.err('cannot book for someone else', format($q$insert into public.bookings(customer_id,boat_id,start_date,end_date) values ((select id from public.customers where email='bob@x.com'),(select id from public.boats where name='T-Boat1'),%L,%L)$q$, t.d(10), t.d(13)), 'only create bookings for your own');
select t.err('past start date', format($q$insert into public.bookings(customer_id,boat_id,start_date,end_date) values (public.my_customer_id(),(select id from public.boats where name='T-Boat1'),%L,%L)$q$, t.d(-3), t.d(2)), 'in the past');
select t.err('end before start', format($q$insert into public.bookings(customer_id,boat_id,start_date,end_date) values (public.my_customer_id(),(select id from public.boats where name='T-Boat1'),%L,%L)$q$, t.d(12), t.d(10)), 'after the start');
select t.err('longer than 30 days', format($q$insert into public.bookings(customer_id,boat_id,start_date,end_date) values (public.my_customer_id(),(select id from public.boats where name='T-Boat1'),%L,%L)$q$, t.d(10), t.d(60)), 'longer than 30');
select t.err('maintenance boat not bookable', format($q$insert into public.bookings(customer_id,boat_id,start_date,end_date) values (public.my_customer_id(),(select id from public.boats where name='T-Maint'),%L,%L)$q$, t.d(10), t.d(12)), 'maintenance');
select t.ok ('valid booking accepted', format($q$insert into public.bookings(customer_id,boat_id,start_date,end_date,notes) values (public.my_customer_id(),(select id from public.boats where name='T-Boat1'),%L,%L,'<script>x</script>')$q$, t.d(10), t.d(13)));
select t.val('server computed price = 3 days x 1000', $q$select total_amount::text from public.bookings where notes like '%script%'$q$, '3000');
select t.val('status forced to Pending', $q$select status||'/'||payment_status from public.bookings where notes like '%script%'$q$, 'Pending/Unpaid');
select t.err('customer cannot approve own booking', $q$update public.bookings set status='Approved'$q$, 'cannot change a booking from Pending to Approved');
select t.err('customer cannot edit price (column privilege)', $q$update public.bookings set total_amount=1$q$, 'permission denied');
select t.err('customer cannot mark paid (column privilege)', $q$update public.bookings set payment_status='Paid'$q$, 'permission denied');
select t.as_db();
select t.as_user('bob');
select t.ok('bob books same boat, overlapping pending', format($q$insert into public.bookings(customer_id,boat_id,start_date,end_date) values (public.my_customer_id(),(select id from public.boats where name='T-Boat1'),%L,%L)$q$, t.d(11), t.d(14)));
select t.val('bob cannot see alice''s bookings', $q$select count(*)::text from public.bookings where notes like '%script%'$q$, '0');
select t.as_db();
select t.as_user('op');
select t.val('operator cannot approve (0 rows)', $q$with u as (update public.bookings set status='Approved' returning 1) select count(*)::text from u$q$, '0');
select t.as_db();
select t.as_user('mgr');
select t.val('manager sees both bookings', 'select count(*)::text from public.bookings', '2');
select t.ok ('manager approves alice booking', $q$update public.bookings set status='Approved' where notes like '%script%'$q$);
select t.val('approved_by stamped by server', $q$select (approved_by = public.staff_id())::text from public.bookings where notes like '%script%'$q$, 'true');
select t.err('DOUBLE BOOKING: approving overlapping booking is blocked', $q$update public.bookings set status='Approved' where notes is null and status='Pending'$q$, 'exclusion|already booked|conflict');
select t.as_db();
select t.as_user('bob');
select t.err('DOUBLE BOOKING at insert (overlaps approved)', format($q$insert into public.bookings(customer_id,boat_id,start_date,end_date) values (public.my_customer_id(),(select id from public.boats where name='T-Boat1'),%L,%L)$q$, t.d(12), t.d(15)), 'already booked');
select t.ok('back-to-back booking allowed (checkout day = next start)', format($q$insert into public.bookings(customer_id,boat_id,start_date,end_date) values (public.my_customer_id(),(select id from public.boats where name='T-Boat1'),%L,%L)$q$, t.d(13), t.d(15)));
select t.ok('customer can cancel own Pending booking', $q$update public.bookings set status='Cancelled' where status='Pending'$q$);
select t.as_db();

-- ── 6. payments: atomic, validated, immutable ─────────────
select t.as_user('bob');
select t.err('cannot pay someone else''s booking', $q$select public.record_payment((select id from public.bookings where notes like '%script%'),100,'Cash',null)$q$, 'not allowed|not found');
select t.err('direct INSERT into payments denied', $q$insert into public.payments(booking_id,amount,method) values (1,1,'Cash')$q$, 'permission denied');
select t.as_db();
select t.as_user('alice');
select t.err('overpay rejected', $q$select public.record_payment((select id from public.bookings where notes like '%script%'),3001,'Cash',null)$q$, 'more than the outstanding');
select t.err('zero/negative amount rejected', $q$select public.record_payment((select id from public.bookings where notes like '%script%'),-5,'Cash',null)$q$, 'greater than zero');
select t.err('unknown method rejected', $q$select public.record_payment((select id from public.bookings where notes like '%script%'),100,'Bitcoin',null)$q$, 'Unknown payment method');
select t.err('bad M-Pesa code rejected', $q$select public.record_payment((select id from public.bookings where notes like '%script%'),100,'MPesa','abc')$q$, '10-character');
select t.val('failed payments left NO rows (atomic)', 'select count(*)::text from public.payments', '0');
select t.val('partial payment -> Partial', $q$select public.record_payment((select id from public.bookings where notes like '%script%'),1000,'MPesa','qwe1234567')->>'payment_status'$q$, 'Partial');
select t.err('duplicate M-Pesa code rejected', $q$select public.record_payment((select id from public.bookings where notes like '%script%'),500,'MPesa','QWE1234567')$q$, 'duplicate|unique');
select t.val('only 1 payment stored after duplicate', 'select count(*)::text from public.payments', '1');
select t.err('cannot complete booking if unpaid (customer cannot complete)', $q$update public.bookings set status='Completed'$q$, 'cannot change');
select t.val('final payment -> Paid', $q$select public.record_payment((select id from public.bookings where notes like '%script%'),2000,'Cash',null)->>'payment_status'$q$, 'Paid');
select t.val('customer sees own payments', 'select count(*)::text from public.payments', '2');
select t.as_db();
select t.as_user('mgr');
select t.ok ('manager completes a fully paid booking', $q$update public.bookings set status='Completed' where notes like '%script%'$q$);
select t.err('cannot pay a completed booking', $q$select public.record_payment((select id from public.bookings where notes like '%script%'),1,'Cash',null)$q$, 'Only approved');
select t.err('manager cannot delete a payment', 'delete from public.payments', 'permission denied');
select t.err('manager cannot edit a payment',   'update public.payments set amount=1', 'permission denied');
select t.as_db();
select t.err('payments immutable even for DB owner (update)', 'update public.payments set amount=1', 'append-only');
select t.err('payments immutable even for DB owner (delete)', 'delete from public.payments', 'append-only');

-- ── 7. incidents ──────────────────────────────────────────
select t.as_user('op');
select t.ok ('operator can report incident', $q$insert into public.incidents(boat_id,description) values ((select id from public.boats where name='T-Boat1'),'Hull scratch')$q$);
select t.val('operator cannot resolve (0 rows)', $q$with u as (update public.incidents set status='Resolved' returning 1) select count(*)::text from u$q$, '0');
select t.as_db();
select t.as_user('mgr');
select t.val('manager resolves', $q$with u as (update public.incidents set status='Resolved' returning 1) select count(*)::text from u$q$, '1');
select t.as_db();

-- ── 8. soft delete + lock-out ─────────────────────────────
select t.as_user('mgr');
select t.err('manager cannot soft-delete staff directly', $q$update public.users set deleted_at=now() where auth_id=t.uid('op')$q$, 'permission denied');
select t.ok ('manager archives a boat via RPC', $q$select public.archive_record('boats', (select id from public.boats where name='Mgr-Boat'))$q$);
select t.as_db();
select t.val('deleted_at stamped by server', $q$select (deleted_at > now() - interval '1 minute')::text from public.boats where name='Mgr-Boat'$q$, 'true');
select t.val('deleted_by recorded', $q$select (deleted_by = t.uid('mgr'))::text from public.boats where name='Mgr-Boat'$q$, 'true');
select t.as_user('mgr');
select t.val('soft-deleted boat hidden from manager', $q$select count(*)::text from public.boats where name='Mgr-Boat'$q$, '0');
select t.as_db();
select t.err('hard delete blocked for DB owner too', $q$delete from public.boats where name='Mgr-Boat'$q$, 'never hard-deleted');
select t.as_user('admin');
select t.val('admin still sees archived boat', $q$select count(*)::text from public.boats where name='Mgr-Boat'$q$, '1');
select t.err('admin cannot forge deleted_at directly either', $q$update public.users set deleted_at=now() where auth_id=t.uid('admin')$q$, 'permission denied');
select t.err('admin cannot demote self', $q$update public.users set role='Operator' where auth_id=t.uid('admin')$q$, 'cannot change your own');
select t.ok ('admin disables operator via RPC', $q$select public.archive_record('users', (select id from public.users where auth_id=t.uid('op')))$q$);
select t.err('admin cannot remove self via RPC', $q$select public.archive_record('users', (select id from public.users where auth_id=t.uid('admin')))$q$, 'cannot change your own');
select t.ok ('admin can restore archived boat', $q$select public.archive_record('boats', (select id from public.boats where name='Mgr-Boat'), true)$q$);
select t.ok ('admin re-archives it', $q$select public.archive_record('boats', (select id from public.boats where name='Mgr-Boat'))$q$);
select t.as_db();
select t.as_user('op');
select t.err('disabled staff is locked out at next login', 'select public.bootstrap_profile()', 'disabled');
select t.val('disabled staff has no data access', 'select count(*)::text from public.bookings', '0');
select t.as_db();
select t.as_user('alice');
select t.err('customer cannot soft-delete self (column)', $q$update public.customers set deleted_at=now() where auth_id=t.uid('alice')$q$, 'permission denied');
select t.err('customer cannot soft-delete self (RPC)', $q$select public.archive_record('customers', public.my_customer_id())$q$, 'not allowed');
select t.ok ('customer can edit own phone', $q$update public.customers set phone='+254722222222' where auth_id=t.uid('alice')$q$);
select t.err('customer bad phone rejected by CHECK', $q$update public.customers set phone='<img src=x>' where auth_id=t.uid('alice')$q$, 'customers_chk');
select t.err('customer cannot change e-mail (column privilege)', $q$update public.customers set email='a@b.c' where auth_id=t.uid('alice')$q$, 'permission denied');
select t.val('customer cannot edit another customer (0 rows)', $q$with u as (update public.customers set full_name='pwn' where auth_id=t.uid('bob') returning 1) select count(*)::text from u$q$, '0');
select t.as_db();

-- ── 9. audit log ──────────────────────────────────────────
select t.val('audit: booking insert recorded', $q$select (count(*)>=2)::text from public.audit_log where table_name='bookings' and action='INSERT'$q$, 'true');
select t.val('audit: approval recorded with actor e-mail', $q$select actor_email||'/'||actor_role from public.audit_log where table_name='bookings' and 'status' = any(changed_fields) and new_data->>'status'='Approved' limit 1$q$, 'mgr@x.com/Manager');
select t.val('audit: soft delete + restore labelled', $q$select string_agg(action, ',' order by id) from public.audit_log where table_name='boats' and action in ('SOFT_DELETE','RESTORE')$q$, 'SOFT_DELETE,RESTORE,SOFT_DELETE');
select t.val('audit: payments recorded', $q$select count(*)::text from public.audit_log where table_name='payments' and action='INSERT'$q$, '2');
select t.err('audit log is append-only (update)', 'update public.audit_log set action=''x''', 'append-only');
select t.err('audit log is append-only (delete)', 'delete from public.audit_log', 'append-only');
select t.as_user('admin');
select t.val('admin can read audit log', 'select (count(*)>10)::text from public.audit_log', 'true');
select t.err('admin cannot tamper with audit log', 'delete from public.audit_log', 'permission denied');
select t.as_db();

-- ── 10. storage policies ──────────────────────────────────
select t.as_user('alice');
select t.err('customer cannot upload to boats', $q$insert into storage.objects(bucket_id,name) values ('boats','11111111-1111-1111-1111-111111111111.png')$q$, 'row-level security');
select t.as_db();
select t.as_user('mgr');
select t.ok ('manager uploads boat photo (uuid name)', $q$insert into storage.objects(bucket_id,name) values ('boats','11111111-1111-1111-1111-111111111111.png')$q$);
select t.err('bad object name rejected (path traversal / html)', $q$insert into storage.objects(bucket_id,name) values ('boats','../../evil.html')$q$, 'row-level security');
select t.err('manager cannot overwrite (no UPDATE policy)', $q$with u as (update storage.objects set name='22222222-1111-1111-1111-111111111111.png' returning 1) select 1/count(*) from u$q$, 'division by zero|permission');
select t.as_db();

-- ── report ────────────────────────────────────────────────
select case when ok then 'PASS' else 'FAIL' end as r, name, coalesce(detail,'') from t.results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
rollback;
