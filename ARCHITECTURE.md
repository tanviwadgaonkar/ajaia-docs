# Architecture note

## What was prioritized (and why)
Depth over breadth: a solid editing loop, server-enforced access control, durable persistence, and a coherent UI. Everything else was cut or documented.

1. **Editing experience** — Quill 2 (headings, bold/italic/underline, ordered/bulleted lists, clear formatting). Autosave with a visible *Saving… / Saved ✓ / Save failed* status.
   - **Autosave revision counter:** every user edit increments `editRev`; a finished save only marks the document clean if no newer edit happened while it was in flight, otherwise a follow-up save is sent. Covered by `tests/e2e/autosave-race.py` (fails on the old logic, passes now).
2. **Access logic on the server** — every document route resolves the caller's role (`owner | editor | viewer | none`) in `loadDoc`. 403 for insufficient role, **404 for no access** so existence isn't leaked. Sharing, delete and version history are owner-only.
3. **Persistence** — Postgres in production (Neon free tier) so data survives redeploys on a host with an ephemeral disk; SQLite locally so `npm start` needs no setup. A small async adapter (`src/db.js`) exposes `get/all/run`; SQL is written once with `?` placeholders and rewritten to `$n` for Postgres. Sessions live in the DB. The same tests run against both backends. The Postgres pool has an `error` listener so a connection dropped by the server (e.g. Neon suspending) is discarded and reconnected instead of crashing the process.
4. **UI/UX** — a small design system in `public/styles.css` (CSS variables: warm off-white background, white document surfaces, restrained indigo accent, shared radii/shadows/spacing, system font). Inline SVG icons with accessible labels, visible keyboard focus, responsive layouts (verified at 375 px, no horizontal overflow). One accessible dialog helper (focus trap, Escape, focus returns to the trigger) is used for sharing, history and delete confirmation.
5. **Shippability** — `npm start`, Dockerfile + `render.yaml`, seeded users, automated API + browser tests.

## Data model
`users(id, email, name, password[scrypt])` · `sessions(token, user_id, created_at)` · `documents(id, owner_id, title, content[sanitized HTML], created_at, updated_at)` · `shares(doc_id, user_id, role)` (`PK(doc_id,user_id)`, `CHECK role IN ('editor','viewer')`) · `document_versions(id, doc_id, title, content, editor_id, reason['edit'|'restore'], created_at)`.
Schema is applied at boot with `CREATE TABLE IF NOT EXISTS` — **additive only**; `document_versions` was added without touching existing tables or rows (verified by opening a Postgres database created by the previous version with the new code).

## Version history semantics
- On a content-changing save, the **previous** content is stored as a snapshot (recording the editor who made the change and the time) — unless a snapshot already exists within the last 5 minutes, which groups frequent autosaves. New/empty documents aren't snapshotted.
- Only the newest **10** snapshots per document are kept.
- **Restore** (owner only): the current content is first stored as a `restore` snapshot, then replaced by the chosen version; the title is unchanged. In the restoring browser, pending autosaves are flushed and awaited first, saving is blocked and the editor is disabled during the restore, so a stale autosave can't overwrite the restored content.
- **Not conflict-free:** if another editor has unsaved edits open when the owner restores, their next autosave will overwrite the restored text (last-write-wins).

## Other key decisions
- **Content stored as sanitized HTML** (Quill `getSemanticHTML()` → server `sanitize-html` allow-list), so txt/md/docx importers share one pipeline and imported/API-supplied HTML is untrusted. Trade-off vs. Quill Delta: Delta is more faithful/diffable.
- **Auth is intentionally lightweight:** seeded accounts, scrypt-hashed passwords, random session tokens in an `httpOnly; SameSite=Lax` cookie (`Secure` in production).
- **No build step:** vanilla JS SPA with hash routing; Quill served from `node_modules`.
- **"Collaboration" is polling (4 s), not real-time.**

## Deliberately deprioritized
Real-time co-editing (OT/CRDT), comments/suggestions, PDF/Markdown export, real signup/password reset, attachments, docx images/tables, rate limiting, schema migrations tooling, mobile-specific editor toolbar beyond wrapping.

## Next with more time
Yjs/Tiptap collaboration with presence; per-version diffs and named versions; export to Markdown/PDF; migrations tooling; link sharing; rate limiting.
