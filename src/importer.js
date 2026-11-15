'use strict';
const path = require('node:path');
const mammoth = require('mammoth');
const { marked } = require('marked');
const { clean } = require('./sanitize');

const ALLOWED_EXT = ['.txt', '.md', '.docx'];
const MAX_BYTES = 5 * 1024 * 1024;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function txtToHtml(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

class ImportError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Returns { title, html } for a supported upload, throws ImportError otherwise.
async function importFile({ originalname, buffer }) {
  const ext = path.extname(originalname || '').toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    throw new ImportError(`Unsupported file type "${ext || 'unknown'}". Supported: ${ALLOWED_EXT.join(', ')}`, 415);
  }
  if (!buffer || buffer.length === 0) throw new ImportError('File is empty');
  const title = path.basename(originalname, ext).slice(0, 200) || 'Imported document';
  let html;
  try {
    if (ext === '.txt') html = txtToHtml(buffer.toString('utf8'));
    else if (ext === '.md') html = await marked.parse(buffer.toString('utf8'));
    else html = (await mammoth.convertToHtml({ buffer })).value;
  } catch (e) {
    throw new ImportError(`Could not read ${ext} file: ${e.message}`, 422);
  }
  return { title, html: clean(html) || '<p></p>' };
}

module.exports = { importFile, ImportError, ALLOWED_EXT, MAX_BYTES };
