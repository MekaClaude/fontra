/**
 * Renders Knowledge Cards
 */
export class CardRenderer {
  renderFull(card, container, options = {}) {
    container.innerHTML = `
      <div class="coach-card full">
        <h3>${card.title}</h3>
        <div class="body-text">${this.sanitize(card.body)}</div>
        ${card.tips && card.tips.length > 0 ? `
          <ul class="tips">
            ${card.tips.map(tip => `<li>${this.sanitize(tip)}</li>`).join('')}
          </ul>
        ` : ''}
      </div>
    `;
  }

  renderCompact(card, container) {
    container.innerHTML = `
      <div class="coach-card compact">
        <strong>${card.title}</strong>
      </div>
    `;
  }

  renderAnnotation(card) {
    return card.title || "Contextual tip";
  }

  sanitize(text) {
    if (!text) return '';
    let html = text
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '</p><p>');
    return `<p>${html}</p>`;
  }
}
