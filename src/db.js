'use strict';
/*
 * Tiny async DB adapter with two backends behind one interface:
 *   - Postgres  when DATABASE_URL is set (production / hosted, durable)
 *   - SQLite    otherwise (zero-setup local dev; ':memory:' for tests)
 * Queries are written once with `?` placeholders; the Postgres backend rewrites them to $1..$n.
 * Interface: get(sql, params) -> row|undefined, all(sql, params) -> rows, run(sql, params), close(), kind
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(crypto.scryptSync(pw, salt, 32), Buffer.from(hash, 'hex'));
}

const SCHEMA = (bigint) => `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at ${bigint} NOT NULL
  );
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
    created_at ${bigint} NOT NULL, updated_at ${bigint} NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shares (
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('editor','viewer')),
    created_at ${bigint} NOT NULL,
    PRIMARY KEY (doc_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS document_versions (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    title TEXT NOT NULL, content TEXT NOT NULL,
    editor_id TEXT NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL DEFAULT 'edit',
    created_at ${bigint} NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_versions_doc ON document_versions(doc_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_docs_owner ON documents(owner_id);
  CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
`;

function sqliteBackend(file) {
  const { DatabaseSync } = require('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA('INTEGER'));
  return {
    kind: 'sqlite',
    async get(sql, p = []) { return db.prepare(sql).get(...p); },
    async all(sql, p = []) { return db.prepare(sql).all(...p); },
    async run(sql, p = []) { db.prepare(sql).run(...p); },
    async close() { db.close(); },
  };
}

async function postgresBackend(url) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT (timestamps, COUNT) -> number
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({
    connectionString: url,
    ssl: local || process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true },
    max: 5,
  });
  // An idle pooled connection can be dropped by the server (Neon suspends/restarts, network blips). Without this
  // listener the 'error' event is unhandled and crashes the process. The pool discards the dead client and reconnects.
  pool.on('error', (e) => console.error('[db] idle Postgres client error (will reconnect):', e.message));
  const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  await pool.query(SCHEMA('BIGINT'));
  return {
    kind: 'postgres',
    async get(sql, p = []) { return (await pool.query(toPg(sql), p)).rows[0]; },
    async all(sql, p = []) { return (await pool.query(toPg(sql), p)).rows; },
    async run(sql, p = []) { await pool.query(toPg(sql), p); },
    async close() { await pool.end(); },
  };
}

async function seed(db) {
  if ((await db.get('SELECT COUNT(*) AS n FROM users')).n > 0) return;
  const ids = {};
  for (const [email, name] of [['alice@example.com', 'Alice Owner'], ['bob@example.com', 'Bob Reviewer'], ['carol@example.com', 'Carol Viewer']]) {
    ids[email] = crypto.randomUUID();
    await db.run('INSERT INTO users (id,email,name,password) VALUES (?,?,?,?) ON CONFLICT DO NOTHING', [ids[email], email, name, hashPassword(SEED_PASSWORD)]);
  }
  // Re-read ids in case a concurrent instance seeded first.
  for (const email of Object.keys(ids)) ids[email] = (await db.get('SELECT id FROM users WHERE email = ?', [email])).id;
  if ((await db.get('SELECT COUNT(*) AS n FROM documents')).n > 0) return;
  const now = Date.now();
  const docId = crypto.randomUUID();
  await db.run('INSERT INTO documents (id,owner_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?)', [
    docId, ids['alice@example.com'], 'Welcome to Ajaia Docs',
    '<h1>Welcome to Ajaia Docs</h1><p>This doc is <strong>owned by Alice</strong> and shared with Bob as an <em>editor</em>.</p><ul><li>Try bold, italic, <u>underline</u></li><li>Headings and lists</li><li>Import a .txt, .md or .docx from the home page</li></ul>',
    now, now]);
  await db.run('INSERT INTO shares (doc_id,user_id,role,created_at) VALUES (?,?,?,?)', [docId, ids['bob@example.com'], 'editor', now]);
}

const SEED_PASSWORD = 'demo123';

/** openDb({ url, file }) — url => Postgres; otherwise SQLite at file (default ./data/app.db or ':memory:'). */
async function openDb({ url = process.env.DATABASE_URL, file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db') } = {}) {
  const db = url ? await postgresBackend(url) : sqliteBackend(file);
  await seed(db);
  return db;
}

module.exports = { openDb, hashPassword, verifyPassword, SEED_PASSWORD };
