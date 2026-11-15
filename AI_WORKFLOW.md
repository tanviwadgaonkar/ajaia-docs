# AI workflow note

**Tool:** Claude (via Claude Code in a cloud sandbox), driven by prompts from the project author. A headless Chrome controlled by Playwright was used for UI checks. This note describes what the AI did and how it was checked; it makes no claim about any manual review beyond what's listed in the last section.

## Who did what
- **Project author (prompts):** supplied the assignment; set scope and priorities (core correctness first, then visual polish, version history only if time allowed, 60-minute timebox); asked for durable hosted persistence, the autosave race fix, clearer Postgres test errors, and the viewer/unrelated-user API test; created the GitHub repository and the Render service.
- **Claude:** wrote the code, tests and docs: Express/SQLite→Postgres adapter, Quill editor and SPA, importers, sharing, version history, the redesigned UI, Playwright scripts, and these notes.

## Where AI materially sped things up
- Producing the full vertical slice (schema, routes, importers, SPA, dialogs) and later the redesign and history feature in one pass each.
- Writing the role × action API test matrix and browser scripts that exercise real flows across three signed-in users.
- Keeping README/architecture/submission docs aligned with the code that exists.

## AI-generated output that was changed or rejected during the work
- Chose Node's built-in `node:sqlite` over `better-sqlite3` (avoids native builds); when the free host's ephemeral disk was identified as a durability risk, added hosted Postgres behind an adapter and kept SQLite for local use.
- Chose Quill served as static files over a React/Tiptap + bundler setup to keep the build simple.
- A first autosave implementation marked the document saved when an earlier request returned even if newer edits existed; replaced with an edit-revision counter and a regression test that fails on the old logic.
- A regex-based async refactor briefly produced mangled lines; found by syntax check/tests and fixed.
- A stray literal "null" rendered on the editor page (a `null` passed to `replaceChildren`) was found by looking at a screenshot and fixed.
- The first Postgres test setup failed opaquely; it now reports the real startup error.
- **A real bug found while stress-running tests:** ~25% of Postgres test runs exited non-zero because an idle pooled connection dropped by the server emitted an unhandled `error` event. The same would crash the app if Neon dropped an idle connection, so a pool `error` listener was added; 10 consecutive runs then passed.
- A first draft of the autosave regression test passed on both old and new logic (it didn't discriminate); it was rewritten to hold server responses so it fails on the bug.

## How correctness was verified (checks actually run)
- `npm test`: 8 API tests on SQLite and on a real Postgres (16 total), including viewer-cannot-modify, unrelated-user-gets-404, history grouping/cap/owner-only/restore, and cascade delete. Ten consecutive runs after the pool fix: 0 failures.
- Upgrade safety: opened a Postgres database created by the previous version with the new code; tables were added, existing users/documents unchanged.
- Restart persistence on Postgres (document, share and login session survive a server restart).
- Playwright browser runs on a fresh SQLite database: login, create/format/autosave/reload, share dialog keyboard flow (focus into dialog, Escape, focus returns to the Share button), editor live-update, view-only mode, `.docx` import, delete-confirmation cancel, history preview + restore (including that a reload doesn't bring the old text back), and no horizontal overflow at 375 px on login, dashboard, editor and share dialog.
- Autosave race regression test passes.
- Screenshots of the dashboard, editor, sharing dialog, view-only, history and mobile views were looked at for layout problems.

## Not verified
- The updated live Render deployment (not checked by Claude); the Docker image build; browsers other than Chromium; screen-reader behavior beyond roles/labels/focus checks; the browser tests against Postgres (API tests cover Postgres).

## Author's own review
_[Optional — add what you personally checked or decided. Left blank on purpose; nothing is claimed here on your behalf.]_
