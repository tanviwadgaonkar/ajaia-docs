'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { verifyPassword } = require('./db');
const { clean } = require('./sanitize');
const { importFile, ImportError, MAX_BYTES, ALLOWED_EXT } = require('./importer');

const MAX_TITLE = 200;
const MAX_CONTENT = 1_000_000;
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ---------- auth ----------
  const q = {
    userByEmail: 'SELECT * FROM users WHERE email = ?',
    allUsers: 'SELECT id,email,name FROM users ORDER BY name',
    insSession: 'INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)',
    sessionUser: 'SELECT u.id,u.email,u.name,s.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token = ?',
    delSession: 'DELETE FROM sessions WHERE token = ?',
    doc: 'SELECT d.*, u.name AS owner_name, u.email AS owner_email FROM documents d JOIN users u ON u.id=d.owner_id WHERE d.id = ?',
    share: 'SELECT role FROM shares WHERE doc_id = ? AND user_id = ?',
    owned: 'SELECT id,title,updated_at,created_at FROM documents WHERE owner_id = ? ORDER BY updated_at DESC',
    sharedWithMe: `SELECT d.id,d.title,d.updated_at,d.created_at,s.role,u.name AS owner_name,u.email AS owner_email
      FROM shares s JOIN documents d ON d.id=s.doc_id JOIN users u ON u.id=d.owner_id
      WHERE s.user_id = ? ORDER BY d.updated_at DESC`,
    insDoc: 'INSERT INTO documents (id,owner_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    updDoc: 'UPDATE documents SET title = ?, content = ?, updated_at = ? WHERE id = ?',
    delDoc: 'DELETE FROM documents WHERE id = ?',
    shares: 'SELECT s.user_id,s.role,u.name,u.email FROM shares s JOIN users u ON u.id=s.user_id WHERE s.doc_id = ? ORDER BY u.name',
    upsertShare: `INSERT INTO shares (doc_id,user_id,role,created_at) VALUES (?,?,?,?)
      ON CONFLICT(doc_id,user_id) DO UPDATE SET role = excluded.role`,
    delShare: 'DELETE FROM shares WHERE doc_id = ? AND user_id = ?',
  };

  const requireAuth = async (req, _res, next) => {
    const token = req.cookies.sid;
    const row = token && await db.get(q.sessionUser, [token]);
    if (!row || Date.now() - row.created_at > SESSION_TTL_MS) return next(new HttpError(401, 'Not signed in'));
    req.user = { id: row.id, email: row.email, name: row.name };
    next();
  };

  // Returns { doc, role } or throws 404 (never reveals docs the user cannot see).
  async function loadDoc(docId, userId) {
    const doc = await db.get(q.doc, [docId]);
    if (!doc) throw new HttpError(404, 'Document not found');
    if (doc.owner_id === userId) return { doc, role: 'owner' };
    const s = await db.get(q.share, [docId, userId]);
    if (!s) throw new HttpError(404, 'Document not found');
    return { doc, role: s.role };
  }
  const canEdit = (role) => role === 'owner' || role === 'editor';

  const cleanTitle = (t, fallback) => {
    if (t === undefined) return fallback;
    if (typeof t !== 'string' || !t.trim()) throw new HttpError(400, 'Title cannot be empty');
    if (t.length > MAX_TITLE) throw new HttpError(400, `Title must be at most ${MAX_TITLE} characters`);
    return t.trim();
  };

  const api = express.Router();

  api.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Email and password required');
    const user = await db.get(q.userByEmail, [email.trim().toLowerCase()]);
    if (!user || !verifyPassword(password, user.password)) throw new HttpError(401, 'Invalid email or password');
    const token = crypto.randomBytes(32).toString('hex');
    await db.run(q.insSession, [token, user.id, Date.now()]);
    res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS, secure: process.env.NODE_ENV === 'production' });
    res.json({ id: user.id, email: user.email, name: user.name });
  });

  api.post('/logout', async (req, res) => {
    if (req.cookies.sid) await db.run(q.delSession, [req.cookies.sid]);
    res.clearCookie('sid');
    res.json({ ok: true });
  });

  api.get('/config', (_req, res) => res.json({ allowedUploadTypes: ALLOWED_EXT, maxUploadBytes: MAX_BYTES }));
  api.get('/demo-users', async (_req, res) => res.json((await db.all(q.allUsers)).map(({ email, name }) => ({ email, name }))));

  api.use(requireAuth);

  api.get('/me', async (req, res) => res.json(req.user));

  api.get('/docs', async (req, res) => {
    res.json({ owned: await db.all(q.owned, [req.user.id]), shared: await db.all(q.sharedWithMe, [req.user.id]) });
  });

  api.post('/docs', async (req, res) => {
    const title = cleanTitle(req.body?.title, 'Untitled document');
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.run(q.insDoc, [id, req.user.id, title, '', now, now]);
    res.status(201).json({ id, title });
  });

  api.get('/docs/:id', async (req, res) => {
    const { doc, role } = await loadDoc(req.params.id, req.user.id);
    res.json({
      id: doc.id, title: doc.title, content: doc.content, updated_at: doc.updated_at,
      role, owner: { name: doc.owner_name, email: doc.owner_email },
    });
  });

  api.put('/docs/:id', async (req, res) => {
    const { doc, role } = await loadDoc(req.params.id, req.user.id);
    if (!canEdit(role)) throw new HttpError(403, 'You have view-only access to this document');
    const { title, content } = req.body || {};
    const newTitle = cleanTitle(title, doc.title);
    let newContent = doc.content;
    if (content !== undefined) {
      if (typeof content !== 'string') throw new HttpError(400, 'Content must be a string');
      if (content.length > MAX_CONTENT) throw new HttpError(413, 'Document is too large');
      newContent = clean(content);
    }
    const now = Date.now();
    await db.run(q.updDoc, [newTitle, newContent, now, doc.id]);
    res.json({ id: doc.id, title: newTitle, updated_at: now });
  });

  api.delete('/docs/:id', async (req, res) => {
    const { doc, role } = await loadDoc(req.params.id, req.user.id);
    if (role !== 'owner') throw new HttpError(403, 'Only the owner can delete a document');
    await db.run(q.delDoc, [doc.id]);
    res.json({ ok: true });
  });

  // ---------- sharing ----------
  api.get('/docs/:id/shares', async (req, res) => {
    const { doc, role } = await loadDoc(req.params.id, req.user.id);
    if (role !== 'owner') throw new HttpError(403, 'Only the owner can manage sharing');
    res.json({ owner: { name: doc.owner_name, email: doc.owner_email }, shares: await db.all(q.shares, [doc.id]) });
  });

  api.post('/docs/:id/shares', async (req, res) => {
    const { doc, role } = await loadDoc(req.params.id, req.user.id);
    if (role !== 'owner') throw new HttpError(403, 'Only the owner can manage sharing');
    const { email, role: shareRole } = req.body || {};
    if (typeof email !== 'string' || !email.trim()) throw new HttpError(400, 'Email required');
    if (!['editor', 'viewer'].includes(shareRole)) throw new HttpError(400, 'Role must be "editor" or "viewer"');
    const target = await db.get(q.userByEmail, [email.trim().toLowerCase()]);
    if (!target) throw new HttpError(404, 'No user with that email');
    if (target.id === doc.owner_id) throw new HttpError(400, 'You already own this document');
    await db.run(q.upsertShare, [doc.id, target.id, shareRole, Date.now()]);
    res.status(201).json({ user_id: target.id, email: target.email, name: target.name, role: shareRole });
  });

  api.delete('/docs/:id/shares/:userId', async (req, res) => {
    const { doc, role } = await loadDoc(req.params.id, req.user.id);
    if (role !== 'owner') throw new HttpError(403, 'Only the owner can manage sharing');
    await db.run(q.delShare, [doc.id, req.params.userId]);
    res.json({ ok: true });
  });

  // ---------- import ----------
  api.post('/docs/import', upload.single('file'), wrap(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No file uploaded (field name: "file")');
    const { title, html } = await importFile(req.file);
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.run(q.insDoc, [id, req.user.id, title, html, now, now]);
    res.status(201).json({ id, title });
  }));

  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  app.use('/vendor/quill', express.static(path.join(path.dirname(require.resolve('quill/package.json')), 'dist')));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` : err.message;
      return res.status(status).json({ error: msg });
    }
    if (err instanceof HttpError || err instanceof ImportError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
