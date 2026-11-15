# Ajaia Docs — lightweight collaborative document editor

Rich-text editor with document create/rename/save, file import, and owner/editor/viewer sharing.
Stack: **Node 22 + Express 5 + Postgres (hosted, durable) / SQLite (zero-setup local) + Quill 2** (vanilla JS frontend, no build step).
Set `DATABASE_URL` to use Postgres; leave it unset and the app uses a local SQLite file.

**Live demo:** see `SUBMISSION.md` · **Architecture:** `ARCHITECTURE.md` · **AI workflow:** `AI_WORKFLOW.md`

## Run locally

Requires **Node ≥ 22.5**. No database install needed — without `DATABASE_URL` it uses SQLite (built into Node).

```bash
npm install
npm start            # http://localhost:3000
npm test             # API tests, run against BOTH SQLite and a real Postgres
```

Run locally against Postgres: `DATABASE_URL=postgres://user:pass@localhost:5432/db npm start` (tables and demo users are created automatically; `PGSSL=disable` if your server has no TLS).

`npm test` starts a throwaway embedded Postgres automatically (it cannot run as root, e.g. inside some containers). Or point it at your own: `TEST_DATABASE_URL=postgres://… npm test` (use an empty/disposable database). If Postgres setup fails, the test output prints the real reason; `SKIP_PG_TESTS=1 npm test` runs SQLite only.

Browser regression test for the autosave race (needs Playwright, app running): `BASE_URL=http://localhost:3000 python3 tests/e2e/autosave-race.py`.

Env vars (all optional locally): `PORT` (default 3000), `DATABASE_URL` (Postgres; takes precedence), `DB_PATH` (SQLite file, default `./data/app.db`), `PGSSL=disable`.

## Demo accounts (seeded, password `demo123`)

| User | Email | Seeded state |
|---|---|---|
| Alice Owner | alice@example.com | Owns "Welcome to Ajaia Docs" |
| Bob Reviewer | bob@example.com | Has **edit** access to Alice's welcome doc |
| Carol Viewer | carol@example.com | No access until Alice shares something |

The login screen has one-click buttons for each account.

## 2-minute review path

1. Sign in as **Alice** → **+ New document** → rename it in the title bar → format text (headings, bold/italic/underline, lists). The status shows *Saving… → Saved ✓*. Refresh: everything persists.
2. **Share** → add `carol@example.com` as *View only* and `bob@example.com` as *Can edit*.
3. Open a second browser/incognito window, sign in as **Bob**: the doc is under **Shared with me** with a *Can edit* badge. Edit it — Alice's open tab picks up the change within ~4 s.
4. Sign in as **Carol**: same doc opens read-only (banner + disabled editor).
5. Home → **Import file…** → upload a `.txt`, `.md` or `.docx` → becomes a new editable document.

## Supported import types

`.txt`, `.md`, `.docx` only, max 5 MB (stated in the UI too). `.docx` uses Mammoth (headings, bold/italic/underline, lists, links survive; images, tables and comments are dropped). Anything else returns a clear error.

## Permissions

| Action | Owner | Editor | Viewer | No access |
|---|---|---|---|---|
| Read | ✅ | ✅ | ✅ | 404 |
| Edit content / rename | ✅ | ✅ | ❌ 403 | 404 |
| Share / unshare / change role | ✅ | ❌ | ❌ | 404 |
| Delete | ✅ | ❌ | ❌ | 404 |

## Deploy (free, no credit card) — Neon Postgres + Render

Data lives in **Neon** (free hosted Postgres), so it survives Render redeploys, restarts and sleep.

**A. Create the database (Neon)**
1. Sign up at https://neon.tech (GitHub/Google login works) → **Create project** (any name/region; Postgres 16+).
2. On the project dashboard click **Connect** → copy the **connection string** (looks like `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`). Keep it secret.

**B. Deploy the app (Render)**
1. Push this folder to a GitHub repo (`git init && git add . && git commit -m init && git push` to a new repo).
2. Sign up at https://render.com (GitHub login) → **New → Web Service** → select the repo.
3. Settings: **Runtime: Docker**, **Instance type: Free**, Health check path `/api/config`.
4. **Environment → Add variable:** `DATABASE_URL` = *the Neon connection string*. (`NODE_ENV=production` is set by the Dockerfile.)
5. **Create Web Service**. First build takes ~3–5 min. Tables and demo users are created automatically on first boot.
6. Open the `https://<name>.onrender.com` URL and run the review path above.

Notes: Render's free web service sleeps after ~15 min idle (first request takes ~30–60 s to wake; data is unaffected). Neon's free compute also auto-suspends and wakes on the first query.

## Layout

```
src/db.js        DB adapter (Postgres | SQLite), schema, seed, password hashing (scrypt)
src/app.js       Express app factory: auth, docs, sharing, import, error handling
src/importer.js  txt / md / docx → sanitized HTML
src/sanitize.js  server-side HTML allow-list
public/          SPA (index.html, app.js, styles.css); Quill served from node_modules
tests/           node:test API tests
```
