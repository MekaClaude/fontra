import { resolveDNA } from '../knowledge/dna-resolver.js';

export class DNAPanel extends HTMLElement {
  constructor(engine, kb) {
    super();
    this.engine = engine;
    this.kb = kb;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    document.addEventListener('fontra-glyph-selected', e => {
      this.updateState(e.detail.glyphName, e.detail.fontController);
    });
  }

  updateState(glyphName, fontController) {
    this.state = resolveDNA(glyphName, this.kb);
    this.render();
  }

  render() {
    if (!this.state || this.state.empty) {
      this.shadowRoot.innerHTML = `<div class="empty-state" style="color:#e0e0e0">Select a glyph to view its DNA.</div>`;
      return;
    }
    
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          background: var(--fontra-panel-bg, #1e1e1e);
          color: var(--fontra-text-primary, #e0e0e0);
          font-family: var(--fontra-font-ui, sans-serif);
          padding: 8px;
        }
        .section { margin-bottom: 1em; }
        .title { color: var(--fontra-text-secondary, #888); font-size: 0.9em; text-transform: uppercase; margin-bottom: 4px; }
        .glyph-item { display: flex; align-items: center; justify-content: space-between; padding: 4px; cursor: pointer; border-radius: 4px;}
        .glyph-item:hover { background: #3a3a3a; }
        .pill { font-size: 0.8em; padding: 2px 4px; border-radius: 4px; background: #444;}
      </style>
      <div class="dna-panel">
        <div class="section">
          <div class="title">Built From</div>
          ${this.state.buildsFrom.map(r => this.renderGlyphItem(r)).join('')}
          ${this.state.buildsFrom.length === 0 ? '<em>None</em>' : ''}
        </div>
        <div class="section">
          <div class="title">Feeds Into</div>
          ${this.state.feedsInto.map(r => this.renderGlyphItem(r)).join('')}
          ${this.state.feedsInto.length === 0 ? '<em>None</em>' : ''}
        </div>
        <div class="section">
          <div class="title">Shares DNA With</div>
          ${this.state.sharesDnaWith.map(r => this.renderGlyphItem(r)).join('')}
          ${this.state.sharesDnaWith.length === 0 ? '<em>None</em>' : ''}
        </div>
      </div>
    `;
  }

  renderGlyphItem(rel) {
    return `
      <div class="glyph-item">
        <span><strong style="font-size: 1.2em;">${rel.glyph}</strong> <span class="pill">${rel.method || rel.relationship}</span></span>
        <button title="Toggle Ghost Overlay" style="background:none; border:1px solid #555; color:inherit; cursor:pointer;" onclick="console.log('Toggle ghost for ${rel.glyph}')">👁</button>
      </div>
    `;
  }
}

if (!customElements.get('coach-dna-panel')) {
  customElements.define('coach-dna-panel', DNAPanel);
}
