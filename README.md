# Ajaia Docs — lightweight collaborative document editor

Rich-text editor with document create/rename/autosave, file import, owner/editor/viewer sharing, and owner-only version history.
Stack: **Node 22 + Express 5 + Postgres (hosted, durable) / SQLite (zero-setup local) + Quill 2** — vanilla JS frontend, no build step.

- **Live demo:** https://ajaia-docs-y5at.onrender.com (free tier: first request after idle can take 30–60 s)
- Architecture: `ARCHITECTURE.md` · AI workflow: `AI_WORKFLOW.md` · What's included / status: `SUBMISSION.md` · Video outline: `VIDEO_SCRIPT.md`

## Demo accounts (seeded; password `demo123`)

| User | Email | Seeded state |
|---|---|---|
| Alice Owner | alice@example.com | Owns "Welcome to Ajaia Docs" |
| Bob Reviewer | bob@example.com | Has **edit** access to the welcome doc |
| Carol Viewer | carol@example.com | No access until Alice shares something |

The login screen explains these are demo accounts and fills the form in one click.

## Run locally

Requires **Node ≥ 22.5**. No database install needed — without `DATABASE_URL` it uses a local SQLite file.

```bash
npm install
npm start            # http://localhost:3000
npm test             # API tests, run against BOTH SQLite and a real Postgres
```

Run against Postgres: `DATABASE_URL=postgres://user:pass@localhost:5432/db npm start` (tables and demo users are created automatically; `PGSSL=disable` if the server has no TLS).

Env vars (all optional locally): `PORT` (3000), `DATABASE_URL` (Postgres; takes precedence), `DB_PATH` (SQLite file, default `./data/app.db`), `PGSSL=disable`.

### Tests
- `npm test` — 8 API tests × 2 backends. Covers auth, create/rename/edit/reopen, validation and HTML sanitizing, sharing roles, **viewer cannot modify / unrelated user cannot access**, import, and **version history** (grouping, 10-snapshot cap, owner-only, restore keeps current content, cascade delete).
  It starts a throwaway embedded Postgres (cannot run as root). Alternatives: `TEST_DATABASE_URL=postgres://…` (disposable DB) or `SKIP_PG_TESTS=1` for SQLite only. If Postgres setup fails, the real reason is printed.
- Browser tests (need `pip install playwright` + a Chromium/Chrome, app running on a **fresh** database):
  - `BASE_URL=http://localhost:3000 python3 tests/e2e/smoke.py` — login, format/save/reload, sharing dialog + keyboard focus, editor/viewer roles, live update, import, delete confirmation, history restore, no horizontal overflow at 375 px; also writes screenshots to `docs/screenshots/`.
  - `BASE_URL=http://localhost:3000 python3 tests/e2e/autosave-race.py` — regression test: an in-flight save must not mark newer edits as saved.

## 2-minute review path
1. Sign in as **Alice** → **New document** → rename in the title bar → format text (headings, bold/italic/underline, lists). Status shows *Saving… → Saved ✓*; refresh and it persists.
2. **Share** → add `carol@example.com` as *View only* and `bob@example.com` as *Can edit* (Esc closes the dialog and returns focus to the button).
3. In a second window sign in as **Bob**: the doc is under **Shared with me** (*Can edit*). Edit it — Alice's tab picks it up within ~4 s.
4. Sign in as **Carol**: same doc opens read-only with an unmistakable banner.
5. Dashboard → **Import file** → `.txt`, `.md` or `.docx` becomes a new editable document.
6. As Alice, edit a doc, then **History** → preview a snapshot → **Restore this version** (your current text is saved as a version first).

## Features and limits
- **Import:** `.txt`, `.md`, `.docx` only, max 5 MB (stated in the UI). Mammoth keeps headings, bold/italic/underline, lists, links; images/tables/comments are dropped.
- **Permissions:** Owner = everything. Editor = read/edit/rename. Viewer = read only. Others get 404. Sharing, delete and history are owner-only (enforced by the API, not just hidden in the UI).
- **Version history (owner only):** a snapshot of the previous text is saved before an editing session changes it; edits within 5 minutes share one snapshot; the newest 10 are kept; restoring first snapshots the current text.
- **Collaboration is NOT real-time and NOT conflict-free.** Saves are last-write-wins per document; open tabs poll every 4 s and adopt others' changes only when they have no unsaved edits. Two people typing at once can overwrite each other.

## Deploy (free, no card) — Neon Postgres + Render
1. **Neon:** create a project at https://neon.tech, click **Connect**, copy the connection string (`postgresql://…?sslmode=require`).
2. **GitHub:** push this folder to a repo.
3. **Render:** New → Web Service → the repo → Runtime **Docker**, Free instance, health check path `/api/config`. Add env var `DATABASE_URL` = the Neon string. Create. Tables, demo users and the history table are created automatically on boot (additive, `CREATE TABLE IF NOT EXISTS` — existing data is never dropped).
4. **Updating an existing deployment:** replace the files in the repo, commit, push; Render auto-deploys (or Manual Deploy → Deploy latest commit). No new service or database is needed.

## Layout
```
src/db.js        DB adapter (Postgres | SQLite), schema, seed, password hashing (scrypt)
src/app.js       Express app: auth, docs, sharing, import, version history, error handling
src/importer.js  txt / md / docx → sanitized HTML
src/sanitize.js  server-side HTML allow-list
public/          SPA (index.html, app.js, styles.css); Quill served from node_modules
tests/           node:test API tests; tests/e2e/ Playwright browser tests
docs/screenshots final UI screenshots
```
