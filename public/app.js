'use strict';
/* Ajaia Docs — vanilla JS SPA. Hash routes: #/ (dashboard), #/doc/:id (editor). */
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
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

// Inline SVG icons (constant markup only — never interpolate user data here).
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  share: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M17 8v6M14 11h6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  logo: '<path d="M7 4h7l4 4v12H7z"/><path d="M14 4v4h4M10 13h5M10 16h5" />',
};
function icon(name, label) {
  const s = document.createElement('span');
  s.className = 'icon';
  s.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"'}>${ICONS[name]}</svg>`;
  return s;
}
const initials = (name) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

let toastTimer;
function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = isErr ? 'err' : ''; t.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.display = 'none'), 3500);
}
async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, credentials: 'same-origin' };
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
function relTime(ms) {
  const d = Date.now() - ms;
  if (d < 60e3) return 'just now';
  if (d < 3600e3) return `${Math.floor(d / 60e3)} min ago`;
  if (d < 86400e3) return `${Math.floor(d / 3600e3)} h ago`;
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };
const ROLE = {
  owner: { label: 'Owner', icon: 'user' },
  editor: { label: 'Can edit', icon: 'pencil' },
  viewer: { label: 'View only', icon: 'eye' },
};
const roleBadge = (role) => h('span', { class: `badge ${role}` }, icon(ROLE[role].icon), ROLE[role].label);

// ---------- accessible dialog: focus trap, Escape, restore focus to trigger ----------
function openDialog({ title, wide = false, build }) {
  const opener = document.activeElement;
  const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } });
  let closed = false;
  function close() {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    if (opener && document.contains(opener)) opener.focus();
    else document.querySelector('[data-focus-fallback]')?.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...modal.querySelectorAll('button, input, select, a[href], [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }
  const { body, focus } = build(close);
  const modal = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'modal-head' }, h('h2', { id: titleId }, title),
      h('button', { class: 'icon-btn neutral', type: 'button', 'aria-label': 'Close dialog', onclick: close }, icon('close'))),
    body);
  overlay.append(modal);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  (focus || modal.querySelector('input, button'))?.focus();
  return { close, modal };
}

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
  document.title = 'Sign in · Ajaia Docs';
  let demo = [];
  try { demo = await api('/demo-users'); } catch { /* ignore */ }
  const err = h('div', { class: 'error', role: 'alert' });
  const email = h('input', { type: 'email', id: 'email', required: true, autocomplete: 'username' });
  const pw = h('input', { type: 'password', id: 'password', required: true, autocomplete: 'current-password' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; submit.disabled = true;
    try { state.user = await api('/login', { method: 'POST', body: { email: email.value, password: pw.value } }); location.hash = '#/'; route(); }
    catch (ex) { err.textContent = ex.message; submit.disabled = false; }
  } },
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { for: 'password' }, 'Password'), pw),
    submit, err);
  $app.replaceChildren(h('main', { id: 'main', class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    h('span', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('logo')), 'Ajaia Docs'),
    h('h1', {}, 'Sign in to your workspace'),
    h('p', { class: 'muted' }, 'Write, import and share documents with your team.'),
    form,
    h('section', { class: 'demo', 'aria-label': 'Demo accounts' },
      h('div', { class: 'demo-title' }, 'Demo accounts'),
      h('p', {}, 'This is a demo with seeded users. Select one to fill the form (password: demo123), then sign in.'),
      h('div', { class: 'demo-list' }, demo.map((u) => h('button', { type: 'button', class: 'demo-user', onclick: () => { email.value = u.email; pw.value = 'demo123'; submit.focus(); } },
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(u.name)), h('span', {}, u.name, h('small', {}, u.email)))))))));
}

function topbar() {
  return h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/', 'aria-label': 'Ajaia Docs home' }, h('span', { class: 'brand-mark' }, icon('logo')), 'Ajaia Docs'),
    h('div', { class: 'spacer' }),
    h('span', { class: 'user-chip' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(state.user.name)), h('span', { class: 'name' }, state.user.name)),
    h('button', { class: 'btn sm', onclick: async () => { await api('/logout', { method: 'POST' }).catch(() => {}); state.user = null; location.hash = '#/'; route(); } }, 'Sign out'));
}

// ---------- dashboard ----------
function skeletonRows(n) {
  return h('div', { class: 'list', 'aria-hidden': 'true' }, Array.from({ length: n }, () => h('div', { class: 'skeleton' },
    h('div', { class: 'sk sk-icon' }), h('div', { style: 'flex:1;display:grid;gap:8px' }, h('div', { class: 'sk sk-line', style: 'width:40%' }), h('div', { class: 'sk sk-line', style: 'width:22%' })))));
}

async function renderHome() {
  document.title = 'Documents · Ajaia Docs';
  const head = (heading) => h('div', { class: 'page-head' }, heading,
    h('p', {}, 'Create, import and share documents. Changes save automatically, and anything shared with you appears below.'));
  const h1 = h('h1', { tabindex: '-1', 'data-focus-fallback': true }, 'Documents');
  $app.replaceChildren(topbar(), h('main', { id: 'main', class: 'container' }, head(h1),
    h('div', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', {}, 'Owned by me')), skeletonRows(2)),
    h('div', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', {}, 'Shared with me')), skeletonRows(1))));
  let docs;
  try { docs = await api('/docs'); } catch (e) { return toast(e.message, true); }

  const importBtn = h('button', { class: 'btn', type: 'button' }, icon('upload'), 'Import file');
  const fileInput = h('input', { type: 'file', accept: state.config.allowedUploadTypes.join(','), style: 'display:none', 'aria-label': 'Import a file', onchange: async () => {
    const f = fileInput.files[0]; fileInput.value = '';
    if (!f) return;
    const ext = '.' + f.name.split('.').pop().toLowerCase();
    if (!state.config.allowedUploadTypes.includes(ext)) return toast(`Unsupported file type. Use ${state.config.allowedUploadTypes.join(', ')}`, true);
    if (f.size > state.config.maxUploadBytes) return toast('File too large (max 5 MB)', true);
    const form = new FormData(); form.append('file', f);
    importBtn.disabled = true;
    try { const d = await api('/docs/import', { method: 'POST', form }); toast('Imported ✓'); location.hash = `#/doc/${d.id}`; }
    catch (e) { toast(e.message, true); importBtn.disabled = false; }
  } });
  importBtn.addEventListener('click', () => fileInput.click());
  const newBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    newBtn.disabled = true;
    try { const d = await api('/docs', { method: 'POST', body: {} }); location.hash = `#/doc/${d.id}`; }
    catch (e) { toast(e.message, true); newBtn.disabled = false; }
  } }, icon('plus'), 'New document');

  const row = (d, kind) => {
    const meta = kind === 'owned' ? `Edited ${relTime(d.updated_at)}` : `Shared by ${d.owner_name} · Edited ${relTime(d.updated_at)}`;
    return h('div', { class: 'row' },
      h('a', { class: 'row-main', href: `#/doc/${d.id}` },
        h('span', { class: 'file-icon' }, icon('file')),
        h('span', { class: 'row-text' }, h('div', { class: 'row-title' }, d.title), h('div', { class: 'row-meta', title: fmtDate(d.updated_at) }, meta))),
      roleBadge(kind === 'owned' ? 'owner' : d.role),
      kind === 'owned' ? h('button', { class: 'icon-btn', type: 'button', title: 'Delete', 'aria-label': `Delete ${d.title}`, onclick: () => confirmDelete(d) }, icon('trash')) : null);
  };
  const section = (name, items, kind, emptyTitle, emptyText) => h('section', { class: 'section', 'aria-label': name },
    h('div', { class: 'section-head' }, h('h2', {}, name), h('span', { class: 'count' }, `${items.length}`)),
    h('div', { class: 'list' }, items.length ? items.map((d) => row(d, kind)) : h('div', { class: 'empty' }, h('strong', {}, emptyTitle), emptyText)));

  $app.replaceChildren(topbar(), h('main', { id: 'main', class: 'container' }, head(h1),
    h('div', { class: 'actions' }, newBtn, importBtn, fileInput,
      h('span', { class: 'hint' }, `Import supports ${state.config.allowedUploadTypes.join(', ')} up to 5 MB.`)),
    section('Owned by me', docs.owned, 'owned', 'No documents yet', 'Create a new document or import a file to get started.'),
    section('Shared with me', docs.shared, 'shared', 'Nothing shared with you yet', 'Documents others share with you will show up here.')));
}

function confirmDelete(d) {
  openDialog({ title: `Delete “${d.title}”?`, build: (close) => {
    const cancel = h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel');
    const del = h('button', { class: 'btn danger solid', type: 'button', onclick: async () => {
      del.disabled = true;
      try { await api(`/docs/${d.id}`, { method: 'DELETE' }); close(); toast('Document deleted'); renderHome(); }
      catch (ex) { toast(ex.message, true); del.disabled = false; }
    } }, icon('trash'), 'Delete document');
    return { focus: cancel, body: [
      h('p', {}, 'This permanently deletes the document and removes access for everyone it is shared with. This can’t be undone.'),
      h('div', { class: 'modal-foot' }, cancel, del)] };
  } });
}

// ---------- editor ----------
async function renderEditor(id) {
  let doc;
  try { doc = await api(`/docs/${id}`); }
  catch (e) { toast(e.message, true); location.hash = '#/'; return; }

  const editable = doc.role === 'owner' || doc.role === 'editor';
  // editRev increments on every user edit; a save only marks the doc clean if no newer edit happened while it was in flight.
  let lastUpdated = doc.updated_at, dirty = false, saving = false, pendingSave = false, editRev = 0, inflight = Promise.resolve(), restoring = false;
  document.title = `${doc.title} · Ajaia Docs`;

  const status = h('span', { class: 'status', role: 'status', 'aria-live': 'polite' }, editable ? 'Saved' : '');
  const setStatus = (t, err = false) => { status.textContent = t; status.className = 'status' + (err ? ' err' : ''); };
  const title = h('input', { class: 'title-input', type: 'text', value: doc.title, maxlength: 200, 'aria-label': 'Document title', readonly: !editable });
  const words = h('span', { 'aria-label': 'Word count' }, '0 words');
  const updateWords = () => { const n = quill.getText().trim().split(/\s+/).filter(Boolean).length; words.textContent = `${n.toLocaleString()} ${n === 1 ? 'word' : 'words'}`; };

  const tb = (cls, label, extra = {}) => h('button', { class: cls, type: 'button', 'aria-label': label, title: label, ...extra });
  const toolbarEl = h('div', { id: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    h('span', { class: 'ql-formats' },
      h('select', { class: 'ql-header', 'aria-label': 'Text style' }, h('option', { value: '1' }, 'Heading 1'), h('option', { value: '2' }, 'Heading 2'), h('option', { value: '3' }, 'Heading 3'), h('option', { selected: true }, 'Normal'))),
    h('span', { class: 'ql-formats' }, tb('ql-bold', 'Bold (Ctrl+B)'), tb('ql-italic', 'Italic (Ctrl+I)'), tb('ql-underline', 'Underline (Ctrl+U)')),
    h('span', { class: 'ql-formats' }, tb('ql-list', 'Numbered list', { value: 'ordered' }), tb('ql-list', 'Bulleted list', { value: 'bullet' })),
    h('span', { class: 'ql-formats' }, tb('ql-clean', 'Clear formatting')));
  const editorEl = h('div', { id: 'editor' });

  let shareBtn = null, historyBtn = null;
  if (doc.role === 'owner') {
    shareBtn = h('button', { class: 'btn', type: 'button', 'aria-label': 'Share', onclick: () => openShareModal(doc.id, () => title.value || doc.title) }, icon('share'), h('span', { class: 'label' }, 'Share'));
    historyBtn = h('button', { class: 'btn', type: 'button', 'aria-label': 'Version history', onclick: () => openHistory() }, icon('history'), h('span', { class: 'label' }, 'History'));
  }
  $app.replaceChildren(...[
    h('header', { class: 'editor-header' },
      h('a', { class: 'back-link', href: '#/', 'aria-label': 'Back to documents' }, icon('back'), h('span', { class: 'label' }, 'Documents')),
      title, roleBadge(doc.role), status,
      h('div', { class: 'header-actions' }, historyBtn, shareBtn,
        h('span', { class: 'user-chip' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(state.user.name)), h('span', { class: 'name' }, state.user.name)))),
    editable ? null : h('div', { class: 'readonly-banner', role: 'status' }, icon('lock'), `View only — you can read this document but can’t edit it. Ask ${doc.owner.name} for edit access.`),
    h('main', { id: 'main', class: 'workspace' }, h('div', { class: 'sheet-wrap' + (editable ? '' : ' view-only') }, editable ? toolbarEl : null, editorEl,
      h('div', { class: 'doc-footer' }, words)))].filter(Boolean));

  const quill = new Quill(editorEl, { theme: 'snow', readOnly: !editable, modules: { toolbar: editable ? toolbarEl : false }, placeholder: editable ? 'Start typing…' : '' });
  const loadHtml = (html) => { quill.setContents(quill.clipboard.convert({ html: html || '' }), 'silent'); updateWords(); };
  loadHtml(doc.content);
  quill.on('text-change', updateWords);

  function save() {
    if (!editable || restoring) return Promise.resolve();
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
    title.addEventListener('input', () => { if (!title.value.trim()) return setStatus('Title cannot be empty', true); document.title = `${title.value} · Ajaia Docs`; markDirty(); });
    title.addEventListener('blur', () => { if (!title.value.trim()) { title.value = doc.title; markDirty(); } });
  }

  // Poll for changes made by other collaborators (simple, no websockets). Skips while the local user has unsaved edits.
  const poll = setInterval(async () => {
    if (dirty || saving || restoring || document.hidden) return;
    try {
      const fresh = await api(`/docs/${id}`);
      if (fresh.updated_at > lastUpdated && !dirty && !saving && !restoring) {
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

  // Restore a version (owner). Flushes + waits for pending saves first so nothing in this browser can
  // overwrite the restored content afterwards; the server also snapshots the pre-restore content.
  async function restoreVersion(vid) {
    debouncedSave.cancel();
    if (dirty) await save();
    await inflight;
    if (dirty) throw new Error('Your latest edits could not be saved, so the restore was cancelled. Try again.');
    restoring = true; quill.disable();
    try {
      const r = await api(`/docs/${id}/versions/${vid}/restore`, { method: 'POST' });
      loadHtml(r.content); lastUpdated = r.updated_at; dirty = false; editRev++;
      setStatus('Version restored ✓'); toast('Version restored');
    } finally { restoring = false; if (editable) quill.enable(); }
  }

  function openHistory() {
    openDialog({ title: 'Version history', wide: true, build: (close) => {
      const list = h('div', { class: 'version-list', role: 'list', 'aria-label': 'Saved versions' }, h('p', { class: 'hint' }, 'Loading…'));
      const pane = h('div', { class: 'preview-pane', 'aria-live': 'polite' }, h('div', { class: 'empty' }, 'Select a version to preview it.'));
      const fb = h('div', { class: 'feedback', role: 'status' });
      const confirmRow = h('div', { class: 'modal-foot', hidden: true });
      const restoreBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, icon('history'), 'Restore this version');
      let selected = null;
      const setFb = (m, ok) => { fb.textContent = m; fb.className = 'feedback ' + (ok ? 'ok' : 'bad'); };

      async function select(v, btn) {
        selected = v; confirmRow.hidden = true; fb.textContent = '';
        list.querySelectorAll('.version-item').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        try {
          const full = await api(`/docs/${id}/versions/${v.id}`);
          const holder = h('div'); pane.replaceChildren(holder);
          const pv = new Quill(holder, { theme: 'snow', readOnly: true, modules: { toolbar: false } });
          pv.setContents(pv.clipboard.convert({ html: full.content }), 'silent');
          restoreBtn.disabled = false;
        } catch (e) { setFb(e.message, false); }
      }
      async function load() {
        try {
          const d = await api(`/docs/${id}/versions`);
          if (!d.versions.length) { list.replaceChildren(h('p', { class: 'hint' }, 'No earlier versions yet. A snapshot is saved before an editing session changes the text.')); return; }
          list.replaceChildren(...d.versions.map((v) => {
            const b = h('button', { class: 'version-item', type: 'button', role: 'listitem', 'aria-pressed': 'false' },
              h('strong', {}, fmtDate(v.created_at)), h('span', {}, v.reason === 'restore' ? `Saved before a restore by ${v.editor_name}` : `Saved before an edit by ${v.editor_name}`));
            b.addEventListener('click', () => select(v, b));
            return b;
          }));
        } catch (e) { list.replaceChildren(h('p', { class: 'error' }, e.message)); }
      }
      const doRestore = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        doRestore.disabled = true;
        try { await restoreVersion(selected.id); close(); }
        catch (e) { setFb(e.message, false); doRestore.disabled = false; confirmRow.hidden = true; restoreBtn.hidden = false; }
      } }, 'Confirm restore');
      confirmRow.append(h('p', { style: 'flex:1;text-align:left;margin:0;font-size:13.5px' }, 'Your current text is saved as a version first, so you can undo this.'),
        h('button', { class: 'btn', type: 'button', onclick: () => { confirmRow.hidden = true; restoreBtn.hidden = false; restoreBtn.focus(); } }, 'Cancel'), doRestore);
      restoreBtn.addEventListener('click', () => { restoreBtn.hidden = true; confirmRow.hidden = false; doRestore.focus(); });
      load();
      return { focus: null, body: [
        h('div', { class: 'history-grid' }, list, pane), fb,
        h('div', { class: 'modal-foot' }, restoreBtn, h('button', { class: 'btn', type: 'button', onclick: close }, 'Close')), confirmRow,
        h('p', { class: 'note' }, 'Up to 10 snapshots are kept; frequent autosaves are grouped into one. Only the owner can view or restore history. Editing is last-write-wins — this is not real-time collaborative editing.')] };
    } });
  }
}

// ---------- share dialog ----------
const PERM_HELP = {
  editor: 'Can edit — can change the text and rename the document. Can’t share or delete it.',
  viewer: 'View only — can read the document but can’t change it.',
};
function openShareModal(docId, getTitle) {
  const feedback = h('div', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
  const say = (msg, ok) => { feedback.textContent = msg; feedback.className = 'feedback ' + (ok ? 'ok' : 'bad'); feedback.setAttribute('role', ok ? 'status' : 'alert'); };
  const list = h('div', {});
  openDialog({ title: `Share “${getTitle()}”`, build: (close) => {
    const email = h('input', { type: 'email', id: 'share-email', placeholder: 'name@example.com', list: 'userlist', autocomplete: 'off' });
    const dl = h('datalist', { id: 'userlist' });
    const role = h('select', { id: 'share-role' }, h('option', { value: 'editor' }, 'Can edit'), h('option', { value: 'viewer' }, 'View only'));
    const help = h('div', { class: 'perm-help', id: 'perm-help' }, PERM_HELP.editor);
    role.setAttribute('aria-describedby', 'perm-help');
    role.addEventListener('change', () => { help.textContent = PERM_HELP[role.value]; });
    api('/demo-users').then((us) => us.forEach((u) => dl.append(h('option', { value: u.email }, u.name)))).catch(() => {});

    async function grant(em, r, okMsg) {
      feedback.textContent = '';
      try { const s = await api(`/docs/${docId}/shares`, { method: 'POST', body: { email: em, role: r } }); say(okMsg ? okMsg(s) : `Shared with ${s.name} as ${ROLE[r].label.toLowerCase()}.`, true); await refresh(); return true; }
      catch (e) { say(e.message, false); return false; }
    }
    async function refresh() {
      try {
        const d = await api(`/docs/${docId}/shares`);
        const person = (name, mail, right) => h('div', { class: 'share-row' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(name)), h('div', { class: 'who' }, h('strong', {}, name), h('span', {}, mail)), right);
        list.replaceChildren(
          person(d.owner.name, d.owner.email, roleBadge('owner')),
          ...d.shares.map((s) => person(s.name, s.email, h('span', { class: 'field-row', style: 'flex-wrap:nowrap' },
            h('select', { 'aria-label': `Permission for ${s.name}`, onchange: (e) => grant(s.email, e.target.value, () => `Updated ${s.name} to ${ROLE[e.target.value].label.toLowerCase()}.`) },
              h('option', { value: 'editor', selected: s.role === 'editor' }, 'Can edit'), h('option', { value: 'viewer', selected: s.role === 'viewer' }, 'View only')),
            h('button', { class: 'btn sm danger', type: 'button', 'aria-label': `Remove ${s.name}`, onclick: async () => {
              try { await api(`/docs/${docId}/shares/${s.user_id}`, { method: 'DELETE' }); say(`Removed access for ${s.name}.`, true); refresh(); } catch (e) { say(e.message, false); }
            } }, 'Remove')))));
      } catch (e) { say(e.message, false); }
    }
    const addBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Share');
    const form = h('form', { onsubmit: async (e) => { e.preventDefault(); addBtn.disabled = true; if (await grant(email.value, role.value)) email.value = ''; addBtn.disabled = false; email.focus(); } },
      h('div', { class: 'field-row' },
        h('div', { class: 'grow' }, h('label', { for: 'share-email' }, 'Add a person by email'), email, dl),
        h('div', {}, h('label', { for: 'share-role' }, 'Permission'), role), addBtn),
      help);
    refresh();
    return { focus: email, body: [form, feedback, h('div', { class: 'people-title' }, 'People with access'), list,
      h('p', { class: 'hint', style: 'margin-top:10px' }, 'Demo users: bob@example.com, carol@example.com'),
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Done'))] };
  } });
}

route();
