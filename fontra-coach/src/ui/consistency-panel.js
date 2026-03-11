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

    const button = document.createElement('button');
    button.id = 'run-audit-btn';
    button.textContent = 'Run Audit';
    container.appendChild(button);

    this.shadowRoot.appendChild(container);

    this.shadowRoot.getElementById('run-audit-btn').addEventListener('click', () => {
      console.log('Audit requested');
    });
  }
}

if (!customElements.get('coach-consistency-panel')) {
  customElements.define('coach-consistency-panel', ConsistencyPanel);
}
