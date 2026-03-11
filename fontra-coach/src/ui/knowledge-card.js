import { CardRenderer } from '../knowledge/card-renderer.js';

export class KnowledgeCardComponent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.renderer = new CardRenderer();
  }
  
  set card(data) {
    this.renderer.renderFull(data, this.shadowRoot);
  }
}

if (!customElements.get('coach-knowledge-card')) {
  customElements.define('coach-knowledge-card', KnowledgeCardComponent);
}
