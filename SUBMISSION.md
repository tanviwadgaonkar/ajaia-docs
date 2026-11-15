# Submission — Ajaia Docs

## Links
- **Live product:** `<<PASTE RENDER URL>>`
- **Walkthrough video:** `<<PASTE LOOM/YOUTUBE URL>>` (also in `VIDEO_URL.txt`)

## Test accounts (all password `demo123`)
| Email | Role in seeded data |
|---|---|
| alice@example.com | Owner of "Welcome to Ajaia Docs" |
| bob@example.com | Editor on Alice's welcome doc |
| carol@example.com | No access until Alice shares (use to test viewer role) |

Sharing flow: sign in as Alice → open any doc → **Share** → add Carol as *View only* → sign in as Carol in an incognito window.

## What's included
| Path | Contents |
|---|---|
| `src/`, `public/`, `tests/` | Source code (backend, SPA frontend, API tests, browser autosave-race test) |
| `package.json`, `package-lock.json` | Dependencies and scripts (`npm start`, `npm test`) |
| `Dockerfile`, `render.yaml` | Deployment config used for the live URL (needs `DATABASE_URL` env var) |
| `README.md` | Local setup, run, demo accounts, review path, permissions, deploy |
| `ARCHITECTURE.md` | Architecture note: priorities, data model, decisions, cuts |
| `AI_WORKFLOW.md` | AI tools used, what was changed/rejected, verification |
| `SUBMISSION.md` | This file |
| `VIDEO_SCRIPT.md` | Timed outline used for the walkthrough video |
| `VIDEO_URL.txt` | Walkthrough video URL |
| `docs/screenshots/` | Screenshots: home, editor, share modal, shared-with-me, viewer mode, docx import |

## What's working (end to end)
- Create, rename, edit, autosave, reopen documents; formatting (headings H1–H3, bold, italic, underline, bulleted/numbered lists, clear formatting) persists across refresh.
- Import `.txt`, `.md`, `.docx` (≤ 5 MB) into a new editable document; limits stated in UI + README; clear errors for bad type / empty / corrupt / oversize files.
- Sharing: owner grants *Can edit* or *View only* by email, changes role, revokes; "My documents" vs "Shared with me" with role badges; viewer mode is read-only in UI **and** enforced by the API (403).
- Durable persistence: hosted Postgres (Neon) in production, SQLite locally; seeded demo users; scrypt-hashed passwords; cookie sessions.
- Open editors pick up collaborators' saved changes within ~4 s (polling).
- Server-side HTML sanitization, input validation, consistent JSON errors.
- 6 automated API tests, run against both SQLite and real Postgres (`npm test`), including an explicit test that a viewer cannot modify a document and an unrelated user cannot access it; plus a Playwright E2E run (see `AI_WORKFLOW.md`).

## What's incomplete / intentionally cut
- No real-time co-editing — concurrent edits are last-write-wins per document.
- No comments, version history, PDF/MD export, signup/password reset, attachments, docx images/tables.
- Render free web service sleeps when idle (first request ~30–60 s). Data is durable in Neon Postgres.

## Next with 2–4 more hours
1. Yjs/Tiptap real-time collaboration with presence cursors.
2. Version history + restore.
3. Export to Markdown/PDF; richer docx import.
4. Schema migrations; link sharing.
