import DOMPurify from 'dompurify';

export function sanitizeHTML(dirty, config = {}) {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'code', 'br', 'p', 'span', 'a', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: ['href', 'class', 'target', 'rel'],
    ...config
  });
}

export function escapeHTML(str) {
  if (str === null || str === undefined) {
    return '';
  }
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
