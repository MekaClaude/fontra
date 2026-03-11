export class ConsistencyPanel extends HTMLElement {
  constructor(engine, kb) {
    super();
    this.engine = engine;
    this.kb = kb;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          background: var(--fontra-panel-bg, #1e1e1e);
          color: var(--fontra-text-primary, #e0e0e0);
          font-family: var(--fontra-font-ui, sans-serif);
          padding: 8px;
        }
      </style>
      <div class="consistency-panel">
        <p>Font-wide Consistency Audit</p>
        <button id="run-audit-btn">Run Audit</button>
      </div>
    `;
    this.shadowRoot.getElementById('run-audit-btn').addEventListener('click', () => {
      console.log('Audit requested');
    });
  }
}

if (!customElements.get('coach-consistency-panel')) {
  customElements.define('coach-consistency-panel', ConsistencyPanel);
}
