# Coast Boat Rental — CBRDMS

Boat-rental management web app (staff back-office + customer portal). Plain HTML/JS front end, **Supabase** backend.

- **Security write-up (OWASP Top 10 mapping):** [SECURITY.md](SECURITY.md)
- **Database:** [schema.sql](schema.sql) — tables, constraints, RLS, triggers, audit log, atomic payment function. Re-runnable.
- **Tests:** `supabase/tests/security_tests.sql` (database, 111 checks) · `tests/e2e_security.py` (browser XSS/CSP/auth)

## Run it
```bash
npm install          # exact pinned versions from package-lock.json
npm run build        # vendors libraries, compiles Tailwind, writes SRI hashes + header files
npx serve .          # or any static file server
```
Then follow *One-time set-up* in SECURITY.md (run `schema.sql`, create the first admin, Auth settings).

## Scripts
| Command | What it does |
|---|---|
| `npm run build` | copy libs to `vendor/`, compile Tailwind, update SRI hashes, regenerate `_headers` / `vercel.json` |
| `npm run verify` | fail if anything generated is out of date (used in CI) |
| `npm run audit` | `npm audit` for high/critical vulnerabilities |
