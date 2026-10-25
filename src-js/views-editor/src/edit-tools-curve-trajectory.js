import {
  drawAnchorRings,
  drawCurveTrajectory,
} from "@fontra/core/curve-trajectory-drawing.js";
import { scopeToSelectionMode } from "@fontra/core/curve-trajectory-scope.js";
import {
  SEVERITY_OK,
  analyzePath,
  applyIdealHandles,
} from "@fontra/core/ideal-curve.js";
import { translate } from "@fontra/core/localization.js";
import { ObservableController } from "@fontra/core/observable-object.js";
import { parseSelection } from "@fontra/core/utils.js";
import { BaseTool } from "./edit-tools-base.js";
import { registerVisualizationLayerDefinition } from "./visualization-layer-definitions.js";
import { getGlyphEntriesBySelectionMode } from "./visualization-layers.js";

const CURVE_TRAJECTORY_IDENTIFIER = "fontra.curve.trajectory";

let activeToolInstance = null;

try {
  registerVisualizationLayerDefinition({
    identifier: CURVE_TRAJECTORY_IDENTIFIER,
    name: "sidebar.user-settings.glyph.curve-trajectory",
    selectionFunc: (visContext) => {
      const scope = activeToolInstance?.scope || "editing";
      return visContext.glyphsBySelectionMode[scopeToSelectionMode(scope)] || [];
    },
    userSwitchable: true,
    defaultOn: false,
    zIndex: 620,
    screenParameters: {
      strokeWidth: 1.5,
      trajectoryStrokeWidth: 1.6,
      circleStrokeWidth: 1,
      ribbonOpacity: 0.16,
      handleRadius: 4,
      ringRadius: 8,
      ringStrokeWidth: 1.5,
      labelFontSize: 11,
      dashLength: 7,
      dashGap: 5,
      dotLength: 1,
      dotGap: 4,
      haloWidth: 3,
    },
    colors: {
      idealColor: "#6C5CE7",
      okColor: "#1D9E75",
      warnColor: "#D99117",
      errorColor: "#E24B4A",
      haloColor: "#FFFFFF",
    },
    colorsDarkMode: {
      idealColor: "#A99BFF",
      okColor: "#3ECF9E",
      warnColor: "#F2B457",
      errorColor: "#FF6B6B",
      haloColor: "#2B2B2B",
    },
    draw: ({ context, positionedGlyph, parameters, model, controller }) =>
      activeToolInstance?.draw(
        context,
        positionedGlyph,
        parameters,
        model,
        controller
      ),
  });
} catch (e) {
  console.warn("Curve Trajectory visualization layer already registered:", e);
}

/**
 * Curve Trajectory — shows, as an overlay, the trajectory a curve *should*
 * follow when the classic rules of Bézier construction are respected.
 *
 * The tool doubles as an overlay: it registers a visualization layer, so the
 * reference trajectories stay visible while other tools are used.
 */
export class CurveTrajectoryTool extends BaseTool {
  inlineSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M40 216A176 176 0 0 0 216 40h-48a128 128 0 0 1-128 128zM77 165l14 14-14 14-14-14zm51-37l14 14-14 14-14-14zm51-37l14 14-14 14-14-14z"/></svg>`;
  identifier = "curve-trajectory";

  constructor(editor) {
    super(editor);
    activeToolInstance = this;
    this.fontController = editor.fontController;

    this._layerEnabled =
      editor.visualizationLayersSettings.model[CURVE_TRAJECTORY_IDENTIFIER];
    this._isActive = false;

    // Display settings. The panel edits these through `this.settings`, and
    // the keyboard shortcuts go through the same controller, so everything
    // stays in sync.
    this.settings = new ObservableController({
      scope: "editing",
      strictness: "standard",
      showTrajectory: true,
      showCircle: true,
      showRibbon: true,
      showHandles: true,
      showRings: true,
      showLabels: false,
      onlySelected: false,
    });
    this.settings.addListener(() => {
      this.canvasController.requestUpdate();
    });

    this._analysisCache = new WeakMap();

    editor.visualizationLayersSettings.addKeyListener(
      CURVE_TRAJECTORY_IDENTIFIER,
      (event) => {
        this._layerEnabled = event.newValue;
        this.canvasController.requestUpdate();
      }
    );

    this.sceneController.addCurrentGlyphChangeListener(() => {
      this._invalidateAnalysis();
      this.canvasController.requestUpdate();
    });

    this.fontController.addEditListener(async (...args) => {
      this._invalidateAnalysis();
      this.canvasController.requestUpdate();
    });

    // The panel is lazy-imported, so it does not slow down editor startup.
    import("./panel-curve-trajectory.js").then((mod) => {
      const CurveTrajectoryPanel = mod.default;
      if (
        document.querySelector(
          '.sidebar-content[data-sidebar-name="curve-trajectory-panel"]'
        )
      ) {
        return;
      }
      const panel = new CurveTrajectoryPanel(editor);
      panel.tool = this;
      editor.addSidebarPanel(panel, "right");
    });
  }

  activate() {
    super.activate();
    this._isActive = true;
    // Make sure the overlay is on when the tool is picked.
    if (!this._layerEnabled) {
      this._layerEnabled = true;
      this.editor.visualizationLayersSettings.model[
        CURVE_TRAJECTORY_IDENTIFIER
      ] = true;
    }
    this.canvasController.requestUpdate();
  }

  deactivate() {
    super.deactivate();
    this._isActive = false;
    // The layer stays on: the overlay is useful while other tools are active.
    this.canvasController.requestUpdate();
  }

  // Convenience accessors, so the drawing code can read the settings
  // without reaching into the controller every time.
  get scope() {
    return this.settings.model.scope;
  }
  get strictness() {
    return this.settings.model.strictness;
  }
  get showTrajectory() {
    return this.settings.model.showTrajectory;
  }
  get showCircle() {
    return this.settings.model.showCircle;
  }
  get showRibbon() {
    return this.settings.model.showRibbon;
  }
  get showHandles() {
    return this.settings.model.showHandles;
  }
  get showRings() {
    return this.settings.model.showRings;
  }
  get showLabels() {
    return this.settings.model.showLabels;
  }
  get onlySelected() {
    return this.settings.model.onlySelected;
  }

  setCursor() {
    this.canvasController.canvas.style.cursor = "crosshair";
  }

  handleHover(event) {
    this.setCursor();
  }

  handleKeyDown(event) {
    if (event.key === "Escape") {
      this.editor.setSelectedTool("pointer-tool");
      return;
    }

    const toggles = {
      t: "showTrajectory",
      c: "showCircle",
      r: "showRibbon",
      h: "showHandles",
      n: "showRings",
      l: "showLabels",
    };

    const key = event.key.toLowerCase();
    if (toggles[key]) {
      const setting = toggles[key];
      this.settings.setItem(setting, !this.settings.model[setting]);
      return;
    }

    if (key === "f") {
      this.applyIdealTrajectory();
    }
  }

  // ---------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------

  _invalidateAnalysis() {
    this._analysisCache = new WeakMap();
  }

  getAnalysis(path) {
    if (!path) {
      return null;
    }
    const cached = this._analysisCache.get(path);
    if (cached && cached.strictness === this.strictness) {
      return cached.analysis;
    }
    const analysis = analyzePath(path, { strictness: this.strictness });
    this._analysisCache.set(path, { strictness: this.strictness, analysis });
    return analysis;
  }

  /** The analysis of the glyph that is currently being edited. */
  getCurrentGlyphAnalysis() {
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    const path = positionedGlyph?.glyph?.path;
    if (!path) {
      return null;
    }
    return { path: path, analysis: this.getAnalysis(path) };
  }

  /**
   * The glyphs that are in scope, as `{ positionedGlyph, lineIndex, glyphIndex }`.
   *
   * This is exactly the set that the overlay draws, so the panel and the
   * canvas can never disagree about which glyphs are being looked at.
   */
  getScopeGlyphEntries() {
    const model = this.sceneModel;
    if (!model) {
      return [];
    }
    const entries = getGlyphEntriesBySelectionMode(model);
    return entries[scopeToSelectionMode(this.scope)] || [];
  }

  /**
   * The glyphs in scope, one entry per glyph name: a glyph that occurs more
   * than once in the text is one glyph, with one set of curves.
   */
  getScopeGlyphsByName() {
    const byName = new Map();
    for (const entry of this.getScopeGlyphEntries()) {
      const glyphName = entry.positionedGlyph.glyphName;
      if (!glyphName || byName.has(glyphName)) {
        continue;
      }
      byName.set(glyphName, {
        glyphName: glyphName,
        positionedGlyph: entry.positionedGlyph,
        lineIndex: entry.lineIndex,
        glyphIndex: entry.glyphIndex,
      });
    }
    return [...byName.values()];
  }

  // ---------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------

  draw(context, positionedGlyph, parameters, model, controller) {
    if (!this._layerEnabled) {
      return;
    }

    const glyph = positionedGlyph?.glyph;
    if (!glyph || !glyph.path) {
      return;
    }

    const analysis = this.getAnalysis(glyph.path);
    if (!analysis) {
      return;
    }

    const { point: selectedPointIndices } = parseSelection(model.selection) || {};
    const { point: hoveredPointIndices } = parseSelection(model.hoverSelection) || {};
    const selectedSet = new Set(selectedPointIndices || []);
    const hoveredSet = new Set(hoveredPointIndices || []);

    const drawnEntries = [];

    for (const contour of analysis.contours) {
      for (const entry of contour.segments) {
        if (!entry.analysis || entry.analysis.degenerate) {
          continue;
        }
        if (!this._segmentIsRelevant(entry, selectedSet, hoveredSet)) {
          continue;
        }
        drawCurveTrajectory(context, entry, parameters, {
          showTrajectory: this.showTrajectory,
          showCircle: this.showCircle,
          showRibbon: this.showRibbon,
          showHandles: this.showHandles,
          showLabels: this.showLabels,
          isHighlighted: this._segmentIsHighlighted(entry, selectedSet),
        });
        drawnEntries.push(entry);
      }
    }

    if (this.showRings) {
      drawAnchorRings(
        context,
        glyph.path,
        drawnEntries,
        analysis,
        parameters
      );
    }
  }

  _segmentIsRelevant(entry, selectedSet, hoveredSet) {
    // While the tool is active, everything in scope is shown. As an overlay,
    // only the segments the user is working on are shown, so the canvas
    // does not turn into a wall of reference curves.
    if (this._isActive || !this.onlySelected) {
      return true;
    }
    return this._segmentIsHighlighted(entry, selectedSet, hoveredSet);
  }

  _segmentIsHighlighted(entry, selectedSet, hoveredSet = selectedSet) {
    if (!entry.pointIndices) {
      return false;
    }
    for (const index of entry.pointIndices) {
      if (selectedSet.has(index) || hoveredSet.has(index)) {
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  /**
   * Select the points of a segment, so the user can see which one it is.
   *
   * When the segment belongs to another glyph, that glyph is selected first,
   * so the user lands on the curve that was clicked.
   */
  selectSegment(entry, glyphEntry = null) {
    if (!entry?.pointIndices) {
      return;
    }
    if (glyphEntry && !this._isEditingGlyph(glyphEntry.positionedGlyph)) {
      this.sceneSettings.selectedGlyph = {
        lineIndex: glyphEntry.lineIndex,
        glyphIndex: glyphEntry.glyphIndex,
        isEditing: true,
      };
    }
    const selection = new Set();
    for (const index of entry.pointIndices) {
      selection.add(`point/${index}`);
    }
    this.sceneController.selection = selection;
  }

  _isEditingGlyph(positionedGlyph) {
    const editingGlyph = this.sceneModel.getSelectedPositionedGlyph();
    return (
      !!editingGlyph &&
      !!positionedGlyph &&
      editingGlyph.glyphName === positionedGlyph.glyphName
    );
  }

  /** The curve segments that the current selection touches. */
  getSelectedSegmentEntries() {
    const result = this.getCurrentGlyphAnalysis();
    if (!result) {
      return [];
    }
    const { point: selectedPointIndices } =
      parseSelection(this.sceneController.selection) || {};
    const selectedSet = new Set(selectedPointIndices || []);

    if (!selectedSet.size) {
      return [];
    }

    const glyphName = this.sceneModel.getSelectedPositionedGlyph()?.glyphName;

    return result.analysis.segments
      .filter((entry) => {
        if (!entry.pointIndices || !entry.analysis || entry.analysis.degenerate) {
          return false;
        }
        return entry.pointIndices.some((index) => selectedSet.has(index));
      })
      .map((entry) => ({
        glyphName: glyphName,
        contourIndex: entry.contourIndex,
        segmentIndex: entry.segmentIndex,
      }));
  }

  /**
   * Move the handles of the flagged curves onto their ideal trajectory.
   *
   * The edit is applied to every glyph that is in scope, and it is undoable.
   *
   * `entries` is a list of `{ glyphName, contourIndex, segmentIndex }`
   * objects, or null to fix every flagged curve in scope.
   *
   * Returns `{ changed, skipped }`: `skipped` holds the names of the glyphs
   * that could not be edited at the current location.
   */
  async applyIdealTrajectory(entries = null) {
    const scopeGlyphs = this.getScopeGlyphsByName();
    if (!scopeGlyphs.length) {
      return { changed: false, skipped: [] };
    }

    const entriesByGlyphName = new Map();
    if (entries) {
      for (const entry of entries) {
        const list = entriesByGlyphName.get(entry.glyphName) || [];
        list.push(entry);
        entriesByGlyphName.set(entry.glyphName, list);
      }
    }

    let changed = false;
    const skipped = [];

    for (const scopeGlyph of scopeGlyphs) {
      const glyphEntries = entries
        ? entriesByGlyphName.get(scopeGlyph.glyphName)
        : null;
      if (entries && !glyphEntries) {
        // This glyph has nothing to fix.
        continue;
      }
      const result = await this._applyIdealTrajectoryToGlyph(
        scopeGlyph,
        glyphEntries
      );
      if (result === "skipped") {
        skipped.push(scopeGlyph.glyphName);
      } else if (result) {
        changed = true;
      }
    }

    this._invalidateAnalysis();
    this.canvasController.requestUpdate();
    return { changed, skipped };
  }

  async _applyIdealTrajectoryToGlyph(scopeGlyph, entries) {
    if (this._isEditingGlyph(scopeGlyph.positionedGlyph)) {
      return await this._applyIdealTrajectoryToEditingGlyph(entries);
    }
    return await this._applyIdealTrajectoryToNamedGlyph(scopeGlyph, entries);
  }

  /**
   * Fix the glyph that is being edited: its editing layer(s) are edited
   * directly, which is the safest thing to do, as the editor takes care of
   * the source bookkeeping.
   */
  async _applyIdealTrajectoryToEditingGlyph(entries) {
    let changed = false;

    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        changed = this._applyIdealHandlesToPath(layerGlyph.path, entries) || changed;
      }
      return translate("edit-tools-curve-trajectory.undo.apply-trajectory");
    });

    return changed;
  }

  /**
   * Fix a glyph that is in scope, but is not being edited: its source layer
   * is edited directly.
   *
   * A glyph that is not backed by a source at the current location is skipped:
   * writing to a source that is not on display would change the wrong shape.
   */
  async _applyIdealTrajectoryToNamedGlyph(scopeGlyph, entries) {
    const glyphName = scopeGlyph.glyphName;
    const controller = scopeGlyph.positionedGlyph.glyph;

    if (!controller?.canEdit) {
      return "skipped";
    }

    const layerName = await this._getSourceLayerName(glyphName);
    if (!layerName || layerName !== controller.layerName) {
      // The glyph is not on display from a source at this location, so we
      // cannot safely edit it here.
      return "skipped";
    }

    let changed = false;

    await this.sceneController.editNamedGlyphAndRecordChanges(
      glyphName,
      (glyph) => {
        const path = glyph.layers?.[layerName]?.glyph?.path;
        if (path) {
          changed = this._applyIdealHandlesToPath(path, entries) || changed;
        }
        return translate("edit-tools-curve-trajectory.undo.apply-trajectory");
      }
    );

    return changed;
  }

  /**
   * The name of the layer that is on display for a glyph at the current
   * location, or undefined if the location is not at a source.
   */
  async _getSourceLayerName(glyphName) {
    const varGlyph = await this.fontController.getGlyph(glyphName);
    if (!varGlyph) {
      return undefined;
    }
    const location = this.sceneModel.getLocationForGlyph(glyphName);
    const sourceIndex = varGlyph.getSourceIndex(location);
    if (sourceIndex === undefined) {
      return undefined;
    }
    return varGlyph.sources[sourceIndex]?.layerName;
  }

  /**
   * Apply the ideal handles to the flagged segments of a path.
   *
   * The path is analysed again here, so the segment indices refer to the path
   * that is being edited, and not to the path that was on display.
   */
  _applyIdealHandlesToPath(path, entries) {
    if (!path) {
      return false;
    }
    let changed = false;
    const analysis = analyzePath(path, { strictness: this.strictness });
    for (const entry of analysis.segments) {
      if (!entry.analysis || entry.analysis.degenerate) {
        continue;
      }
      if (entries) {
        const match = entries.some(
          (target) =>
            target.contourIndex === entry.contourIndex &&
            target.segmentIndex === entry.segmentIndex
        );
        if (!match) {
          continue;
        }
      } else if (entry.analysis.severity === SEVERITY_OK) {
        // Nothing to fix: the curve already follows its trajectory.
        continue;
      }
      if (applyIdealHandles(path, entry)) {
        changed = true;
      }
    }
    return changed;
  }

  static isToolActive(editor) {
    return !!activeToolInstance?._isActive;
  }

  static getInstance() {
    return activeToolInstance;
  }
}
