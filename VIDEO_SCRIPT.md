# Video script — 3:30 to 4:30 min (Loom, record the live URL, not localhost)

Setup before recording: two windows — normal (Alice) + incognito (Bob). Live URL loaded. Cut any cold-start wait (Render free sleeps; open the URL 1 min before recording).

| Time | Show | Say |
|---|---|---|
| 0:00–0:20 | Login screen | "Lightweight Google-Docs-style editor. Node, Express, SQLite, Quill. I scoped to editing, upload, sharing, persistence — depth over breadth." |
| 0:20–1:20 | Alice → New document → rename → type heading, bold, italic, underline, bullet + numbered list → watch "Saved ✓" → **refresh** | "Autosave with visible status. Formatting stored as sanitized HTML, so structure survives refresh." |
| 1:20–2:00 | Home → Import file → upload a .docx (have a heading + bullets ready) → opens as editable doc. Point at the "supports .txt .md .docx, 5 MB" hint | "Upload turns a file into a new editable doc. Mammoth for docx, marked for md. Limits stated in UI and README; bad types give clear errors." |
| 2:00–3:10 | Share → add Bob (Can edit) + Carol (View only) → switch to incognito Bob → "Shared with me" badge → edit → switch back to Alice, change appears in ~4s → incognito Carol → read-only banner | "Owner/editor/viewer enforced on the server — viewer gets 403, strangers get 404 so doc existence isn't leaked. 'Collaboration' is polling, not CRDT." |
| 3:10–3:50 | Terminal: `npm test` (5 green) — or the tests file briefly | "Tests cover the role × action matrix, validation + XSS stripping, import, formatting round-trip." |
| 3:50–4:30 | ARCHITECTURE.md / AI_WORKFLOW.md on screen | "Cut: real-time co-editing, comments, version history, export. Next: Yjs, version history, Postgres. AI: Claude Code scaffolded the slice; I rejected better-sqlite3 and a bundler setup, and caught a 'null' rendering bug via screenshot. Verified with API tests plus a 3-browser Playwright run." |

Tips: one take, no editing. Say what works, what you cut, why. Keep under 5:00.
