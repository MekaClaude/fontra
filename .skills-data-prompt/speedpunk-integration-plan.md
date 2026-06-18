# Speed Punk Integration Plan

## Overview

Integrate Speed Punk — a curvature visualization tool for font outlines — into Fontra as a core feature with a visualization layer and sidebar panel.

## Source

The algorithm is adapted from [GaetanBaehr's commit](https://github.com/GaetanBaehr/fontra/commit/5e2786282174b36cb337e5c1a149c6e347106f32) which adds curvature "speed lines" perpendicular to bezier curves, colored by curvature magnitude (purple/blue for low → red/orange for high).

## Architecture

Core-integrated approach (not external plugin), matching how all existing Fontra visualization layers and panels work:

| File | Action |
|---|---|
| `src-js/views-editor/src/curvature-math.js` | **NEW** — Pure math: Bezier evaluation, curvature computation, HSL color |
| `src-js/views-editor/src/visualization-layer-definitions.js` | **MODIFY** — Add `fontra.speedpunk` layer + export `speedpunkState` |
| `src-js/views-editor/src/panel-speedpunk.js` | **NEW** — Sidebar panel with toggle, sliders, color legend |
| `src-js/views-editor/src/editor.js` | **MODIFY** — Import and register `SpeedPunkPanel` |

## Visualization Layer (`fontra.speedpunk`)

| Property | Value |
|---|---|
| `identifier` | `"fontra.speedpunk"` |
| `name` | `"sidebar.user-settings.glyph.speedpunk"` |
| `selectionFunc` | `glyphSelector("editing")` |
| `userSwitchable` | `true` |
| `defaultOn` | `false` |
| `zIndex` | `100` |

### Draw Function

Two-pass algorithm:
1. **Pass 1** — Iterate all curve segments (cubic & quad) via `path.iterContourDecomposedSegments()`, sample `combDensity` points per segment, compute curvature κ = (x'y'' − y'x'') / |B'|³ at each point, collect samples with perpendicular vectors
2. **Pass 2** — For each sample with non-zero κ, draw a line from the point along the perpendicular, with:
   - Length = `|κ| × upm × 0.3 × combLengthScale`
   - Color = `HSL(hue, 90%, 60%)` where `hue = clamp(0, 360, 280 - (log(|κ|+1e-8) + 8) × 32)`
   - Direction toward center of curvature (signed κ)

### Shared State

`speedpunkState` object (exported from `visualization-layer-definitions.js`):
- `enabled: boolean` — synced with visualization layer toggle
- `combLengthScale: number` — multiplier for comb length (0.1–5.0)
- `combDensity: number` — samples per segment (5–50)

## Panel (`SpeedPunkPanel`)

Extends `Panel` from `./panel.js`:
- **On/Off toggle** — writes to `visualizationLayersSettings.model["fontra.speedpunk"]`, syncs with `speedpunkState.enabled`
- **Comb length slider** (0.1–5.0) — adjusts `speedpunkState.combLengthScale`
- **Comb density slider** (5–50) — adjusts `speedpunkState.combDensity`
- **Color legend** — gradient bar from purple → blue → green → yellow → red, with labels
- Every value change calls `canvasController.requestUpdate()`
- `ObservableController` created in `getContentElement()`
- Settings persisted via `synchronizeWithLocalStorage("speedpunk.")`

## Math Module (`curvature-math.js`)

Pure functions (no Fontra dependencies):
- `solveCubic(p0, p1, p2, p3, t)` → `{ point, d1, d2 }`
- `solveQuad(p0, p1, p2, t)` → `{ point, d1, d2 }`
- `curvatureFromDerivatives(d1, d2)` → κ
- `curvatureColorHSL(kappa)` → `"hsl(…)"` string
- `vecLen(v)` → length

## Files Changed

```
src-js/views-editor/src/
  + curvature-math.js          (55 lines)
  + panel-speedpunk.js         (195 lines)
  ~ visualization-layer-definitions.js  (+95 lines)
  ~ editor.js                            (+2 lines)
```

## Key Design Decisions

1. **Core-integrated** — follows the same pattern as all existing Fontra features (triangle guardian, coordinates, etc.)
2. **HSL coloring from the commit** — more informative continuous gradient than 3-stop discrete gradient
3. **Shared state** — `speedpunkState` is a plain object, not an ObservableController, keeping the draw function minimal
4. **Two-pass rendering** — first pass collects all κ values for global min/max normalization (not per-segment)
5. **Quad segments** — evaluated directly via `solveQuad()` with proper derivative formulas (not converted to cubic)
6. **`requestUpdate()` on every change** — ensures canvas redraws immediately when panel values change
