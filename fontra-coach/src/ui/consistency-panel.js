export class ConsistencyPanel extends HTMLElement {
  constructor(engine, kb) {
    super();
    this.engine = engine;
    this.kb = kb;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        background: var(--fontra-panel-bg, #1e1e1e);
        color: var(--fontra-text-primary, #e0e0e0);
        font-family: var(--fontra-font-ui, sans-serif);
        padding: 8px;
      }
    `;
    this.shadowRoot.appendChild(style);

    const container = document.createElement('div');
    container.className = 'consistency-panel';

    const p = document.createElement('p');
    p.textContent = 'Font-wide Consistency Audit';
    container.appendChild(p);

    const note = document.createElement('p');
    note.textContent = 'Not implemented yet — this audit will compare every glyph against the font-wide DNA.';
    note.style.cssText = 'color:#888; font-size:0.85em;';
    container.appendChild(note);

    const button = document.createElement('button');
    button.id = 'run-audit-btn';
    button.textContent = 'Run Audit';
    button.disabled = true;
    button.title = 'Not implemented yet';
    button.style.cssText = 'cursor:default; opacity:0.4;';
    container.appendChild(button);

    this.shadowRoot.appendChild(container);
  }
}

if (!customElements.get('coach-consistency-panel')) {
  customElements.define('coach-consistency-panel', ConsistencyPanel);
}
