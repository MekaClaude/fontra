/**
 * edit-tools-brush-advanced — the four brush sub-tools.
 *
 * The template-method refactor moved the drag loop, FSM, hover, cursor,
 * toast, and cancel into BrushStrokeToolBase. Each sub-tool below is now
 * a thin declaration: identifier, icon, mode, and the commit path that
 * actually differs.
 *
 * Improvements vs. source v3:
 *   - Distinct Phosphor icon per sub-tool mode (calligraphic / straight /
 *     sculpt / eraser) instead of reusing brush.svg for everything.
 *   - Click-click straight line is now the default (no Shift required);
 *     the base class handles anchor → commit.
 *   - simplify default 0.6 (from 0.5) for fewer vector points.
 */
import { translate } from "@fontra/core/localization.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { Backend } from "@fontra/core/backend-api.js";
import { getSelectionByContour } from "@fontra/core/path-functions.js";
import { parseSelection } from "@fontra/core/utils.js";
import { BRUSH_SHARED_DEFAULTS, BRUSH_MODE_TO_TOOL_ID, BRUSH_MODES } from "@fontra/core/brush-settings.js";
import { buildRoundCapsuleOutline, resamplePolyline } from "@fontra/core/brush-engine.js";
import { SpatialGrid } from "@fontra/core/brush-stroke.js";
import {
  BrushToolBase,
  BrushDrawingToolBase,
  BrushStrokeToolBase,
  boundsOverlap,
  douglasPeucker,
  snapshotSettings,
} from "./brush-tool-base.js";

const STORAGE_PREFIX_V2 = "fontra.brush-v2.";
const ADVANCED_DEFAULTS = { ...BRUSH_SHARED_DEFAULTS, simplify: 0.6 };

export { BRUSH_MODES };

// ─────────────────────────────────────────────────────────────────────────────
// BrushToolAdvanced — container that owns all four sub-tools
// ─────────────────────────────────────────────────────────────────────────────

export class BrushToolAdvanced {
  identifier = "brush-tool-advanced";
  subTools = [
    BrushToolCalligraphic,
    BrushToolStraight,
    BrushToolSculpt,
    BrushToolEraser,
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Calligraphic — broad-nib, cubic-fitted smooth outline
// ─────────────────────────────────────────────────────────────────────────────

export class BrushToolCalligraphic extends BrushToolBase {
  iconPath = "/images/brush-calligraphic.svg";
  identifier = "brush-tool-calligraphic";
  brushMode = BRUSH_MODES.CALLIGRAPHIC;

  constructor(editor) {
    super(editor, "fontra.brush-v2.calligraphic.", ADVANCED_DEFAULTS);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Straight — Douglas-Peucker simplified, plain on-curve outline
// ─────────────────────────────────────────────────────────────────────────────

export class BrushToolStraight extends BrushToolBase {
  iconPath = "/images/brush-straight.svg";
  identifier = "brush-tool-straight";
  brushMode = BRUSH_MODES.STRAIGHT;

  constructor(editor) {
    super(editor, "fontra.brush-v2.straight.", ADVANCED_DEFAULTS);
  }

  _buildStrokeForCommit(rawPoints) {
    try {
      const eps = 1 + this.simplify * 4; // 1..5
      const simplified = douglasPeucker(rawPoints, eps);
      return this.brushEngine.generateSharpContour(simplified);
    } catch (e) {
      console.warn("straight stroke build error", e);
      return null;
    }
  }

  /** Preview the simplified sharp outline so aiming matches the commit
   *  (the shared base preview would show a smoothed calligraphic shape). */
  _updatePreview() {
    if (this.rawPoints.pointCount < 2) {
      super._updatePreview();
      return;
    }
    try {
      const t0 = performance.now();
      const eps = 1 + this.simplify * 4; // 1..5
      const simplified = douglasPeucker(this._previewSamples(), eps);
      const contour = this._buildStrokeForCommit(simplified);
      if (!contour || contour.points.length < 3) {
        super._updatePreview();
        return;
      }
      const path = new Path2D();
      path.moveTo(contour.points[0].x, contour.points[0].y);
      for (let i = 1; i < contour.points.length; i++) path.lineTo(contour.points[i].x, contour.points[i].y);
      path.closePath();
      const centerPath = new Path2D();
      centerPath.moveTo(simplified[0].x, simplified[0].y);
      for (let i = 1; i < simplified.length; i++) centerPath.lineTo(simplified[i].x, simplified[i].y);
      this.sceneModel.brushPreviewPath = path;
      this.sceneModel.brushPreviewCenterline = centerPath;
      this.sceneModel.brushAngle = this.brushEngine.brushAngle;
      this.canvasController.requestUpdate();
      this._adaptPreviewCap(performance.now() - t0);
    } catch (e) {
      console.warn("straight preview error", e);
      super._updatePreview();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sculpt — push/pull existing points within a brush radius
// ─────────────────────────────────────────────────────────────────────────────

export class BrushToolSculpt extends BrushDrawingToolBase {
  iconPath = "/images/brush-sculpt.svg";
  identifier = "brush-tool-sculpt";
  brushMode = BRUSH_MODES.SCULPT;

  constructor(editor) {
    super(editor);
    // Shared-prefix store (same object the eraser and the panel use).
    this._initSettingsStore(STORAGE_PREFIX_V2);
    this._sculptRadius = this._store.get("sculptRadius");
    this._sculptStrength = this._store.get("sculptStrength");
    this._syncFromStore();
  }

  get settings() {
    return { ...snapshotSettings(this), sculptRadius: this._sculptRadius, sculptStrength: this._sculptStrength };
  }

  _syncFromStore() {
    super._syncFromStore();
    if (!this._store) return;
    this._sculptRadius = this._store.get("sculptRadius");
    this._sculptStrength = this._store.get("sculptStrength");
  }

  setBrushMode(mode) {
    const targetId = BRUSH_MODE_TO_TOOL_ID[mode];
    if (targetId && targetId !== this.identifier) this.editor.setSelectedTool(targetId);
  }

  _brushAngleForHover() { return 0; }

  // Sculpt draws a radius ring on hover. Sub-tool's own implementation.
  handleHover(event) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      this.editor.tools["pointer-tool"].handleHover(event);
      return;
    }
    this.setCursor();
    if (event?.x === undefined) return;
    const p = this.sceneController.localPoint(event);
    this.sceneModel.brushHoverPoint = p;
    this.sceneModel.brushAngle = 0;
    if (!this.isDrawing) {
      const r = this._sculptRadius * (1 / (this.sceneController.magnification || 1));
      const path = new Path2D();
      path.arc(p.x, p.y, r, 0, Math.PI * 2);
      this.sceneModel.brushPreviewPath = path;
      this.sceneModel.brushPreviewCenterline = null;
      this.canvasController.requestUpdate();
    }
  }

  handleKeyDown(event) {
    if (!this.isActive || !this.sceneModel.selectedGlyph?.isEditing) return;
    if (event.key === "Escape" && this.isDrawing) {
      this.cancelStroke();
      event.preventDefault();
    }
  }

  async handleDrag(eventStream, initialEvent) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      await this.editor.tools["pointer-tool"].handleDrag(eventStream, initialEvent);
      return;
    }
    const initialPoint = this.sceneController.selectedGlyphPoint(initialEvent);
    if (!initialPoint || initialPoint.x === undefined) return;

    // Cache the editing layers once — not per mousemove.
    const editingLayerInfos = await this._captureEditingLayers();
    if (!editingLayerInfos?.length) return;

    // Index every point once: glyph points are static until commit, so each
    // mousemove then touches only cells overlapping the brush disc instead
    // of scanning all points of all layers.
    const sculptIndex = this._buildSculptIndex(editingLayerInfos);

    this.isDrawing = true;
    this._strokeCancelled = false;
    this.lastPoint = { ...initialPoint };
    const deltas = (this._sculptDeltas = new Map());
    let prevPoint = { ...initialPoint };

    for await (const event of eventStream) {
      if (!this.isDrawing) continue;
      const point = this.sceneController.selectedGlyphPoint(event);
      if (!point || point.x === undefined) continue;
      const { x, y } = point;
      const incDx = x - prevPoint.x;
      const incDy = y - prevPoint.y;
      const radius = this._sculptRadius * (1 / (this.sceneController.magnification || 1));
      this._accumulateDeltas(sculptIndex, { x, y }, { dx: incDx, dy: incDy }, radius, deltas);
      prevPoint = { x, y };
      this.lastPoint = { x, y };
      this._schedulePreview();
    }

    if (this._strokeCancelled) { this.cancelStroke(); return; }
    this.isDrawing = false;
    delete this.sceneModel.brushPreviewPath;
    delete this.sceneModel.brushPreviewCenterline;
    this.canvasController.requestUpdate();

    if (deltas.size === 0) return;
    // Filter out negligible moves (<0.5 units) — saves a no-op glyph edit.
    const moves = [...deltas.values()].filter((m) => Math.hypot(m.dx, m.dy) >= 0.5);
    if (!moves.length) return;

    await this.sceneController.editGlyphAndRecordChanges(
      (glyph) => {
        const layers = this.sceneController.getEditingLayerFromGlyphLayers(glyph.layers);
        for (const m of moves) {
          const layerGlyph = layers[m.layerName];
          if (!layerGlyph) continue;
          const pt = layerGlyph.path.getPoint(m.index);
          layerGlyph.path.setPoint(m.index, {
            x: Math.round(pt.x + m.dx),
            y: Math.round(pt.y + m.dy),
            type: pt.type,
            smooth: pt.smooth,
          });
        }
        return translate("edit-tools-brush.undo.sculpt");
      },
      undefined,
      true
    );
    this.canvasController.requestUpdate();
  }

  _updatePreview() { this._updateSculptPreview(); }

  _updateSculptPreview() {
    const path = new Path2D();
    const centerPath = new Path2D();
    if (this.lastPoint) {
      const r = this._sculptRadius * (1 / (this.sceneController.magnification || 1));
      path.arc(this.lastPoint.x, this.lastPoint.y, r, 0, Math.PI * 2);
    }
    for (const m of this._sculptDeltas?.values() || []) {
      if (Math.hypot(m.dx, m.dy) < 0.5) continue;
      centerPath.moveTo(m.ox, m.oy);
      centerPath.lineTo(m.ox + m.dx, m.oy + m.dy);
    }
    this.sceneModel.brushPreviewPath = path;
    this.sceneModel.brushPreviewCenterline = centerPath;
    this.canvasController.requestUpdate();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  async _captureEditingLayers() {
    try {
      const glyphController = await this.sceneController.sceneModel.getSelectedVariableGlyphController();
      if (!glyphController) return null;
      const layers = this.sceneController.getEditingLayerFromGlyphLayers(glyphController.layers);
      return Object.entries(layers).map(([name, lg]) => ({ layerName: name, path: lg.path }));
    } catch (e) {
      console.warn("sculpt: failed to get glyph controller", e);
      return null;
    }
  }

  /**
   * Snapshot all editing-layer points into a spatial index. Positions are
   * static for the whole stroke (the glyph mutates only at commit), so the
   * index stays valid from build until _resetStrokeState.
   */
  _buildSculptIndex(editingLayerInfos) {
    const entries = [];
    const cellSize = Math.max(
      1,
      this._sculptRadius * (1 / (this.sceneController.magnification || 1))
    );
    const grid = new SpatialGrid(cellSize);
    for (const { layerName, path } of editingLayerInfos) {
      for (let i = 0; i < path.numPoints; i++) {
        const pt = path.getPoint(i);
        grid.insert(entries.length, pt.x, pt.y);
        entries.push({ key: `${layerName}:${i}`, layerName, index: i, x: pt.x, y: pt.y });
      }
    }
    return { entries, grid };
  }

  _accumulateDeltas(sculptIndex, { x, y }, { dx, dy }, radius, deltas) {
    const { entries, grid } = sculptIndex;
    const strength = this._sculptStrength;
    grid.forEachInRadius(x, y, radius, (id) => {
      const e = entries[id];
      const ox = e.x - x, oy = e.y - y;
      // Bounding-box pre-check — saves the hypot on far points.
      if (ox > radius || ox < -radius || oy > radius || oy < -radius) return;
      const dist = Math.hypot(ox, oy);
      if (dist >= radius) return;
      const factor = (1 - dist / radius) * strength;
      let entry = deltas.get(e.key);
      if (!entry) {
        entry = { layerName: e.layerName, index: e.index, dx: 0, dy: 0, ox: e.x, oy: e.y };
        deltas.set(e.key, entry);
      }
      entry.dx += dx * factor;
      entry.dy += dy * factor;
    });
  }

  activate() {
    super.activate();
    this.setCursor();
    this.canvasController.requestUpdate();
  }

  deactivate() {
    super.deactivate();
    this.cancelStroke();
    this.canvasController.requestUpdate();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Eraser — paint-to-subtract boolean
// ─────────────────────────────────────────────────────────────────────────────

export class BrushToolEraser extends BrushStrokeToolBase {
  iconPath = "/images/brush-eraser.svg";
  identifier = "brush-tool-eraser";
  brushMode = BRUSH_MODES.ERASER;

  constructor(editor) {
    super(editor);
    // Shared-prefix store (same object sculpt and the panel use).
    this._initSettingsStore(STORAGE_PREFIX_V2);
    this.eraserWidth = this._store.get("eraserWidth");
    this._syncFromStore();
  }

  get settings() { return { eraserWidth: this.eraserWidth }; }

  _syncFromStore() {
    super._syncFromStore();
    if (!this._store) return;
    this.eraserWidth = this._store.get("eraserWidth");
  }

  /** Eraser accepts the same knob set as the draw tools and forwards the
   *  engine-level ones to the calligraphic + straight siblings so the
   *  adjustment persists per-mode (otherwise it would be silently lost on
   *  the next mode switch). */
  updateSettings(patch) {
    this.applySettings(patch);
    const { eraserWidth: _ignore, ...rest } = patch;
    if (!Object.keys(rest).length) return;
    for (const mode of [BRUSH_MODES.CALLIGRAPHIC, BRUSH_MODES.STRAIGHT]) {
      const tool = this.editor?.tools?.[BRUSH_MODE_TO_TOOL_ID[mode]];
      try { tool?.updateSettings?.(rest); }
      catch (e) { console.warn("eraser forward settings failed for", mode, e); }
    }
  }

  _brushAngleForHover() { return 0; }

  handleKeyDown(event) {
    if (!this.isActive || !this.sceneModel.selectedGlyph?.isEditing) return;
    const { key } = event;
    if (key === "[") {
      this.applySettings({ eraserWidth: this.eraserWidth - 8 });
      this._showToast(`Eraser size: ${Math.round(this.eraserWidth)}`, `e${Math.round(this.eraserWidth)}`);
      event.preventDefault();
    } else if (key === "]") {
      this.applySettings({ eraserWidth: this.eraserWidth + 8 });
      this._showToast(`Eraser size: ${Math.round(this.eraserWidth)}`, `e${Math.round(this.eraserWidth)}`);
      event.preventDefault();
    } else if (key === "Escape" && this.isDrawing) {
      this.cancelStroke();
      event.preventDefault();
    }
  }

  _updatePreview() {
    if (this.rawPoints.pointCount < 1) return;
    try {
      let outline = null;
      if (this.rawPoints.pointCount < 2) {
        // Single-point preview: degenerate capsule that just draws a circle.
        const p = this.rawPoints.firstPoint;
        outline = buildRoundCapsuleOutline(
          [{ x: p.x - 0.5, y: p.y }, { x: p.x + 0.5, y: p.y }],
          this.eraserWidth / 2
        );
      } else {
        // Full-resolution shape (unchanged): the capsule pass is O(n) cheap,
        // and resample(2u) interpolates rather than decimates.
        outline = this._buildEraserShape(this.rawPoints.toPoints());
      }
      const path = new Path2D();
      if (outline?.points?.length >= 3) {
        path.moveTo(outline.points[0].x, outline.points[0].y);
        for (let i = 1; i < outline.points.length; i++) path.lineTo(outline.points[i].x, outline.points[i].y);
        path.closePath();
      }
      this.sceneModel.brushEraserPath = path;
      this.sceneModel.brushAngle = 0;
      this.canvasController.requestUpdate();
    } catch (e) {
      console.warn("eraser preview error", e);
    }
  }

  async _commitStroke(rawPoints, { didDrag } = {}) {
    if (!didDrag || rawPoints.length < 2) {
      this._resetStrokeState();
      this._clearPreviewModel();
      this.canvasController.requestUpdate();
      return;
    }
    const eraserShape = this._buildEraserShape(rawPoints);
    if (!eraserShape) { this._resetStrokeState(); return; }

    const rounded = {
      points: eraserShape.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      isClosed: true,
    };
    const eraserPath = VarPackedPath.fromUnpackedContours([rounded]).roundCoordinates();
    const eraserBounds = eraserPath.getControlBounds();
    if (!eraserBounds) { this._resetStrokeState(); return; }

    const positionedGlyph = this.sceneController.sceneModel.getSelectedPositionedGlyph?.();
    if (!positionedGlyph) { this._resetStrokeState(); return; }
    const editLayerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(
      positionedGlyph.varGlyph.glyph.layers
    );

    // Target semantics (Figma/Affinity): a non-empty selection scopes the
    // eraser to the selected contours; otherwise every intersecting contour
    // is fair game.
    const { point: pointIndices } = parseSelection(this.sceneController.selection);
    const selectedContourIndices = new Set(
      getSelectionByContour(positionedGlyph.glyph.path, pointIndices || []).keys()
    );
    const scoped = selectedContourIndices.size > 0;

    // Compute all booleans BEFORE the transaction (Backend calls are async).
    const layerPaths = {};
    let anyChange = false;
    for (const [layerName, layerGlyph] of Object.entries(editLayerGlyphs)) {
      try {
        const path = layerGlyph.path;
        if (!path.numContours) continue;
        if (!boundsOverlap(path.getControlBounds(), eraserBounds)) continue;

        let newPath;
        if (scoped) {
          const selectedPath = new VarPackedPath();
          const unselectedPath = new VarPackedPath();
          for (let i = 0; i < path.numContours; i++) {
            (selectedContourIndices.has(i) ? selectedPath : unselectedPath).appendContour(
              path.getContour(i)
            );
          }
          if (!selectedPath.numContours) continue;
          const subtracted = await Backend.subtractPath(selectedPath, eraserPath).catch(() => null);
          if (!subtracted) continue; // backend failure: leave layer untouched
          newPath = unselectedPath;
          newPath.appendPath(subtracted);
        } else {
          const subtracted = await Backend.subtractPath(path, eraserPath).catch(() => null);
          if (!subtracted) continue;
          newPath = subtracted;
        }
        // Assign even when empty: erasing a whole contour must remove it.
        layerPaths[layerName] = newPath;
        anyChange = true;
      } catch (e) {
        console.warn("eraser subtract failed for layer", layerName, e);
      }
    }

    if (!anyChange) {
      this._resetStrokeState();
      this._clearPreviewModel();
      this.canvasController.requestUpdate();
      this._showToast("Nothing erased", "nothing-erased");
      return;
    }

    await this.sceneController.editGlyphAndRecordChanges(
      (glyph) => {
        const layers = this.sceneController.getEditingLayerFromGlyphLayers(glyph.layers);
        for (const [layerName, newPath] of Object.entries(layerPaths)) {
          if (layers[layerName]) layers[layerName].path = newPath;
        }
        return translate("edit-tools-brush.undo.erase");
      },
      undefined,
      true
    );
    this._resetStrokeState();
    this._clearPreviewModel();
    this.canvasController.requestUpdate();
    this._showToast("Eraser applied", "eraser-applied");
  }

  _buildEraserShape(rawPoints) {
    // Resample to bound vertex counts on long drags, then build the shared
    // round capsule. Radius is constant along the stroke (predictable carving).
    return buildRoundCapsuleOutline(resamplePolyline(rawPoints, 2), this.eraserWidth / 2);
  }
}
