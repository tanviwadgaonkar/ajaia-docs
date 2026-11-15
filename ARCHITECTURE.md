# Architecture note

## What I prioritized (and why)
The brief rewards depth in a few areas, so I put the time into **a solid editing loop, real access control, and persistence you can trust**, and cut everything else.

1. **Editing experience** — Quill 2 gives headings, bold/italic/underline, ordered/bulleted lists and clear-formatting out of the box with good keyboard shortcuts. Autosave (700 ms debounce) with a visible *Saving… / Saved ✓ / Save failed* status, a flush on navigation, and an unsaved-changes guard on tab close.
2. **Access logic enforced on the server** — every document route resolves the caller's role (`owner | editor | viewer | none`) in one function (`loadDoc`). The UI hides controls, but the API is the source of truth (403 for insufficient role, **404 for no access** so document existence isn't leaked).
3. **Persistence** — **Postgres in production** (Neon free tier) so data survives redeploys and restarts on a host with an ephemeral disk; **SQLite locally** (Node's built-in `node:sqlite`) so `npm start` needs no setup. A small async adapter (`src/db.js`) exposes `get/all/run`; SQL is written once with `?` placeholders and rewritten to `$n` for Postgres. Foreign keys cascade (deleting a doc removes its shares). Sessions live in the DB, so logins survive restarts. The same test suite runs against both backends.
4. **Shippability** — single `npm start`, Dockerfile + `render.yaml`, seeded users, automated tests.

## Data model
`users(id, email, name, password[scrypt])` · `sessions(token, user_id)` · `documents(id, owner_id, title, content[HTML], created_at, updated_at)` · `shares(doc_id, user_id, role)` with `PRIMARY KEY(doc_id, user_id)` and `CHECK(role IN ('editor','viewer'))`.

## Key decisions
- **Content stored as sanitized HTML** (Quill `getSemanticHTML()` → server `sanitize-html` allow-list). Readable, exportable, and trivially produced by the importers. Trade-off vs. Quill Delta: Delta is a more faithful/diffable format, but HTML let the three importers (txt/md/docx) share one pipeline. Sanitizing on write defends against stored XSS from imports and hand-crafted API calls.
- **Auth is intentionally lightweight**: seeded accounts, scrypt-hashed passwords, random session tokens in an `httpOnly; SameSite=Lax` cookie (`Secure` in production). Not a production identity system — scoped per the brief.
- **No build step**: vanilla JS SPA with hash routing; Quill served from `node_modules`. Less tooling = fewer ways to fail a reviewer's setup.
- **Import = new document** from `.txt/.md/.docx` (Mammoth for docx, `marked` for md), 5 MB cap, extension allow-list, clear errors (415/422/413). Limits are stated in the UI and README.
- **"Collaboration" is polling, not real-time**: open editors poll every 4 s and adopt remote changes if the local user has no unsaved edits. It demonstrates shared access convincingly without WebSocket/CRDT complexity.

## Deliberately deprioritized
Real-time co-editing (OT/CRDT) — concurrent edits are **last-write-wins** at document level; comments/suggestions; version history; export to PDF/MD; real signup/password reset; attachments; images/tables in docx import; rate limiting; persistent disk on the free host.

## Next with 2–4 more hours
1. Yjs + y-websocket (or Tiptap Collaboration) for true multi-cursor editing and conflict-free merges.
2. Version history (append-only `document_versions` table) + restore.
3. Export to Markdown/PDF; docx tables/images.
4. Schema migrations (currently `CREATE TABLE IF NOT EXISTS` at boot); link-based sharing; per-user rate limiting.
