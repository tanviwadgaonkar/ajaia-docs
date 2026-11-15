# AI workflow note

**Tools:** Claude (Claude Code agent mode in a cloud sandbox) for scaffolding, implementation, test writing and docs; a headless Chrome driven by Playwright for UI verification.

**Where AI materially sped things up**
- Scaffolding the whole vertical slice (schema, Express routes, importer pipeline, SPA, share modal) in one pass instead of hand-typing boilerplate.
- Writing the API test matrix (role × action) and a three-browser Playwright script that exercises the real flows.
- Drafting README/architecture/submission docs from the code that actually exists.

**What I changed or rejected**
- *Rejected* `better-sqlite3` (native compile = risk on reviewer machines/hosts) in favour of Node 22's built-in `node:sqlite`; then, once I realised the free host's disk is ephemeral, added hosted Postgres (Neon) behind a small adapter and kept SQLite for local dev.
- Regex-refactoring the sync queries to async briefly produced mangled lines (`Date.now(])`); caught by `node --check`/tests and fixed by hand.
- *Rejected* a React/Tiptap + bundler setup: more moving parts than the timebox justified. Chose Quill 2 served as static files.
- *Chose* sanitized HTML over Quill Delta so txt/md/docx importers share one pipeline; added a server-side allow-list because imported/API-supplied HTML is untrusted.
- *Returned 404 (not 403)* for documents the caller can't see, so existence isn't leaked.
- *Fixed* an AI-generated bug found only by looking at a screenshot: passing `null` children to `replaceChildren()` rendered the literal text "null" on the editor page.
- *Caught in review:* the first autosave marked the doc "Saved" when an earlier request returned even if newer edits had been typed meanwhile. Fixed with an edit-revision counter (a save only clears `dirty` if no newer edit happened), then wrote a Playwright test that holds the first save open, types more, and confirmed it fails on the old logic and passes on the fix.
- Made the Postgres test setup report its real startup error (root user, bad URL, initdb output) instead of an opaque "tests cancelled".
- Fixed the test command (`node --test tests/` fails on Node 22; globbed files instead).

**How I verified**
- `npm test`: 6 API tests run against **both SQLite and a real Postgres** (embedded throwaway server) — auth, create/rename/edit/reopen with formatting preserved, validation + XSS stripping, full share matrix (viewer can't edit, editor can't re-share/delete, strangers get 404, revoke works), plus a dedicated viewer-cannot-write / unrelated-user-cannot-read test, and import (txt/md success; bad type/empty/corrupt rejected).
- Playwright E2E with three separate browser sessions (Alice/Bob/Carol): format → reload → persisted; share → Bob sees it under *Shared with me*; Bob's edit appears in Alice's open tab via polling; Carol's editor is read-only; `.docx` import produces headings/bold/bullets.
- Manually reviewed screenshots of home, editor, share modal and viewer mode for UX problems.
- Restart check on Postgres: created a doc + share, killed and restarted the server, confirmed doc, share and login session were intact.
- Known limit: I did not test on mobile viewports or in Safari/Firefox.
