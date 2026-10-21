// cadence-panel.js
//
// The sidebar panel of the Cadence Spacer plugin.
//
// Plugins load via a native dynamic import, so `@fontra/...` specifiers cannot
// be resolved. `Panel` (a thin `SimpleElement` subclass) and the tiny DOM
// helpers are inlined here instead — exactly like the reference
// "triangle-guardian" plugin does.

import {
  DEFAULT_GRID_STEPS,
  SIDE_DEFS,
  beamDiagnostics,
  deleteCustEntry,
  loadCustText,
  measureCadenceUnit,
  runAutoSpacing,
  runTabularPass,
  serializeCust,
  setCustEntry,
  suggestBeamY,
  getLayerGlyphController,
} from "./cadence-engine.js";
import { getPresetNames, loadPreset } from "./cadence-presets.js";
import { state } from "./cadence-state.js";

class SimpleElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._appendStyleLink("/css/shared.css");
    if (this.constructor.styles) {
      this._appendStyle(this.constructor.styles);
    }
  }

  _appendStyle(cssText) {
    const style = document.createElement("style");
    style.textContent = cssText;
    this.shadowRoot.appendChild(style);
  }

  _appendStyleLink(href) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    this.shadowRoot.appendChild(link);
  }

  appendStyle(cssText) {
    this._appendStyle(cssText);
  }
}

class Panel extends SimpleElement {
  constructor(editorController) {
    super();
    this.editorController = editorController;
    this.fontController = editorController.fontController;
    this.contentElement = this.getContentElement();
    this.shadowRoot.appendChild(this.contentElement);
  }

  getContentElement() {}

  async toggle(on, focus) {}
}

const attrExceptions = {
  for: "htmlFor",
  class: "className",
  tabindex: "tabIndex",
  colspan: "colSpan",
  rowspan: "rowSpan",
  readonly: "readOnly",
  maxlength: "maxLength",
};

function el(tagName, attributes, children) {
  const element = document.createElement(tagName);
  for (const [key, value] of Object.entries(attributes || {})) {
    if (key === undefined || value === undefined || value === null) {
      continue;
    }
    if (key.slice(0, 5) === "data-") {
      element.dataset[key.slice(5)] = value;
    } else {
      element[attrExceptions[key] || key] = value;
    }
  }
  // `children` is the rest-argument list of the helpers below, so a call
  // site usually passes ONE array of children: div(attrs, [a, b]).
  //
  // Element.append() follows the DOM standard: a non-Node argument is
  // converted to a DOMString. Appending the array itself would therefore
  // turn the children into the text "[object HTMLDivElement],..." and the
  // panel would render as a single line of garbage. Flatten one level
  // first — this is the same convention as Fontra's own
  // createDomElement(tagName, attributes, children), which takes a single
  // array of children (src-js/fontra-core/src/html-utils.js:119-132).
  const childList = Array.isArray(children)
    ? children.flat()
    : children === undefined || children === null
    ? []
    : [children];
  for (const child of childList) {
    element.append(child);
  }
  return element;
}

const div = (attrs, ...children) => el("div", attrs, children);
const span = (attrs, ...children) => el("span", attrs, children);
const label = (attrs, ...children) => el("label", attrs, children);
const input = (attrs) => el("input", attrs);
const button = (attrs, ...children) => el("button", attrs, children);
const select = (attrs, ...children) => el("select", attrs, children);
const option = (attrs, ...children) => el("option", attrs, children);
const table = (attrs, ...children) => el("table", attrs, children);
const thead = (attrs, ...children) => el("thead", attrs, children);
const tbody = (attrs, ...children) => el("tbody", attrs, children);
const tr = (attrs, ...children) => el("tr", attrs, children);
const th = (attrs, ...children) => el("th", attrs, children);
const td = (attrs, ...children) => el("td", attrs, children);

export default class CadenceSpacerPanel extends Panel {
  identifier = "cadence-spacer-panel-plugin";
  inlineSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path d="M4 30 L12 30" stroke="currentColor" stroke-width="3" fill="none"/><path d="M24 30 L32 30" stroke="currentColor" stroke-width="3" fill="none"/><path d="M12 30 L12 6 L24 6 L24 30" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 18 L32 18" stroke="currentColor" stroke-width="1" stroke-dasharray="3 3" fill="none"/></svg>`;

  static styles = `
    #cs-panel { padding: 12px; display: flex; flex-direction: column; gap: 12px; font-size: 12px; }
    .cs-section { display: flex; flex-direction: column; gap: 6px; }
    .cs-section-title {
      font-size: 11px; font-weight: 500; text-transform: uppercase;
      letter-spacing: .05em; color: var(--ui-element-foreground-color);
      opacity: .55; padding-bottom: 2px;
      border-bottom: 0.5px solid var(--ui-element-background-color);
    }
    .cs-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .cs-label { color: var(--ui-element-foreground-color); }
    .cs-hint { color: var(--ui-element-foreground-color); opacity: .55; font-size: 11px; line-height: 1.35; }
    .cs-error {
      color: var(--fontra-red, #E24B4A); font-size: 11px; line-height: 1.35;
      white-space: pre-wrap;
    }
    .cs-warning { color: #B8860B; font-size: 11px; line-height: 1.35; white-space: pre-wrap; }
    .cs-ok { color: #1D9E75; font-size: 11px; }
    .cs-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .cs-actions button { flex: 1 1 auto; }
    .cs-table-wrap { max-height: 260px; overflow: auto; border: 0.5px solid var(--ui-element-background-color); }
    .cs-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .cs-table th { position: sticky; top: 0; text-align: right; font-weight: 500; padding: 3px 4px;
      background: var(--ui-element-background-color); color: var(--ui-element-foreground-color); opacity: .8; }
    .cs-table th:first-child, .cs-table td:first-child { text-align: left; }
    .cs-table td { padding: 2px 4px; text-align: right; font-variant-numeric: tabular-nums; }
    .cs-table tr.cs-bad td { color: var(--fontra-red, #E24B4A); }
    .cs-editor { max-height: 300px; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
    .cs-editor-row { display: flex; align-items: center; gap: 4px; }
    .cs-editor-row input { min-width: 0; }
    .cs-editor-row .cs-glyph { flex: 1 1 40%; }
    .cs-editor-row .cs-num { flex: 0 0 46px; }
    .cs-editor-row .cs-side { flex: 0 0 58px; }
    .cs-editor-row .cs-del { flex: 0 0 22px; }
    .cs-progress { height: 4px; background: var(--ui-element-background-color); border-radius: 2px; overflow: hidden; }
    .cs-progress-bar { height: 100%; width: 0; background: #1D9E75; transition: width .1s linear; }
    .cs-summary { font-size: 11px; line-height: 1.4; white-space: pre-wrap; }
  `;

  constructor(editorController) {
    super(editorController);
    this._updateDiagnostics();
    this._refreshTableEditor();
    this._updatePreviewTable(null);
    this._updateApplyState();
    const sceneController = this.editorController.sceneController;
    sceneController?.addCurrentGlyphChangeListener?.(() => this._updateDiagnostics());
    sceneController?.sceneSettingsController?.addKeyListener?.("selectedGlyphName", () =>
      this._updateDiagnostics()
    );
  }

  getContentElement() {
    // Start out with the first built-in preset.
    const presetName = getPresetNames()[0];
    this._cust = loadPreset(presetName).cust;
    this._custSource = presetName;
    this._results = null;
    this._busy = false;
    // The table may declare its own beam height ("nBeam=200").
    if (this._cust.meta.nBeam != null) {
      state.beamY = this._cust.meta.nBeam;
    }

    return div({ id: "cs-panel" }, [
      this._buildTableSection(),
      this._buildMeasurementSection(),
      this._buildPreviewSection(),
      this._buildEditorSection(),
    ]);
  }

  // -------------------------------------------------------------------
  // Spacing table
  // -------------------------------------------------------------------

  _buildTableSection() {
    const title = div({ class: "cs-section-title" }, "Spacing table");

    this._presetSelect = select({ class: "cs-select" });
    for (const name of getPresetNames()) {
      this._presetSelect.appendChild(option({ value: name }, name));
    }
    this._presetSelect.value = this._custSource;
    this._presetSelect.addEventListener("change", () => {
      this._loadPreset(this._presetSelect.value);
    });

    const fileInput = input({ type: "file", accept: ".txt,.csv,text/plain" });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) {
        return;
      }
      try {
        const text = await file.text();
        this._cust = loadCustText(text, file.name);
        this._custSource = file.name;
        this._adoptTableBeam();
        this._setStatus(`Loaded spacing table "${file.name}".`, "ok");
        this._refreshTableEditor();
        this._invalidatePreview();
      } catch (e) {
        this._setStatus(e.message, "error");
      }
    });

    this._tableSourceLabel = span({ class: "cs-hint" }, `Using: ${this._custSource}`);

    const saveButton = button({ type: "button" }, "Save table…");
    saveButton.addEventListener("click", () => this._downloadTable());

    return div({ class: "cs-section" }, [
      title,
      div({ class: "cs-row" }, [
        label({ class: "cs-label" }, "Preset"),
        this._presetSelect,
      ]),
      div({ class: "cs-row" }, [label({ class: "cs-label" }, "Load .txt/.csv"), fileInput]),
      this._tableSourceLabel,
      div({ class: "cs-actions" }, [saveButton]),
    ]);
  }

  // -------------------------------------------------------------------
  // Measurement
  // -------------------------------------------------------------------

  _buildMeasurementSection() {
    const title = div({ class: "cs-section-title" }, "Measurement");

    this._gridStepsInput = input({
      type: "number",
      min: "1",
      step: "1",
      value: String(state.gridSteps),
    });
    this._gridStepsInput.addEventListener("change", () => {
      const value = parseInt(this._gridStepsInput.value, 10);
      state.gridSteps = Number.isFinite(value) && value > 0 ? value : DEFAULT_GRID_STEPS;
      this._gridStepsInput.value = String(state.gridSteps);
      this._updateDiagnostics();
    });

    this._refSelect = select({});
    for (const name of ["n", "m"]) {
      this._refSelect.appendChild(option({ value: name }, name));
    }
    this._refSelect.value = state.refGlyphName;
    this._refSelect.addEventListener("change", () => {
      state.refGlyphName = this._refSelect.value;
      this._updateDiagnostics();
    });

    this._beamInput = input({
      type: "number",
      step: "1",
      value: String(state.beamY),
    });
    this._beamInput.addEventListener("change", () => {
      const value = parseFloat(this._beamInput.value);
      if (Number.isFinite(value)) {
        state.beamY = value;
        this._beamInput.value = String(state.beamY);
      }
      this._updateDiagnostics();
      this._requestCanvasUpdate();
    });

    const suggestButton = button({ type: "button" }, "Beam from glyph");
    suggestButton.addEventListener("click", () => this._suggestBeam());

    this._diagnostics = div({ class: "cs-hint" }, "—");

    const toggles = [
      { key: "showBeam", label: "Show beam" },
      { key: "showCrossings", label: "Show stem crossings" },
      { key: "showSidebearings", label: "Show sidebearings" },
      { key: "showDesired", label: "Show desired sidebearings" },
    ];
    const toggleRows = toggles.map(({ key, label: text }) => {
      const chk = input({ type: "checkbox", checked: state[key] });
      chk.addEventListener("change", () => {
        state[key] = chk.checked;
        this._requestCanvasUpdate();
      });
      return div({ class: "cs-row" }, [label({ class: "cs-label" }, text), chk]);
    });

    return div({ class: "cs-section" }, [
      title,
      div({ class: "cs-row" }, [
        label({ class: "cs-label" }, "Grid steps"),
        this._gridStepsInput,
      ]),
      div({ class: "cs-row" }, [
        label({ class: "cs-label" }, "Reference glyph"),
        this._refSelect,
      ]),
      div({ class: "cs-row" }, [
        label({ class: "cs-label" }, "Beam Y"),
        this._beamInput,
        suggestButton,
      ]),
      this._diagnostics,
      ...toggleRows,
    ]);
  }

  // -------------------------------------------------------------------
  // Preview (dry run) and apply
  // -------------------------------------------------------------------

  _buildPreviewSection() {
    const title = div({ class: "cs-section-title" }, "Preview");

    this._previewButton = button({ type: "button" }, "Preview (dry run)");
    this._previewButton.addEventListener("click", () => this._runPreview());

    this._applyButton = button({ type: "button" }, "Apply spacing");
    this._applyButton.disabled = true;
    this._applyButton.addEventListener("click", () => this._applySpacing());

    this._progressFill = div({ class: "cs-progress-bar" });
    this._progress = div({ class: "cs-progress" }, [this._progressFill]);

    this._status = div({ class: "cs-hint" }, "");
    this._summary = div({ class: "cs-summary" }, "");

    this._previewTable = table({ class: "cs-table" });
    this._previewTableWrap = div({ class: "cs-table-wrap" }, [this._previewTable]);

    this._layerModeSelect = select({});
    this._layerModeSelect.appendChild(option({ value: "editing" }, "editing layer(s)"));
    this._layerModeSelect.appendChild(option({ value: "all" }, "all layers"));
    this._layerModeSelect.addEventListener("change", () => this._invalidatePreview());

    return div({ class: "cs-section" }, [
      title,
      div({ class: "cs-row" }, [
        label({ class: "cs-label" }, "Apply to"),
        this._layerModeSelect,
      ]),
      div({ class: "cs-actions" }, [this._previewButton, this._applyButton]),
      this._progress,
      this._status,
      this._summary,
      this._previewTableWrap,
    ]);
  }

  // -------------------------------------------------------------------
  // Spacing-table editor + tabular figures
  // -------------------------------------------------------------------

  _buildEditorSection() {
    const title = div({ class: "cs-section-title" }, "Table editor");

    this._editorFilter = input({ type: "search", placeholder: "filter glyphs" });
    this._editorFilter.addEventListener("input", () => this._refreshTableEditor());

    this._editorList = div({ class: "cs-editor" });

    const newName = input({ type: "text", placeholder: "glyph", class: "cs-glyph" });
    const newSide = select({ class: "cs-side" });
    for (const sideDef of SIDE_DEFS) {
      newSide.appendChild(option({ value: sideDef }, sideDef));
    }
    const newLeft = input({ type: "number", step: "1", value: "8", class: "cs-num" });
    const newRight = input({ type: "number", step: "1", value: "8", class: "cs-num" });
    const addButton = button({ type: "button", class: "cs-del" }, "+");
    addButton.addEventListener("click", () => {
      try {
        setCustEntry(this._cust, newName.value, {
          sideDef: newSide.value,
          left: newLeft.value,
          right: newRight.value,
          beam: "Beam",
        });
        newName.value = "";
        this._refreshTableEditor();
        this._invalidatePreview();
        this._setStatus("Added a spacing-table entry.", "ok");
      } catch (e) {
        this._setStatus(e.message, "error");
      }
    });

    // --- tabular (fixed width) figures ---
    this._tabularWidthInput = input({
      type: "number",
      step: "1",
      value: String(this._cust.meta.tabularWidth ?? 600),
    });
    this._tabularWidthInput.addEventListener("change", () => {
      const value = parseFloat(this._tabularWidthInput.value);
      this._cust.meta.tabularWidth = Number.isFinite(value) ? value : null;
      this._invalidatePreview();
    });

    this._tabularGlyphsInput = input({
      type: "text",
      value: (this._cust.meta.tabular || []).join(","),
    });
    this._tabularGlyphsInput.addEventListener("change", () => {
      this._cust.meta.tabular = this._tabularGlyphsInput.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      this._invalidatePreview();
    });

    this._tabularPreviewButton = button({ type: "button" }, "Preview tabular");
    this._tabularPreviewButton.addEventListener("click", () => this._runTabular(true));
    this._tabularApplyButton = button({ type: "button" }, "Apply tabular");
    this._tabularApplyButton.addEventListener("click", () => this._runTabular(false));

    return div({ class: "cs-section" }, [
      title,
      div({ class: "cs-row" }, [label({ class: "cs-label" }, "Filter"), this._editorFilter]),
      this._editorList,
      div({ class: "cs-row" }, [newName, newSide, newLeft, newRight, addButton]),
      div({ class: "cs-section-title" }, "Tabular figures"),
      div({ class: "cs-row" }, [
        label({ class: "cs-label" }, "Width"),
        this._tabularWidthInput,
      ]),
      div({ class: "cs-row" }, [
        label({ class: "cs-label" }, "Glyphs"),
        this._tabularGlyphsInput,
      ]),
      div({ class: "cs-actions" }, [this._tabularPreviewButton, this._tabularApplyButton]),
    ]);
  }

  // -------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------

  _loadPreset(name) {
    let preset;
    try {
      preset = loadPreset(name);
    } catch (e) {
      this._setStatus(e.message, "error");
      return;
    }
    this._cust = preset.cust;
    this._custSource = name;
    this._tableSourceLabel.textContent = `Using: ${this._custSource}`;
    this._adoptTableBeam();
    this._tabularWidthInput.value = String(this._cust.meta.tabularWidth ?? 600);
    this._tabularGlyphsInput.value = (this._cust.meta.tabular || []).join(",");
    this._refreshTableEditor();
    this._invalidatePreview();
    this._updateDiagnostics();
    this._setStatus(`Loaded the "${name}" spacing table.`, "ok");
  }

  // A spacing table may declare its own beam height ("nBeam=200"); when it
  // does, the panel follows it.
  _adoptTableBeam() {
    const tableBeam = this._cust?.meta?.nBeam;
    if (tableBeam != null) {
      state.beamY = tableBeam;
      if (this._beamInput) {
        this._beamInput.value = String(state.beamY);
      }
    }
  }

  _downloadTable() {
    try {
      const text = serializeCust(this._cust);
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "cadence-table.txt";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this._setStatus("Saved the spacing table as cadence-table.txt.", "ok");
    } catch (e) {
      this._setStatus(e.message, "error");
    }
  }

  async _suggestBeam() {
    try {
      const sceneController = this.editorController.sceneController;
      const glyphName = sceneController?.sceneSettings?.selectedGlyphName;
      if (!glyphName) {
        this._setStatus("No glyph is selected.", "error");
        return;
      }
      const layerName = sceneController?.editingLayerNames?.[0] ?? null;
      const controller = await getLayerGlyphController(
        this.editorController,
        glyphName,
        layerName
      );
      if (!controller) {
        this._setStatus("Could not load the selected glyph.", "error");
        return;
      }
      state.beamY = suggestBeamY(controller);
      this._beamInput.value = String(state.beamY);
      this._updateDiagnostics();
      this._requestCanvasUpdate();
      this._setStatus(`Beam set to y=${state.beamY} (middle of "${glyphName}").`, "ok");
    } catch (e) {
      this._setStatus(e.message, "error");
    }
  }

  async _updateDiagnostics() {
    if (!this._diagnostics) {
      return;
    }
    this._selectedGlyphInfo = await this._describeSelectedGlyph();
    try {
      const sceneController = this.editorController.sceneController;
      const primaryLayer = sceneController?.editingLayerNames?.[0] ?? null;
      const info = await measureCadenceUnit({
        editor: this.editorController,
        refGlyphName: state.refGlyphName,
        beamY: state.beamY,
        gridSteps: state.gridSteps,
        layerName: primaryLayer,
      });
      this._diagnostics.textContent =
        `Reference "${info.refGlyphName}": ${info.crossingCount} beam crossing(s), ` +
        `${info.stemCount} stem(s).\n` +
        `Stem interval: ${formatNumber(info.interval)} units\n` +
        `Cadence unit: ${formatNumber(info.cadenceUnit)} units ` +
        `(${info.gridSteps} grid steps)` +
        (info.warnings?.length ? `\n${info.warnings.join("\n")}` : "") +
        (this._selectedGlyphInfo ? `\n${this._selectedGlyphInfo}` : "");
      this._selectedGlyphInfo = null;
    } catch (e) {
      this._diagnostics.textContent =
        `Cannot measure the reference glyph "${state.refGlyphName}": ${e.message}`;
    }
  }

  _glyphNames() {
    // fontController.glyphMap is the font's live glyph map; its keys are the
    // glyph names (see shaper-controller.js:121).
    return Object.keys(this.editorController.fontController.glyphMap || {});
  }

  // A one-line report about the glyph that is currently open: how many
  // times the beam crosses it, and whether the beam is usable there.
  async _describeSelectedGlyph() {
    try {
      const sceneController = this.editorController.sceneController;
      const glyphName = sceneController?.sceneSettings?.selectedGlyphName;
      if (!glyphName) {
        return null;
      }
      const layerName = sceneController?.editingLayerNames?.[0] ?? null;
      const controller = await getLayerGlyphController(
        this.editorController,
        glyphName,
        layerName
      );
      if (!controller) {
        return null;
      }
      const info = beamDiagnostics(controller, state.beamY);
      return (
        `Selected "${glyphName}": ${info.crossingCount} beam crossing(s)` +
        (info.isUsable ? "" : " (odd or too few — check the beam height)")
      );
    } catch (e) {
      return null;
    }
  }

  _layerMode() {
    return this._layerModeSelect?.value === "all" ? "all" : "editing";
  }

  async _runPreview() {
    if (this._busy) {
      return;
    }
    this._busy = true;
    this._setBusy(true);
    this._progressFill.style.width = "0%";
    this._summary.textContent = "";
    try {
      const result = await runAutoSpacing({
        editor: this.editorController,
        cust: this._cust,
        glyphNames: this._glyphNames(),
        gridSteps: state.gridSteps,
        refGlyphName: state.refGlyphName,
        beamY: state.beamY,
        dryRun: true,
        layerMode: this._layerMode(),
        onProgress: (i, total) => this._setProgress(i, total),
      });
      this._plan = result;
      this._results = result.results;
      this._updatePreviewTable(result);
      this._storePlans(result.results);
      this._summary.textContent = formatSummary(result);
      this._setStatus(
        `Preview: ${result.targetCount} glyph(s) in the table, ` +
          `${result.summary.ok} measured successfully.`,
        "ok"
      );
    } catch (e) {
      this._plan = null;
      this._results = null;
      this._updatePreviewTable(null);
      this._setStatus(e.message, "error");
    } finally {
      this._busy = false;
      this._setBusy(false);
    }
  }

  async _applySpacing() {
    if (this._busy) {
      return;
    }
    this._busy = true;
    this._setBusy(true);
    this._progressFill.style.width = "0%";
    try {
      const result = await runAutoSpacing({
        editor: this.editorController,
        cust: this._cust,
        glyphNames: this._glyphNames(),
        gridSteps: state.gridSteps,
        refGlyphName: state.refGlyphName,
        beamY: state.beamY,
        dryRun: false,
        senderID: this,
        layerMode: this._layerMode(),
        onProgress: (i, total) => this._setProgress(i, total),
      });
      this._results = result.results;
      this._updatePreviewTable(result);
      this._storePlans(result.results);
      this._plan = null;
      this._summary.textContent = formatSummary(result);
      // Count what was really applied. `summary.ok` is the number of glyphs
      // that measured successfully, which is *not* the number of applied
      // glyphs once some of them are skipped — subtracting the failures from
      // it can even produce a negative count.
      const appliedCount = result.results.filter(
        (r) => r.status === "ok" && r.applied === true
      ).length;
      const failed = result.results.length - appliedCount;
      if (failed > 0) {
        this._setStatus(
          `Applied ${appliedCount} of ${result.results.length} glyph(s); ` +
            `${failed} could not be applied.`,
          "warning"
        );
      } else {
        this._setStatus(`Applied ${appliedCount} glyph(s).`, "ok");
      }
    } catch (e) {
      this._setStatus(e.message, "error");
    } finally {
      this._busy = false;
      this._setBusy(false);
    }
  }

  async _runTabular(dryRun) {
    if (this._busy) {
      return;
    }
    this._busy = true;
    this._setBusy(true);
    this._progressFill.style.width = "0%";
    try {
      const result = await runTabularPass({
        editor: this.editorController,
        cust: this._cust,
        dryRun,
        senderID: this,
        layerMode: this._layerMode(),
        onProgress: (i, total) => this._setProgress(i, total),
      });
      this._updatePreviewTable(result);
      this._summary.textContent = formatSummary(result);
      if (dryRun) {
        this._setStatus(
          `Tabular preview: ${result.targetCount} glyph(s) with a fixed width of ` +
            `${this._cust.meta.tabularWidth}.`,
          "ok"
        );
      } else {
        this._setStatus(`Tabular widths applied to ${result.summary.ok} glyph(s).`, "ok");
      }
    } catch (e) {
      this._setStatus(e.message, "error");
    } finally {
      this._busy = false;
      this._setBusy(false);
    }
  }

  _storePlans(results) {
    const plans = new Map();
    for (const result of results) {
      if (result.status === "ok") {
        plans.set(result.glyphName, {
          currentLeft: result.currentLeft,
          currentRight: result.currentRight,
          desiredLeft: result.desiredLeft,
          desiredRight: result.desiredRight,
        });
      }
    }
    state.plans = plans;
    this._requestCanvasUpdate();
  }

  _updatePreviewTable(result) {
    const headRows = [];
    const bodyRows = [];
    if (result?.results?.length) {
      const isTabular = result.results[0].kind === "tabular";
      if (isTabular) {
        headRows.push(
          tr({}, [
            th({}, "Glyph"),
            th({}, "Advance"),
            th({}, "Fixed"),
            th({}, "Δ"),
            th({}, ""),
          ])
        );
        for (const item of result.results) {
          bodyRows.push(
            tr({ class: item.status === "ok" ? "" : "cs-bad" }, [
              td({}, item.glyphName),
              td({}, formatNumber(item.xAdvanceBefore)),
              td({}, formatNumber(item.xAdvanceDesired)),
              td({}, formatNumber((item.xAdvanceDesired ?? 0) - (item.xAdvanceBefore ?? 0))),
              td({}, item.message || ""),
            ])
          );
        }
      } else {
        headRows.push(
          tr({}, [
            th({}, "Glyph"),
            th({}, "SD"),
            th({}, "cur L"),
            th({}, "want L"),
            th({}, "ΔL"),
            th({}, "cur R"),
            th({}, "want R"),
            th({}, "ΔR"),
            th({}, ""),
          ])
        );
        for (const item of result.results) {
          const bad = item.status !== "ok";
          bodyRows.push(
            tr({ class: bad ? "cs-bad" : "" }, [
              td({}, item.glyphName),
              td({}, item.sideDef || ""),
              td({}, formatNumber(item.currentLeft)),
              td({}, formatNumber(item.desiredLeft)),
              td({}, formatNumber(item.deltaLeft)),
              td({}, formatNumber(item.currentRight)),
              td({}, formatNumber(item.desiredRight)),
              td({}, formatNumber(item.deltaRight)),
              td({}, item.message || (item.applied ? "applied" : "")),
            ])
          );
        }
      }
    } else {
      bodyRows.push(
        tr({}, [td({ colspan: "9" }, "No preview yet — press “Preview (dry run)”.")])
      );
    }
    this._previewTable.replaceChildren(thead({}, headRows), tbody({}, bodyRows));
  }

  _refreshTableEditor() {
    if (!this._editorList) {
      return;
    }
    const filter = (this._editorFilter?.value || "").trim().toLowerCase();
    const rows = [];
    for (const key of this._cust.order) {
      const entry = this._cust.entries.get(key);
      if (!entry) {
        continue;
      }
      if (filter && !key.toLowerCase().includes(filter)) {
        continue;
      }
      rows.push(this._makeEditorRow(key, entry));
    }
    this._editorList.replaceChildren(...rows);
  }

  _makeEditorRow(key, entry) {
    const nameInput = input({ type: "text", value: key, class: "cs-glyph" });
    const sideSelect = select({ class: "cs-side" });
    for (const sideDef of SIDE_DEFS) {
      sideSelect.appendChild(option({ value: sideDef }, sideDef));
    }
    sideSelect.value = entry.sideDef;
    const leftInput = input({
      type: "number",
      step: "1",
      value: String(entry.left),
      class: "cs-num",
    });
    const rightInput = input({
      type: "number",
      step: "1",
      value: String(entry.right),
      class: "cs-num",
    });
    const deleteButton = button({ type: "button", class: "cs-del" }, "×");

    const commit = () => {
      try {
        const newKey = nameInput.value.trim();
        if (newKey !== key) {
          deleteCustEntry(this._cust, key);
          setCustEntry(this._cust, newKey, {
            sideDef: sideSelect.value,
            left: leftInput.value,
            right: rightInput.value,
            beam: entry.beam,
          });
          this._refreshTableEditor();
        } else {
          setCustEntry(this._cust, key, {
            sideDef: sideSelect.value,
            left: leftInput.value,
            right: rightInput.value,
            beam: entry.beam,
          });
        }
        this._invalidatePreview();
        this._setStatus(`Updated the entry for "${newKey}".`, "ok");
      } catch (e) {
        this._setStatus(e.message, "error");
      }
    };

    nameInput.addEventListener("change", commit);
    sideSelect.addEventListener("change", commit);
    leftInput.addEventListener("change", commit);
    rightInput.addEventListener("change", commit);
    deleteButton.addEventListener("click", () => {
      deleteCustEntry(this._cust, key);
      this._refreshTableEditor();
      this._invalidatePreview();
      this._setStatus(`Removed the entry for "${key}".`, "ok");
    });

    return div({ class: "cs-editor-row" }, [
      nameInput,
      sideSelect,
      leftInput,
      rightInput,
      deleteButton,
    ]);
  }

  _invalidatePreview() {
    this._plan = null;
    this._results = null;
    state.plans = new Map();
    this._updatePreviewTable(null);
    this._updateApplyState();
    this._requestCanvasUpdate();
  }

  _updateApplyState() {
    if (!this._applyButton) {
      return;
    }
    const readOnly = !!this.editorController.fontController.readOnly;
    this._applyButton.disabled = readOnly || !this._plan;
    this._applyButton.title = readOnly ? "The font is read-only." : "";
  }

  _setBusy(busy) {
    this._previewButton.disabled = busy;
    this._tabularPreviewButton.disabled = busy;
    this._tabularApplyButton.disabled = busy;
    if (!busy) {
      this._updateApplyState();
    } else {
      this._applyButton.disabled = true;
    }
  }

  _setProgress(index, total) {
    const percent = total ? Math.round((index / total) * 100) : 0;
    this._progressFill.style.width = `${percent}%`;
  }

  _setStatus(text, kind = "hint") {
    if (!this._status) {
      return;
    }
    this._status.textContent = text || "";
    this._status.className =
      kind === "error"
        ? "cs-error"
        : kind === "warning"
        ? "cs-warning"
        : kind === "ok"
        ? "cs-ok"
        : "cs-hint";
  }

  _requestCanvasUpdate() {
    this.editorController.canvasController?.requestUpdate();
  }
}

function formatNumber(value) {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  const rounded = Math.round(value * 10) / 10;
  return String(rounded);
}

function formatSummary(result) {
  const summary = result.summary || {};
  const parts = [
    `targets: ${summary.total ?? 0}`,
    `ok: ${summary.ok ?? 0}`,
    `missing: ${summary.missing ?? 0}`,
    `locked: ${summary.locked ?? 0}`,
    `errors: ${summary.error ?? 0}`,
  ];
  if (summary["read-only"]) {
    parts.push(`read-only: ${summary["read-only"]}`);
  }
  let text = parts.join("  ·  ");
  if (result.cadence) {
    text += `\ncadence unit ${formatNumber(result.cadence.cadenceUnit)} ` +
      `(stem interval ${formatNumber(result.cadence.interval)} / ` +
      `${result.cadence.gridSteps} steps)`;
  }
  const warnings = (result.results || []).flatMap((r) => r.warnings || []);
  if (warnings.length) {
    text += `\n${[...new Set(warnings)].join("\n")}`;
  }
  return text;
}

if (!customElements.get("panel-cadence-spacer-plugin")) {
  customElements.define("panel-cadence-spacer-plugin", CadenceSpacerPanel);
}
