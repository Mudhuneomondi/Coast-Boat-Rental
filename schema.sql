-- ─────────────────────────────────────────────
-- CBRDMS FULL SCHEMA  (run in Supabase SQL Editor)
-- ─────────────────────────────────────────────

-- USERS (staff)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  full_name     TEXT,
  role          TEXT DEFAULT 'Operator',  -- Admin | Manager | Operator
  phone         TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- BOATS
CREATE TABLE IF NOT EXISTS boats (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,              -- Speedboat | Yacht | Fishing | Pontoon | Sailboat
  capacity    INTEGER NOT NULL,
  base_price  INTEGER NOT NULL,
  status      TEXT DEFAULT 'Available',   -- Available | Rented | Maintenance
  photo_urls  TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- CUSTOMERS (people who sign up via the portal)
CREATE TABLE IF NOT EXISTS customers (
  id           SERIAL PRIMARY KEY,
  full_name    TEXT NOT NULL,
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  phone        TEXT,
  id_number    TEXT,                      -- national ID / passport
  created_at   TIMESTAMP DEFAULT NOW()
);

-- BOOKINGS
CREATE TABLE IF NOT EXISTS bookings (
  id           SERIAL PRIMARY KEY,
  customer_id  INTEGER REFERENCES customers(id),
  boat_id      INTEGER REFERENCES boats(id),
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  total_amount INTEGER,
  status       TEXT DEFAULT 'Pending',    -- Pending | Approved | Rejected | Completed | Cancelled
  payment_status TEXT DEFAULT 'Unpaid',   -- Unpaid | Partial | Paid
  notes        TEXT,
  approved_by  INTEGER REFERENCES users(id),
  created_at   TIMESTAMP DEFAULT NOW()
);

-- PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
  id          SERIAL PRIMARY KEY,
  booking_id  INTEGER REFERENCES bookings(id),
  amount      INTEGER NOT NULL,
  method      TEXT NOT NULL,              -- Cash | Card | MPesa | Bank Transfer
  reference   TEXT,                       -- MPesa code, receipt number, etc.
  recorded_by INTEGER REFERENCES users(id),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- INCIDENTS
CREATE TABLE IF NOT EXISTS incidents (
  id             SERIAL PRIMARY KEY,
  boat_id        INTEGER REFERENCES boats(id),
  booking_id     INTEGER REFERENCES bookings(id),  -- optional link to booking
  description    TEXT NOT NULL,
  photo_urls     TEXT,
  status         TEXT DEFAULT 'Reported',           -- Reported | Resolved
  incident_date  TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- SAMPLE DATA
-- ─────────────────────────────────────────────

INSERT INTO users (email, password_hash, full_name, role, phone) VALUES
  ('admin@coastboat.com',    'demo123', 'Admin User',    'Admin',    '+254700000001'),
  ('manager@coastboat.com',  'demo123', 'Jane Manager',  'Manager',  '+254700000002'),
  ('operator@coastboat.com', 'demo123', 'John Operator', 'Operator', '+254700000003')
ON CONFLICT (email) DO NOTHING;

INSERT INTO boats (name, type, capacity, base_price, status) VALUES
  ('Sea Explorer',  'Speedboat', 6,  8500,  'Available'),
  ('Ocean Queen',   'Yacht',     12, 25000, 'Available'),
  ('Fisher King',   'Fishing',   4,  5000,  'Available'),
  ('Sunset Cruise', 'Pontoon',   10, 15000, 'Maintenance')
ON CONFLICT DO NOTHING;

INSERT INTO customers (full_name, email, password_hash, phone, id_number) VALUES
  ('Alice Wanjiru', 'alice@example.com', 'pass123', '+254711111111', '12345678'),
  ('Bob Kamau',     'bob@example.com',   'pass123', '+254722222222', '87654321')
ON CONFLICT (email) DO NOTHING;

-- ─────────────────────────────────────────────
-- DISABLE ROW LEVEL SECURITY (for student demo)
-- Remove these lines if you want to enforce RLS
-- ─────────────────────────────────────────────
ALTER TABLE users     DISABLE ROW LEVEL SECURITY;
ALTER TABLE boats     DISABLE ROW LEVEL SECURITY;
ALTER TABLE customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE bookings  DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments  DISABLE ROW LEVEL SECURITY;
ALTER TABLE incidents DISABLE ROW LEVEL SECURITY;
