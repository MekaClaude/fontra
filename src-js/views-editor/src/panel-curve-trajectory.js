import { aggregateScopeFindings } from "@fontra/core/curve-trajectory-scope.js";
import {
  RULE_LABELS,
  SEVERITY_ERROR,
  SEVERITY_OK,
  SEVERITY_WARN,
} from "@fontra/core/ideal-curve.js";
import { div, input, label, span } from "@fontra/core/html-utils.js";
import { translate, translatePlural } from "@fontra/core/localization.js";
import { themeController } from "@fontra/core/theme-settings.js";
import Panel from "./panel.js";

const CURVE_TRAJECTORY_IDENTIFIER = "fontra.curve.trajectory";

const LIGHT_COLORS = {
  ok: "#1D9E75",
  warn: "#D99117",
  error: "#E24B4A",
  ideal: "#6C5CE7",
  rule: "#8A8A8A",
};

const DARK_COLORS = {
  ok: "#3ECF9E",
  warn: "#F2B457",
  error: "#FF6B6B",
  ideal: "#A99BFF",
  rule: "#9A9A9A",
};

const SEVERITY_COLORS = {
  [SEVERITY_OK]: "ok",
  [SEVERITY_WARN]: "warn",
  [SEVERITY_ERROR]: "error",
};

export default class CurveTrajectoryPanel extends Panel {
  identifier = "curve-trajectory-panel";
  inlineSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M40 216A176 176 0 0 0 216 40h-48a128 128 0 0 1-128 128zM77 165l14 14-14 14-14-14zm51-37l14 14-14 14-14-14zm51-37l14 14-14 14-14-14z"/></svg>`;

  static styles = `
    :host {
      --ct-ok: ${LIGHT_COLORS.ok};
      --ct-warn: ${LIGHT_COLORS.warn};
      --ct-error: ${LIGHT_COLORS.error};
      --ct-ideal: ${LIGHT_COLORS.ideal};
      --ct-rule: ${LIGHT_COLORS.rule};
    }

    #ct-panel {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      font-size: 12px;
      color: var(--ui-element-foreground-color);
    }

    .ct-section {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .ct-section-title {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: var(--ct-rule);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ct-section-title::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--horizontal-rule-color);
    }

    .ct-toggle {
      width: 100%;
      padding: 7px 0;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: .04em;
      cursor: pointer;
      border: 1px solid var(--horizontal-rule-color);
      border-radius: 6px;
      color: white;
      transition: background-color .12s ease;
    }

    .ct-toggle.on { background: var(--ct-ok); }
    .ct-toggle.off { background: var(--ct-error); }

    .ct-pills {
      display: flex;
      gap: 4px;
      background: var(--ui-element-background-color);
      border-radius: 6px;
      padding: 3px;
    }

    .ct-pill {
      flex: 1;
      text-align: center;
      padding: 4px 2px;
      font-size: 11px;
      border-radius: 4px;
      cursor: pointer;
      color: var(--ui-element-foreground-color);
      opacity: .6;
      user-select: none;
      transition: opacity .12s ease, background-color .12s ease;
    }

    .ct-pill:hover { opacity: .9; }

    .ct-pill.selected {
      opacity: 1;
      font-weight: 600;
      background: var(--ui-element-background-color);
      box-shadow: 0 1px 3px rgba(0, 0, 0, .18);
    }

    .ct-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      cursor: pointer;
      padding: 1px 0;
    }

    .ct-row:hover .ct-row-label { color: var(--ct-ideal); }

    .ct-row-label { transition: color .12s ease; }

    .ct-key {
      font-size: 10px;
      color: var(--ct-rule);
      border: 1px solid var(--horizontal-rule-color);
      border-radius: 3px;
      padding: 0 4px;
      margin-left: 6px;
    }

    .ct-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      font-size: 11px;
      color: var(--ui-element-foreground-color);
      opacity: .85;
    }

    .ct-legend-item { display: flex; align-items: center; gap: 5px; }

    .ct-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex: none;
    }

    .ct-dot.ok { background: var(--ct-ok); }
    .ct-dot.warn { background: var(--ct-warn); }
    .ct-dot.error { background: var(--ct-error); }
    .ct-dot.ideal { background: var(--ct-ideal); }

    .ct-summary {
      font-size: 11px;
      color: var(--ui-element-foreground-color);
      opacity: .75;
      line-height: 1.45;
    }

    .ct-findings {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 220px;
      overflow-y: auto;
    }

    .ct-finding {
      display: flex;
      align-items: flex-start;
      gap: 7px;
      padding: 4px 5px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      line-height: 1.35;
    }

    .ct-finding:hover { background: var(--ui-element-background-color); }

    .ct-finding-id {
      font-variant-numeric: tabular-nums;
      opacity: .6;
      flex: none;
      min-width: 34px;
    }

    .ct-finding-glyph {
      flex: none;
      font-weight: 600;
      font-size: 10px;
      padding: 1px 4px;
      border-radius: 3px;
      background: var(--ui-element-background-color);
      color: var(--ct-ideal);
      max-width: 84px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ct-finding-text { flex: 1; }

    .ct-finding-rule {
      display: block;
      opacity: .6;
      font-size: 10px;
    }

    .ct-empty {
      font-size: 11px;
      opacity: .55;
      font-style: italic;
      padding: 6px 0;
      text-align: center;
    }

    .ct-actions {
      display: flex;
      gap: 6px;
    }

    .ct-button {
      flex: 1;
      padding: 6px 4px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--horizontal-rule-color);
      border-radius: 5px;
      background: var(--ui-element-background-color);
      color: var(--ui-element-foreground-color);
    }

    .ct-button:hover { border-color: var(--ct-ideal); color: var(--ct-ideal); }
    .ct-button:disabled { opacity: .4; cursor: default; }
    .ct-button:disabled:hover { border-color: var(--horizontal-rule-color); color: var(--ui-element-foreground-color); }

    .ct-fix-message {
      display: none;
      font-size: 10.5px;
      line-height: 1.45;
      color: var(--ct-warn);
    }

    .ct-fix-message.visible { display: block; }

    .ct-note {
      font-size: 10.5px;
      line-height: 1.5;
      opacity: .6;
      border-left: 2px solid var(--ct-ideal);
      padding-left: 8px;
    }

    .ct-note code {
      font-family: fontra-ui-semibold, sans-serif;
      opacity: .9;
    }
  `;

  constructor(editorController) {
    super(editorController);
    this._tool = null;
    this._findings = [];
    this._scopeGlyphs = [];
    this._scopeGlyphsByName = new Map();
  }

  set tool(tool) {
    this._tool = tool;
    if (tool) {
      this._bindToTool();
    }
  }

  get tool() {
    return this._tool;
  }

  getContentElement() {
    this._root = div({ id: "ct-panel" });

    this._toggleButton = input({
      type: "button",
      class: "ct-toggle off",
      value: translate("sidebar.curve-trajectory-panel.off"),
    });
    this._toggleButton.addEventListener("click", () => this._toggleEnabled());

    this._scopePills = this._buildPills(
      [
        ["editing", translate("sidebar.curve-trajectory-panel.scope-editing")],
        ["selected", translate("sidebar.curve-trajectory-panel.scope-selected")],
        ["all", translate("sidebar.curve-trajectory-panel.scope-all")],
      ],
      "scope"
    );

    this._strictnessPills = this._buildPills(
      [
        ["strict", translate("sidebar.curve-trajectory-panel.strict")],
        ["standard", translate("sidebar.curve-trajectory-panel.standard")],
        ["relaxed", translate("sidebar.curve-trajectory-panel.relaxed")],
      ],
      "strictness"
    );

    this._displayRows = {};
    const displaySection = div({ class: "ct-section" }, [
      div({ class: "ct-section-title" }, translate("sidebar.curve-trajectory-panel.display")),
      ...[
        ["showTrajectory", "trajectory", "t"],
        ["showCircle", "circle", "c"],
        ["showRibbon", "ribbon", "r"],
        ["showHandles", "handles", "h"],
        ["showRings", "rings", "n"],
        ["showLabels", "labels", "l"],
      ].map(([key, labelKey, shortcut]) =>
        this._buildCheckbox(key, labelKey, shortcut)
      ),
      this._buildCheckbox(
        "onlySelected",
        "sidebar.curve-trajectory-panel.only-selected",
        null
      ),
    ]);

    this._summary = div({ class: "ct-summary" });
    this._findingsList = div({ class: "ct-findings" });
    this._fixMessage = div({ class: "ct-fix-message" });

    this._fixAllButton = input({
      type: "button",
      class: "ct-button",
      value: translate("sidebar.curve-trajectory-panel.fix-flagged"),
    });
    this._fixAllButton.addEventListener("click", () => this._fix(null));

    this._fixSelectedButton = input({
      type: "button",
      class: "ct-button",
      value: translate("sidebar.curve-trajectory-panel.fix-selected"),
    });
    this._fixSelectedButton.addEventListener("click", () => this._fixSelected());

    this._root.appendChild(
      div({ class: "ct-section" }, [
        this._toggleButton,
      ])
    );

    this._root.appendChild(
      div({ class: "ct-section" }, [
        div(
          { class: "ct-section-title" },
          translate("sidebar.curve-trajectory-panel.scope")
        ),
        this._scopePills,
      ])
    );

    this._root.appendChild(displaySection);

    this._root.appendChild(
      div({ class: "ct-section" }, [
        div(
          { class: "ct-section-title" },
          translate("sidebar.curve-trajectory-panel.strictness")
        ),
        this._strictnessPills,
      ])
    );

    this._root.appendChild(
      div({ class: "ct-section" }, [
        div(
          { class: "ct-section-title" },
          translate("sidebar.curve-trajectory-panel.legend")
        ),
        div({ class: "ct-legend" }, [
          div({ class: "ct-legend-item" }, [
            span({ class: "ct-dot ideal" }),
            span({}, translate("sidebar.curve-trajectory-panel.legend-trajectory")),
          ]),
          div({ class: "ct-legend-item" }, [
            span({ class: "ct-dot ok" }),
            span({}, translate("sidebar.curve-trajectory-panel.legend-ok")),
          ]),
          div({ class: "ct-legend-item" }, [
            span({ class: "ct-dot warn" }),
            span({}, translate("sidebar.curve-trajectory-panel.legend-warn")),
          ]),
          div({ class: "ct-legend-item" }, [
            span({ class: "ct-dot error" }),
            span({}, translate("sidebar.curve-trajectory-panel.legend-error")),
          ]),
        ]),
      ])
    );

    this._root.appendChild(
      div({ class: "ct-section" }, [
        div(
          { class: "ct-section-title" },
          translate("sidebar.curve-trajectory-panel.findings")
        ),
        this._summary,
        this._findingsList,
        div({ class: "ct-actions" }, [
          this._fixSelectedButton,
          this._fixAllButton,
        ]),
        this._fixMessage,
      ])
    );

    this._root.appendChild(
      div({ class: "ct-note" }, [
        span({}, translate("sidebar.curve-trajectory-panel.note")),
      ])
    );

    // React to glyph and theme changes.
    this.editorController.sceneController.addCurrentGlyphChangeListener(() =>
      this._updateFindings()
    );
    this.editorController.sceneSettingsController.addKeyListener(
      "selectedGlyphName",
      () => this._updateFindings()
    );
    this.editorController.sceneSettingsController.addKeyListener(
      "positionedLines",
      () => this._updateFindings()
    );
    this.editorController.fontController.addEditListener(() =>
      this._updateFindings()
    );
    this.editorController.visualizationLayersSettings.addKeyListener(
      CURVE_TRAJECTORY_IDENTIFIER,
      (event) => this._updateEnabledState()
    );
    themeController.addListener(() => this._updateTheme());

    this._updateTheme();
    this._updateEnabledState();
    this._updateFindings();

    return this._root;
  }

  // ---------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------

  _buildPills(options, settingKey) {
    const container = div({ class: "ct-pills" });
    const pills = new Map();

    for (const [value, text] of options) {
      const pill = div({ class: "ct-pill" }, [text]);
      pill.addEventListener("click", () => {
        this._setSetting(settingKey, value);
      });
      pills.set(value, pill);
      container.appendChild(pill);
    }

    container._pills = pills;
    return container;
  }

  _buildCheckbox(key, labelKey, shortcut) {
    const checkbox = input({ type: "checkbox" });
    checkbox.addEventListener("change", () => {
      this._setSetting(key, checkbox.checked);
    });
    this._displayRows[key] = { checkbox: checkbox };

    const labelChildren = [translate(labelKey)];
    if (shortcut) {
      labelChildren.push(span({ class: "ct-key" }, [shortcut.toUpperCase()]));
    }
    const labelText = span({ class: "ct-row-label" }, labelChildren);

    return label({ class: "ct-row" }, [labelText, checkbox]);
  }

  _setSetting(key, value) {
    if (this._tool) {
      this._tool.settings.setItem(key, value);
    }
    this._syncControls();
    if (key === "strictness") {
      this._updateFindings();
    }
  }

  _bindToTool() {
    this._tool.settings.addListener(() => {
      this._syncControls();
      this._updateFindings();
    });
    this._syncControls();
    this._updateFindings();
  }

  _syncControls() {
    const model = this._tool?.settings.model;
    if (!model) {
      return;
    }

    for (const [container, key] of [
      [this._scopePills, "scope"],
      [this._strictnessPills, "strictness"],
    ]) {
      for (const [value, pill] of container._pills) {
        pill.classList.toggle("selected", model[key] === value);
      }
    }

    for (const [key, row] of Object.entries(this._displayRows)) {
      row.checkbox.checked = !!model[key];
    }
  }

  _toggleEnabled() {
    const settings = this.editorController.visualizationLayersSettings;
    const enabled = !settings.model[CURVE_TRAJECTORY_IDENTIFIER];
    settings.model[CURVE_TRAJECTORY_IDENTIFIER] = enabled;
    if (this._tool) {
      this._tool._layerEnabled = enabled;
    }
    this.editorController.canvasController.requestUpdate();
    if (enabled) {
      this.editorController.setSelectedTool("curve-trajectory");
    } else {
      this.editorController.setSelectedTool("pointer-tool");
    }
    this._updateEnabledState();
  }

  _updateEnabledState() {
    const enabled = !!this.editorController.visualizationLayersSettings.model[
      CURVE_TRAJECTORY_IDENTIFIER
    ];
    this._toggleButton.classList.toggle("on", enabled);
    this._toggleButton.classList.toggle("off", !enabled);
    this._toggleButton.value = enabled
      ? translate("sidebar.curve-trajectory-panel.on")
      : translate("sidebar.curve-trajectory-panel.off");
  }

  _updateTheme() {
    const dark = this.editorController.isThemeDark;
    const colors = dark ? DARK_COLORS : LIGHT_COLORS;
    for (const [name, value] of Object.entries(colors)) {
      this._root.style.setProperty(`--ct-${name}`, value);
    }
  }

  // ---------------------------------------------------------------------
  // Findings
  // ---------------------------------------------------------------------

  _updateFindings() {
    if (!this._findingsList) {
      return;
    }

    // The findings follow the scope: they describe exactly the glyphs that
    // the overlay draws, so the panel and the canvas cannot disagree.
    const scopeGlyphs = this._tool?.getScopeGlyphsByName?.() || [];
    this._scopeGlyphs = scopeGlyphs;
    this._scopeGlyphsByName = new Map(
      scopeGlyphs.map((scopeGlyph) => [scopeGlyph.glyphName, scopeGlyph])
    );

    const glyphAnalyses = scopeGlyphs.map((scopeGlyph) => {
      const path = scopeGlyph.positionedGlyph?.glyph?.path;
      return {
        glyphName: scopeGlyph.glyphName,
        analysis: path ? this._tool.getAnalysis(path) : null,
      };
    });

    const aggregated = aggregateScopeFindings(glyphAnalyses);
    this._findings = aggregated.findings;

    this._updateSummary(aggregated);
    this._renderFindings();
  }

  _updateSummary(aggregated) {
    if (!aggregated.glyphCount) {
      this._summary.textContent = translate(
        "sidebar.curve-trajectory-panel.no-glyphs-in-scope"
      );
      return;
    }

    if (aggregated.glyphCount > 1) {
      this._summary.textContent = translate(
        "sidebar.curve-trajectory-panel.summary-multi",
        aggregated.glyphCount,
        aggregated.curveCount,
        aggregated.offCount
      );
    } else {
      this._summary.textContent = translate(
        "sidebar.curve-trajectory-panel.summary",
        aggregated.curveCount,
        aggregated.offCount
      );
    }
  }

  _renderFindings() {
    this._findingsList.replaceChildren();

    if (!this._findings.length) {
      this._findingsList.appendChild(
        div(
          { class: "ct-empty" },
          translate("sidebar.curve-trajectory-panel.no-findings")
        )
      );
      this._fixAllButton.disabled = true;
      this._fixSelectedButton.disabled = true;
      return;
    }

    this._fixAllButton.disabled = false;
    this._fixSelectedButton.disabled = false;

    const showGlyphNames = this._scopeGlyphs.length > 1;

    for (const issue of this._findings) {
      const severity = SEVERITY_COLORS[issue.severity] || "ok";
      const segment = issue.segment;
      const id = segment
        ? `c${segment.contourIndex}·s${segment.segmentIndex}`
        : "";

      const children = [span({ class: "ct-dot " + severity, style: "margin-top: 4px;" })];
      if (showGlyphNames) {
        children.push(span({ class: "ct-finding-glyph" }, [issue.glyphName]));
      }
      children.push(span({ class: "ct-finding-id" }, [id]));
      children.push(
        span({ class: "ct-finding-text" }, [
          issue.message,
          span({ class: "ct-finding-rule" }, [
            RULE_LABELS[issue.rule] || issue.rule,
          ]),
        ])
      );

      const item = div({ class: "ct-finding" }, children);

      item.addEventListener("click", () => {
        if (segment) {
          this._tool?.selectSegment(
            segment,
            this._scopeGlyphsByName.get(issue.glyphName)
          );
        }
      });

      this._findingsList.appendChild(item);
    }
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  async _fix(entries) {
    if (!this._tool) {
      return;
    }
    const result = await this._tool.applyIdealTrajectory(entries);
    this._updateFindings();
    this._updateFixMessage(result);
  }

  async _fixSelected() {
    const selected = this._tool?.getSelectedSegmentEntries?.();
    if (!selected || !selected.length) {
      return;
    }
    await this._fix(selected);
  }

  _updateFixMessage(result) {
    const skipped = result?.skipped || [];
    if (skipped.length) {
      this._fixMessage.textContent = translatePlural(
        "sidebar.curve-trajectory-panel.skipped",
        skipped.length
      );
      this._fixMessage.classList.add("visible");
    } else {
      this._fixMessage.textContent = "";
      this._fixMessage.classList.remove("visible");
    }
  }

  async toggle(on, focus) {
    if (on) {
      this._syncControls();
      this._updateFindings();
    }
  }
}

customElements.define("panel-curve-trajectory", CurveTrajectoryPanel);
