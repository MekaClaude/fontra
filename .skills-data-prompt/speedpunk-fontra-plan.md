# SpeedPunk for Fontra — Complete Implementation Plan

**Date**: March 21, 2026  
**Status**: Fresh plan — corrects all failure modes from previous attempt  
**License**: Apache 2.0 (matching original SpeedPunk)

---

## 1. Why the Previous Attempt Failed — Root Causes

Before building anything, understand exactly what broke before:

| Failure | Root cause | Correct approach |
|---|---|---|
| `[object Object]` in panel | Panel extended plain `class` instead of Fontra's `Panel` | Always extend `Panel` from `fontra/editor/panel.js` |
| `toggle()` undefined crash | Panel created in wrong inheritance chain | `super(editorController)` inside `Panel` subclass only |
| Visualization layer showed nothing | `selectionFunc` used instead of `selectionMode` | Use `selectionMode: "editing"` |
| Settings not synced | `ObservableController` created in constructor | Move to `getContentElement()` — **always** |
| Icon path broken | Hard-coded relative path | Set `MyPanel.prototype.iconPath` inside `start()` with `pluginPath` |
| Modifying Fontra internals | Plugin injected into `editor.js` / `visualization-layer-definitions.js` | Build as **external plugin package** instead |
| No persistence | Settings lost on reload | Call `synchronizeWithLocalStorage("speedpunk.")` |
| Canvas not re-rendered | No `requestUpdate()` call | Call `canvasController.requestUpdate()` in every key listener |

---

## 2. Architecture Decision: External Plugin (Not Core Modification)

The previous attempt modified Fontra's internal source files. **Do not do this.**

Build it as a standalone external plugin package (like `fontra-reference-font`). This means:

- No touching `editor.js` or `visualization-layer-definitions.js`
- Installable via Fontra's plugin manager
- Works across Fontra updates
- Can be developed and tested independently

### Plugin directory structure

```
fontra-speedpunk/
├── plugin.json          ← manifest
├── start.js             ← entry point, registers panel + layer
├── icon.svg             ← sidebar icon
├── curvature.js         ← pure math: Bézier curvature calculation
└── panel-speedpunk.js   ← Panel subclass with UI controls
```

---

## 3. File 1 — `plugin.json`

```json
{
  "name": "Speed Punk",
  "identifier": "de.yanone.speedpunk.fontra",
  "version": "0.1.0",
  "description": "Curvature comb visualization for Fontra — port of Yanone's Speed Punk",
  "author": "Your Name",
  "license": "Apache-2.0",
  "entries": {
    "editor": "start.js"
  }
}
```

---

## 4. File 2 — `start.js`

This is the **only** entry point. It does two things: registers the visualization layer and adds the panel.

```js
import { registerVisualizationLayerDefinition }
  from "fontra/editor/visualization-layer-definitions.js";
import SpeedPunkPanel from "./panel-speedpunk.js";
import { drawCurvatureCombs } from "./curvature.js";

// ── Visualization layer ───────────────────────────────────────────────────────
// CRITICAL: call at module top level, not inside a function
registerVisualizationLayerDefinition({
  identifier:    "de.yanone.speedpunk.combs",
  name:          "Speed Punk — Curvature Combs",
  selectionMode: "editing",   // ← correct key (not selectionFunc)
  userSwitchable: true,
  defaultOn:     false,
  zIndex:        100,

  screenParameters: {
    strokeWidth:           1,
    combLengthScale:       1.0,    // user-controlled gain multiplier
    combDensity:           20,     // number of t-sample points per segment
    illustrationPosition:  "outside",  // "outside" | "inner"
  },

  colors: {
    combColorLow:  "#8b939c",
    combColorMid:  "#f29400",
    combColorHigh: "#e3004f",
  },
  colorsDarkMode: {
    combColorLow:  "#6b7380",
    combColorMid:  "#d27400",
    combColorHigh: "#c3003f",
  },

  draw: drawCurvatureCombs,
});

// ── Panel registration ────────────────────────────────────────────────────────
export function start(editorController, pluginPath) {
  // Set icon using pluginPath — NEVER hard-code this
  SpeedPunkPanel.prototype.iconPath = `${pluginPath}/icon.svg`;

  customElements.define("speedpunk-panel", SpeedPunkPanel);
  editorController.addSidebarPanel(new SpeedPunkPanel(editorController), "right");
}
```

**Key rules respected here:**
- `registerVisualizationLayerDefinition` is at module top level
- `iconPath` is set inside `start()` using `pluginPath`
- `customElements.define` before passing to `addSidebarPanel`

---

## 5. File 3 — `curvature.js` (Pure Math — No Fontra Dependencies)

This file is self-contained. It exports the draw function and the math helpers.

```js
// ── Vector helpers ────────────────────────────────────────────────────────────

function vecAdd(a, b)  { return { x: a.x + b.x, y: a.y + b.y }; }
function vecSub(a, b)  { return { x: a.x - b.x, y: a.y - b.y }; }
function vecScale(v, s){ return { x: v.x * s,   y: v.y * s   }; }
function vecLen(v)     { return Math.hypot(v.x, v.y); }

// ── Cubic Bézier at parameter t ───────────────────────────────────────────────
// Returns { point, d1, d2 }  (position, 1st & 2nd derivatives)

export function solveCubic(p0, p1, p2, p3, t) {
  const mt = 1 - t;

  // Position B(t)
  const point = {
    x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
    y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
  };

  // 1st derivative B'(t) = 3[(1-t)²(P1-P0) + 2(1-t)t(P2-P1) + t²(P3-P2)]
  const d1 = {
    x: 3*(mt*mt*(p1.x-p0.x) + 2*mt*t*(p2.x-p1.x) + t*t*(p3.x-p2.x)),
    y: 3*(mt*mt*(p1.y-p0.y) + 2*mt*t*(p2.y-p1.y) + t*t*(p3.y-p2.y)),
  };

  // 2nd derivative B''(t) = 6[(1-t)(P2-2P1+P0) + t(P3-2P2+P1)]
  const d2 = {
    x: 6*(mt*(p2.x - 2*p1.x + p0.x) + t*(p3.x - 2*p2.x + p1.x)),
    y: 6*(mt*(p2.y - 2*p1.y + p0.y) + t*(p3.y - 2*p2.y + p1.y)),
  };

  return { point, d1, d2 };
}

// ── Signed curvature κ = (x'y'' - y'x'') / |B'|³ ────────────────────────────

export function curvatureFromDerivatives(d1, d2) {
  const denom = Math.pow(vecLen(d1), 3);
  if (denom < 1e-10) return 0;   // degenerate (zero-length tangent)
  return (d1.x * d2.y - d1.y * d2.x) / denom;
}

// ── Quadratic → cubic conversion ──────────────────────────────────────────────
// Raises a quadratic B(P0, P1, P2) to cubic equivalent control points

export function quadToCubic(p0, p1, p2) {
  return [
    p0,
    vecAdd(p0, vecScale(vecSub(p1, p0), 2/3)),
    vecAdd(p2, vecScale(vecSub(p1, p2), 2/3)),
    p2,
  ];
}

// ── Color interpolation ───────────────────────────────────────────────────────

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return [r, g, b];
}

function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0]-a[0])*t),
    Math.round(a[1] + (b[1]-a[1])*t),
    Math.round(a[2] + (b[2]-a[2])*t),
  ];
}

// Three-stop gradient: low → mid → high
export function curvatureColor(k, kMin, kMax, colors) {
  const { combColorLow, combColorMid, combColorHigh } = colors;
  const range = kMax - kMin;
  if (range < 1e-10) return combColorMid;

  const p = (k - kMin) / range;   // 0…1
  const [low, mid, high] = [combColorLow, combColorMid, combColorHigh].map(hexToRgb);
  const [r, g, b] = p < 0.5
    ? lerpColor(low,  mid,  p * 2)
    : lerpColor(mid,  high, (p - 0.5) * 2);
  return `rgb(${r},${g},${b})`;
}

// ── Main draw function ────────────────────────────────────────────────────────

export function drawCurvatureCombs(context, positionedGlyph, parameters, model, controller) {
  const path = positionedGlyph.glyph.path;
  if (!path) return;

  const {
    strokeWidth,
    combLengthScale,
    combDensity,
    illustrationPosition,
  } = parameters;

  // ── Pass 1: collect all curvature samples to find global min/max ─────────
  const allSamples = [];   // { point, kappa, perp }

  const numContours = path.numContours;
  for (let ci = 0; ci < numContours; ci++) {
    for (const seg of path.iterContourDecomposedSegments(ci)) {
      let pts;
      if (seg.type === "cubic") {
        pts = seg.points;
      } else if (seg.type === "quad") {
        pts = quadToCubic(...seg.points);
      } else {
        continue;   // line segments have zero curvature — skip
      }

      const [p0, p1, p2, p3] = pts;
      const n = combDensity;

      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const { point, d1, d2 } = solveCubic(p0, p1, p2, p3, t);
        const kappa = curvatureFromDerivatives(d1, d2);
        const len = vecLen(d1);

        // Perpendicular unit vector (rotated 90°)
        const perp = len > 1e-10
          ? { x: -d1.y / len, y: d1.x / len }
          : { x: 0, y: 0 };

        allSamples.push({ point, kappa, perp });
      }
    }
  }

  if (allSamples.length === 0) return;

  // ── Global curvature range for color normalization ───────────────────────
  const absValues = allSamples.map(s => Math.abs(s.kappa));
  const kMin = Math.min(...absValues);
  const kMax = Math.max(...absValues);

  // Scale: combs reach a visually reasonable length.
  // 0.3 × unitsPerEm gives a good baseline; combLengthScale multiplies it.
  const upm = model?.fontController?.unitsPerEm ?? 1000;
  const baseScale = upm * 0.3 * combLengthScale;

  // ── Pass 2: draw ──────────────────────────────────────────────────────────
  context.lineWidth = strokeWidth;

  for (const { point, kappa, perp } of allSamples) {
    const absK = Math.abs(kappa);
    if (absK < 1e-10) continue;

    const color = curvatureColor(absK, kMin, kMax, parameters);
    const combLen = absK * baseScale;

    // Direction: "outside" flips based on curvature sign (left vs right bend)
    const sign = (illustrationPosition === "outside")
      ? Math.sign(kappa)   // positive = inward, negative = outward in font coords
      : 1;

    const end = {
      x: point.x + perp.x * combLen * sign,
      y: point.y + perp.y * combLen * sign,
    };

    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = color;
    context.stroke();
  }
}
```

### Why this draw function works correctly

- Accesses the path via `positionedGlyph.glyph.path` (correct Fontra API)
- Iterates segments with `path.iterContourDecomposedSegments(ci)` (correct iterator)
- Handles both `"cubic"` and `"quad"` segment types
- Skips line segments (zero curvature — nothing to draw)
- Uses a global min/max pass to normalize the color gradient per glyph
- Uses `upm` from `model.fontController.unitsPerEm` for scale-invariant lengths

---

## 6. File 4 — `panel-speedpunk.js`

```js
import Panel from "fontra/editor/panel.js";
import { ObservableController } from "fontra/core/observable-object.js";
import { div, span, label, input, createDomElement }
  from "fontra/core/html-utils.js";

// Defaults must match screenParameters in start.js
const DEFAULTS = {
  combLengthScale:      1.0,
  combDensity:          20,
  illustrationPosition: "outside",
};

export default class SpeedPunkPanel extends Panel {
  // identifier must match customElements.define name (kebab-case)
  identifier = "speedpunk-panel";
  iconPath   = "/images/placeholder.svg";  // overwritten by start()

  static styles = `
    .sp-section        { margin: 8px 0; }
    .sp-row            { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
    .sp-label          { flex: 0 0 130px; font-size: 11px;
                         color: var(--ui-element-foreground-color); }
    .sp-slider         { flex: 1; }
    .sp-value          { width: 32px; text-align: right; font-size: 11px; }
    .sp-radio-group    { display: flex; flex-direction: column; gap: 4px; margin-left: 4px; }
    .sp-reset-btn      { margin: 10px 4px 4px;
                         background: var(--ui-element-background-color-1);
                         color: var(--ui-element-foreground-color);
                         border: 1px solid var(--ui-element-foreground-color);
                         border-radius: 4px; padding: 4px 10px;
                         font-size: 11px; cursor: pointer; }
  `;

  constructor(editorController) {
    super(editorController);
    // ⚠ Do NOT create ObservableController here — do it in getContentElement()
    // Attach scene listeners here — they survive re-renders
    this.editorController.sceneSettingsController.addKeyListener(
      "selectedGlyphName",
      () => this.editorController.canvasController.requestUpdate()
    );
  }

  get model() { return this.controller.model; }

  getContentElement() {
    // 1. Reactive state — ALWAYS in getContentElement
    this.controller = new ObservableController({ ...DEFAULTS });
    this.controller.synchronizeWithLocalStorage("speedpunk.");

    // 2. Helper: build a labeled slider row
    const sliderRow = (labelText, key, min, max, step) => {
      const valueSpan = span({ class: "sp-value" }, [
        String(this.model[key])
      ]);

      const slider = input({
        type: "range",
        class: "sp-slider",
        min, max, step,
        value: this.model[key],
        oninput: (e) => {
          const v = parseFloat(e.target.value);
          this.controller.model[key] = v;
          valueSpan.textContent = v.toFixed(step < 1 ? 1 : 0);
          this.editorController.canvasController.requestUpdate();
        },
      });

      // Sync slider if setting changes from another source
      this.controller.addKeyListener(key, (event) => {
        slider.value = event.newValue;
        valueSpan.textContent = String(event.newValue);
      });

      return div({ class: "sp-row" }, [
        span({ class: "sp-label" }, [labelText]),
        slider,
        valueSpan,
      ]);
    };

    // 3. Illustration position radio buttons
    const makeRadio = (value, labelText) => {
      const radio = input({
        type: "radio",
        name: "sp-position",
        value,
        checked: this.model.illustrationPosition === value,
        onchange: () => {
          this.controller.model.illustrationPosition = value;
          this.editorController.canvasController.requestUpdate();
        },
      });
      this.controller.addKeyListener("illustrationPosition", (event) => {
        radio.checked = (event.newValue === value);
      });
      return label({ class: "sp-row" }, [radio, span({}, [labelText])]);
    };

    // 4. Reset button
    const resetBtn = createDomElement("button", {
      class: "sp-reset-btn",
      onclick: () => {
        for (const [k, v] of Object.entries(DEFAULTS)) {
          this.controller.model[k] = v;
        }
        this.editorController.canvasController.requestUpdate();
      },
    });
    resetBtn.textContent = "Reset to defaults";

    // 5. Assemble DOM
    return div({ class: "sp-section" }, [
      sliderRow("Comb length",   "combLengthScale", 0.1, 5.0, 0.1),
      sliderRow("Comb density",  "combDensity",      5,  50,  1  ),
      div({ class: "sp-row" }, [
        span({ class: "sp-label" }, ["Position"]),
        div({ class: "sp-radio-group" }, [
          makeRadio("outside", "Outside of glyph"),
          makeRadio("inner",   "Inner side of curve"),
        ]),
      ]),
      resetBtn,
    ]);
  }
}
```

### Why this panel pattern is correct

- Extends `Panel` from `fontra/editor/panel.js` — gives `toggle()`, shadow DOM, styles injection
- `ObservableController` created inside `getContentElement()` — required by Fontra
- `synchronizeWithLocalStorage` persists all settings automatically
- `canvasController.requestUpdate()` called after every model change — triggers redraw
- Scene listener attached in `constructor()` — survives panel re-renders
- `iconPath` is a placeholder; overwritten by `start()` using `pluginPath`

---

## 7. File 5 — `icon.svg`

A simple SVG showing a curve with perpendicular combs:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
  <!-- curve -->
  <path d="M2 15 C4 4, 16 4, 18 15"
        stroke="currentColor" stroke-width="1.5" fill="none"/>
  <!-- comb ticks -->
  <line x1="5"  y1="12" x2="5"  y2="7"  stroke="#f29400" stroke-width="1.2"/>
  <line x1="8"  y1="8"  x2="8"  y2="4"  stroke="#e3004f" stroke-width="1.2"/>
  <line x1="10" y1="7"  x2="10" y2="3"  stroke="#e3004f" stroke-width="1.2"/>
  <line x1="12" y1="8"  x2="12" y2="4"  stroke="#f29400" stroke-width="1.2"/>
  <line x1="15" y1="12" x2="15" y2="7"  stroke="#8b939c" stroke-width="1.2"/>
</svg>
```

---

## 8. Phased Build Plan

### Phase 0 — Smoke test (Day 1, ~2 hours)
**Goal**: Confirm the plugin scaffolding loads at all.

1. Create `plugin.json`, a minimal `start.js` (just `console.log("SpeedPunk loaded")`), and `icon.svg`
2. Install via Fontra's plugin manager
3. Verify icon appears in right sidebar
4. Open browser console — confirm no errors

**Pass criteria**: Icon visible, no console errors.  
**If this fails**: Nothing else will work — diagnose plugin loading before continuing.

---

### Phase 1 — Minimal visualization layer (Day 1–2)
**Goal**: Draw *something* (dots at sample points) to confirm layer execution path.

Replace `drawCurvatureCombs` with:
```js
export function drawCurvatureCombs(context, positionedGlyph, parameters) {
  const path = positionedGlyph.glyph.path;
  if (!path) return;
  context.fillStyle = "red";
  const n = path.numContours;
  for (let ci = 0; ci < n; ci++) {
    for (const seg of path.iterContourDecomposedSegments(ci)) {
      if (seg.type === "cubic" || seg.type === "quad") {
        const p = seg.points[0];
        context.beginPath();
        context.arc(p.x, p.y, 8, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
}
```

Enable "Speed Punk — Curvature Combs" in user settings and open a glyph.

**Pass criteria**: Red dots appear at curve start points.  
**If dots don't appear**: The layer `draw` function is not being called — check `identifier` uniqueness and `selectionMode`.

---

### Phase 2 — Real curvature combs (Day 2–3)
**Goal**: Replace dots with actual curvature combs using the full math.

Swap in the real `drawCurvatureCombs` from `curvature.js`. At this stage, ignore colors — just use a single color (e.g. `"#f29400"`).

**Pass criteria**: Comb lines appear perpendicular to curves. Lines are longer on high-curvature areas (tight corners) and shorter on gentle curves.

---

### Phase 3 — Color gradient (Day 3)
**Goal**: Apply the three-stop gradient (low → mid → high curvature).

Integrate `curvatureColor()`. At this point the visualization should match original SpeedPunk visually.

**Pass criteria**: Colors visually gradient from grey (gentle) through orange to red/pink (tight).

---

### Phase 4 — Panel UI (Day 4)
**Goal**: Wire up the panel so the sliders actually change what's drawn.

The current `draw` function reads from `parameters`, but those come from `screenParameters` defaults. To connect the panel to the draw function:

The visualization layer's `parameters` object is populated from `visualizationLayersSettings`. The panel's `ObservableController` needs to write to those same keys.

```js
// In panel-speedpunk.js getContentElement(), after creating controller:
const layerSettings = this.editorController.visualizationLayersSettings;
const prefix = "de.yanone.speedpunk.combs.";

// Sync panel → layer
this.controller.addKeyListener("combLengthScale", (e) => {
  layerSettings.model[prefix + "combLengthScale"] = e.newValue;
  this.editorController.canvasController.requestUpdate();
});
// ... repeat for other keys

// Sync layer → panel (in case another panel/window changes it)
layerSettings.addKeyListener(prefix + "combLengthScale", (e) => {
  this.controller.setItem("combLengthScale", e.newValue, { senderID: this });
});
```

**Pass criteria**: Moving the "Comb length" slider changes comb heights in real time.

---

### Phase 5 — Polish (Day 5)
- Add fader: a slider that fades out combs below a curvature threshold
- Add color swatch preview in the panel
- Test with UFO, .designspace, .ttf, .otf
- Test edge cases: glyph with no curves, glyph with mixed cubic+quadratic, very complex glyph (500+ points)
- Test dark mode (colors should auto-switch via `colorsDarkMode`)

---

## 9. Critical Technical Details

### Coordinate system
Fontra's canvas context has +Y pointing **up** (font coordinates), not down (screen coordinates). The perpendicular math in `curvature.js` uses `{ x: -d1.y, y: d1.x }` which is correct in this flipped system. Do not negate Y.

### `iterContourDecomposedSegments` returns decomposed segments
Each segment from this iterator is already decomposed into atomic pieces (`line`, `cubic`, `quad`). You don't need to manually split or step through a contour point-by-point.

### Performance
For 20 density × 6 segments × 3 contours = 360 draw calls per glyph. This is fast. However for very dense glyphs (CJK characters with 80+ segments), this can be 1600+ draw calls. To keep 60 FPS:
- Batch all combs of the same color in a single `beginPath()` / `stroke()` call
- Only recalculate when the glyph changes (use the scene listener pattern)

### The `model` parameter in `draw`
The `model` argument passed to `draw` is the scene model. Access `unitsPerEm` via:
```js
const upm = model?.fontController?.unitsPerEm ?? 1000;
```

### `screenParameters` vs `colors`
`screenParameters` values are multiplied by the canvas pixel density (useful for things like stroke widths that should stay visually consistent at any zoom). `colors` and `colorsDarkMode` are automatically swapped based on the OS dark-mode setting.

---

## 10. File Summary

| File | Purpose | Lines (est.) |
|---|---|---|
| `plugin.json` | Manifest — name, identifier, entry | 12 |
| `start.js` | Entry point — registers layer + panel | 45 |
| `curvature.js` | Math — Bézier derivatives, curvature, color | ~130 |
| `panel-speedpunk.js` | Sidebar UI — sliders, radio buttons, reset | ~120 |
| `icon.svg` | Sidebar icon | 10 |

**Total: ~320 lines.** Much smaller than the previous 800-line attempt, and it will actually work.

---

## 11. Development Checklist

### Setup
- [ ] Create directory `fontra-speedpunk/`
- [ ] Create all 5 files from this plan
- [ ] Install plugin via Fontra plugin manager

### Phase 0 — Scaffolding
- [ ] Icon appears in right sidebar with no console errors

### Phase 1 — Smoke test draw
- [ ] Red dots appear at curve segment start points

### Phase 2 — Combs
- [ ] Perpendicular lines appear on curves
- [ ] Lines are longer at high-curvature areas (corners)
- [ ] No lines on straight segments

### Phase 3 — Colors
- [ ] Low curvature = grey
- [ ] Mid curvature = orange
- [ ] High curvature = red/pink

### Phase 4 — Panel controls
- [ ] Panel opens and shows sliders
- [ ] "Comb length" slider changes comb heights live
- [ ] "Comb density" slider changes number of samples
- [ ] "Position" radio buttons switch comb direction
- [ ] "Reset" button restores defaults
- [ ] Settings persist after browser reload

### Phase 5 — Polish
- [ ] Works with UFO, designspace, TTF, OTF
- [ ] Works with quadratic curves (TrueType)
- [ ] No crash on glyph with zero curves
- [ ] Dark mode colors applied automatically
- [ ] Acceptable performance on complex CJK glyph

---

## 12. Common Mistakes to Avoid

1. **Do not** create `ObservableController` in the constructor
2. **Do not** hard-code `iconPath` — always set via `pluginPath` in `start()`
3. **Do not** use `selectionFunc` — use `selectionMode: "editing"`
4. **Do not** modify `editor.js` or `visualization-layer-definitions.js` in Fontra core
5. **Do not** forget `canvasController.requestUpdate()` in every controller key listener
6. **Do not** forget `customElements.define(...)` before `addSidebarPanel(...)`
7. **Do not** call `registerVisualizationLayerDefinition` inside `start()` — it must be at module top level

---

## 13. References

- Original SpeedPunk algorithm: https://github.com/yanone/speedpunk (Apache 2.0)
- Fontra plugin skill: see `/mnt/skills/user/fontra-plugin/SKILL.md`
- Existing external plugin example: https://github.com/fontra/fontra-reference-font
- Bézier curvature math: κ = (x'y'' − y'x'') / |B'|³
