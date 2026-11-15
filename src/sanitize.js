'use strict';
const sanitizeHtml = require('sanitize-html');

// Allow only the formatting the editor can produce. Everything else is stripped.
const OPTIONS = {
  allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'span'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) },
};

const clean = (html) => sanitizeHtml(String(html ?? ''), OPTIONS);
module.exports = { clean };
