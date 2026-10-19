# Fontra Vector Brush Tool — Port Report

**Source project:** `D:\DEVWEB\OPEN CODE\Fontra UX\fontra` (working brush tool)
**Target project:** `D:\DEVWEB\MINIMAX AGENT\fontra\fontra` (no brush tool yet)
**Goal:** Port the brush tool, improve it, minimize generated vector points, make it intuitive & professional.

---

## 1. Executive summary

The source project contains a complete, well-architected brush implementation split across 7 files:

| Layer | File (source) | Status in target |
|---|---|---|
| Geometry engine | `src-js/fontra-core/src/brush-engine.js` | ❌ missing |
| Input buffer / spatial grid | `src-js/fontra-core/src/brush-stroke.js` | ❌ missing |
| Settings store + defaults | `src-js/fontra-core/src/brush-settings.js` | ❌ missing |
| Sidebar preview canvas | `src-js/fontra-core/src/brush-preview.js` | ❌ missing |
| Tool base classes + FSM + viz layers | `src-js/views-editor/src/brush-tool-base.js` | ❌ missing |
| 4 sub-tools (Calligraphic / Straight / Sculpt / Eraser) | `src-js/views-editor/src/edit-tools-brush-advanced.js` | ❌ missing |
| Settings panel | `src-js/views-editor/src/panel-brush.js` | ❌ missing |

The target project has nothing brush-related. Porting means copying/adapting all 7 files, then wiring:
- `BrushToolAdvanced` (multi-tool container) into `editor.js` `initTools()`
- `BrushPanel` into the right sidebar via `addSidebarPanel()`
- The brush visualization layers into the editor's visualization layer registry

The existing source implementation is already solid. The improvements below focus on (a) fewer vector points on curves, (b) tighter integration with the target's patterns, and (c) professional UX polish.

---

## 2. Source implementation inventory (what "working" looks like)

### 2.1 BrushEngine (`brush-engine.js`)
Broad-nib calligraphic model:
```
width = minWidth + (maxWidth-minWidth) * |sin(moveAngle - brushAngle)| ^ (1 + contrast*1.5)
```
Pipeline: `generateStroke()` → prepare → resample → smooth → enrich → widths → taper → outline.
- `generateStrokeContour()` — cubic-fit smooth outline (default calligraphic commit)
- `generateSharpContour()` — plain on-curve polygon (straight mode commit)
- `generateDotContour()` — nib-shaped stamp for click-without-drag
- `buildOutline()` — offsets centerline left/right, clamps half-width by local curvature radius, cleans collinear vertices, rounds to integers
- `fitOutlineToContour()` — Schneider-style recursive cubic fitting (via `bezier-js` + `fit-cubic.js`)
- Static tunables: `RESAMPLE_DISTANCE = 3`, `FIT_ERROR = 4.0`, `MAX_HALFWIDTH_CURVATURE_RATIO = 0.85`

### 2.2 BrushStrokeInput (`brush-stroke.js`)
Typed-array (`Float64Array`/`Float32Array`) accumulator — no per-point objects during drag. Materializes plain objects only at preview (bounded) and commit (once).
- `resampled(minDist)` — distance-based decimation, keeps endpoints
- `minDistForCap(cap)` — adaptive sample cap so long strokes don't explode
- `SpatialGrid` — uniform hash grid for O(1) radius queries (sculpt tool)
- `adaptPreviewCap()` — rAF budget feedback (8 ms target)

### 2.3 BrushSettingsStore (`brush-settings.js`)
`EventTarget`-based store per storage prefix. Clamps on write, persists to localStorage, broadcasts `change` events synchronously. Per-mode prefixes (`fontra.brush-v2.calligraphic.`, …) preserve per-mode memory.
- `BRUSH_BOUNDS`, `BRUSH_TOOL_BOUNDS`, `DEFAULT_OPTIONS`, `DEFAULT_BRUSH_SETTINGS`, `BRUSH_PRESETS`, `BRUSH_MODES`, `BRUSH_MODE_TO_TOOL_ID`, `ENGINE_SETTINGS`, `TOOL_SETTINGS`, `FLOAT_SETTINGS`

### 2.4 Tool layer (`brush-tool-base.js` + `edit-tools-brush-advanced.js`)
- `BrushDrawingToolBase` — FSM, cursor, hover, toast, preview rAF throttle, cancel
- `BrushStrokeToolBase` — shared drag loop, `StrokeInput` buffer, shift-constrain, click-click anchor, dot stamp
- `BrushToolBase` — calligraphic/straight contour commit, auto-union, selection of new anchors
- Sub-tools:
  - `BrushToolCalligraphic` — cubic-fitted smooth outline
  - `BrushToolStraight` — Douglas-Peucker simplified + sharp contour
  - `BrushToolSculpt` — push/pull existing points within radius (spatial grid)
  - `BrushToolEraser` — boolean subtract capsule shape, selection-scoped or global
- Three registered visualization layers: `fontra.brush.preview`, `fontra.brush.centerline`, `fontra.brush.eraser`

### 2.5 Panel (`panel-brush.js`)
Segmented mode selector, size/contrast/angle/advanced sliders, presets, pressure & union toggles, eraser/sculpt sections, live canvas preview via `drawBrushPreview`. Settings flow through `BrushSettingsStore`; no shadow copies.

---

## 3. Key architectural differences between the two projects

| Aspect | Source (UX) | Target (main fork) | Porting implication |
|---|---|---|---|
| `BaseTool` constructor | `new Tool(editor)` | Same | Brush classes drop in directly |
| `constrainHorVerDiag` | `edit-behavior.js` | `edit-behavior.js:892` | Available, import directly |
| `sceneController.addEventListener` | Exists, but **no** `selectedToolChanged` event | Same (line 985-986) | Panel-brush's `selectedToolChanged` hook will fall back to monkey-patching `setSelectedTool` — works but is fragile. Prefer the legacy fallback path explicitly. |
| `setSelectedTool` | `editor.js:1415` | `editor.js:1415` | Identical signature — `BrushToolAdvanced` multi-tool wrapper works as-is |
| Sidebar panel registration | `addSidebarPanel(panel, "right")` | Same | `BrushPanel` registers identically |
| Visualization layers | `registerVisualizationLayerDefinition` | Same API | Brush layers register the same way |
| localStorage settings | `BrushSettingsStore` | Not present | Must bring the store (no dependency on existing storage) |
| `bezier-js` / `fit-cubic` | Used by brush engine | Unknown if present | Must verify npm deps; bundle will fail if missing |

---

## 4. Porting plan — file map

Copy/adapt these 7 source files into the target:

```
src-js/fontra-core/src/
  brush-engine.js          (new)
  brush-stroke.js          (new)
  brush-settings.js        (new)
  brush-preview.js         (new)

src-js/views-editor/src/
  brush-tool-base.js       (new)
  edit-tools-brush-advanced.js  (new)
  panel-brush.js           (new)
```

Then wire into `editor.js`:
1. Import `BrushToolAdvanced` from `./edit-tools-brush-advanced.js`
2. Add `BrushToolAdvanced` to `editToolClasses` in `initTools()` (so its 4 sub-tools register as a multi-tool)
3. Import `BrushPanel` from `./panel-brush.js`
4. `this.addSidebarPanel(new BrushPanel(this), "right");` alongside the other right-sidebar panels
5. Register the 3 brush visualization layers (either in `brush-tool-base.js` import side-effect at editor init, or explicitly in `editor.js`)

Verify npm deps: `bezier-js` is imported by `brush-engine.js`. Check `package.json` in the target; if absent, add it or replace `fitCubic` with a minimal inline fitter to avoid a new dependency.

---

## 5. Improvements & recommendations

### 5.1 Core constraint: fewer vector points on curves (highest priority)

The source already reduces points vs. naive sampling, but the commit path still generates dense outlines. Specific levers to pull:

#### a) Tighten the resample distance
`brush-engine.js` uses `RESAMPLE_DISTANCE = 3` glyph units. Raise this to `4`–`5` for commit-only (keep `3` for preview so aiming stays precise). Fewer input points → fewer outline vertices → fewer fitted cubic segments.

#### b) Increase the cubic-fit error tolerance
`FIT_ERROR = 4.0` (squared distance). Raising to `6.0`–`9.0` produces fewer, longer bezier segments with imperceptible deviation for type-scale strokes. Expose as a hidden "curve tolerance" setting tied to `simplify`.

#### c) Aggressive collinearity cleanup
`cleanPolygon()` already drops colinear vertices (`dot > 0.998`). Lower the threshold to `0.995` and increase `MIN_CORNER_EDGE_LENGTH` from `3` to `4`–`5`. This removes near-straight bezier segments that waste on-curve points.

#### d) Decouple preview density from commit density
Preview currently resamples to `~140` samples (`PREVIEW_CAP_DEFAULT`). Commit uses full resampled points. Add a separate `COMMIT_RESAMPLE_DISTANCE` (e.g. `5`) so the live preview stays smooth while the committed outline stays lean. The preview is thrown away; the commit is forever in the glyph.

#### e) Straight mode already does this well
`BrushToolStraight` applies Douglas-Peucker (`eps = 1 + simplify*4`) before `generateSharpContour`, producing plain on-curve points with no handles. This is the leanest output. Make the `simplify` slider's effect more visible (label shows estimated anchor count).

#### f) Add a "point budget" readout
After commit, show `Stroke: N anchors (M smooth)` — the source already does this via `countAnchors()`. Keep it, and add a warning toast when a stroke exceeds a configurable anchor budget (e.g. 200 anchors) so the user learns to draw with fewer, longer gestures.

**Estimated point reduction:** 30–50% fewer on-curve anchors vs. the source's defaults, with no visible quality loss at text sizes.

---

### 5.2 UX / intuitiveness improvements

| Area | Source behavior | Recommended improvement |
|---|---|---|
| Mode switching | Segmented buttons in panel | Add tool-bar icons for Calligraphic / Straight / Eraser (not just Sculpt). Currently only the container `BrushToolAdvanced` shows one icon; sub-tools are hidden in a dropdown. |
| Size adjustment | Slider + `[` `]` keys | Add on-canvas HUD showing live size/angle while dragging (like the shift-angle toast already does). |
| Angle | Slider + `,` `.` keys | Show a rotating nib preview on hover (source draws an angle line; make it a filled nib wedge for instant direction readout). |
| Pressure | Toggle only | Add pressure-response curve preview in the panel (mini graph). |
| Undo | One undo per stroke | Group rapid consecutive strokes (<300ms apart) into a single undo entry for "gestural" drawing. |
| Eraser | Boolean subtract | Add "erase to selection only" toggle (already scoped via selection; expose in UI). |
| Dot stamp | Click-without-drag = dot | Keep, but also allow click-click to draw a straight line between two clicks (source does this via Shift + anchor; make it the default click-click behavior without Shift). |

---

### 5.3 Code-quality / maintainability improvements (porting fixes)

1. **Remove the `selectedToolChanged` event dependency.** The target's `sceneController` doesn't emit `selectedToolChanged`. `panel-brush.js` falls back to monkey-patching `setSelectedTool`, which works but is fragile when multiple panels do it. Replace with an explicit `editor.registerToolChangeListener(callback)` or call `_syncFromTool()` from `setSelectedTool` directly.

2. **Make visualization-layer registration explicit.** `brush-tool-base.js` registers layers on first instantiation (side-effect). Better: export `registerBrushVisualizationLayers()` and call it once from `editor.js` after `VisualizationLayers` is constructed, so layer ordering is deterministic.

3. **Decouple from `localStorage` in headless/test contexts.** `BrushSettingsStore.defaultSettingsBackend()` reads `localStorage`. The target runs in Electron/PyQt6; `localStorage` may be unavailable. The fallback to memory-only is already there — keep it, but add a `sessionStorage` option for persistence that survives dev-server reloads.

4. **Single settings file is already good.** `brush-settings.js` is the single source of truth — keep this pattern when adding new knobs (e.g. `curveTolerance`, `commitResampleDistance`, `anchorBudget`).

---

### 5.4 Performance improvements

- **StrokeInput typed arrays** are already used — keep. Do not refactor to per-point objects.
- **Preview rAF throttle** (`_schedulePreview`) already prevents frame drops — keep the 8 ms adaptive cap.
- **Sculpt spatial grid** already indexes glyph points once per stroke — keep.
- **Commit does backend union async before the transaction** — keep this pattern; it avoids jank.
- **Avoid `Path2D` recreation every frame** in preview — cache and mutate when possible (minor).

---

### 5.5 Professional polish checklist

- [ ] Consistent icons: one `brush.svg` for calligraphic, distinct icons for straight/sculpt/eraser (source reuses `brush.svg` for all four — confusing in the toolbar).
- [ ] Keyboard HUD: size/angle toasts already exist; extend to show "anchors committed" after each stroke.
- [ ] Dark-mode colors for viz layers already defined — keep.
- [ ] Localization keys: source uses `edit-tools-brush.*` and `sidebar.brush-settings.*` — add these to the target's translation files.
- [ ] Cursor: crosshair on canvas, add a nib-shaped cursor preview at brush size (optional, high polish).
- [ ] Pressure: if no tablet, simulate pressure from speed (fast = thin). Already partially in engine via `speedFactor`.

---

## 6. Decisions applied (from user feedback)

| # | Question | Decision |
|---|---|---|
| 1 | `bezier-js` dependency | **Add** to `package.json` dependencies (already present in `node_modules` v6.1.4) |
| 2 | Toolbar placement | **Nested** as a multi-tool container (4 sub-tools under one toolbar icon). Must work with the "show all tools" flat-mode toggle. |
| 3 | Persistence | **localStorage** via `BrushSettingsStore` (source behavior). Efficient and fast enough. |
| 4 | `simplify` default | **0.6** (raised from 0.5 for fewer points) |
| 5 | Translation keys | **Add** `edit-tools-brush.*` and `sidebar.brush-settings.*` to `en.js` (and other locales as needed) |
| 6 | Click-click straight line | **Default, no Shift required** — click once to anchor, click again to commit a straight stroke |

## 7. Porting plan — file map

Copy/adapt these 7 source files into the target:

```
src-js/fontra-core/src/
  brush-engine.js          (new)
  brush-stroke.js          (new)
  brush-settings.js        (new)
  brush-preview.js         (new)

src-js/views-editor/src/
  brush-tool-base.js       (new)
  edit-tools-brush-advanced.js  (new)
  panel-brush.js           (new)
```

Then wire into `editor.js`:
1. Add `bezier-js` to `package.json` dependencies + `npm install`
2. Import `BrushToolAdvanced` from `./edit-tools-brush-advanced.js`
3. Add `BrushToolAdvanced` to `editToolClasses` in `initTools()` (registers as a multi-tool with 4 nested sub-tools)
4. Import `BrushPanel` from `./panel-brush.js`
5. `this.addSidebarPanel(new BrushPanel(this), "right");` alongside the other right-sidebar panels
6. Register the 3 brush visualization layers (call `ensureBrushVisualizationLayers()` at editor init)

Verify npm deps: `bezier-js` is imported by `brush-engine.js`; `fit-cubic.js` already exists in target `fontra-core/src/`.

---

## 7. Recommended first commit (minimal viable port)

1. Copy the 7 core + editor files verbatim.
2. Add `BrushToolAdvanced` to `initTools()` and `BrushPanel` to right sidebar in `editor.js`.
3. Add `bezier-js` to dependencies if missing.
4. Run `npm run bundle`, then `npm test`.
5. Open the editor, select the brush tool, verify strokes commit and undo correctly.
6. Then apply the "fewer points" tweaks (resample distance, fit error, collinearity) as a second commit with before/after anchor counts.

---

**Bottom line:** The source brush tool is production-quality and well factored. The port is mostly a copy-plus-wire job. The biggest value-add on top of the port is tightening the curve-fitting/resample parameters to honor your "fewer vector points" constraint, plus toolbar icons and a point-budget readout for professional feel.

---

## 8. Port status — COMPLETE ✅

All 7 new files created, 2 existing files modified (`editor.js`, `en.js`), 1 dependency added (`bezier-js`), 4 new Phosphor icons added. Bundle compiles cleanly; all 1212 existing tests pass.

### Files created (8 new)
| File | Purpose |
|---|---|
| `src-js/fontra-core/src/brush-settings.js` | Settings store, defaults, bounds, presets, modes |
| `src-js/fontra-core/src/brush-stroke.js` | StrokeInput buffer, SpatialGrid, adaptPreviewCap |
| `src-js/fontra-core/src/brush-engine.js` | BrushEngine geometry (broad-nib, cubic fit, outline) |
| `src-js/fontra-core/src/brush-preview.js` | Sidebar preview canvas geometry |
| `src-js/views-editor/src/brush-tool-base.js` | Base classes, FSM, viz layers, drag loop |
| `src-js/views-editor/src/edit-tools-brush-advanced.js` | 4 sub-tools (calligraphic, straight, sculpt, eraser) |
| `src-js/views-editor/src/panel-brush.js` | Right-sidebar settings panel |
| `BRUSH_TOOL_PORT_REPORT.md` | This report |

### Files modified (2)
| File | Change |
|---|---|
| `package.json` | Added `bezier-js` dependency |
| `src-js/views-editor/src/editor.js` | Imported `BrushToolAdvanced`, `BrushPanel`, `registerBrushVisualizationLayers`; added brush to `initTools()` tool list; registered viz layers; added `BrushPanel` to right sidebar |
| `src-js/fontra-core/assets/lang/en.js` | Added `editor.brush-tool-*`, `edit-tools-brush.undo.*`, `sidebar.brush-settings.*` translation keys |

### New assets (4 Phosphor icons)
| File | Used by |
|---|---|
| `src-js/fontra-core/assets/images/brush-calligraphic.svg` | Calligraphic mode (`paint-brush-broad`) |
| `src-js/fontra-core/assets/images/brush-straight.svg` | Straight mode (`pen-nib-straight`) |
| `src-js/fontra-core/assets/images/brush-sculpt.svg` | Sculpt mode (`hand`) |
| `src-js/fontra-core/assets/images/brush-eraser.svg` | Eraser mode (`eraser`) |

### Verification
- `node --check` — all 8 JS files pass syntax check
- `npm run bundle` — webpack compiles cleanly (3 pre-existing size warnings only)
- `npm test` — **1212 passing**, 0 failing

