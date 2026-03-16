import { resolveDNA } from '../knowledge/dna-resolver.js';
import { CardRenderer } from '../knowledge/card-renderer.js';

export class DNAPanel extends HTMLElement {
  constructor(engine, kb) {
    super();
    this.engine = engine;
    this.kb = kb;
    this.cardRenderer = new CardRenderer();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    if (this.engine && this.engine.onStateUpdated) {
      this.engine.onStateUpdated(glyphName => {
        this.updateState(glyphName);
      });
    }
  }

  updateState(glyphName) {
    this.state = resolveDNA(glyphName, this.kb);
    this.render();
  }


  render() {
    // Clear existing content safely
    while (this.shadowRoot.firstChild) {
      this.shadowRoot.removeChild(this.shadowRoot.firstChild);
    }

    if (!this.state || this.state.empty) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.style.cssText = 'color:#e0e0e0';
      emptyDiv.textContent = 'Select a glyph to view its DNA.';
      this.shadowRoot.appendChild(emptyDiv);
      return;
    }

    const style = document.createElement('style');
    style.textContent = `
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
      .knowledge-card-container { margin-bottom: 12px; }
    `;
    this.shadowRoot.appendChild(style);

    const panelDiv = document.createElement('div');
    panelDiv.className = 'dna-panel';

    // Render knowledge card if available
    if (this.state.card) {
      const cardContainer = document.createElement('div');
      cardContainer.className = 'knowledge-card-container';
      this.cardRenderer.renderFull(this.state.card, cardContainer);
      panelDiv.appendChild(cardContainer);
    }

    // Built From section
    const buildsFromSection = this.createSection('Built From', this.state.buildsFrom);
    panelDiv.appendChild(buildsFromSection);

    // Feeds Into section
    const feedsIntoSection = this.createSection('Feeds Into', this.state.feedsInto);
    panelDiv.appendChild(feedsIntoSection);

    // Shares DNA With section
    const sharesDnaWithSection = this.createSection('Shares DNA With', this.state.sharesDnaWith);
    panelDiv.appendChild(sharesDnaWithSection);

    this.shadowRoot.appendChild(panelDiv);
  }

  createSection(title, items) {
    const section = document.createElement('div');
    section.className = 'section';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'title';
    titleDiv.textContent = title;
    section.appendChild(titleDiv);

    if (items.length === 0) {
      const em = document.createElement('em');
      em.textContent = 'None';
      section.appendChild(em);
    } else {
      for (const item of items) {
        section.appendChild(this.renderGlyphItem(item));
      }
    }

    return section;
  }

  renderGlyphItem(rel) {
    const div = document.createElement('div');
    div.className = 'glyph-item';

    const leftSpan = document.createElement('span');
    const strong = document.createElement('strong');
    strong.style.cssText = 'font-size: 1.2em;';
    strong.textContent = rel.glyph;
    leftSpan.appendChild(strong);

    const pillSpan = document.createElement('span');
    pillSpan.className = 'pill';
    pillSpan.textContent = rel.method || rel.relationship;
    leftSpan.appendChild(pillSpan);

    div.appendChild(leftSpan);

    const button = document.createElement('button');
    button.title = 'Toggle Ghost Overlay';
    button.style.cssText = 'background:none; border:1px solid #555; color:inherit; cursor:pointer;';
    button.textContent = '👁';
    button.addEventListener('click', () => console.log(`Toggle ghost for ${rel.glyph}`));
    div.appendChild(button);

    return div;
  }
}

if (!customElements.get('coach-dna-panel')) {
  customElements.define('coach-dna-panel', DNAPanel);
}
