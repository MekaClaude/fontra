/**
 * brush-tool-base — shared tool layer for the brush sub-tools.
 *
 * Architecture (top → bottom):
 *   BaseTool                       (existing)
 *     └─ BrushDrawingToolBase      FSM, viz layers, toast, cursor, hover
 *          ├─ BrushStrokeToolBase template-method drag loop (calligraphic,
 *          │                      straight, eraser all share this)
 *          │    └─ BrushToolCalligraphic / BrushToolStraight / BrushToolEraser
 *          └─ BrushToolSculpt     push/pull existing points (own drag loop)
 *
 * What used to live here as three near-identical copies of `setCursor`,
 * `handleHover`, `_cancelPreview`, `_showToast`, and `handleDrag` is now
 * defined once in the base classes. The sub-tools only describe the parts
 * that genuinely differ (their identifier, their icon, their commit path,
 * their preview override).
 *
 * Improvements vs. source v3:
 *   - Click-click straight line by default (no Shift required): first click
 *     sets an anchor, second click commits a straight stroke between them.
 *   - simplify default raised to 0.6 for fewer vector points.
 *   - Distinct icon paths per sub-tool mode.
 *   - Visualization layers registered explicitly via registerBrushVisualizationLayers().
 */
import { translate } from "@fontra/core/localization.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { Backend } from "@fontra/core/backend-api.js";
import { constrainHorVerDiag } from "./edit-behavior.js";
import { BaseTool } from "./edit-tools-base.js";
import { glyphSelector, registerVisualizationLayerDefinition } from "./visualization-layer-definitions.js";
import { BrushEngine } from "@fontra/core/brush-engine.js";
import { StrokeInput, adaptPreviewCap, PREVIEW_CAP_DEFAULT } from "@fontra/core/brush-stroke.js";
import { BRUSH_SHARED_DEFAULTS, BRUSH_TOOL_BOUNDS, DEFAULT_BRUSH_SETTINGS, BRUSH_MODES, BRUSH_MODE_TO_TOOL_ID, BrushSettingsStore, ENGINE_SETTINGS, FLOAT_SETTINGS } from "@fontra/core/brush-settings.js";
import * as vector from "@fontra/core/vector.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared constants & storage helpers
// ─────────────────────────────────────────────────────────────────────────────

/** A drag shorter than this is treated as a click (no stroke committed). */
export const DOT_MAX_STROKE_LENGTH = 8;
/** After integer rounding, samples closer than this collapse — skip them. */
export const MIN_SAMPLE_DISTANCE = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Brush mode identifiers — canonical definitions live in brush-settings.js;
// re-exported here for backward compatibility (panel + sub-tools import
// them from either module).
// ─────────────────────────────────────────────────────────────────────────────

export { BRUSH_MODES, BRUSH_MODE_TO_TOOL_ID };

// ─────────────────────────────────────────────────────────────────────────────
// Shared visualization layers (registered once globally)
// ─────────────────────────────────────────────────────────────────────────────

let _brushVizRegistered = false;

/** Register the three brush visualization layers. Call once at editor init. */
export function registerBrushVisualizationLayers() {
  if (_brushVizRegistered) return;
  _brushVizRegistered = true;

  registerVisualizationLayerDefinition({
    identifier: "fontra.brush.preview",
    name: "Brush preview",
    selectionFunc: glyphSelector("editing"),
    zIndex: 520,
    screenParameters: { strokeWidth: 1.0 },
    colors: {
      fillColor: "rgba(0,180,255,0.18)",
      strokeColor: "#0099FF",
    },
    colorsDarkMode: {
      fillColor: "rgba(0,180,255,0.20)",
      strokeColor: "#2AB0FF",
    },
    draw: (context, positionedGlyph, parameters) => {
      const path = positionedGlyph.model.brushPreviewPath;
      if (!path) return;
      context.fillStyle = parameters.fillColor;
      context.strokeStyle = parameters.strokeColor;
      context.lineWidth = parameters.strokeWidth;
      context.fill(path);
      context.stroke(path);
    },
  });

  registerVisualizationLayerDefinition({
    identifier: "fontra.brush.centerline",
    name: "Brush centerline",
    selectionFunc: glyphSelector("editing"),
    zIndex: 521,
    screenParameters: { strokeWidth: 1, lineDash: [4, 3] },
    colors: {
      strokeColor: "rgba(255,105,180,0.85)",
      guideColor: "rgba(0,200,255,0.9)",
    },
    colorsDarkMode: {
      strokeColor: "rgba(255,105,180,0.85)",
      guideColor: "rgba(0,200,255,0.9)",
    },
    draw: (context, positionedGlyph, parameters, model, controller) => {
      const center = model.brushPreviewCenterline;
      const angle = model.brushAngle;
      if (center) {
        context.strokeStyle = parameters.strokeColor;
        context.lineWidth = parameters.strokeWidth;
        context.setLineDash(parameters.lineDash);
        context.stroke(center);
        context.setLineDash([]);
      }
      const hover = model.brushHoverPoint;
      if (!hover) return;
      const pt = { x: hover.x - positionedGlyph.x, y: hover.y - positionedGlyph.y };
      if (controller.magnification !== undefined && controller.magnification < 0.3) return;
      const scale = controller.magnification ? 1 / controller.magnification : 1;
      const lineLen = 28 * scale;
      const rad = ((angle ?? 30) * Math.PI) / 180;
      const dx = Math.cos(rad) * lineLen;
      const dy = Math.sin(rad) * lineLen;
      context.save();
      context.translate(pt.x, pt.y);
      context.strokeStyle = "rgba(255,255,255,0.7)";
      context.lineWidth = parameters.strokeWidth + 1.8;
      context.beginPath();
      context.moveTo(-dx, -dy);
      context.lineTo(dx, dy);
      context.stroke();
      context.strokeStyle = parameters.guideColor;
      context.lineWidth = parameters.strokeWidth + 0.4;
      context.beginPath();
      context.moveTo(-dx, -dy);
      context.lineTo(dx, dy);
      context.stroke();
      context.fillStyle = parameters.guideColor;
      context.beginPath();
      context.arc(0, 0, 2.2, 0, Math.PI * 2);
      context.fill();
      context.restore();
    },
  });

  registerVisualizationLayerDefinition({
    identifier: "fontra.brush.eraser",
    name: "Brush eraser",
    selectionFunc: glyphSelector("editing"),
    zIndex: 522,
    screenParameters: { strokeWidth: 1.0 },
    colors: {
      fillColor: "rgba(255,60,60,0.20)",
      strokeColor: "#FF3333",
    },
    colorsDarkMode: {
      fillColor: "rgba(255,60,60,0.24)",
      strokeColor: "#FF5553",
    },
    draw: (context, positionedGlyph, parameters) => {
      const path = positionedGlyph.model.brushEraserPath;
      if (!path) return;
      context.fillStyle = parameters.fillColor;
      context.strokeStyle = parameters.strokeColor;
      context.lineWidth = parameters.strokeWidth;
      context.setLineDash([5, 3]);
      context.fill(path);
      context.stroke(path);
      context.setLineDash([]);
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared geometry helpers (used by the straight tool)
// ─────────────────────────────────────────────────────────────────────────────

export function douglasPeucker(points, epsilon) {
  if (points.length <= 2) return points.slice();
  let maxDist = 0;
  let maxIndex = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIndex), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [start, end];
}

export function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  const t = Math.max(0, Math.min(1, ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (len * len)));
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

/** Bounding-box overlap test for `{xMin, yMin, xMax, yMax}` rects. */
export function boundsOverlap(a, b) {
  if (!a || !b) return false;
  return a.xMin <= b.xMax && a.xMax >= b.xMin && a.yMin <= b.yMax && a.yMax >= b.yMin;
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings snapshot — used by the panel and exposed via `tool.settings`
// ─────────────────────────────────────────────────────────────────────────────

/** Subclasses return their current settings via this getter; the panel reads it. */
export function snapshotSettings(tool) {
  const s = tool.brushEngine
    ? {
        brushAngle: tool.brushEngine.brushAngle,
        minWidth: tool.brushEngine.minWidth,
        maxWidth: tool.brushEngine.maxWidth,
        contrast: tool.brushEngine.contrast,
        smoothness: tool.brushEngine.smoothness,
        taper: tool.brushEngine.taper,
        usePressure: tool.brushEngine.usePressure,
      }
    : {};
  return { ...s, simplify: tool.simplify ?? 0, autoUnion: tool.autoUnion ?? 0, eraserWidth: tool.eraserWidth ?? 32 };
}

// ─────────────────────────────────────────────────────────────────────────────
// BrushDrawingToolBase — FSM, viz, toast, cursor, hover, cancel
// ─────────────────────────────────────────────────────────────────────────────

export class BrushDrawingToolBase extends BaseTool {
  constructor(editor) {
    super(editor);
    this.isDrawing = false;
    this._previewPending = false;
    this._strokeCancelled = false;
    this.lastPoint = null;
    registerBrushVisualizationLayers();
  }

  // ── Hover / cursor (shared by every sub-tool) ──────────────────────────────

  setCursor() {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      this.editor.tools["pointer-tool"].setCursor();
    } else {
      this.canvasController.canvas.style.cursor = "crosshair";
    }
  }

  handleHover(event) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      this.editor.tools["pointer-tool"].handleHover(event);
      return;
    }
    this.setCursor();
    if (event?.x === undefined) return;
    const p = this.sceneController.localPoint(event);
    this.sceneModel.brushHoverPoint = p;
    this.sceneModel.brushAngle = this._brushAngleForHover();
    this.canvasController.requestUpdate();
  }

  /** Subclasses override when their hover angle differs (e.g. eraser = 0). */
  _brushAngleForHover() {
    return this.brushEngine?.brushAngle ?? 30;
  }

  // ── Toast (shared) ─────────────────────────────────────────────────────────

  _showToast(msg, dedupKey = null) {
    if (dedupKey !== null && this._lastToastKey === dedupKey) return;
    this._lastToastKey = dedupKey;
    if (this.editor?.miniConsole) {
      this.editor.miniConsole.innerText = msg;
      this.editor.miniConsole.style.display = "inherit";
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        if (this.editor.miniConsole) this.editor.miniConsole.style.display = "none";
      }, 1800);
    } else {
      console.log(msg);
    }
  }

  // ── Preview scheduling (rAF throttle shared by every brush sub-tool) ──────

  _schedulePreview() {
    if (this._previewPending) return;
    this._previewPending = true;
    requestAnimationFrame(() => {
      this._previewPending = false;
      if (this.isDrawing) this._updatePreview();
    });
  }

  // ── Cancel FSM (shared base; subclasses add their own state reset) ──────

  _clearPreviewModel() {
    delete this.sceneModel.brushPreviewPath;
    delete this.sceneModel.brushPreviewCenterline;
    delete this.sceneModel.brushHoverPoint;
    delete this.sceneModel.brushEraserPath;
  }

  /** Called by Escape and by external cancel signals. */
  cancelStroke() {
    if (this.isDrawing) this._strokeCancelled = true;
    this.isDrawing = false;
    this._previewPending = false;
    this._resetStrokeState();
    this._clearPreviewModel();
    this.canvasController.requestUpdate();
  }

  /** Subclasses reset any per-stroke state here (rawPoints, sculpt deltas, etc.). */
  _resetStrokeState() {}

  // ── Settings dispatch (shared) ─────────────────────────────────────────────

  /**
   * Attach this tool to its settings store (one per storage prefix; modes
   * keep their own prefix so per-mode memory keeps working). From here on
   * the store is the single writer: every change flows through _syncFromStore,
   * synchronously inside set() — subscribers (tools, panel) see new values
   * before applySettings returns.
   */
  _initSettingsStore(prefix, fallbacks = [], defaults = BRUSH_SHARED_DEFAULTS) {
    this._store = BrushSettingsStore.for(prefix, { fallbacks, defaults });
    this._store.addEventListener("change", () => this._syncFromStore());
  }

  /** Mirror the store into live fields. Runs synchronously on every change. */
  _syncFromStore() {
    if (!this._store) return;
    const values = this._store.getAll();
    if (this.brushEngine) {
      const enginePatch = {};
      for (const key of ENGINE_SETTINGS) enginePatch[key] = values[key];
      this.brushEngine.updateOptions(enginePatch);
    }
    if ("simplify" in this) this.simplify = values.simplify;
    if ("autoUnion" in this) this.autoUnion = values.autoUnion;
    if ("eraserWidth" in this) this.eraserWidth = values.eraserWidth;
  }

  /** Engine option slice of the store snapshot (for construction). */
  _engineOptionsFromStore() {
    const values = this._store.getAll();
    const opts = {};
    for (const key of ENGINE_SETTINGS) opts[key] = values[key];
    return opts;
  }

  /** Patch engine + tool settings in one call; persists via the settings store. */
  applySettings(patch) {
    this._store?.set(patch);
    this.canvasController?.requestUpdate?.();
  }

  /** Public entry point used by the panel (duck-typed) and keyboard handlers. */
  updateSettings(patch) {
    this.applySettings(patch);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BrushStrokeToolBase — drag loop for tools that DRAW a stroke
//   (calligraphic, straight, eraser).
//
// The loop is shared. Subclasses describe only what differs:
//   _onStrokeBegin(initialPoint, initialEvent) → optional (e.g. anchor setup)
//   _buildRawSample(point, event)              → optional shift-constrain hook
//   _updatePreview()                          → geometry to render
//   _commitStroke(rawPoints)                  → async, returns nothing
// ─────────────────────────────────────────────────────────────────────────────

const KEY_STEP_WIDTH = 8;
const KEY_STEP_ANGLE = 5;
const KEY_STEP_THIN = 4;

export class BrushStrokeToolBase extends BrushDrawingToolBase {
  constructor(editor) {
    super(editor);
    // Typed-array input buffer: no per-event objects during the drag.
    // Plain points materialize only for preview (bounded) and commit (once).
    this.rawPoints = new StrokeInput();
    this.strokeLength = 0;
    this._previewCap = PREVIEW_CAP_DEFAULT;
  }

  // Subclass extension points (override as needed) ────────────────────────────

  /** Subclasses can intercept the very first click (e.g. click-click line). */
  _onStrokeBegin(_initialPoint, _initialEvent) {}

  /** Subclasses can transform the raw event into a constrained sample point. */
  _buildRawSample(point, event) {
    if (event.shiftKey && this.rawPoints.pointCount > 0) {
      // Constrain against stroke origin (first point) for accurate straight lines.
      const origin = this.rawPoints.firstPoint;
      const delta = vector.subVectors(point, origin);
      const constrained = constrainHorVerDiag(delta);
      return { x: origin.x + constrained.x, y: origin.y + constrained.y };
    }
    return point;
  }

  /** Subclasses render their own preview geometry into sceneModel. */
  _updatePreview() {}

  /** Subclasses commit the raw points (e.g. build a stroke or call the eraser). */
  async _commitStroke(_rawPoints) {}

  // Shared FSM reset for stroke tools ───────────────────────────────────────

  _resetStrokeState() {
    this.rawPoints.clear();
    this.strokeLength = 0;
  }

  // Shared drag loop ──────────────────────────────────────────────────────────

  async handleDrag(eventStream, initialEvent) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      await this.editor.tools["pointer-tool"].handleDrag(eventStream, initialEvent);
      return;
    }
    const initialPoint = this.sceneController.selectedGlyphPoint(initialEvent);
    if (!initialPoint || initialPoint.x === undefined) return;

    // Hook: subclasses may consume the first click (e.g. click-click anchor).
    if (await this._onStrokeBegin(initialPoint, initialEvent)) return;

    this.isDrawing = true;
    this._strokeCancelled = false;
    this.rawPoints.clear();
    const initialSample = this._sampleFromEvent(initialPoint, initialEvent);
    this.rawPoints.addPoint(
      initialSample.x,
      initialSample.y,
      initialSample.pressure,
      initialSample.timestamp
    );
    this.lastPoint = { ...initialPoint };
    this.strokeLength = 0;
    this._updatePreview();

    let didDrag = false;
    for await (const event of eventStream) {
      if (!this.isDrawing) continue;
      const point = this.sceneController.selectedGlyphPoint(event);
      if (!point || point.x === undefined) continue;

      const { x, y } = this._buildRawSample({ x: Math.round(point.x), y: Math.round(point.y) }, event);
      const dist = Math.hypot(x - this.lastPoint.x, y - this.lastPoint.y);
      if (dist < MIN_SAMPLE_DISTANCE && this.rawPoints.pointCount > 1) continue;

      this.strokeLength += dist;
      const sample = this._sampleFromEvent({ x, y }, event);
      this.rawPoints.addPoint(sample.x, sample.y, sample.pressure, sample.timestamp);
      this.lastPoint = { x, y };
      didDrag = true;
      this._schedulePreview();
      this._onDragSample?.({ x, y }, event);
      // Live angle/length readout while Shift-constraining. The text itself
      // is the dedup key: identical consecutive values are shown only once.
      if (event.shiftKey && this.rawPoints.pointCount > 1) {
        const origin = this.rawPoints.firstPoint;
        const sdx = x - origin.x;
        const sdy = y - origin.y;
        const angle = (((((Math.atan2(sdy, sdx) * 180) / Math.PI) % 180) + 180) % 180);
        const text = `${Math.round(angle)}° · ${Math.round(Math.hypot(sdx, sdy))}u`;
        this._showToast(text, text);
      }
    }

    if (this._strokeCancelled) {
      this.cancelStroke();
      return;
    }
    this.isDrawing = false;
    // Clear the live preview BEFORE commit: the commit may set its own
    // marker (click-click anchor) which must survive this (cf. old loop).
    this._clearPreviewModel();
    // Materialize plain points ONCE — the commit path owns this array.
    await this._commitStroke(this.rawPoints.toPoints(), { didDrag, initialEvent });
  }

  /** Build a raw sample object with the right pressure/timestamp. */
  _sampleFromEvent(point, event) {
    return {
      x: point.x,
      y: point.y,
      pressure: this.brushEngine?.usePressure ? event.pressure || 0.5 : 0.5,
      timestamp: event.timeStamp ?? Date.now(),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BrushToolBase — calligraphic / straight brush (draws a new contour)
//
// This is the "default" stroke tool. Subclasses override:
//   identifier, iconPath, brushMode
//   _buildStrokeForCommit(rawPoints)   (straight uses generateSharpContour)
// ─────────────────────────────────────────────────────────────────────────────

export class BrushToolBase extends BrushStrokeToolBase {
  static drawsContour = true;

  constructor(editor, storagePrefix, defaults = BRUSH_SHARED_DEFAULTS) {
    super(editor);
    this._defaults = { ...BRUSH_SHARED_DEFAULTS, ...defaults };
    this._initSettingsStore(storagePrefix, ["fontra.brush-v2."], this._defaults);
    this.brushEngine = new BrushEngine(this._engineOptionsFromStore());
    // Declare the tool-level mirrors, then sync every live value from the store.
    this.simplify = this._defaults.simplify ?? 0;
    this.autoUnion = this._defaults.autoUnion ?? 0;
    this.eraserWidth = this._defaults.eraserWidth ?? 32;
    this._syncFromStore();
    this._pendingAnchor = null;
  }

  get settings() {
    return snapshotSettings(this);
  }

  /** Escape also clears a pending click-click anchor (old _cancelPreview). */
  _resetStrokeState() {
    super._resetStrokeState();
    this._pendingAnchor = null;
  }

  setBrushMode(mode) {
    const targetId = BRUSH_MODE_TO_TOOL_ID[mode];
    if (targetId && targetId !== this.identifier) this.editor.setSelectedTool(targetId);
  }

  // Clear any pending click-click anchor when a real drag starts, so a drag
  // never gets swallowed by the anchor FSM.
  async handleDrag(eventStream, initialEvent) {
    this._clearPendingAnchor();
    return super.handleDrag(eventStream, initialEvent);
  }

  /** Forget the pending click-click anchor and its preview marker. */
  _clearPendingAnchor() {
    if (!this._pendingAnchor) {
      return;
    }
    this._pendingAnchor = null;
    delete this.sceneModel.brushPreviewPath;
    delete this.sceneModel.brushPreviewCenterline;
  }

  /** Remember a click as the first end of a click-click straight line. */
  _setPendingAnchor(point) {
    this._pendingAnchor = { x: point.x, y: point.y };
    const marker = new Path2D();
    marker.arc(this._pendingAnchor.x, this._pendingAnchor.y, 6, 0, Math.PI * 2);
    this.sceneModel.brushPreviewPath = marker;
    this.sceneModel.brushPreviewCenterline = null;
    this.sceneModel.brushAngle = this.brushEngine.brushAngle;
    this.canvasController.requestUpdate();
    this._showToast(
      `Anchor set at ${Math.round(this._pendingAnchor.x)}, ${Math.round(this._pendingAnchor.y)} — click again to commit line`,
      "anchor"
    );
  }

  // Click-without-drag: dot stamp (or anchor if Shift was held on release).
  async _commitStroke(rawPoints, { didDrag, initialEvent } = {}) {
    // Click (no drag): implement click-click straight line by default.
    if (!didDrag) {
      // Alt+click → dot stamp (modifier-based, since click-click defaults to anchors).
      if (initialEvent?.altKey && rawPoints?.[0]) {
        this._clearPendingAnchor();
        await this._commitDot(rawPoints[0]);
        return;
      }
      // Second click while an anchor is pending → commit the straight stroke.
      if (this._pendingAnchor && rawPoints?.[0]) {
        const anchor = this._pendingAnchor;
        this._clearPendingAnchor();
        const pts = [
          { x: anchor.x, y: anchor.y, pressure: 0.5, timestamp: Date.now() },
          { x: rawPoints[0].x, y: rawPoints[0].y, pressure: 0.5, timestamp: Date.now() },
        ];
        const contour = this._buildStrokeForCommit(pts);
        if (!contour) {
          this._resetStrokeState();
          this._showToast(translate("edit-tools-brush.stroke-too-small"), "stroke-small");
          return;
        }
        this._resetStrokeState();
        await this._appendContourToGlyph(contour, "edit-tools-brush.undo.add-stroke");
        return;
      }
      // Shift+click → set an anchor (legacy, explicit).
      if (initialEvent?.shiftKey && rawPoints?.[0]) {
        this._setPendingAnchor(rawPoints[0]);
        return;
      }
      // Default first click → set an anchor (click-click straight line).
      if (rawPoints?.[0]) {
        this._setPendingAnchor(rawPoints[0]);
      }
      return;
    }
    this._clearPendingAnchor();
    if (rawPoints.length < 2) {
      this._resetStrokeState();
      return;
    }
    const contour = this._buildStrokeForCommit(rawPoints);
    if (!contour) {
      this._resetStrokeState();
      this._showToast(translate("edit-tools-brush.stroke-too-small"), "stroke-small");
      return;
    }
    this._resetStrokeState();
    await this._appendContourToGlyph(contour, "edit-tools-brush.undo.add-stroke");
  }

  /** Default cubic-fitted commit. The straight tool overrides this. */
  _buildStrokeForCommit(rawPoints) {
    try {
      const contour = this.brushEngine.generateStrokeContour(rawPoints);
      if (!contour || contour.points.length < 4) return null;
      const anchors = new Set(
        contour.points.filter((p) => !p.type).map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
      );
      if (anchors.size < 3) return null;
      return contour;
    } catch (e) {
      console.warn("brush build error", e);
      return null;
    }
  }

  async _commitDot(point) {
    this._resetStrokeState();
    const rounded = { x: Math.round(point.x), y: Math.round(point.y) };
    const contour = this.brushEngine.generateDotContour(rounded);
    if (!contour) return;
    this._resetStrokeState();
    await this._appendContourToGlyph(contour, "edit-tools-brush.undo.add-dot");
  }

  _brushAngleForHover() {
    return this.brushEngine.brushAngle;
  }

  _updatePreview() {
    if (this.rawPoints.pointCount < 2) {
      const p = this.rawPoints.firstPoint;
      if (!p) return;
      const r = Math.max(2, this.brushEngine.minWidth / 4);
      const path = new Path2D();
      path.arc(p.x, p.y, r, 0, Math.PI * 2);
      this.sceneModel.brushPreviewPath = path;
      this.sceneModel.brushPreviewCenterline = null;
      this.sceneModel.brushAngle = this.brushEngine.brushAngle;
      this.canvasController.requestUpdate();
      return;
    }
    try {
      const t0 = performance.now();
      const previewPts = this._previewSamples();
      const { outlinePoints, centerlinePoints } = this.brushEngine.generateStroke(previewPts);
      this.sceneModel.brushPreviewPath = path2DFromPolygon(outlinePoints);
      this.sceneModel.brushPreviewCenterline = path2DFromPoints(centerlinePoints);
      this.sceneModel.brushAngle = this.brushEngine.brushAngle;
      this.canvasController.requestUpdate();
      this._adaptPreviewCap(performance.now() - t0);
    } catch (e) {
      console.warn("brush preview error", e);
    }
  }

  /**
   * Bounded preview samples straight from the typed buffer. Distance-based
   * (not index-stride) so long curved strokes keep their shape; short
   * strokes (≤ cap) render at full fidelity.
   */
  _previewSamples() {
    return this.rawPoints.resampled(this.rawPoints.minDistForCap(this._previewCap));
  }

  /** Fold the measured frame cost back into the sample cap (8 ms budget). */
  _adaptPreviewCap(elapsedMs) {
    this._previewCap = adaptPreviewCap(this._previewCap, elapsedMs);
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  handleKeyDown(event) {
    if (!this.isActive || !this.sceneModel.selectedGlyph?.isEditing) return;
    const { key, code, shiftKey } = event;
    if (shiftKey && (code === "BracketLeft" || code === "BracketRight")) {
      const delta = code === "BracketLeft" ? -KEY_STEP_THIN : KEY_STEP_THIN;
      this.applySettings({ minWidth: this.brushEngine.minWidth + delta });
      this._showToast(
        `Thin ${Math.round(this.brushEngine.minWidth)} — Size ${Math.round(this.brushEngine.maxWidth)}`,
        "thin-size"
      );
      event.preventDefault();
      return;
    }
    switch (key) {
      case "[":
        this.applySettings({ maxWidth: this.brushEngine.maxWidth - KEY_STEP_WIDTH });
        this._showToastSize();
        event.preventDefault();
        break;
      case "]":
        this.applySettings({ maxWidth: this.brushEngine.maxWidth + KEY_STEP_WIDTH });
        this._showToastSize();
        event.preventDefault();
        break;
      case ",":
        this.applySettings({ brushAngle: this.brushEngine.brushAngle - KEY_STEP_ANGLE });
        this._showToastSize();
        event.preventDefault();
        break;
      case ".":
        this.applySettings({ brushAngle: this.brushEngine.brushAngle + KEY_STEP_ANGLE });
        this._showToastSize();
        event.preventDefault();
        break;
      case "Escape":
        if (this.isDrawing || this._pendingAnchor) {
          this.cancelStroke();
          event.preventDefault();
        }
        break;
    }
  }

  _showToastSize() {
    this._showToast(
      `Size ${Math.round(this.brushEngine.maxWidth)} — Angle ${Math.round(this.brushEngine.brushAngle)}°`,
      `s${Math.round(this.brushEngine.maxWidth)}-a${Math.round(this.brushEngine.brushAngle)}`
    );
  }

  // ── Commit + auto-union (shared by calligraphic and straight) ──────────────

  async _appendContourToGlyph(unpackedContour, undoKey) {
    const varPacked = VarPackedPath.fromUnpackedContours([unpackedContour]).roundCoordinates();
    const bounds = varPacked.getControlBounds();
    if (!bounds || bounds.xMax - bounds.xMin < 1 && bounds.yMax - bounds.yMin < 1) {
      this._showToast(translate("edit-tools-brush.stroke-too-small"), "stroke-small");
      return;
    }

    // Auto-union runs BEFORE the transaction: Backend calls are async and must
    // never run inside the synchronous edit callback.
    let useUnion = this.autoUnion === 1;
    let unionLayerPaths = null;
    let unionFailed = false;
    if (useUnion) {
      try {
        const positionedGlyph = this.sceneController.sceneModel.getSelectedPositionedGlyph?.();
        const layers = positionedGlyph
          ? this.sceneController.getEditingLayerFromGlyphLayers(positionedGlyph.varGlyph.glyph.layers)
          : null;
        if (layers && Object.keys(layers).length) {
          unionLayerPaths = {};
          for (const [layerName, layerGlyph] of Object.entries(layers)) {
            const combined = layerGlyph.path.clone();
            combined.appendPath(varPacked);
            try {
              unionLayerPaths[layerName] = await Backend.unionPath(combined);
            } catch {
              // Backend unreachable: fall back to plain append for this layer.
              unionFailed = true;
              const fallback = layerGlyph.path.clone();
              fallback.appendPath(varPacked);
              unionLayerPaths[layerName] = fallback;
            }
          }
        } else {
          unionFailed = true;
        }
      } catch {
        unionFailed = true;
        unionLayerPaths = null;
      }
    }

    await this.sceneController.editGlyphAndRecordChanges(
      (glyph) => {
        const editLayerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(glyph.layers);
        if (useUnion && unionLayerPaths) {
          for (const [layerName, newPath] of Object.entries(unionLayerPaths)) {
            if (editLayerGlyphs[layerName]) editLayerGlyphs[layerName].path = newPath;
          }
          // Union reorders/renumbers contours — pre-union indices are meaningless.
          this.sceneController.selection = new Set();
        } else {
          if (useUnion) unionFailed = true;
          const primary = Object.values(editLayerGlyphs)[0];
          const firstIndex = primary ? primary.path.numPoints : 0;
          for (const layerGlyph of Object.values(editLayerGlyphs)) layerGlyph.path.appendPath(varPacked);
          const newSel = new Set();
          for (let i = 0; i < varPacked.numPoints; i++) {
            const pt = varPacked.getPoint(i);
            if (!pt.type) newSel.add(`point/${firstIndex + i}`);
          }
          this.sceneController.selection = newSel;
        }
        return translate(undoKey);
      },
      undefined,
      true
    );
    this.canvasController.requestUpdate();

    if (useUnion && unionFailed) {
      this._showToast(translate("edit-tools-brush.union-unavailable-fallback"), "union-fallback");
    }
    const { total, smooth } = countAnchors(unpackedContour);
    if (total > 0) this._showToast(`Stroke: ${total} anchors (${smooth} smooth)`, `s${total}-${smooth}`);
  }

  activate() {
    super.activate();
    this.setCursor();
    this.sceneModel.brushAngle = this.brushEngine.brushAngle;
    this.canvasController.requestUpdate();
  }

  deactivate() {
    super.deactivate();
    this.cancelStroke();
    delete this.sceneModel.brushAngle;
    this.canvasController.requestUpdate();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers (used by preview rendering and the panel)
// ─────────────────────────────────────────────────────────────────────────────

export function path2DFromPolygon(points) {
  const path = new Path2D();
  if (points.length < 3) return path;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
  path.closePath();
  return path;
}

export function path2DFromPoints(points) {
  const path = new Path2D();
  if (points.length < 2) return path;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
  return path;
}

export function countAnchors(contour) {
  if (!contour?.points) return { total: 0, smooth: 0 };
  let total = 0, smooth = 0;
  for (const pt of contour.points) {
    if (!pt.type) {
      total++;
      if (pt.smooth) smooth++;
    }
  }
  return { total, smooth };
}

// Re-exports for backward compatibility with downstream imports.
export { BRUSH_SHARED_DEFAULTS, BRUSH_TOOL_BOUNDS, DEFAULT_BRUSH_SETTINGS, FLOAT_SETTINGS };
