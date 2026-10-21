// Public client configuration.
// The anon key is DESIGNED to be public — it only identifies the project. What it can
// do is limited by Row Level Security (see schema.sql). NEVER put the service_role
// key in this file or anywhere in the front end.
// If you change SUPABASE_URL, also update the CSP in index.html, _headers and vercel.json.
window.CBR = Object.freeze({
  SUPABASE_URL:      'https://vvnokweblgojqaqlbsyh.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2bm9rd2VibGdvanFhcWxic3loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MTE1OTgsImV4cCI6MjA4OTI4NzU5OH0.FWZseH-90QKOutDLSdrZf6QBtKO8G-BMCbvtNb6JUTI',
  IDLE_MINUTES:      15,      // automatic sign-out after this long without activity
  MIN_PASSWORD:      10,
});
