export class WorkflowPanel extends HTMLElement {
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
        .stage { padding: 4px; border-left: 2px solid #555; margin-bottom: 8px; margin-left:8px; }
      </style>
      <div class="workflow-panel">
        <h3>Recommended Build Order</h3>
        <div id="stages-container"></div>
      </div>
    `;
    this.renderStages();
  }

  renderStages() {
    const container = this.shadowRoot.getElementById('stages-container');
    // Clear existing content safely
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    if (this.kb && this.kb.workflowSequences) {
      const seq = this.kb.workflowSequences.sequences[0];
      if (seq && seq.stages) {
        for (const s of seq.stages) {
          const stageDiv = document.createElement('div');
          stageDiv.className = 'stage';

          const strong = document.createElement('strong');
          strong.textContent = `Stage ${s.stage}: ${s.name}`;
          stageDiv.appendChild(strong);
          stageDiv.appendChild(document.createElement('br'));

          const span = document.createElement('span');
          span.style.cssText = 'font-size:0.8em; color:#888;';
          const glyphsText = s.glyphs ? s.glyphs.join(', ') : (s.glyphs_first ? s.glyphs_first.join(', ') : '');
          span.textContent = glyphsText;
          stageDiv.appendChild(span);

          container.appendChild(stageDiv);
        }
      } else {
        const p = document.createElement('p');
        p.textContent = 'No workflow selected';
        container.appendChild(p);
      }
    }
  }
}

if (!customElements.get('coach-workflow-panel')) {
  customElements.define('coach-workflow-panel', WorkflowPanel);
}
