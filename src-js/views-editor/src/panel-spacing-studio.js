import * as html from "@fontra/core/html-utils.js";
import { throttleCalls } from "@fontra/core/utils.js";
import { AutoSpaceEngine } from "./auto-space-engine.js";
import { PROOF_STRINGS } from "./data/proof-strings.js";
import { SPACING_CURRICULUM, GLYPH_HINTS } from "./data/spacing-curriculum.js";

export default class SpacingStudioPanel {
  identifier = "spacing-studio";
  iconPath = "/images/spacing-studio.svg";

  static styles = `
    .ss-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-size: 12px;
      overflow: hidden;
    }
    .ss-tabs {
      display: flex;
      border-bottom: 1px solid var(--ui-element-background-color);
      padding: 4px;
      gap: 4px;
    }
    .ss-tab {
      padding: 6px 10px;
      cursor: pointer;
      font-size: 11px;
      background: transparent;
      border: none;
      border-radius: 4px;
      color: var(--ui-element-foreground-color);
      opacity: 0.6;
      transition: opacity 0.2s, background 0.2s;
    }
    .ss-tab:hover {
      opacity: 0.9;
      background: var(--ui-element-background-color);
    }
    .ss-tab.active {
      opacity: 1;
      background: var(--ui-element-background-color);
      font-weight: 600;
    }
    .ss-content {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: none;
    }
    .ss-content.active {
      display: block;
    }
    .ss-section {
      margin-bottom: 16px;
    }
    .ss-section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.7;
      margin-bottom: 8px;
    }
    .ss-proof-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }
    .ss-proof-btn {
      padding: 4px 8px;
      font-size: 10px;
      background: var(--ui-element-background-color);
      border: 1px solid var(--ui-element-background-color);
      border-radius: 3px;
      color: var(--ui-element-foreground-color);
      cursor: pointer;
    }
    .ss-proof-btn:hover {
      border-color: var(--ui-element-foreground-color);
    }
    .ss-proof-canvas-wrap {
      background: var(--ui-element-background-color);
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 8px;
    }
    .ss-proof-canvas {
      width: 100%;
      height: 60px;
      display: block;
    }
    .ss-metric-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: var(--ui-element-background-color);
      border-radius: 4px;
      margin-bottom: 8px;
    }
    .ss-metric-label {
      font-size: 11px;
      opacity: 0.7;
      min-width: 30px;
    }
    .ss-metric-value {
      flex: 1;
      font-family: monospace;
      font-size: 13px;
    }
    .ss-metric-input {
      width: 60px;
      padding: 4px;
      font-size: 12px;
      text-align: right;
      background: var(--text-input-background-color);
      border: 1px solid transparent;
      border-radius: 3px;
      color: var(--text-input-foreground-color);
    }
    .ss-metric-input:focus {
      border-color: var(--ui-element-foreground-color);
      outline: none;
    }
    .ss-hint-box {
      padding: 10px;
      background: var(--ui-element-background-color);
      border-radius: 4px;
      font-size: 11px;
      line-height: 1.5;
      border-left: 3px solid #4a9eff;
    }
    .ss-hint-box strong {
      opacity: 0.9;
    }
    .ss-curriculum-item {
      padding: 8px;
      background: var(--ui-element-background-color);
      border-radius: 4px;
      margin-bottom: 6px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .ss-curriculum-item:hover {
      background: var(--text-input-background-color);
    }
    .ss-curriculum-item.active {
      border-left: 3px solid #4a9eff;
    }
    .ss-curriculum-label {
      font-size: 11px;
      font-weight: 500;
    }
    .ss-empty-state {
      text-align: center;
      padding: 20px;
      opacity: 0.5;
      font-size: 11px;
    }
    .ss-suggestion {
      padding: 8px;
      background: #4a9eff15;
      border-radius: 4px;
      margin-bottom: 8px;
      border-left: 3px solid #4a9eff;
    }
    .ss-suggestion-label {
      font-size: 10px;
      text-transform: uppercase;
      opacity: 0.6;
      margin-bottom: 4px;
    }
    .ss-suggestion-values {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .ss-suggestion-val {
      font-family: monospace;
      font-size: 14px;
    }
    .ss-suggestion-apply {
      margin-left: auto;
      padding: 4px 8px;
      font-size: 10px;
      background: #4a9eff;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
    }
    .ss-suggestion-apply:hover {
      background: #3a8eef;
    }
  `;

  constructor(editorController) {
    this.editorController = editorController;
    this.fontController = editorController.fontController;
    this.autoSpaceEngine = new AutoSpaceEngine(this.fontController);
    this._currentGlyphName = null;
    this._currentMetrics = { lsb: 0, rsb: 0, advance: 500 };
    this._refs = { nLSB: 60, nRSB: 58, nCounter: 250, hCounter: 350 };
    this._activeTab = "proof";
    this._currentCurriculumItem = null;
    this._initialized = false;

    this.sceneController = this.editorController.sceneController;
    this.throttledUpdate = throttleCalls(() => this._onGlyphChanged(), 100);
  }

  async ensureInitialized() {
    if (this._initialized) return;
    
    this.sceneController.sceneSettingsController.addKeyListener(
      ["selectedGlyphName", "glyphLocation"],
      () => this.throttledUpdate()
    );

    this.sceneController.addCurrentGlyphChangeListener(() => {
      this.throttledUpdate();
    });

    this._initialized = true;
  }

  getContentElement() {
    this._element = html.div({ class: "ss-panel", style: SpacingStudioPanel.styles }, [
      this._buildTabBar(),
      this._buildContent()
    ]);
    return this._element;
  }

  _buildTabBar() {
    const tabs = [
      { id: "proof", label: "Proof" },
      { id: "metrics", label: "Metrics" },
      { id: "guide", label: "Guide" },
      { id: "auto", label: "Auto" }
    ];
    
    return html.div({ class: "ss-tabs" },
      tabs.map(tab => 
        html.button({
          class: `ss-tab ${tab.id === this._activeTab ? "active" : ""}`,
          onClick: () => this._switchTab(tab.id)
        }, tab.label)
      )
    );
  }

  _buildContent() {
    return html.div({ class: "ss-content-container" }, [
      this._buildProofPane(),
      this._buildMetricsPane(),
      this._buildGuidePane(),
      this._buildAutoPane()
    ]);
  }

  _buildProofPane() {
    this._proofPane = html.div({ class: "ss-content ss-proof-pane" }, [
      html.div({ class: "ss-section" }, [
        html.div({ class: "ss-section-title" }, "Proof Strings"),
        html.div({ class: "ss-proof-buttons" },
          Object.keys(PROOF_STRINGS).map(key =>
            html.button({
              class: "ss-proof-btn",
              onClick: () => this._showProofString(PROOF_STRINGS[key])
            }, key.replace(/_/g, " "))
          )
        )
      ]),
      html.div({ class: "ss-proof-canvas-wrap" }, [
        html.createDomElement("canvas", { class: "ss-proof-canvas", id: "proof-canvas" })
      ]),
      html.div({ class: "ss-hint-box", id: "proof-hint" }, 
        "Select a glyph to see spacing hints"
      )
    ]);
    return this._proofPane;
  }

  _buildMetricsPane() {
    this._metricsPane = html.div({ class: "ss-content ss-metrics-pane" }, [
      html.div({ class: "ss-section" }, [
        html.div({ class: "ss-section-title" }, "Sidebearings"),
        html.div({ class: "ss-metric-row" }, [
          html.span({ class: "ss-metric-label" }, "LSB"),
          html.input({
            class: "ss-metric-input",
            type: "number",
            id: "lsb-input",
            value: 0,
            onChange: (e) => this._onLSBChange(e)
          }),
          html.span({ class: "ss-metric-value", id: "lsb-value" }, "0")
        ]),
        html.div({ class: "ss-metric-row" }, [
          html.span({ class: "ss-metric-label" }, "RSB"),
          html.input({
            class: "ss-metric-input",
            type: "number",
            id: "rsb-input",
            value: 0,
            onChange: (e) => this._onRSBChange(e)
          }),
          html.span({ class: "ss-metric-value", id: "rsb-value" }, "0")
        ]),
        html.div({ class: "ss-metric-row" }, [
          html.span({ class: "ss-metric-label" }, "Width"),
          html.span({ class: "ss-metric-value", id: "advance-value" }, "500")
        ])
      ]),
      html.div({ class: "ss-hint-box", id: "metrics-hint" },
        "Edit sidebearings to adjust spacing"
      )
    ]);
    return this._metricsPane;
  }

  _buildGuidePane() {
    this._guidePane = html.div({ class: "ss-content ss-guide-pane" }, [
      html.div({ class: "ss-section" }, [
        html.div({ class: "ss-section-title" }, "Spacing Curriculum"),
        html.div({ class: "ss-curriculum-list", id: "curriculum-list" },
          SPACING_CURRICULUM.map(item =>
            html.div({
              class: `ss-curriculum-item ${item.id === this._currentCurriculumItem ? "active" : ""}`,
              "data-id": item.id,
              onClick: () => this._selectCurriculumItem(item)
            }, html.span({ class: "ss-curriculum-label" }, item.label))
          )
        ),
        html.div({ class: "ss-hint-box", id: "curriculum-tip", style: "margin-top: 12px;" },
          "Click a lesson to learn proper spacing techniques"
        )
      ])
    ]);
    return this._guidePane;
  }

  _buildAutoPane() {
    this._autoPane = html.div({ class: "ss-content ss-auto-pane" }, [
      html.div({ class: "ss-section" }, [
        html.div({ class: "ss-section-title" }, "Reference Glyphs"),
        html.div({ class: "ss-metric-row" }, [
          html.span({ class: "ss-metric-label" }, "n LSB"),
          html.input({
            class: "ss-metric-input",
            type: "number",
            id: "ref-n-lsb",
            value: this._refs.nLSB,
            onChange: (e) => { this._refs.nLSB = parseInt(e.target.value) || 60; this._updateAutoSuggestions(); }
          })
        ]),
        html.div({ class: "ss-metric-row" }, [
          html.span({ class: "ss-metric-label" }, "n RSB"),
          html.input({
            class: "ss-metric-input",
            type: "number",
            id: "ref-n-rsb",
            value: this._refs.nRSB,
            onChange: (e) => { this._refs.nRSB = parseInt(e.target.value) || 58; this._updateAutoSuggestions(); }
          })
        ]),
        html.div({ class: "ss-metric-row" }, [
          html.span({ class: "ss-metric-label" }, "n counter"),
          html.input({
            class: "ss-metric-input",
            type: "number",
            id: "ref-n-counter",
            value: this._refs.nCounter,
            onChange: (e) => { this._refs.nCounter = parseInt(e.target.value) || 250; this._updateAutoSuggestions(); }
          })
        ]),
        html.div({ class: "ss-metric-row" }, [
          html.span({ class: "ss-metric-label" }, "H counter"),
          html.input({
            class: "ss-metric-input",
            type: "number",
            id: "ref-h-counter",
            value: this._refs.hCounter,
            onChange: (e) => { this._refs.hCounter = parseInt(e.target.value) || 350; this._updateAutoSuggestions(); }
          })
        ])
      ]),
      html.div({ class: "ss-section" }, [
        html.div({ class: "ss-section-title" }, "Suggestions"),
        html.div({ id: "auto-suggestions" })
      ])
    ]);
    return this._autoPane;
  }

  async toggle(on, focus) {
    if (on) {
      await this.ensureInitialized();
      await this._onGlyphChanged();
    }
  }

  async _onGlyphChanged() {
    if (!this._element) return;
    
    const glyphName = this.sceneController.sceneSettings.selectedGlyphName;
    if (!glyphName) {
      this._currentGlyphName = null;
      return;
    }

    this._currentGlyphName = glyphName;
    await this._updateMetrics();
    this._updateHints(glyphName);
    this._updateAutoSuggestions();
    this._renderProofString(PROOF_STRINGS.round_straight);
  }

  async _updateMetrics() {
    if (!this._currentGlyphName || !this._element) return;

    try {
      const glyphController = await this.sceneController.sceneModel.getGlyphInstance(
        this._currentGlyphName,
        this.sceneController.sceneSettings.editLayerName
      );

      if (glyphController) {
        this._currentMetrics = {
          lsb: glyphController.leftMargin || 0,
          rsb: glyphController.rightMargin || 0,
          advance: glyphController.xAdvance || 500
        };

        const lsbInput = this._element.querySelector("#lsb-input");
        const rsbInput = this._element.querySelector("#rsb-input");
        const lsbValue = this._element.querySelector("#lsb-value");
        const rsbValue = this._element.querySelector("#rsb-value");
        const advanceValue = this._element.querySelector("#advance-value");

        if (lsbInput) lsbInput.value = Math.round(this._currentMetrics.lsb);
        if (rsbInput) rsbInput.value = Math.round(this._currentMetrics.rsb);
        if (lsbValue) lsbValue.textContent = Math.round(this._currentMetrics.lsb);
        if (rsbValue) rsbValue.textContent = Math.round(this._currentMetrics.rsb);
        if (advanceValue) advanceValue.textContent = Math.round(this._currentMetrics.advance);
      }
    } catch (e) {
      console.warn("Failed to update metrics:", e);
    }
  }

  _updateHints(glyphName) {
    if (!this._element) return;
    
    const hint = GLYPH_HINTS[glyphName];
    const proofHint = this._element.querySelector("#proof-hint");
    const metricsHint = this._element.querySelector("#metrics-hint");
    
    if (hint) {
      const hintText = `<strong>${glyphName}:</strong> ${hint}`;
      if (proofHint) proofHint.innerHTML = hintText;
      if (metricsHint) metricsHint.innerHTML = hintText;
    } else {
      if (proofHint) proofHint.textContent = "No specific hint for this glyph";
      if (metricsHint) metricsHint.textContent = "Edit sidebearings to adjust spacing";
    }
  }

  _updateAutoSuggestions() {
    if (!this._currentGlyphName || !this._element) return;

    const suggestions = this.autoSpaceEngine.computeSuggestions(
      this._currentGlyphName,
      {},
      this._refs
    );

    const container = this._element.querySelector("#auto-suggestions");
    if (!container) return;

    container.innerHTML = "";
    
    const div = html.div({ class: "ss-suggestion" }, [
      html.div({ class: "ss-suggestion-label" }, 
        `Based on ${suggestions.shapeClass} class`
      ),
      html.div({ class: "ss-suggestion-values" }, [
        html.span({}, `LSB: `),
        html.span({ class: "ss-suggestion-val" }, suggestions.lsb),
        html.span({}, ` RSB: `),
        html.span({ class: "ss-suggestion-val" }, suggestions.rsb),
        html.button({
          class: "ss-suggestion-apply",
          onClick: () => this._applySuggestion(suggestions)
        }, "Apply")
      ]),
      html.div({ style: "font-size: 10px; opacity: 0.6; margin-top: 4px;" },
        suggestions.formula
      )
    ]);
    
    container.appendChild(div);
  }

  async _applySuggestion(suggestion) {
    if (!this._currentGlyphName) return;

    await this.sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
      const editLayerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(glyph.layers);
      
      for (const [layerName, layerGlyph] of Object.entries(editLayerGlyphs)) {
        const dx = suggestion.lsb - (layerGlyph.xMax || 0);
        
        if (layerGlyph.path && layerGlyph.path.coordinates) {
          for (let i = 0; i < layerGlyph.path.coordinates.length; i += 2) {
            layerGlyph.path.coordinates[i] += dx;
          }
        }
        
        if (layerGlyph.components) {
          for (const compo of layerGlyph.components) {
            compo.transformation.translateX += dx;
          }
        }
        
        const xMin = layerGlyph.xMin || 0;
        const xMax = layerGlyph.xMax || 0;
        layerGlyph.xAdvance = suggestion.lsb + suggestion.rsb + (xMax - xMin);
      }

      return {
        changes: [],
        undoLabel: `Apply spacing suggestion`,
        broadcast: true
      };
    });

    await this._updateMetrics();
  }

  _switchTab(tabId) {
    this._activeTab = tabId;
    
    if (!this._element) return;
    
    const tabs = this._element.querySelectorAll(".ss-tab");
    tabs.forEach(tab => {
      tab.classList.toggle("active", tab.textContent.toLowerCase() === tabId);
    });

    const proofPane = this._element.querySelector(".ss-proof-pane");
    const metricsPane = this._element.querySelector(".ss-metrics-pane");
    const guidePane = this._element.querySelector(".ss-guide-pane");
    const autoPane = this._element.querySelector(".ss-auto-pane");

    if (proofPane) proofPane.classList.toggle("active", tabId === "proof");
    if (metricsPane) metricsPane.classList.toggle("active", tabId === "metrics");
    if (guidePane) guidePane.classList.toggle("active", tabId === "guide");
    if (autoPane) autoPane.classList.toggle("active", tabId === "auto");
  }

  _showProofString(str) {
    this._renderProofString(str);
  }

  async _renderProofString(str) {
    if (!this._element) return;
    
    const canvas = this._element.querySelector("#proof-canvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const bgColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--ui-element-background-color").trim() || "#484848";
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (!this._currentGlyphName) {
      ctx.fillStyle = "#888";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Select a glyph to see proof string", rect.width / 2, rect.height / 2);
      return;
    }

    const glyphName = this._currentGlyphName;
    
    try {
      const glyphController = await this.fontController.getGlyph(glyphName);
      if (!glyphController) return;

      const instance = glyphController.getInstanceAtLocation({});
      if (!instance || !instance.path) return;

      const fontSize = 28;
      const x = 10;
      const y = 40;

      const fgColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--ui-element-foreground-color").trim() || "#fff";
      ctx.fillStyle = fgColor;
      ctx.font = `${fontSize}px "${this.fontController.fontFamily || "Sans"}"`;

      let offsetX = x;
      for (const char of str) {
        if (char === " " || char === "·") {
          offsetX += fontSize * 0.3;
          continue;
        }

        try {
          const charGlyph = await this.fontController.getGlyph(char);
          if (charGlyph) {
            const charInstance = charGlyph.getInstanceAtLocation({});
            if (charInstance && charInstance.path) {
              ctx.save();
              ctx.translate(offsetX, y);
              ctx.scale(fontSize / 1000, -fontSize / 1000);
              ctx.fill(charInstance.path);
              ctx.restore();
              
              offsetX += (charInstance.xAdvance || 500) * fontSize / 1000;
            } else {
              ctx.fillText(char, offsetX, y);
              offsetX += fontSize * 0.6;
            }
          } else {
            ctx.fillText(char, offsetX, y);
            offsetX += fontSize * 0.6;
          }
        } catch (e) {
          ctx.fillText(char, offsetX, y);
          offsetX += fontSize * 0.6;
        }
      }
    } catch (e) {
      ctx.fillStyle = "#888";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Unable to render glyph", rect.width / 2, rect.height / 2);
    }
  }

  _selectCurriculumItem(item) {
    this._currentCurriculumItem = item.id;
    
    if (!this._element) return;
    
    const items = this._element.querySelectorAll(".ss-curriculum-item");
    items.forEach(el => {
      el.classList.toggle("active", el.dataset.id === item.id);
    });

    const tipEl = this._element.querySelector("#curriculum-tip");
    if (tipEl) {
      tipEl.innerHTML = `<strong>${item.label}</strong><br><br>${item.tip}`;
    }

    if (item.proofString) {
      this._renderProofString(item.proofString);
    }
  }

  async _onLSBChange(event) {
    if (!this._currentGlyphName) return;
    const newValue = parseInt(event.target.value) || 0;
    
    await this.sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
      const editLayerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(glyph.layers);
      
      for (const [layerName, layerGlyph] of Object.entries(editLayerGlyphs)) {
        const oldLsb = layerGlyph.xMax || 0;
        const dx = newValue - oldLsb;
        
        if (layerGlyph.path && layerGlyph.path.coordinates) {
          for (let i = 0; i < layerGlyph.path.coordinates.length; i += 2) {
            layerGlyph.path.coordinates[i] += dx;
          }
        }
        
        if (layerGlyph.components) {
          for (const compo of layerGlyph.components) {
            compo.transformation.translateX += dx;
          }
        }
        
        layerGlyph.xAdvance += dx;
      }

      return {
        changes: [],
        undoLabel: `Set LSB to ${newValue}`,
        broadcast: true
      };
    });

    await this._updateMetrics();
  }

  async _onRSBChange(event) {
    if (!this._currentGlyphName) return;
    const newValue = parseInt(event.target.value) || 0;
    
    await this.sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
      const editLayerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(glyph.layers);
      
      for (const [layerName, layerGlyph] of Object.entries(editLayerGlyphs)) {
        const oldRsb = (layerGlyph.xAdvance || 0) - (layerGlyph.xMax || 0);
        const dx = newValue - oldRsb;
        layerGlyph.xAdvance += dx;
      }

      return {
        changes: [],
        undoLabel: `Set RSB to ${newValue}`,
        broadcast: true
      };
    });

    await this._updateMetrics();
  }
}
