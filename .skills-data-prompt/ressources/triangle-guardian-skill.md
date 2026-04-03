# Triangle Guardian — Fontra Plugin
## Prompt & Skill Specification

> **Source principle**: Adobe *Designing Multiple Master Typefaces* (1997), Appendix A, p. 63 —
> *"As a rule of thumb, the control points of a curve segment should fall inside an imaginary
> triangle formed by the two end points and the lines that connect each end point to its
> associated control point, extended to their intersection."*

---

## 1. What this plugin does

Triangle Guardian is a **visualization layer** for the Fontra variable-font editor.
For every cubic Bézier curve segment in the active glyph, it constructs the imaginary
triangle described in Adobe's point-placement guidelines and checks whether both off-curve
(control) points lie inside it. Segments that violate the rule are flagged visually so the
designer can correct them before they cause rasterization artifacts or interpolation
instability.

The plugin has two modes:

| Mode | Trigger | Audience |
|---|---|---|
| **Selection mode** | Overlay appears on hover or when a segment / its points are selected | Production use |
| **Educational mode** | Overlay shown on all segments simultaneously | Learning, onboarding, review |

---

## 2. Mathematical specification

### 2.1 Triangle construction for a simple arc

Given a cubic Bézier segment defined by four points:

```
P0  — on-curve start (end point A)
P1  — off-curve (control point associated with P0)
P2  — off-curve (control point associated with P3)
P3  — on-curve end (end point B)
```

Construct the triangle as follows:

1. **Ray A**: the ray originating at `P0` passing through `P1`, extended to infinity.
2. **Ray B**: the ray originating at `P3` passing through `P2`, extended to infinity.
3. **Apex** `V`: the intersection of Ray A and Ray B.
4. **Triangle vertices**: `P0`, `P3`, `V`.

A control point is **inside** the triangle if and only if it lies within or on the boundary
of the triangle `P0–V–P3` (use a small epsilon for floating-point tolerance, e.g. `±0.5`
font units).

**Intersection formula** (Ray A: `P0 + t*(P1-P0)`, Ray B: `P3 + s*(P2-P3)`):

```
dx = P3.x - P0.x,  dy = P3.y - P0.y
d1 = P1 - P0,      d2 = P2 - P3

denom = d1.x * d2.y - d1.y * d2.x

// Rays are parallel (denom ≈ 0) → no triangle, skip overlay
t = (dx * d2.y - dy * d2.x) / denom

V = { x: P0.x + t * d1.x,  y: P0.y + t * d1.y }
```

### 2.2 Point-in-triangle test

Use the sign-of-cross-product method:

```js
function sign(ax, ay, bx, by, cx, cy) {
  return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(hasNeg && hasPos);
}
```

Apply with triangle vertices `P0`, `P3`, `V` and test each of `P1` and `P2` separately.

### 2.3 S-curve detection and dual-triangle handling

An **S-curve** occurs when the two handle rays diverge rather than converge — i.e. `denom`
has the correct sign but `t < 0` (the apex is "behind" both end points, meaning the handles
cross). In this case the single-triangle model does not apply.

Detection:

```js
const isSCurve = t < 0 || s < 0;   // apex behind one or both origin points
```

For S-curves, draw **two separate triangles**:

- **Triangle A**: `P0`, midpoint `M`, `P1` — where `M` is the curve's inflection point
  (approximated as the midpoint of the segment for display purposes).
- **Triangle B**: `P3`, midpoint `M`, `P2`.

Visually distinguish S-curve triangles from simple-arc triangles (see §4 Visual design).

### 2.4 Degenerate cases to skip

| Condition | Action |
|---|---|
| `P0 === P3` (zero-length segment) | Skip |
| `P0 === P1` or `P3 === P2` (handle has zero length) | Skip — no meaningful ray |
| `\|denom\| < 1e-6` (parallel handles) | Skip — rays never intersect |
| Straight line segment (both handles colinear with end points) | Skip — not a curve |

---

## 3. Fontra plugin architecture

### 3.1 File layout

```
triangle-guardian/
├── plugin.json
├── start.js
├── triangle-guardian-panel.js
├── triangle-guardian-layer.js   ← visualization logic lives here
└── icon.svg
```

### 3.2 `plugin.json`

```json
{
  "name": "Triangle Guardian",
  "identifier": "com.fontra.plugins.triangle-guardian",
  "version": "1.0.0",
  "description": "Visualizes the control-point triangle guideline on Bézier segments.",
  "author": "Your Name",
  "license": "MIT",
  "entries": {
    "editor": "start.js"
  }
}
```

### 3.3 `start.js`

```js
import TriangleGuardianPanel from "./triangle-guardian-panel.js";
import "./triangle-guardian-layer.js";   // registers the viz layer at import time

export function start(editorController, pluginPath) {
  TriangleGuardianPanel.prototype.iconPath = `${pluginPath}/icon.svg`;
  customElements.define("triangle-guardian-panel", TriangleGuardianPanel);
  editorController.addSidebarPanel(
    new TriangleGuardianPanel(editorController),
    "right"
  );
}
```

---

## 4. Visualization layer — `triangle-guardian-layer.js`

### 4.1 Registration

```js
import { registerVisualizationLayerDefinition } from
  "fontra/editor/visualization-layer-definitions.js";

registerVisualizationLayerDefinition({
  identifier:     "com.fontra.plugins.triangle-guardian.overlay",
  name:           "Triangle guardian",
  selectionMode:  "editing",
  userSwitchable: true,
  defaultOn:      true,
  zIndex:         200,
  screenParameters: {
    strokeWidth:       1,
    triangleOpacity:   0.18,
    violationColor:    "#E24B4A",
    okColor:           "#1D9E75",
    sCurveColor:       "#185FA5",
    apexRadius:        3,
    dashLength:        5,
    dashGap:           4,
  },
  draw(context, positionedGlyph, parameters, model, controller) {
    // implementation below
  }
});
```

### 4.2 `draw()` implementation outline

```js
draw(context, positionedGlyph, parameters, model, controller) {
  const glyph = positionedGlyph.glyph;
  if (!glyph || !glyph.path) return;

  const path       = glyph.path;
  const educMode   = model.educationalMode ?? false;
  const showAll    = model.showAllSegments ?? false;
  const selectedPts = controller?.selection ?? new Set();

  // Iterate contours
  for (const contour of iterContours(path)) {
    const segments = extractCubicSegments(contour);

    for (const seg of segments) {
      const { P0, P1, P2, P3, segmentIndex } = seg;

      // Determine visibility
      const isSelected = educMode || showAll
        || isSegmentOrPointSelected(selectedPts, segmentIndex, contour);
      if (!isSelected) continue;

      // Detect S-curve
      const { apex, isSCurve } = computeApex(P0, P1, P2, P3);
      if (!apex && !isSCurve) continue;   // degenerate

      // Check violations
      const p1Outside = apex && !pointInTriangle(P1, P0, P3, apex);
      const p2Outside = apex && !pointInTriangle(P2, P0, P3, apex);

      // Draw
      context.save();
      if (isSCurve) {
        drawSCurveTriangles(context, P0, P1, P2, P3, parameters);
      } else {
        drawSimpleTriangle(context, P0, P1, P2, P3, apex,
                           p1Outside, p2Outside, parameters);
      }
      context.restore();
    }
  }
}
```

### 4.3 `drawSimpleTriangle()`

```js
function drawSimpleTriangle(ctx, P0, P1, P2, P3, apex,
                             p1Outside, p2Outside, p) {
  const anyViolation = p1Outside || p2Outside;
  const fillColor    = anyViolation ? p.violationColor : p.okColor;

  // Dashed triangle fill (very light)
  ctx.beginPath();
  ctx.moveTo(P0.x, P0.y);
  ctx.lineTo(apex.x, apex.y);
  ctx.lineTo(P3.x, P3.y);
  ctx.closePath();
  ctx.globalAlpha = p.triangleOpacity;
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Dashed triangle stroke
  ctx.setLineDash([p.dashLength, p.dashGap]);
  ctx.strokeStyle = fillColor;
  ctx.lineWidth   = p.strokeWidth;
  ctx.stroke();
  ctx.setLineDash([]);

  // Apex dot
  ctx.beginPath();
  ctx.arc(apex.x, apex.y, p.apexRadius, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();

  // Handle lines (thin dotted)
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = fillColor;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = p.strokeWidth * 0.7;
  drawLine(ctx, P0, apex);
  drawLine(ctx, P3, apex);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Flag violating control points
  if (p1Outside) drawViolationMarker(ctx, P1, p);
  if (p2Outside) drawViolationMarker(ctx, P2, p);
}
```

### 4.4 `drawViolationMarker()`

Draws a red circle + cross on the offending control point:

```js
function drawViolationMarker(ctx, pt, p) {
  const r = p.apexRadius * 1.8;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = p.violationColor;
  ctx.lineWidth   = p.strokeWidth * 1.5;
  ctx.stroke();
  // cross
  ctx.beginPath();
  ctx.moveTo(pt.x - r * 0.6, pt.y - r * 0.6);
  ctx.lineTo(pt.x + r * 0.6, pt.y + r * 0.6);
  ctx.moveTo(pt.x + r * 0.6, pt.y - r * 0.6);
  ctx.lineTo(pt.x - r * 0.6, pt.y + r * 0.6);
  ctx.strokeStyle = p.violationColor;
  ctx.stroke();
}
```

### 4.5 S-curve rendering

For S-curves, draw two half-triangles with the blue (`sCurveColor`) ramp and a label:

```js
function drawSCurveTriangles(ctx, P0, P1, P2, P3, p) {
  const M = { x: (P0.x+P3.x)/2, y: (P0.y+P3.y)/2 };  // inflection approx

  // Triangle A: P0 — M — P1
  drawHalfTriangle(ctx, P0, M, P1, p.sCurveColor, p);
  // Triangle B: P3 — M — P2
  drawHalfTriangle(ctx, P3, M, P2, p.sCurveColor, p);

  // S-curve label at midpoint
  ctx.font = `${Math.round(9 / ctx.getTransform().a)}px sans-serif`;
  ctx.fillStyle  = p.sCurveColor;
  ctx.globalAlpha = 0.7;
  ctx.textAlign  = "center";
  ctx.fillText("S", M.x, M.y - 6);
  ctx.globalAlpha = 1;
}
```

---

## 5. Sidebar panel — `triangle-guardian-panel.js`

### 5.1 State model

```js
const DEFAULTS = {
  enabled:          true,
  educationalMode:  false,
  showAllSegments:  false,
  showSCurveLabels: true,
  highlightViolations: true,
  triangleOpacity:  18,   // 0–100 maps to 0.0–1.0
};
```

### 5.2 Panel layout

The panel contains three sections:

**Section 1 — Mode toggles**

| Control | Binding | Description |
|---|---|---|
| Toggle: *Selection mode* / *Show all* | `showAllSegments` | Show triangles on all segments or only selected |
| Toggle: *Educational mode* | `educationalMode` | Locks to show-all, adds "S" labels, brightens opacity |
| Toggle: *Highlight violations* | `highlightViolations` | Red markers on off-canvas control points |
| Toggle: *S-curve labels* | `showSCurveLabels` | Show "S" badge at inflection point |

**Section 2 — Appearance**

| Control | Binding | Default |
|---|---|---|
| Opacity slider (0–100) | `triangleOpacity` | 18 |

**Section 3 — Violation summary (live)**

A `UIList` that lists all segments in the current glyph where at least one control point
falls outside the triangle. Columns: `Contour`, `Segment`, `Issue`.
Clicking a row selects the offending segment in the editor.

### 5.3 Panel skeleton

```js
import Panel from "fontra/editor/panel.js";
import { ObservableController } from "fontra/core/observable-object.js";
import { div, label, input, span } from "fontra/core/html-utils.js";
import { UIList } from "fontra/web-components/ui-list.js";

export default class TriangleGuardianPanel extends Panel {
  identifier = "triangle-guardian-panel";
  iconPath   = "/images/placeholder.svg";

  static styles = `
    #tg-panel { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    .tg-section { display: flex; flex-direction: column; gap: 6px; }
    .tg-section-title {
      font-size: 11px; font-weight: 500; text-transform: uppercase;
      letter-spacing: .05em; color: var(--ui-element-foreground-color);
      opacity: .55; padding-bottom: 2px;
      border-bottom: 0.5px solid var(--ui-element-background-color-1);
    }
    .tg-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .tg-label { font-size: 12px; color: var(--ui-element-foreground-color); }
    .tg-violation-list { min-height: 80px; }
    .tg-empty { font-size: 11px; opacity: .5; padding: 8px 0; text-align: center; }
  `;

  constructor(editorController) {
    super(editorController);
    // Re-render violation list on glyph or edit change
    this.editorController.sceneSettingsController.addKeyListener(
      "selectedGlyphName",
      () => this._scheduleViolationScan()
    );
  }

  getContentElement() {
    this.controller = new ObservableController({ ...DEFAULTS });
    this.controller.synchronizeWithLocalStorage("triangle-guardian.");

    // Sync all model keys → canvas update
    Object.keys(DEFAULTS).forEach(key => {
      this.controller.addKeyListener(key, () => {
        this.editorController.canvasController.requestUpdate();
        if (key !== "triangleOpacity") this._scheduleViolationScan();
      });
    });

    this._violationList = new UIList();
    this._violationList.className = "tg-violation-list";
    this._violationList.columnDescriptions = [
      { key: "contour",  title: "Contour", width: "48px" },
      { key: "segment",  title: "Seg",     width: "36px" },
      { key: "issue",    title: "Issue" },
    ];

    this._scheduleViolationScan();

    return div({ id: "tg-panel" }, [
      this._buildModeSection(),
      this._buildAppearanceSection(),
      this._buildViolationsSection(),
    ]);
  }

  // ... _buildModeSection(), _buildAppearanceSection(),
  //     _buildViolationsSection(), _scheduleViolationScan()
  //     are implemented below
}
```

### 5.4 `_scheduleViolationScan()`

Debounce pattern — avoids redundant scans during rapid edits:

```js
async _scheduleViolationScan() {
  if (this._pending) return;
  this._pending = this._runViolationScan();
  await this._pending;
  delete this._pending;
}

async _runViolationScan() {
  const glyphName = this.editorController.sceneSettings.selectedGlyphName;
  if (!glyphName) { this._violationList.setItems([]); return; }

  const glyph = await this.editorController.fontController
    .getGlyph(glyphName);
  if (!glyph) return;

  const violations = [];
  for (const [ci, contour] of iterContours(glyph.path).entries()) {
    for (const seg of extractCubicSegments(contour)) {
      const { apex, isSCurve } = computeApex(seg.P0, seg.P1, seg.P2, seg.P3);
      if (isSCurve) {
        violations.push({
          contour: ci, segment: seg.segmentIndex, issue: "S-curve"
        });
        continue;
      }
      if (!apex) continue;
      const p1Out = !pointInTriangle(seg.P1, seg.P0, seg.P3, apex);
      const p2Out = !pointInTriangle(seg.P2, seg.P0, seg.P3, apex);
      if (p1Out || p2Out) violations.push({
        contour: ci,
        segment: seg.segmentIndex,
        issue:   [p1Out && "handle A", p2Out && "handle B"].filter(Boolean).join(", ")
      });
    }
  }

  this._violationList.setItems(
    violations.length
      ? violations.map(v => ({
          contour: `c${v.contour}`,
          segment: `s${v.segment}`,
          issue:   v.issue
        }))
      : [{ contour: "—", segment: "—", issue: "No violations" }]
  );
}
```

---

## 6. Shared geometry helpers

These are imported by both the layer and the panel:

```js
// triangle-guardian-geometry.js

export function* iterContours(path) {
  // yields arrays of {x,y,type} where type is "line"|"offcurve"|"curve"
  // (wrap path.contours or path.getContourList() per Fontra's path API)
  for (const contour of path.contours ?? []) {
    yield contour;
  }
}

export function extractCubicSegments(contour) {
  // Returns array of { P0, P1, P2, P3, segmentIndex }
  // Only cubic (off-curve, off-curve) segments are returned.
  // Skips line segments and quadratic curves.
  const pts = contour.points;
  const segs = [];
  let i = 0, si = 0;
  while (i < pts.length) {
    const p0 = pts[i % pts.length];
    const p1 = pts[(i + 1) % pts.length];
    const p2 = pts[(i + 2) % pts.length];
    const p3 = pts[(i + 3) % pts.length];
    if (p1?.type === "offcurve" && p2?.type === "offcurve") {
      segs.push({ P0: p0, P1: p1, P2: p2, P3: p3, segmentIndex: si++ });
      i += 3;
    } else {
      i += 1; si++;
    }
  }
  return segs;
}

export function computeApex(P0, P1, P2, P3) {
  const d1x = P1.x - P0.x, d1y = P1.y - P0.y;
  const d2x = P2.x - P3.x, d2y = P2.y - P3.y;
  const denom = d1x * d2y - d1y * d2x;

  if (Math.abs(denom) < 1e-6) return { apex: null, isSCurve: false };

  const dx = P3.x - P0.x, dy = P3.y - P0.y;
  const t = (dx * d2y - dy * d2x) / denom;
  const s = (dx * d1y - dy * d1x) / denom;

  const isSCurve = t < 0 || s < 0;
  const apex = { x: P0.x + t * d1x, y: P0.y + t * d1y };

  return { apex, isSCurve };
}

export function pointInTriangle(pt, A, B, C, eps = 0.5) {
  function sign(ax, ay, bx, by, cx, cy) {
    return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  }
  const d1 = sign(pt.x, pt.y, A.x, A.y, B.x, B.y);
  const d2 = sign(pt.x, pt.y, B.x, B.y, C.x, C.y);
  const d3 = sign(pt.x, pt.y, C.x, C.y, A.x, A.y);
  const hasNeg = d1 < -eps || d2 < -eps || d3 < -eps;
  const hasPos = d1 >  eps || d2 >  eps || d3 >  eps;
  return !(hasNeg && hasPos);
}
```

---

## 7. Visual design specification

### Color palette

| Role | Light mode | Dark mode |
|---|---|---|
| Simple arc — ok | `#1D9E75` (teal) | same |
| Simple arc — violation | `#E24B4A` (red) | same |
| S-curve | `#185FA5` (blue) | same |
| Triangle fill alpha | 0.18 | 0.22 |
| Apex dot | same as stroke color | same |
| Handle extension line | 70 % opacity, same color | same |

### Rendering layers (draw order within the triangle overlay)

1. Triangle fill (very translucent)
2. Dashed triangle stroke
3. Handle extension lines (dotted, 70 % opacity)
4. Apex dot
5. Violation markers (on top of everything)
6. S-curve "S" label

### Coordinate system note

Fontra's canvas context has **Y-axis flipped** (+Y is up in font coordinates).
All point coordinates from the glyph path are already in font units.
`context.font` sizes must be divided by `context.getTransform().a` to get
a screen-space pixel size:

```js
const screenPx = desiredScreenPx / context.getTransform().a;
ctx.font = `${Math.round(screenPx)}px sans-serif`;
```

---

## 8. Edge cases and notes

| Case | Handling |
|---|---|
| Segment with one handle at zero length | Skip (`computeApex` returns `apex: null`) |
| Parallel handles (lines that never meet) | Skip — denom ≈ 0 |
| Apex far off-canvas (e.g. > 10,000 units away) | Still draw — the triangle is just large. Clip with `ctx.save()/restore()` if needed |
| S-curve inflection point approximation | The midpoint `M = (P0+P3)/2` is an approximation. Exact inflection requires solving the cubic for the curvature-zero point — use the approximation for display; accuracy is sufficient |
| Variable font — multiple masters | The visualization layer operates on the **interpolated** glyph at the current axis location. The violation list in the panel should ideally show violations per master — iterate `fontController.masters` if available |
| Educational mode performance | With many glyphs visible in the text view, educational mode may draw many triangles. Limit to the **active glyph** only, or add a debounce on `canvasController.requestUpdate()` |
| Selection sync | Use `controller.selection` (a `Set` of point indices) to determine which segments are "selected". A segment is selected if `P0`, `P1`, `P2`, or `P3` appears in the selection set |

---

## 9. Implementation prompt (use this verbatim to commission the plugin)

> Build a Fontra visualization-layer plugin called **Triangle Guardian** following the
> specification in this document exactly.
>
> **Required deliverables:**
>
> 1. `plugin.json` — manifest with identifier `com.fontra.plugins.triangle-guardian`
> 2. `start.js` — registers panel and imports the layer module
> 3. `triangle-guardian-geometry.js` — all geometry helpers (`iterContours`,
>    `extractCubicSegments`, `computeApex`, `pointInTriangle`, `drawHalfTriangle`,
>    `drawViolationMarker`, `drawSimpleTriangle`, `drawSCurveTriangles`)
> 4. `triangle-guardian-layer.js` — calls `registerVisualizationLayerDefinition`;
>    `draw()` must iterate all contours of the active glyph, call the geometry helpers,
>    and respect `model.educationalMode`, `model.showAllSegments`,
>    `model.highlightViolations`, `model.triangleOpacity`
> 5. `triangle-guardian-panel.js` — `Panel` subclass with `ObservableController`,
>    `synchronizeWithLocalStorage("triangle-guardian.")`, three UI sections
>    (mode toggles, appearance, violations UIList), and `_scheduleViolationScan()`
> 6. `icon.svg` — a simple triangle SVG icon (36×36 px, single stroke path)
>
> **Constraints:**
>
> - Use only Fontra's internal imports (`fontra/editor/…`, `fontra/core/…`,
>   `fontra/web-components/…`). No external npm dependencies.
> - The layer must call `context.save()` / `context.restore()` around each segment draw.
> - All `context.font` sizes must be divided by `context.getTransform().a`.
> - The Y-axis in Fontra's canvas is flipped (+Y = up). Do not negate y-coordinates.
> - `ObservableController` must be created inside `getContentElement()`, not in the
>   constructor.
> - `registerVisualizationLayerDefinition` must be called at module top level.
> - `screenParameters` values (colors, stroke widths, opacity) must drive all drawing —
>   no hard-coded magic values inside `draw()`.
> - Degenerate segments (zero-length handles, parallel handles) must be silently skipped.
> - S-curves must be detected via `t < 0 || s < 0` after apex computation, and rendered
>   with two half-triangles in the blue ramp + an "S" label.
> - The violation `UIList` must update on every `selectedGlyphName` change using the
>   debounce pattern `_scheduleViolationScan()`.

---

## 10. Testing checklist

- [ ] Simple convex arc — triangle drawn, both handles inside → green
- [ ] Simple arc with one handle outside → handle flagged red, triangle red
- [ ] S-curve (handles cross) → two blue half-triangles, "S" label at midpoint
- [ ] Straight line segment → no triangle drawn
- [ ] Zero-length handle → segment skipped silently
- [ ] Parallel handles — no triangle drawn, no console error
- [ ] Educational mode ON → triangles on all segments regardless of selection
- [ ] Educational mode OFF → triangles only on selected segment / hovered segment
- [ ] Opacity slider changes → triangle fill opacity updates live
- [ ] Violation list updates when switching glyphs
- [ ] Violation list shows "No violations" when all handles are inside
- [ ] `localStorage` persistence — panel state survives page reload
- [ ] Canvas `requestUpdate()` fires on every model key change
- [ ] Plugin installs via Fontra plugin manager without errors

---

*Specification version 1.0 — April 2026*
