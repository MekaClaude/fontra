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
