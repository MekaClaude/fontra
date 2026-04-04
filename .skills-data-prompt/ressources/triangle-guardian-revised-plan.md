# Triangle Guardian — Fontra Plugin
## Revised Plan (Post-Audit)

> **Audit date**: April 2026
> **Status**: Ready to build — all P0/P1 issues resolved below

---

## Priority Fixes Applied

### P0 — Path iteration (was: `path.contours` — does not exist)

**Fix**: Use `glyph.path.iterContourDecomposedSegments(contourIndex)` which yields:
```js
{
  type: "cubic",
  points: [P0, P1, P2, P3],  // {x, y} objects
  parentPointIndices: [idx0, idx1, idx2, idx3]  // absolute indices
}
```

### P0 — Selection parsing (was: Set of integers)

**Fix**: Selection is `Set<string>` with format `"point/0"`. Use:
```js
import { parseSelection } from "@fontra/core/utils.js";
const { point: selectedIndices } = parseSelection(model.selection);
// selectedIndices = [0, 3, 5] — sorted array of integers
```

### P0 — plugin.json schema (was: `entries`)

**Fix**: Use correct schema:
```json
{
  "init": "start.js",
  "function": "registerPlugin"
}
```

### P0 — Import paths (was: `"fontra/..."`)

**Fix**: Use `@fontra/` scoped packages:
```js
import { registerVisualizationLayerDefinition } from "@fontra/editor/visualization-layer-definitions.js";
import Panel from "@fontra/editor/panel.js";
import { ObservableController } from "@fontra/core/observable-object.js";
import { parseSelection } from "@fontra/core/utils.js";
```

### P1 — Shared state between panel and layer

**Fix**: Module-level shared state object:
```js
// triangle-guardian-state.js
export const state = {
  enabled: true,
  educationalMode: false,
  showAllSegments: false,
  highlightViolations: true,
  showSCurveLabels: true,
  triangleOpacity: 0.18,
};
```

Panel writes to `state`, layer reads from `state`. Both import the same module.

### P1 — Layer reads settings from state, not from `model`

**Fix**: In `draw()`, read from shared `state` instead of `model.educationalMode` etc.

### P2 — S-curve inflection point

`fontra-coach`'s `getCurvatureReversalPoint()` is a stub (returns null). Keep the midpoint approximation from the original plan — it's sufficient for visualization.

### P2 — Violation list refresh on edit

Listen to both `selectedGlyphName` changes AND glyph edit events via `sceneController.addCurrentGlyphChangeListener()`.

---

## Corrected Architecture

```
triangle-guardian/
├── plugin.json                          # corrected schema
├── start.js                             # exports registerPlugin(editor, pluginPath)
├── triangle-guardian-state.js           # shared state module
├── triangle-guardian-geometry.js        # geometry helpers (computeApex, pointInTriangle, etc.)
├── triangle-guardian-layer.js           # visualization layer
├── triangle-guardian-panel.js           # sidebar panel
└── icon.svg
```

## Key API Corrections Summary

| Original (wrong) | Corrected |
|---|---|
| `path.contours` | `glyph.path.iterContourDecomposedSegments(ci)` |
| `controller.selection` | `parseSelection(model.selection)` |
| `model.educationalMode` | `import { state } from "./triangle-guardian-state.js"` |
| `"fontra/editor/..."` | `"@fontra/editor/..."` |
| `"entries": {"editor": "start.js"}` | `"init": "start.js", "function": "registerPlugin"` |
| `export function start()` | `export function registerPlugin()` |
| `p1.type === "offcurve"` | `p1.type === "cubic"` |
| `TriangleGuardianPanel.prototype.iconPath = ...` | `iconPath = "..."` as class property |

## Existing Fontra APIs Used

- `glyph.path.iterContourDecomposedSegments(ci)` — iterate cubic segments
- `glyph.path.iterPoints()` — iterate all points
- `parseSelection(selection)` — parse `"point/N"` strings
- `registerVisualizationLayerDefinition()` — register overlay
- `glyphSelector("editing")` — select which glyphs to draw on
- `Panel` base class — sidebar panel
- `ObservableController` — reactive state
- `sceneSettingsController.addKeyListener()` — listen to glyph changes
- `canvasController.requestUpdate()` — trigger redraw

## No Redundancy Confirmed

Fontra has no existing visualization for the Adobe control-point triangle guideline. The closest are:
- `fontra.handles` — draws handle lines only
- `fontra-coach` curve inspector — checks tangent breaks, curvature reversals, handle ratios (different rules)

This plugin fills a genuine gap.
