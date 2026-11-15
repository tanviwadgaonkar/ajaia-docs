# Submission — Ajaia Docs

## Links
- **Live product:** https://ajaia-docs-y5at.onrender.com (Render free tier — the first request after idle can take 30–60 s)
- **Walkthrough video:** `<<PASTE LOOM/YOUTUBE URL — NOT RECORDED YET>>` (also in `VIDEO_URL.txt`)

## Test accounts (all password `demo123`)
| Email | Role in seeded data |
|---|---|
| alice@example.com | Owner of "Welcome to Ajaia Docs" |
| bob@example.com | Editor on Alice's welcome doc |
| carol@example.com | No access until Alice shares (use for the viewer role) |

Sharing flow: sign in as Alice → open a doc → **Share** → add Carol as *View only* → sign in as Carol in a private window.

## What's included
| Path | Contents |
|---|---|
| `src/`, `public/`, `tests/` | Source: backend, SPA frontend, API tests, Playwright browser tests |
| `package.json`, `package-lock.json` | Dependencies and scripts (`npm start`, `npm test`) |
| `Dockerfile`, `render.yaml` | Deployment config (needs the `DATABASE_URL` env var) |
| `README.md` | Setup, run, tests, demo accounts, review path, limits, deploy/redeploy |
| `ARCHITECTURE.md` | Architecture note: priorities, data model, history semantics, decisions, cuts |
| `AI_WORKFLOW.md` | AI tools used, what was changed/rejected, verification, what's unverified |
| `SUBMISSION.md` | This file |
| `VIDEO_SCRIPT.md` | Timed outline for the walkthrough video |
| `VIDEO_URL.txt` | Walkthrough video URL (placeholder until recorded) |
| `docs/screenshots/` | Final UI screenshots (dashboard, editor, sharing dialog, view-only, history, mobile) |

## What's working
- Create, rename, edit, autosave and reopen documents; headings (H1–H3), bold, italic, underline, bulleted/numbered lists persist across refresh. Word count in the editor footer.
- Autosave uses an edit-revision counter so newer edits are never marked saved by an older request (regression-tested).
- Import `.txt`, `.md`, `.docx` (≤ 5 MB) into a new editable document; clear errors for bad type / empty / corrupt / oversize files.
- Sharing: owner grants *Can edit* or *View only* by email, changes role, revokes; "Owned by me" vs "Shared with me" with role badges; view-only mode is unmistakable in the UI and enforced by the API (403); strangers get 404.
- Version history (owner only): up to 10 snapshots per document, grouped autosaves, preview, restore (current content is saved first).
- Durable persistence: hosted Postgres (Neon) in production, SQLite locally; seeded demo users.
- Accessible dialogs (focus trap, Escape, focus return), keyboard focus styles, responsive layout checked at 375 px.
- Tests: 8 API tests on SQLite + Postgres; Playwright smoke and autosave-race tests (see `AI_WORKFLOW.md` for exactly what was run).

## What's incomplete / intentionally cut
- No real-time or conflict-free co-editing — saves are last-write-wins; tabs poll every 4 s. An owner restoring a version while another editor has unsaved edits open can be overwritten by that editor's next autosave.
- No comments, PDF/Markdown export, signup/password reset, attachments, docx images/tables, rate limiting.
- Not verified by the build agent: the updated live deployment, the Docker build, non-Chromium browsers.

## Next with 2–4 more hours
Yjs/Tiptap real-time collaboration with presence; named versions and diffs; export to Markdown/PDF; migration tooling; link sharing.
