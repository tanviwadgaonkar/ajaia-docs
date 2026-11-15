'use strict';
/* Ajaia Docs — vanilla JS SPA. Hash routes: #/ (home), #/doc/:id (editor). */
const $app = document.getElementById('app');
const state = { user: null, config: { allowedUploadTypes: ['.txt', '.md', '.docx'], maxUploadBytes: 5 * 1024 * 1024 }, cleanup: null };

// ---------- helpers ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
let toastTimer;
function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = isErr ? 'err' : ''; t.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.display = 'none'), 3500);
}
async function api(path, { method = 'GET', body, form, keepalive } = {}) {
  const opts = { method, credentials: 'same-origin', keepalive };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch('/api' + path, opts); } catch { throw new Error('Network error — check your connection'); }
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (res.status === 401 && state.user) { state.user = null; route(); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const fmtDate = (ms) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };

// ---------- router ----------
async function route() {
  if (state.cleanup) { await state.cleanup(); state.cleanup = null; }
  if (!state.user) {
    try { state.user = await api('/me'); } catch { return renderLogin(); }
  }
  const m = location.hash.match(/^#\/doc\/([\w-]+)/);
  if (m) return renderEditor(m[1]);
  return renderHome();
}
window.addEventListener('hashchange', route);

// ---------- login ----------
async function renderLogin() {
  let demo = [];
  try { demo = await api('/demo-users'); } catch { /* ignore */ }
  const err = h('div', { class: 'error' });
  const email = h('input', { type: 'email', id: 'email', required: true, autocomplete: 'username' });
  const pw = h('input', { type: 'password', id: 'password', required: true, autocomplete: 'current-password' });
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try { state.user = await api('/login', { method: 'POST', body: { email: email.value, password: pw.value } }); location.hash = '#/'; route(); }
    catch (ex) { err.textContent = ex.message; }
  } },
    h('label', { for: 'email' }, 'Email'), email,
    h('label', { for: 'password' }, 'Password'), pw,
    h('div', { style: 'margin-top:16px' }, h('button', { class: 'primary', type: 'submit' }, 'Sign in')), err);
  $app.replaceChildren(h('div', { class: 'card' },
    h('h1', {}, 'Ajaia ', h('span', { style: 'color:var(--brand)' }, 'Docs')),
    h('div', { class: 'muted' }, 'Lightweight collaborative document editor'),
    form,
    h('div', { class: 'demo' }, h('div', { class: 'muted' }, 'Demo accounts (password: demo123) — click to fill:'),
      demo.map((u) => h('button', { type: 'button', onclick: () => { email.value = u.email; pw.value = 'demo123'; } }, u.name)))));
}

function topbar(extra) {
  return h('div', { class: 'topbar' },
    h('div', { class: 'logo', onclick: () => (location.hash = '#/') }, 'Ajaia ', h('span', {}, 'Docs')),
    h('div', { class: 'spacer' }), extra,
    h('span', { class: 'muted' }, state.user.name),
    h('button', { onclick: async () => { await api('/logout', { method: 'POST' }).catch(() => {}); state.user = null; location.hash = '#/'; route(); } }, 'Sign out'));
}

// ---------- home ----------
async function renderHome() {
  $app.replaceChildren(topbar(), h('div', { class: 'container' }, h('div', { class: 'muted' }, 'Loading…')));
  let docs;
  try { docs = await api('/docs'); } catch (e) { return toast(e.message, true); }

  const fileInput = h('input', { type: 'file', accept: state.config.allowedUploadTypes.join(','), style: 'display:none', onchange: async () => {
    const f = fileInput.files[0]; fileInput.value = '';
    if (!f) return;
    const ext = '.' + f.name.split('.').pop().toLowerCase();
    if (!state.config.allowedUploadTypes.includes(ext)) return toast(`Unsupported file type. Use ${state.config.allowedUploadTypes.join(', ')}`, true);
    if (f.size > state.config.maxUploadBytes) return toast('File too large (max 5 MB)', true);
    const form = new FormData(); form.append('file', f);
    try { const d = await api('/docs/import', { method: 'POST', form }); toast('Imported ✓'); location.hash = `#/doc/${d.id}`; }
    catch (e) { toast(e.message, true); }
  } });

  const newDoc = async () => {
    try { const d = await api('/docs', { method: 'POST', body: {} }); location.hash = `#/doc/${d.id}`; }
    catch (e) { toast(e.message, true); }
  };

  const ownedRows = docs.owned.map((d) => h('div', { class: 'item', onclick: () => (location.hash = `#/doc/${d.id}`) },
    h('div', { class: 'title' }, d.title), h('span', { class: 'badge owner' }, 'Owner'),
    h('div', { class: 'meta' }, 'Edited ' + fmtDate(d.updated_at)),
    h('button', { class: 'danger', title: 'Delete', onclick: async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${d.title}"? This also removes it for everyone it is shared with.`)) return;
      try { await api(`/docs/${d.id}`, { method: 'DELETE' }); renderHome(); } catch (ex) { toast(ex.message, true); }
    } }, 'Delete')));
  const sharedRows = docs.shared.map((d) => h('div', { class: 'item', onclick: () => (location.hash = `#/doc/${d.id}`) },
    h('div', { class: 'title' }, d.title), h('span', { class: `badge ${d.role}` }, d.role === 'editor' ? 'Can edit' : 'View only'),
    h('div', { class: 'meta' }, `Shared by ${d.owner_name} · ${fmtDate(d.updated_at)}`)));

  $app.replaceChildren(topbar(), h('div', { class: 'container' },
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: newDoc }, '+ New document'),
      h('button', { onclick: () => fileInput.click() }, 'Import file…'), fileInput,
      h('span', { class: 'hint' }, `Import supports ${state.config.allowedUploadTypes.join(', ')} (max 5 MB) — creates a new editable document.`)),
    h('h2', {}, 'My documents'),
    h('div', { class: 'list' }, ownedRows.length ? ownedRows : h('div', { class: 'empty' }, 'No documents yet — create one or import a file.')),
    h('h2', {}, 'Shared with me'),
    h('div', { class: 'list' }, sharedRows.length ? sharedRows : h('div', { class: 'empty' }, 'Nothing has been shared with you yet.'))));
}

// ---------- editor ----------
async function renderEditor(id) {
  let doc;
  try { doc = await api(`/docs/${id}`); }
  catch (e) { toast(e.message, true); location.hash = '#/'; return; }

  const editable = doc.role === 'owner' || doc.role === 'editor';
  // editRev increments on every user edit; a save only marks the doc clean if no newer edit happened while it was in flight.
  let lastUpdated = doc.updated_at, dirty = false, saving = false, pendingSave = false, editRev = 0, inflight = Promise.resolve();

  const status = h('span', { class: 'status' }, editable ? 'Saved' : 'View only');
  const setStatus = (t, err = false) => { status.textContent = t; status.className = 'status' + (err ? ' err' : ''); };
  const title = h('input', { class: 'title-input', type: 'text', value: doc.title, maxlength: 200, 'aria-label': 'Document title', readonly: !editable });

  const toolbarEl = h('div', { id: 'toolbar' },
    h('span', { class: 'ql-formats' },
      h('select', { class: 'ql-header' }, h('option', { value: '1' }, 'Heading 1'), h('option', { value: '2' }, 'Heading 2'), h('option', { value: '3' }, 'Heading 3'), h('option', { selected: true }, 'Normal'))),
    h('span', { class: 'ql-formats' },
      h('button', { class: 'ql-bold', title: 'Bold (Ctrl+B)' }), h('button', { class: 'ql-italic', title: 'Italic (Ctrl+I)' }), h('button', { class: 'ql-underline', title: 'Underline (Ctrl+U)' })),
    h('span', { class: 'ql-formats' },
      h('button', { class: 'ql-list', value: 'ordered', title: 'Numbered list' }), h('button', { class: 'ql-list', value: 'bullet', title: 'Bulleted list' })),
    h('span', { class: 'ql-formats' }, h('button', { class: 'ql-clean', title: 'Clear formatting' })));
  const editorEl = h('div', { id: 'editor' });

  const shareBtn = doc.role === 'owner' ? h('button', { onclick: () => openShareModal(doc.id, doc.title) }, 'Share') : null;
  const roleBadge = h('span', { class: `badge ${doc.role}` }, doc.role === 'owner' ? 'Owner' : doc.role === 'editor' ? 'Can edit' : 'View only');
  $app.replaceChildren(...[
    h('div', { class: 'editor-bar' }, h('button', { onclick: () => (location.hash = '#/') }, '← Docs'), title, roleBadge, status, h('div', { class: 'spacer' }),
      doc.role !== 'owner' ? h('span', { class: 'muted' }, `Owner: ${doc.owner.name}`) : null, shareBtn,
      h('span', { class: 'muted' }, state.user.name)),
    editable ? null : h('div', { class: 'readonly-banner' }, 'You have view-only access to this document.'),
    h('div', { class: 'sheet-wrap' }, editable ? toolbarEl : null, editorEl)].filter(Boolean));

  const quill = new Quill(editorEl, { theme: 'snow', readOnly: !editable, modules: { toolbar: editable ? toolbarEl : false }, placeholder: editable ? 'Start typing…' : '' });
  const loadHtml = (html) => { quill.setContents(quill.clipboard.convert({ html: html || '' }), 'silent'); };
  loadHtml(doc.content);

  function save() {
    if (!editable) return Promise.resolve();
    if (saving) { pendingSave = true; return inflight; }
    saving = true; setStatus('Saving…');
    const rev = editRev;                                   // snapshot of the edit state being sent
    const body = { title: title.value, content: quill.getSemanticHTML() };
    inflight = (async () => {
      try {
        const r = await api(`/docs/${id}`, { method: 'PUT', body });
        lastUpdated = r.updated_at;
        if (editRev === rev) { dirty = false; setStatus('Saved ✓'); }   // nothing newer: confirmed clean
        else { dirty = true; setStatus('Unsaved changes…'); pendingSave = true; }  // newer edits still unsaved
      } catch (e) { dirty = true; setStatus('Save failed — will retry on next edit', true); toast(e.message, true); }
      finally {
        saving = false;
        if (pendingSave) { pendingSave = false; await save(); }
      }
    })();
    return inflight;
  }
  const debouncedSave = debounce(save, 700);
  const markDirty = () => { editRev++; dirty = true; setStatus('Unsaved changes…'); debouncedSave(); };

  if (editable) {
    quill.on('text-change', (_d, _o, source) => { if (source === 'user') markDirty(); });
    title.addEventListener('input', () => { if (!title.value.trim()) return setStatus('Title cannot be empty', true); markDirty(); });
    title.addEventListener('blur', () => { if (!title.value.trim()) { title.value = doc.title; markDirty(); } });
  }

  // Poll for changes made by other collaborators (simple, no websockets). Skips while the local user has unsaved edits.
  const poll = setInterval(async () => {
    if (dirty || saving || document.hidden) return;
    try {
      const fresh = await api(`/docs/${id}`);
      if (fresh.updated_at > lastUpdated && !dirty && !saving) {
        const sel = quill.getSelection();
        loadHtml(fresh.content); title.value = fresh.title; lastUpdated = fresh.updated_at;
        if (sel) quill.setSelection(Math.min(sel.index, quill.getLength() - 1), 0, 'silent');
        setStatus('Updated by a collaborator');
      }
    } catch { /* transient */ }
  }, 4000);

  const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  state.cleanup = async () => {
    clearInterval(poll); window.removeEventListener('beforeunload', beforeUnload); debouncedSave.cancel();
    if (dirty && editable) await save();
    await inflight;
  };
}

// ---------- share modal ----------
async function openShareModal(docId, docTitle) {
  const list = h('div', {});
  const err = h('div', { class: 'error' });
  const email = h('input', { type: 'email', placeholder: 'person@example.com', list: 'userlist', style: 'flex:1;min-width:180px', 'aria-label': 'Email to share with' });
  const dl = h('datalist', { id: 'userlist' });
  const role = h('select', { 'aria-label': 'Permission' }, h('option', { value: 'editor' }, 'Can edit'), h('option', { value: 'viewer' }, 'View only'));
  const close = () => overlay.remove();
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Share document' },
      h('h3', {}, `Share "${docTitle}"`), list,
      h('div', { class: 'row', style: 'margin-top:14px' }, email, dl, role, h('button', { class: 'primary', onclick: add }, 'Share')),
      err, h('div', { class: 'hint' }, 'Try bob@example.com or carol@example.com'),
      h('div', { style: 'text-align:right;margin-top:14px' }, h('button', { onclick: close }, 'Done'))));
  document.body.append(overlay);

  api('/demo-users').then((us) => us.forEach((u) => dl.append(h('option', { value: u.email }, u.name)))).catch(() => {});

  async function refresh() {
    try {
      const d = await api(`/docs/${docId}/shares`);
      list.replaceChildren(
        h('div', { class: 'share-row' }, h('div', { class: 'who' }, h('strong', {}, d.owner.name), h('div', { class: 'hint' }, d.owner.email)), h('span', { class: 'badge owner' }, 'Owner')),
        ...d.shares.map((s) => h('div', { class: 'share-row' },
          h('div', { class: 'who' }, h('strong', {}, s.name), h('div', { class: 'hint' }, s.email)),
          h('select', { onchange: (e) => grant(s.email, e.target.value) },
            h('option', { value: 'editor', selected: s.role === 'editor' }, 'Can edit'), h('option', { value: 'viewer', selected: s.role === 'viewer' }, 'View only')),
          h('button', { class: 'danger', onclick: async () => { try { await api(`/docs/${docId}/shares/${s.user_id}`, { method: 'DELETE' }); refresh(); } catch (e) { err.textContent = e.message; } } }, 'Remove'))));
    } catch (e) { err.textContent = e.message; }
  }
  async function grant(em, r) {
    err.textContent = '';
    try { await api(`/docs/${docId}/shares`, { method: 'POST', body: { email: em, role: r } }); refresh(); return true; }
    catch (e) { err.textContent = e.message; return false; }
  }
  async function add() { if (await grant(email.value, role.value)) email.value = ''; }
  refresh();
}

route();
