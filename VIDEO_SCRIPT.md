# Video script — 3:30 to 4:30 min (Loom; record the live site https://ajaia-docs-y5at.onrender.com)

Before recording: open the live URL ~1 minute earlier (Render free sleeps). Two windows: normal (Alice) + private (Bob). Have a small `.docx` ready. Sign out/in as needed with the demo buttons (password `demo123`).

| Time | Show | Say |
|---|---|---|
| 0:00–0:25 | Login screen: point at "Demo accounts" | "Lightweight Google-Docs-style editor: Express, Postgres on Neon, Quill, vanilla JS. Scope: editing, import, sharing, persistence, plus a polished UI and owner-only version history." |
| 0:25–1:20 | Alice → New document → rename → heading, bold, italic, underline, bullet + numbered list → watch "Saved ✓" and word count → **refresh** | "Autosave with visible status. An edit-revision counter means a slow earlier save can't mark newer edits as saved. Content is stored as sanitized HTML and survives refresh." |
| 1:20–1:55 | Dashboard → Import file → `.docx` → opens editable. Point at "supports .txt, .md, .docx up to 5 MB" | "Upload becomes a new editable document — Mammoth for docx, marked for markdown; limits are stated in the UI." |
| 1:55–3:00 | Share → keyboard: type Bob, Enter (Can edit), Carol (View only); show Escape returning focus → private window Bob: "Shared with me / Can edit" → edit → Alice's tab updates in ~4 s → Carol: view-only banner | "Owner/editor/viewer enforced on the server: viewer gets 403, strangers get 404. 'Collaboration' is polling, not real-time or conflict-free — last write wins." |
| 3:00–3:30 | Alice → History → preview → Restore | "Owner-only history: up to 10 snapshots, autosaves grouped, restoring saves the current text first. Additive database change — no data dropped." |
| 3:30–4:00 | Terminal: `npm test` (green) | "8 API tests on SQLite and real Postgres, including viewer-can't-write and stranger-can't-read, history permissions, plus Playwright browser tests." |
| 4:00–4:30 | ARCHITECTURE.md / AI_WORKFLOW.md | "Cut: real-time co-editing, comments, export. Next: Yjs collaboration. AI: Claude Code wrote the code and tests from my prompts; the notes list what was changed, what was verified, and what wasn't." |

Say only what you actually did/checked; keep under 5:00. Don't claim the live deploy is verified until you've clicked through it.
