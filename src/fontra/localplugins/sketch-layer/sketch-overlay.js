// Pointer-input overlay for the Sketch Layer plugin.
//
// While drawing mode is on, a transparent div stacked just above the canvas
// captures pointer events and records strokes in glyph coordinates. When it
// is off, the overlay is inert (pointer-events: none) and the editor works
// exactly as before.
//
// Wheel events are re-dispatched to the canvas so zoom/pan keeps working
// while drawing. The synthetic event is dispatched synchronously from the
// overlay's own wheel handler, which means the canvas controller's
// handleWheel() runs during the target phase of the synthetic event — before
// the document-level scroll blocker records any target — so
// _shouldBlockScroll() passes and the original overlay-targeted event never
// taints the blocker.

import {
  state,
  addStroke,
  capStrokePoints,
  schedulePersist,
} from "./sketch-store.js";

const BADGE_TEXT = "Sketch mode — draw on the canvas · Esc or S to exit";

export class SketchOverlay {
  constructor(editor) {
    this.editor = editor;
    this.element = document.createElement("div");

    const style = this.element.style;
    style.position = "absolute";
    style.inset = "0";
    // No z-index: the overlay is inserted right after the canvas, so DOM
    // order puts it above the canvas but below the metric handles, the
    // mini console, and the tool/tab overlays — all of which stay usable.
    style.touchAction = "none";
    style.pointerEvents = "none";
    style.cursor = "crosshair";
    style.userSelect = "none";
    style.webkitUserSelect = "none";

    this._badge = document.createElement("div");
    const badgeStyle = this._badge.style;
    badgeStyle.position = "absolute";
    badgeStyle.left = "50%";
    badgeStyle.bottom = "14px";
    badgeStyle.transform = "translateX(-50%)";
    badgeStyle.display = "none";
    badgeStyle.whiteSpace = "nowrap";
    badgeStyle.fontSize = "11px";
    badgeStyle.fontFamily = "inherit";
    badgeStyle.color = "var(--foreground-color, #000)";
    badgeStyle.backgroundColor =
      "color-mix(in srgb, var(--background-color, #fff) 80%, transparent)";
    badgeStyle.border = "1px solid var(--border-color, #8888)";
    badgeStyle.borderRadius = "6px";
    badgeStyle.padding = "3px 10px";
    badgeStyle.pointerEvents = "none";
    badgeStyle.userSelect = "none";
    this._badge.textContent = BADGE_TEXT;
    this.element.appendChild(this._badge);

    const canvas = editor.canvasController.canvas;
    const parent = canvas.parentElement;
    if (parent?.insertBefore) {
      parent.insertBefore(this.element, canvas.nextSibling);
    } else {
      parent?.appendChild(this.element);
    }

    this._drawing = false;
    this._active = false;
    this._glyph = null;
    this.onModeChange = null;

    this.element.addEventListener("pointerdown", (event) =>
      this._onPointerDown(event)
    );
    this.element.addEventListener("pointermove", (event) =>
      this._onPointerMove(event)
    );
    this.element.addEventListener("pointerup", (event) =>
      this._endStroke(event)
    );
    this.element.addEventListener("pointercancel", (event) =>
      this._endStroke(event)
    );
    this.element.addEventListener(
      "wheel",
      (event) => this._onWheel(event),
      { passive: false }
    );
    this.element.addEventListener("contextmenu", (event) => {
      if (this._active) {
        event.preventDefault();
      }
    });
    this.element.addEventListener("keydown", (event) => {
      if (this._active && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.editor.__sketchLayer?.setMode(false);
      }
    });
  }

  /** The plugin controller (set by start.js after construction). */
  get plugin() {
    return this.editor.__sketchLayer;
  }

  setMode(onOff) {
    this._active = !!onOff;
    this.element.style.pointerEvents = onOff ? "auto" : "none";
    this._badge.style.display = onOff ? "block" : "none";
    if (!onOff) {
      this._cancelStroke();
    }
  }

  _cancelStroke() {
    if (this._drawing) {
      this._drawing = false;
      state.activeStroke = null;
      this.editor.canvasController.requestUpdate();
    }
  }

  // ------------------------------------------------------------------
  // Coordinate conversion

  _scenePoint(event) {
    const canvasController = this.editor.canvasController;
    const rect = canvasController.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return {
      x: (x - canvasController.origin.x) / canvasController.magnification,
      y: -(y - canvasController.origin.y) / canvasController.magnification,
    };
  }

  /**
   * The positioned glyph under a scene-space point: inside-bounds candidates
   * are preferred (nearest center), with a nearest-center fallback so margin
   * doodles still attach to a glyph and follow it.
   */
  _glyphForScenePoint(point) {
    const lines = this.editor.sceneController?.sceneModel?.positionedLines || [];
    let best = null;
    let bestDistance = Infinity;
    let bestInside = false;
    for (const line of lines) {
      for (const glyph of line.glyphs || []) {
        const bounds = glyph.bounds;
        if (!bounds) {
          continue;
        }
        const centerX = (bounds.xMin + bounds.xMax) / 2;
        const centerY = (bounds.yMin + bounds.yMax) / 2;
        const distance = Math.hypot(point.x - centerX, point.y - centerY);
        const inside =
          point.x >= bounds.xMin &&
          point.x <= bounds.xMax &&
          point.y >= bounds.yMin &&
          point.y <= bounds.yMax;
        if (
          (inside && !bestInside) ||
          (inside === bestInside && distance < bestDistance)
        ) {
          best = glyph;
          bestDistance = distance;
          bestInside = inside;
        }
      }
    }
    return best;
  }

  _toLocal(scenePoint, glyph) {
    return { x: scenePoint.x - glyph.x, y: scenePoint.y - glyph.y };
  }

  // ------------------------------------------------------------------
  // Pointer handling

  _onPointerDown(event) {
    if (!this._active || !event.isPrimary) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.element.setPointerCapture?.(event.pointerId);
    // Keep keyboard behavior identical to editing on the canvas.
    this.editor.canvasController.canvas.focus?.({ preventScroll: true });

    const scenePoint = this._scenePoint(event);
    const glyph = this._glyphForScenePoint(scenePoint);
    if (!glyph) {
      return; // no glyphs on the canvas
    }
    this._drawing = true;
    this._glyph = glyph;
    const local = this._toLocal(scenePoint, glyph);
    state.activeStroke = {
      glyphName: glyph.glyphName,
      color: state.color,
      width: state.width,
      points: [[local.x, local.y]],
    };
    this.editor.canvasController.requestUpdate();
  }

  _onPointerMove(event) {
    if (!this._drawing) {
      return;
    }
    event.preventDefault();
    const stroke = state.activeStroke;
    if (!stroke) {
      return;
    }
    const scenePoint = this._scenePoint(event);
    const local = this._toLocal(scenePoint, this._glyph);
    const points = stroke.points;
    const last = points[points.length - 1];
    const magnification = this.editor.canvasController.magnification || 1;
    const minDist = Math.min(8, Math.max(1.5, 3 / magnification));
    if (Math.hypot(local.x - last[0], local.y - last[1]) < minDist) {
      return;
    }
    points.push([local.x, local.y]);
    if (points.length > 4000) {
      stroke.points = capStrokePoints(points, minDist);
    }
    this.editor.canvasController.requestUpdate();
  }

  _endStroke(event) {
    if (!this._drawing) {
      return;
    }
    this._drawing = false;
    const stroke = state.activeStroke;
    state.activeStroke = null;
    if (stroke && stroke.points.length) {
      if (stroke.points.length === 1) {
        // A tap: widen it into a small dot.
        const [x, y] = stroke.points[0];
        stroke.points.push([x + stroke.width / 6, y]);
      }
      addStroke(state.projectId, stroke.glyphName, stroke);
      schedulePersist(state.projectId);
      this.plugin?.refreshStatus?.();
    }
    this.editor.canvasController.requestUpdate();
  }

  // ------------------------------------------------------------------
  // Wheel forwarding

  _onWheel(event) {
    if (!this._active) {
      return;
    }
    event.preventDefault();
    const canvas = this.editor.canvasController.canvas;
    if (!canvas.dispatchEvent) {
      return;
    }
    const forwarded = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
    });
    // Chrome keeps the legacy wheelDelta* properties off synthetic events;
    // the canvas controller uses them for scroll-speed detection.
    Object.defineProperty(forwarded, "wheelDeltaX", {
      value: event.wheelDeltaX || 0,
    });
    Object.defineProperty(forwarded, "wheelDeltaY", {
      value: event.wheelDeltaY || 0,
    });
    canvas.dispatchEvent(forwarded);
  }
}
