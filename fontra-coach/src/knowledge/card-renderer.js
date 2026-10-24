/**
 * Renders Knowledge Cards
 */
import DOMPurify from 'dompurify';

export class CardRenderer {
  renderFull(card, container, options = {}) {
    // Clear container safely
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const cardDiv = document.createElement('div');
    cardDiv.className = 'coach-card full';

    const h3 = document.createElement('h3');
    h3.textContent = card.title || '';
    cardDiv.appendChild(h3);

    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'body-text';
    bodyDiv.innerHTML = this.sanitize(card.body) || '';
    cardDiv.appendChild(bodyDiv);

    if (card.tips && card.tips.length > 0) {
      const ul = document.createElement('ul');
      ul.className = 'tips';
      for (const tip of card.tips) {
        const li = document.createElement('li');
        li.innerHTML = this.sanitize(tip);
        ul.appendChild(li);
      }
      cardDiv.appendChild(ul);
    }

    container.appendChild(cardDiv);
  }

  renderCompact(card, container) {
    // Clear container safely
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const cardDiv = document.createElement('div');
    cardDiv.className = 'coach-card compact';

    const strong = document.createElement('strong');
    strong.textContent = card.title || '';
    cardDiv.appendChild(strong);

    container.appendChild(cardDiv);
  }

  renderAnnotation(card) {
    return card.title || "Contextual tip";
  }


  renderMasonry(cards, container) {
    while (container.firstChild) container.removeChild(container.firstChild);
    const grid = document.createElement('div');
    grid.className = 'coach-card-grid';
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;';
    for (const card of cards || []) {
      const cardDiv = document.createElement('div');
      cardDiv.className = 'coach-card masonry';
      cardDiv.style.cssText = 'border:1px solid #444;border-radius:8px;padding:8px;background:#2a2a2a;';
      const h = document.createElement('h4');
      h.textContent = card.title || '';
      cardDiv.appendChild(h);
      const body = document.createElement('div');
      body.innerHTML = this.sanitize(card.body || '');
      cardDiv.appendChild(body);
      if (card.tips && card.tips.length) {
        const ul = document.createElement('ul');
        for (const t of card.tips) {
          const li = document.createElement('li');
          li.innerHTML = this.sanitize(t);
          ul.appendChild(li);
        }
        cardDiv.appendChild(ul);
      }
      grid.appendChild(cardDiv);
    }
    container.appendChild(grid);
  }

  renderSuggestions(suggestions, container) {
    while (container.firstChild) container.removeChild(container.firstChild);
    const wrap = document.createElement('div');
    wrap.className = 'coach-suggestions';
    for (const sug of suggestions || []) {
      const div = document.createElement('div');
      div.className = 'coach-suggestion';
      div.style.cssText = 'padding:6px;margin:4px 0;border-left:3px solid #ff9800;background:#2a2a2a;';
      div.textContent = typeof sug === 'string' ? sug : (sug.text || '');
      wrap.appendChild(div);
    }
    container.appendChild(wrap);
  }

  sanitize(text) {
    if (!text) return '';

    // First, escape HTML entities to prevent XSS
    let escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Then process markdown-like formatting
    let html = escaped
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '</p><p>');

    // Wrap in paragraph tags and sanitize with DOMPurify
    html = `<p>${html}</p>`;

    // Use DOMPurify to allow safe HTML tags while preventing XSS
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p', 'strong', 'em', 'code', 'br', 'ul', 'ol', 'li', 'a'],
      ALLOWED_ATTR: ['href', 'target', 'rel'],
    });
  }
}
