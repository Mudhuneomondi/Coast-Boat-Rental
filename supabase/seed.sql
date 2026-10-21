-- OPTIONAL demo data. Contains NO accounts or passwords (accounts live in Supabase Auth).
insert into public.boats (name, type, capacity, base_price, status) values
  ('Sea Explorer',  'Speedboat', 6,  8500,  'Available'),
  ('Ocean Queen',   'Yacht',     12, 25000, 'Available'),
  ('Fisher King',   'Fishing',   4,  5000,  'Available'),
  ('Sunset Cruise', 'Pontoon',   10, 15000, 'Maintenance')
on conflict do nothing;
