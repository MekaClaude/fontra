// commonform-panel.js
//
// The sidebar panel of the Commonform plugin.
//
// Commonform looks for *common forms*: the shapes that a typeface reuses from
// one glyph to the next — the bowl of b/d/p/q, the arm of R and k. A typeface
// built from common forms is a typeface whose parts agree with each other.
//
// The panel is a self-contained custom element. `Panel` (a thin `SimpleElement`
// subclass) and the tiny DOM helpers are inlined here instead — exactly like
// the reference "triangle-guardian" plugin does — because a plugin cannot
// import them: plugins are loaded with a native dynamic import and the page's
// import map only maps "fontra/".

import {
  DEFAULT_SIGNATURE_COUNT,
  DEFAULT_TOLERANCE_FACTOR,
  defaultSearchOptions,
  findMatches,
  prepareContour,
  segmentsToPolyline,
  summarizeMatches,
  toleranceFor,
} from "./commonform-engine.js";
import {
  buildQuery,
  collectCandidates,
  selectContour,
} from "./commonform-font.js";
import { state } from "./commonform-state.js";

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
const checkbox = (attrs) => el("input", attrs);
const table = (attrs, ...children) => el("table", attrs, children);
const thead = (attrs, ...children) => el("thead", attrs, children);
const tbody = (attrs, ...children) => el("tbody", attrs, children);
const tr = (attrs, ...children) => el("tr", attrs, children);
const th = (attrs, ...children) => el("th", attrs, children);
const td = (attrs, ...children) => el("td", attrs, children);

export default class CommonformPanel extends Panel {
  identifier = "commonform-panel-plugin";
  inlineSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path d="M6 26 L12 12 L18 26 L24 12 L30 26" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>`;

  static styles = `
    #cf-panel { padding: 12px; display: flex; flex-direction: column; gap: 12px; font-size: 12px; }
    .cf-section { display: flex; flex-direction: column; gap: 6px; }
    .cf-section-title {
      font-size: 11px; font-weight: 500; text-transform: uppercase;
      letter-spacing: .05em; color: var(--ui-element-foreground-color);
      opacity: .55; padding-bottom: 2px;
      border-bottom: 0.5px solid var(--ui-element-background-color);
    }
    .cf-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .cf-label { color: var(--ui-element-foreground-color); }
    .cf-hint { color: var(--ui-element-foreground-color); opacity: .55; font-size: 11px; line-height: 1.35; }
    .cf-error { color: var(--fontra-red, #E24B4A); font-size: 11px; line-height: 1.35; white-space: pre-wrap; }
    .cf-warning { color: #B8860B; font-size: 11px; line-height: 1.35; white-space: pre-wrap; }
    .cf-ok { color: #1D9E75; font-size: 11px; }
    .cf-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .cf-actions button { flex: 1 1 auto; }
    .cf-progress { height: 4px; background: var(--ui-element-background-color); border-radius: 2px; overflow: hidden; }
    .cf-progress-bar { height: 100%; width: 0; background: #1D9E75; transition: width .1s linear; }
    .cf-summary { font-size: 11px; line-height: 1.4; white-space: pre-wrap; }
    .cf-table-wrap { max-height: 260px; overflow: auto; border: 0.5px solid var(--ui-element-background-color); }
    .cf-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .cf-table th { position: sticky; top: 0; text-align: right; font-weight: 500; padding: 3px 4px;
      background: var(--ui-element-background-color); color: var(--ui-element-foreground-color); opacity: .8; }
    .cf-table th:first-child, .cf-table td:first-child { text-align: left; }
    .cf-table td { padding: 2px 4px; text-align: right; font-variant-numeric: tabular-nums; }
    .cf-table tr.cf-bad td { color: var(--fontra-red, #E24B4A); }
    .cf-table tr.cf-near td { color: #B8860B; }
    .cf-glyph-button { background: none; border: none; padding: 0; font: inherit; color: #185FA5;
      cursor: pointer; text-decoration: underline; }
    .cf-tier { font-size: 10px; letter-spacing: .03em; text-transform: uppercase; opacity: .7; }
    .cf-number { width: 64px; }
  `;

  constructor(editorController) {
    super(editorController);
    this._busy = false;
    this._refreshQuery();

    // The query follows what the user has selected. The selection changes
    // while points are being dragged around, so the refresh is debounced.
    const sceneController = this.editorController.sceneController;
    sceneController?.addCurrentGlyphChangeListener?.(() => this._scheduleQueryRefresh());
    sceneController?.sceneSettingsController?.addKeyListener?.(
      "selection",
      () => this._scheduleQueryRefresh()
    );
  }

  _scheduleQueryRefresh() {
    if (this._queryTimer) {
      clearTimeout(this._queryTimer);
    }
    this._queryTimer = setTimeout(() => {
      this._queryTimer = null;
      this._refreshQuery();
    }, 150);
  }

  getContentElement() {
    this._queryLabel = div({ class: "cf-hint" }, "No shape selected yet.");
    // "cf-status" is a stable hook: the colour class is swapped on every
    // update, so the status line cannot be addressed by class alone.
    this._status = div({ class: "cf-status cf-hint" }, "");
    this._summary = div({ class: "cf-summary" }, "");
    this._resultsTable = table({ class: "cf-table" });
    this._resultsWrap = div({ class: "cf-table-wrap" }, [this._resultsTable]);
    this._progressFill = div({ class: "cf-progress-bar" });
    this._progress = div({ class: "cf-progress" }, [this._progressFill]);

    return div({ id: "cf-panel" }, [
      this._buildQuerySection(),
      this._buildSettingsSection(),
      this._buildSearchSection(),
      this._buildResultsSection(),
    ]);
  }

  // -------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------

  _buildQuerySection() {
    const useButton = button({ type: "button" }, "Use the selection");
    useButton.addEventListener("click", () => this._refreshQuery());

    this._queryGlyphLabel = span({ class: "cf-tier" }, "");
    const queryRow = div({ class: "cf-row" }, [
      label({ class: "cf-label" }, "Query"),
      this._queryGlyphLabel,
    ]);

    return div({ class: "cf-section" }, [
      div({ class: "cf-section-title" }, "Common form"),
      queryRow,
      this._queryLabel,
      div({ class: "cf-actions" }, [useButton]),
    ]);
  }

  _buildSettingsSection() {
    const options = defaultSearchOptions();

    this._floorInput = input({
      type: "number",
      min: "0",
      step: "0.5",
      class: "cf-number",
      value: String(state.toleranceFloor),
    });
    this._floorInput.addEventListener("change", () => {
      const value = parseFloat(this._floorInput.value);
      state.toleranceFloor = Number.isFinite(value) ? Math.max(0, value) : 2;
      this._floorInput.value = String(state.toleranceFloor);
      this._updateToleranceHint();
    });

    this._factorInput = input({
      type: "number",
      min: "0",
      step: "0.1",
      class: "cf-number",
      value: String(state.toleranceFactor * 100),
    });
    this._factorInput.addEventListener("change", () => {
      const value = parseFloat(this._factorInput.value);
      state.toleranceFactor = Number.isFinite(value)
        ? Math.max(0, value) / 100
        : DEFAULT_TOLERANCE_FACTOR;
      this._factorInput.value = String(state.toleranceFactor * 100);
      this._updateToleranceHint();
    });

    this._scaleInvariantInput = checkbox({ type: "checkbox", checked: state.scaleInvariant });
    this._scaleInvariantInput.addEventListener("change", () => {
      state.scaleInvariant = this._scaleInvariantInput.checked;
    });

    this._mirroredInput = checkbox({ type: "checkbox", checked: state.allowMirrored });
    this._mirroredInput.addEventListener("change", () => {
      state.allowMirrored = this._mirroredInput.checked;
    });

    this._toleranceHint = div({ class: "cf-hint" }, "");

    const title = div({ class: "cf-section-title" }, "Settings");

    return div({ class: "cf-section" }, [
      title,
      div({ class: "cf-row" }, [
        label({ class: "cf-label" }, "Tolerance floor (units)"),
        this._floorInput,
      ]),
      div({ class: "cf-row" }, [
        label({ class: "cf-label" }, "Tolerance (% of size)"),
        this._factorInput,
      ]),
      this._toleranceHint,
      div({ class: "cf-row" }, [
        label({ class: "cf-label" }, "Ignore size"),
        this._scaleInvariantInput,
      ]),
      div({ class: "cf-row" }, [
        label({ class: "cf-label" }, "Allow mirrored"),
        this._mirroredInput,
      ]),
    ]);
  }

  _buildSearchSection() {
    const title = div({ class: "cf-section-title" }, "Search");

    this._searchButton = button({ type: "button" }, "Find in font");
    this._searchButton.addEventListener("click", () => this._runSearch());

    this._signatureInput = input({
      type: "number",
      min: "16",
      step: "16",
      class: "cf-number",
      value: String(DEFAULT_SIGNATURE_COUNT),
    });
    this._signatureInput.addEventListener("change", () => {
      const value = parseInt(this._signatureInput.value, 10);
      this._signatureCount =
        Number.isFinite(value) && value >= 16 ? value : DEFAULT_SIGNATURE_COUNT;
      this._signatureInput.value = String(this._signatureCount);
    });
    this._signatureCount = DEFAULT_SIGNATURE_COUNT;

    return div({ class: "cf-section" }, [
      title,
      div({ class: "cf-row" }, [
        label({ class: "cf-label" }, "Compare directions"),
        this._signatureInput,
      ]),
      div({ class: "cf-actions" }, [this._searchButton]),
      this._progress,
      this._status,
    ]);
  }

  _buildResultsSection() {
    const title = div({ class: "cf-section-title" }, "Results");

    const tierToggles = [
      { key: "showIdentical", label: "Show identical" },
      { key: "showSame", label: "Show same" },
      { key: "showNear", label: "Show near" },
    ].map(({ key, label: text }) => {
      const chk = checkbox({ type: "checkbox", checked: state[key] });
      chk.addEventListener("change", () => {
        state[key] = chk.checked;
        this.editorController.canvasController?.requestUpdate();
      });
      return div({ class: "cf-row" }, [label({ class: "cf-label" }, text), chk]);
    });

    return div({ class: "cf-section" }, [
      title,
      this._summary,
      this._resultsWrap,
      ...tierToggles,
    ]);
  }

  // -------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------

  _searchOptions() {
    return {
      ...defaultSearchOptions(),
      scaleInvariant: state.scaleInvariant,
      allowMirrored: state.allowMirrored,
      toleranceFloor: state.toleranceFloor,
      toleranceFactor: state.toleranceFactor,
      nearFloor: state.nearFloor,
      nearFactor: state.nearFactor,
      signatureCount: this._signatureCount || DEFAULT_SIGNATURE_COUNT,
      // The shape the designer is looking at is not a copy of itself: the
      // glyph it came from is left out of the results.
      sourceGlyphName: state.query?.glyphName ?? null,
    };
  }

  /**
   * Turn one of the query's contours into the thing the engine compares:
   * a flattened polyline plus its radial signature.
   */
  _prepare(contour, options) {
    return prepareContour(
      {
        ...contour,
        polyline:
          contour.polyline?.length
            ? contour.polyline
            : segmentsToPolyline(contour.segments || [], options.stepsPerCurve),
      },
      options
    );
  }

  async _refreshQuery() {
    const query = await buildQuery(this.editorController);
    if (!query.ok) {
      state.query = null;
      state.queryError = query.reason;
      this._queryLabel.textContent = query.reason;
      this._queryGlyphLabel.textContent = "";
      this._updateToleranceHint();
      return;
    }
    state.query = query;
    state.queryError = null;

    const options = this._searchOptions();
    const prepared = query.contours.map((contour) => this._prepare(contour, options));
    const total = prepared.reduce(
      (sum, item) => sum + (item.features.pointCount || 0),
      0
    );
    const size = prepared.length
      ? Math.max(...prepared.map((item) => item.features.diagonal))
      : 0;

    this._queryGlyphLabel.textContent = query.glyphName || "";
    this._queryLabel.textContent =
      `${query.contours.length} contour(s) from "${query.glyphName}"` +
      (query.source === "component" ? " (component)" : "") +
      `, ${total} point(s), size ${formatNumber(size)} units.`;
    this._updateToleranceHint();
  }

  _updateToleranceHint() {
    const size = this._querySize();
    const options = this._searchOptions();
    const tolerance = toleranceFor(size, options);
    this._toleranceHint.textContent = `Same-shape threshold: ${formatNumber(
      tolerance
    )} units (max(${options.toleranceFloor}, ${formatNumber(
      size
    )} × ${(options.toleranceFactor * 100).toFixed(1)}%)).`;
  }

  _querySize() {
    if (!state.query?.contours?.length) {
      return 0;
    }
    let size = 0;
    for (const contour of state.query.contours) {
      const prepared = this._prepare(contour, this._searchOptions());
      size = Math.max(size, prepared.features.diagonal);
    }
    return size;
  }

  async _runSearch() {
    if (this._busy) {
      return;
    }
    if (!state.query) {
      await this._refreshQuery();
      if (!state.query) {
        this._setStatus(state.queryError || "Select a shape first.", "error");
        return;
      }
    }
    this._busy = true;
    this._searchButton.disabled = true;
    this._progressFill.style.width = "0%";
    this._setStatus("Searching…", "hint");
    state.isSearching = true;

    try {
      const options = this._searchOptions();

      // --- the query ---------------------------------------------------
      const queryItems = state.query.contours.map((contour) =>
        this._prepare(contour, options)
      );

      // --- the candidates ----------------------------------------------
      const raw = await collectCandidates(this.editorController, {
        onProgress: (done, total) => {
          this._progressFill.style.width = `${Math.round((done / total) * 100)}%`;
          state.progress = { done, total };
        },
      });

      const candidates = [];
      for (const item of raw) {
        const prepared = this._prepare(item.contour, options);
        candidates.push({
          prepared,
          meta: { glyphName: item.glyphName, contourIndex: item.contourIndex },
        });
      }

      // --- the matches --------------------------------------------------
      let matches = [];
      for (const query of queryItems) {
        const found = findMatches(query, candidates, options);
        matches = matches.concat(found);
      }
      matches.sort((a, b) => a.distance - b.distance);
      state.matches = matches;
      state.summary = summarizeMatches(matches, options);
      this._updateResults();
      this._setStatus(
        `Found ${matches.length} common form(s) in ${raw.length} contour(s).`,
        matches.length ? "ok" : "hint"
      );
    } catch (e) {
      this._setStatus(e.message, "error");
    } finally {
      this._busy = false;
      state.isSearching = false;
      this._searchButton.disabled = false;
      this.editorController.canvasController?.requestUpdate();
    }
  }

  _updateResults() {
    const matches = state.matches || [];
    const summary = state.summary;

    if (!matches.length) {
      this._summary.textContent = "No common forms found.";
      this._resultsTable.replaceChildren(
        thead({}),
        tbody({}, [tr({}, [td({ colspan: "4" }, "No results yet.")])])
      );
      return;
    }

    const worst = summary.worst;
    const recurrences = summary.identical + summary.same;
    const parts = [
      `${summary.count} other shape(s) in the font: `,
      `${summary.identical} identical, ${summary.same} the same, `,
      `${summary.near} near.`,
    ];
    if (summary.turned) {
      parts.push(` ${summary.turned} of them are turned or mirrored.`);
    }
    let text = parts.join("");
    if (recurrences) {
      text +=
        `\nThe copies of this shape differ by up to ` +
        `${formatNumber(worst.distance)} units (worst: "${worst.glyphName}").`;
    } else {
      text +=
        `\nNone of them is within the tolerance, so at this tolerance the ` +
        `shape does not recur; the closest is ` +
        `${formatNumber(summary.closest?.distance ?? worst.distance)} units ` +
        `away ("${summary.closest?.glyphName ?? worst.glyphName}").`;
    }
    this._summary.textContent = text;

    const head = tr({}, [
      th({}, "Glyph"),
      th({}, "Δ"),
      th({}, ""),
      th({}, "Nodes"),
    ]);
    const rows = matches.map((match) => {
      const glyphButton = button(
        { type: "button", class: "cf-glyph-button" },
        match.glyphName
      );
      glyphButton.addEventListener("click", () => this._goTo(match));
      const tier = match.tier.replace("-mirrored", "").replace("-", " ");
      // Say *how* the copy had to be turned to match: the bowl of d is the
      // bowl of b, mirrored; the bowl of p is it, flipped.
      const orientation =
        match.orientation && match.orientation !== "as-drawn"
          ? ` · ${match.orientation}`
          : "";
      return tr(
        { class: match.tier.startsWith("near") ? "cf-near" : "" },
        [
          td({}, [glyphButton]),
          td({}, formatNumber(match.distance)),
          td({}, [span({ class: "cf-tier" }, tier + orientation)]),
          td({}, match.sameNodes ? "same" : "—"),
        ]
      );
    });
    this._resultsTable.replaceChildren(thead({}, [head]), tbody({}, rows));
  }

  async _goTo(match) {
    try {
      const ok = await selectContour(
        this.editorController,
        match.glyphName,
        match.contourIndex
      );
      if (!ok) {
        this._setStatus(`Could not open "${match.glyphName}".`, "error");
      }
    } catch (e) {
      this._setStatus(e.message, "error");
    }
  }

  _setStatus(text, kind = "hint") {
    if (!this._status) {
      return;
    }
    this._status.textContent = text || "";
    const colourClass =
      kind === "error"
        ? "cf-error"
        : kind === "warning"
        ? "cf-warning"
        : kind === "ok"
        ? "cf-ok"
        : "cf-hint";
    this._status.className = `cf-status ${colourClass}`;
  }
}

function formatNumber(value) {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  const rounded = Math.round(value * 10) / 10;
  return String(rounded);
}

if (!customElements.get("panel-commonform-plugin")) {
  customElements.define("panel-commonform-plugin", CommonformPanel);
}
