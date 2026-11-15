'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

let server, base, db;
let cleanups = [];

async function startServer(makeDb) {
  db = await makeDb();
  await new Promise((r) => { server = createApp(db).listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}
async function stopServer() { await new Promise((r) => server.close(r)); await db.close(); for (const c of cleanups.reverse()) await c(); cleanups = []; }

// Real Postgres for tests: TEST_DATABASE_URL if given, otherwise an embedded throwaway server.
// Any failure is re-thrown with a clear, actionable message (instead of an opaque "tests cancelled").
async function pgUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    throw new Error('Cannot start the embedded Postgres test server as root (initdb refuses to run as root). ' +
      'Run `npm test` as a non-root user, or set TEST_DATABASE_URL=postgres://… to a disposable database, or SKIP_PG_TESTS=1 to run SQLite only.');
  }
  const logs = [];
  let pg, dir;
  try {
    const EmbeddedPostgres = require('embedded-postgres').default;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ajaia-pg-'));
    const port = 54000 + Math.floor(Math.random() * 900);
    pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
      onLog: (m) => logs.push(String(m)), onError: (m) => logs.push(String(m)) });
    await pg.initialise(); await pg.start();
    cleanups.push(async () => { await pg.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
    return `postgres://postgres:pw@127.0.0.1:${port}/postgres`;
  } catch (e) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    const tail = logs.slice(-8).join('\n  ').trim();
    throw new Error(`Postgres test setup failed to start the embedded server: ${e.message}` + (tail ? `\nServer output:\n  ${tail}` : '') +
      '\nFix the error above, set TEST_DATABASE_URL to an existing disposable Postgres, or set SKIP_PG_TESTS=1 to run SQLite only.');
  }
}

// Surfaces the real reason on stderr up front, then fails the suite with the same message.
async function openPostgres() {
  try {
    const url = await pgUrl();
    return await openDb({ url });
  } catch (e) {
    const msg = e.message.startsWith('Postgres test setup') || e.message.startsWith('Cannot start') ? e.message
      : `Could not connect to Postgres (${process.env.TEST_DATABASE_URL ? 'TEST_DATABASE_URL' : 'embedded'}): ${e.message}`;
    console.error(`\n[postgres test setup] ${msg}\n`);
    throw new Error(msg);
  }
}

const backends = [['sqlite', async () => openDb({ url: null, file: ':memory:' })]];
if (!process.env.SKIP_PG_TESTS) backends.push(['postgres', openPostgres]);

for (const [label, makeDb] of backends) {
describe(`API [${label}]`, async (t) => {
before(() => startServer(makeDb));
after(stopServer);

async function login(email) {
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'demo123' }) });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const call = async (path, { method = 'GET', body, form } = {}) => {
    const headers = { cookie };
    let payload;
    if (form) payload = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(base + '/api' + path, { method, headers, body: payload });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  return call;
}

test('rejects unauthenticated and bad-password requests', async () => {
  assert.equal((await fetch(base + '/api/docs')).status, 401);
  const bad = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com', password: 'nope' }) });
  assert.equal(bad.status, 401);
});

test('create, rename, edit, reopen preserves formatting', async () => {
  const alice = await login('alice@example.com');
  const { data: created } = await alice('/docs', { method: 'POST', body: { title: 'Plan' } });
  const html = '<h1>Hi</h1><p><strong>bold</strong> <em>it</em> <u>un</u></p><ol><li>one</li></ol><ul><li>dot</li></ul>';
  const put = await alice(`/docs/${created.id}`, { method: 'PUT', body: { title: 'Renamed', content: html } });
  assert.equal(put.status, 200);
  const { data: doc } = await alice(`/docs/${created.id}`);
  assert.equal(doc.title, 'Renamed');
  assert.equal(doc.content, html);
  assert.equal(doc.role, 'owner');
});

test('validation: empty title, oversize title, script content stripped', async () => {
  const alice = await login('alice@example.com');
  const { data: d } = await alice('/docs', { method: 'POST', body: {} });
  assert.equal((await alice(`/docs/${d.id}`, { method: 'PUT', body: { title: '   ' } })).status, 400);
  assert.equal((await alice(`/docs/${d.id}`, { method: 'PUT', body: { title: 'x'.repeat(201) } })).status, 400);
  await alice(`/docs/${d.id}`, { method: 'PUT', body: { content: '<p>ok</p><script>alert(1)</script><img src=x onerror=alert(1)>' } });
  const { data: doc } = await alice(`/docs/${d.id}`);
  assert.equal(doc.content, '<p>ok</p>');
});

test('sharing: owner grants access, roles enforced, strangers get 404', async () => {
  const alice = await login('alice@example.com');
  const bob = await login('bob@example.com');
  const carol = await login('carol@example.com');
  const { data: d } = await alice('/docs', { method: 'POST', body: { title: 'Secret' } });

  assert.equal((await bob(`/docs/${d.id}`)).status, 404, 'unshared doc is invisible');

  assert.equal((await alice(`/docs/${d.id}/shares`, { method: 'POST', body: { email: 'bob@example.com', role: 'viewer' } })).status, 201);
  const view = await bob(`/docs/${d.id}`);
  assert.equal(view.status, 200);
  assert.equal(view.data.role, 'viewer');
  assert.equal((await bob(`/docs/${d.id}`, { method: 'PUT', body: { content: '<p>hax</p>' } })).status, 403, 'viewer cannot edit');

  await alice(`/docs/${d.id}/shares`, { method: 'POST', body: { email: 'bob@example.com', role: 'editor' } });
  assert.equal((await bob(`/docs/${d.id}`, { method: 'PUT', body: { content: '<p>bob was here</p>' } })).status, 200, 'editor can edit');
  assert.equal((await bob(`/docs/${d.id}`, { method: 'DELETE' })).status, 403, 'editor cannot delete');
  assert.equal((await bob(`/docs/${d.id}/shares`, { method: 'POST', body: { email: 'carol@example.com', role: 'editor' } })).status, 403, 'editor cannot re-share');

  const list = await bob('/docs');
  assert.ok(list.data.shared.some((x) => x.id === d.id && x.role === 'editor'), 'appears under Shared with me');
  assert.ok(!list.data.owned.some((x) => x.id === d.id));

  assert.equal((await carol(`/docs/${d.id}`)).status, 404, 'unrelated user still blocked');

  const bad = await alice(`/docs/${d.id}/shares`, { method: 'POST', body: { email: 'ghost@example.com', role: 'viewer' } });
  assert.equal(bad.status, 404);
  assert.equal((await alice(`/docs/${d.id}/shares`, { method: 'POST', body: { email: 'bob@example.com', role: 'admin' } })).status, 400);
  assert.equal((await alice(`/docs/${d.id}/shares`, { method: 'POST', body: { email: 'alice@example.com', role: 'editor' } })).status, 400);

  const { data: shares } = await alice(`/docs/${d.id}/shares`);
  await alice(`/docs/${d.id}/shares/${shares.shares[0].user_id}`, { method: 'DELETE' });
  assert.equal((await bob(`/docs/${d.id}`)).status, 404, 'revoked');
});

test('import: .txt and .md become documents; unsupported/empty rejected', async () => {
  const alice = await login('alice@example.com');
  const send = (name, content) => { const f = new FormData(); f.append('file', new Blob([content]), name); return alice('/docs/import', { method: 'POST', form: f }); };

  const txt = await send('notes.txt', 'Line one\nstill one\n\nSecond <b>para</b>');
  assert.equal(txt.status, 201);
  assert.equal(txt.data.title, 'notes');
  const { data: t } = await alice(`/docs/${txt.data.id}`);
  assert.equal(t.content, '<p>Line one<br />still one</p><p>Second &lt;b&gt;para&lt;/b&gt;</p>');

  const md = await send('readme.md', '# Title\n\n- a\n- b\n\n**bold**');
  assert.equal(md.status, 201);
  const { data: m } = await alice(`/docs/${md.data.id}`);
  assert.match(m.content, /<h1>Title<\/h1>/);
  assert.match(m.content, /<ul>/);
  assert.match(m.content, /<strong>bold<\/strong>/);

  assert.equal((await send('evil.exe', 'x')).status, 415);
  assert.equal((await send('empty.txt', '')).status, 400);
  assert.equal((await send('broken.docx', 'not a real docx')).status, 422);
});

test('viewer cannot modify via API; unrelated user cannot access at all', async () => {
  const alice = await login('alice@example.com');
  const carol = await login('carol@example.com');   // will be viewer
  const bob = await login('bob@example.com');       // stays unrelated
  const { data: d } = await alice('/docs', { method: 'POST', body: { title: 'Locked' } });
  await alice(`/docs/${d.id}`, { method: 'PUT', body: { content: '<p>original</p>' } });
  await alice(`/docs/${d.id}/shares`, { method: 'POST', body: { email: 'carol@example.com', role: 'viewer' } });

  // Viewer: can read, every write is rejected, content unchanged.
  assert.equal((await carol(`/docs/${d.id}`)).data.content, '<p>original</p>');
  assert.equal((await carol(`/docs/${d.id}`, { method: 'PUT', body: { content: '<p>changed</p>' } })).status, 403);
  assert.equal((await carol(`/docs/${d.id}`, { method: 'PUT', body: { title: 'Renamed' } })).status, 403);
  assert.equal((await carol(`/docs/${d.id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await carol(`/docs/${d.id}/shares`, { method: 'POST', body: { email: 'bob@example.com', role: 'editor' } })).status, 403);
  assert.equal((await carol(`/docs/${d.id}/shares`)).status, 403);
  const after = (await alice(`/docs/${d.id}`)).data;
  assert.equal(after.content, '<p>original</p>');
  assert.equal(after.title, 'Locked');
  assert.equal((await bob(`/docs/${d.id}`)).status, 404, 'carol could not grant bob access');

  // Unrelated user: every route 404s, doc absent from lists.
  assert.equal((await bob(`/docs/${d.id}`)).status, 404);
  assert.equal((await bob(`/docs/${d.id}`, { method: 'PUT', body: { content: '<p>x</p>' } })).status, 404);
  assert.equal((await bob(`/docs/${d.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await bob(`/docs/${d.id}/shares`)).status, 404);
  const list = (await bob('/docs')).data;
  assert.ok(![...list.owned, ...list.shared].some((x) => x.id === d.id));
  assert.equal((await fetch(`${base}/api/docs/${d.id}`)).status, 401, 'anonymous blocked');
});

test('version history: snapshots, grouping, owner-only, restore keeps current content', async () => {
  const alice = await login('alice@example.com');
  const bob = await login('bob@example.com');       // editor
  const carol = await login('carol@example.com');   // viewer
  const dan = null;
  const { data: d } = await alice('/docs', { method: 'POST', body: { title: 'History' } });
  const save = (c, who = alice) => who(`/docs/${d.id}`, { method: 'PUT', body: { content: c } });
  await save('<p>v1</p>');                              // empty -> v1: nothing worth snapshotting
  assert.equal((await alice(`/docs/${d.id}/versions`)).data.versions.length, 0);
  await save('<p>v2</p>');                              // snapshot of v1
  await save('<p>v3</p>');                              // grouped (inside 5-minute window): no new snapshot
  const list = (await alice(`/docs/${d.id}/versions`)).data;
  assert.equal(list.versions.length, 1, 'frequent autosaves are grouped');
  assert.equal(list.versions[0].editor_name, 'Alice Owner');
  const v1 = (await alice(`/docs/${d.id}/versions/${list.versions[0].id}`)).data;
  assert.equal(v1.content, '<p>v1</p>');

  // Only the owner: editor/viewer -> 403 on list, preview, restore; stranger -> 404.
  await alice(`/docs/${d.id}/shares`, { method: 'POST', body: { email: 'bob@example.com', role: 'editor' } });
  await alice(`/docs/${d.id}/shares`, { method: 'POST', body: { email: 'carol@example.com', role: 'viewer' } });
  for (const who of [bob, carol]) {
    assert.equal((await who(`/docs/${d.id}/versions`)).status, 403);
    assert.equal((await who(`/docs/${d.id}/versions/${v1.id}`)).status, 403);
    assert.equal((await who(`/docs/${d.id}/versions/${v1.id}/restore`, { method: 'POST' })).status, 403);
  }
  assert.equal((await save('<p>v3</p>', bob)).status, 200, 'editor edits do not need history access');
  const { data: other } = await alice('/docs', { method: 'POST', body: { title: 'Other doc' } });
  assert.equal((await alice(`/docs/${other.id}/versions/${v1.id}`)).status, 404, 'version id is scoped to its own document');
  assert.equal((await fetch(`${base}/api/docs/${d.id}/versions`)).status, 401);

  // Restore: content goes back, and the pre-restore content becomes a version.
  await save('<p>latest</p>');
  const r = await alice(`/docs/${d.id}/versions/${v1.id}/restore`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal((await alice(`/docs/${d.id}`)).data.content, '<p>v1</p>');
  const after = (await alice(`/docs/${d.id}/versions`)).data.versions;
  assert.equal(after.length, 2);
  assert.equal(after[0].reason, 'restore');
  const saved = (await alice(`/docs/${d.id}/versions/${after[0].id}`)).data;
  assert.equal(saved.content, '<p>latest</p>', 'pre-restore content is recoverable');
});

test('version history: keeps at most 10 snapshots and deleting a doc removes them', async () => {
  // A second app instance over the SAME database with grouping disabled so every edit snapshots.
  const s2 = await new Promise((r) => { const sv = createApp(db, { versionGroupMs: 0 }).listen(0, () => r(sv)); });
  try {
    const b2 = `http://127.0.0.1:${s2.address().port}`;
    const lr = await fetch(b2 + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com', password: 'demo123' }) });
    const cookie = lr.headers.get('set-cookie').split(';')[0];
    const call = async (p, o = {}) => { const r = await fetch(b2 + '/api' + p, { method: o.method || 'GET', headers: { cookie, 'Content-Type': 'application/json' }, body: o.body && JSON.stringify(o.body) }); return { status: r.status, data: await r.json() }; };
    const { data: d } = await call('/docs', { method: 'POST', body: { title: 'Many' } });
    for (let i = 1; i <= 15; i++) await call(`/docs/${d.id}`, { method: 'PUT', body: { content: `<p>edit ${i}</p>` } });
    const { data } = await call(`/docs/${d.id}/versions`);
    assert.equal(data.versions.length, 10);
    const newest = (await call(`/docs/${d.id}/versions/${data.versions[0].id}`)).data;
    assert.equal(newest.content, '<p>edit 14</p>', 'newest snapshot is the state before the last edit');
    await call(`/docs/${d.id}`, { method: 'DELETE' });
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM document_versions WHERE doc_id = ?', [d.id])).n, 0, 'cascade-deleted');
  } finally { await new Promise((r) => s2.close(r)); }
});

});
}
