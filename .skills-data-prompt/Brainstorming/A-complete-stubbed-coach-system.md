# Category A: Complete the Stubbed-Out Coach System

> Highest Impact, Lowest New Code — these features already have scaffolding in `fontra-coach/`

## Context

The `fontra-coach/` plugin contains extensive scaffolding with mostly empty implementations. It registers panels and visualization layers via `ui.registerPanel()` and `ui.registerVisualizationLayer()`, but the main editor's `editor.js` never invokes the plugin. Connecting it unlocks DNA panel, Workflow panel, and Consistency panel with minimal new code.

The Python server-side `glyph_analysis.py` (544 lines) already performs stem detection, overshoot measurement, and curve analysis — but no UI consumes these results.

---

## Feature A1: Wire the Coach Plugin into the Editor

**Problem:** The `fontra-coach/` plugin's `activate()` function registers panels through `ui.registerPanel()`, but the main editor never calls this plugin. Three panels (DNA, Workflow, Consistency) are invisible to users.

**Implementation:**
- In `src-js/views-editor/src/editor.js`, import and invoke the coach plugin's `activate()` function during editor initialization
- Ensure the plugin's panel registrations are compatible with the editor's sidebar panel system
- Test that all three coach panels appear in the sidebar and receive glyph change events

**Files to modify:**
- `src-js/views-editor/src/editor.js` — add plugin activation call
- `fontra-coach/src/plugin.js` — verify `activate()` API matches editor expectations

---

## Feature A2: Implement Curve Quality Detection

**Problem:** All four detection functions in `fontra-coach/src/analysis/curve-inspector.js` return hardcoded defaults. The CURV-001 through CURV-005 rules in the knowledge base are never evaluated against real glyph data.

**Implementation:**

| Rule | Detection Logic | Status |
|------|----------------|--------|
| CURV-001 | Handle length ratio for circular arcs (magic number 0.552) | Stub: `isNearCircularArc()` returns false |
| CURV-002 | Missing extrema points | Stub: `hasExtremaWithoutOncurvePoint()` returns false |
| CURV-003 | Broken tangent at curve-to-line joins | Stub: `measureTangentBreak()` returns 0 |
| CURV-004 | Unintended S-curves (curvature reversal) | Stub: `hasCurvatureReversal()` returns false |

**Specific implementations:**
- `isNearCircularArc(handleLength, chordLength)`: Calculate expected handle length for a perfect circle (0.552 * chordLength) and compare within tolerance
- `hasExtremaWithoutOncurvePoint(segment)`: Check if a cubic bezier segment has an extremum point that does not have a corresponding on-curve point within a threshold distance
- `measureTangentBreak(segmentA, segmentB)`: At the junction point, compute the angle between the incoming handle of segmentB and the outgoing handle of segmentA; flag if > threshold (e.g., 5 degrees)
- `hasCurvatureReversal(segment)`: Sample the curvature at multiple t values along the segment; detect sign changes indicating unwanted S-curves

**Files to modify:**
- `fontra-coach/src/analysis/curve-inspector.js` — implement all four detection functions

---

## Feature A3: Implement Overlay Visualization

**Problem:** All four renderer classes in `fontra-coach/src/ui/overlay-layer.js` have empty `paint()` methods. Users never see visual warnings drawn on the glyph canvas.

**Implementation:**

| Renderer | Purpose | Implementation |
|----------|---------|----------------|
| `HighlightStrokeRenderer` | Highlight problematic strokes | Draw a colored overlay on segments that fail analysis checks |
| `DimensionArrowRenderer` | Show dimension arrows (e.g., missing overshoot) | Draw annotated arrows between metric lines and curve extrema |
| `CrosshairRenderer` | Crosshair with offset markers | Draw crosshairs at detected extremum points with distance labels |
| `ComparisonPanelRenderer` | Side-by-side comparisons | Render a ghost overlay of a reference glyph |

**Each renderer needs:**
- A `paint(ctx, glyph, analysisResults)` method that draws on the Canvas2D context
- Color coding: red for critical issues, yellow for warnings, green for passing
- Toggle on/off via the visualization layer system

**Files to modify:**
- `fontra-coach/src/ui/overlay-layer.js` — implement all four `paint()` methods

---

## Feature A4: Implement Font-Wide Auditing

**Problem:** `font-auditor.js`'s `conductAudit()` returns a hardcoded pass-all structure. No cross-glyph comparison occurs.

**Implementation:**
- Iterate all glyphs in the font
- Run analysis on each glyph (stems, overshoots, curves)
- Compare measurements across glyphs:
  - **Overshoot consistency**: Are all overshoots within 2-3 units of each other?
  - **Stem weight consistency**: Are vertical stems consistent across all glyphs? Flag outliers > 5 units from the mean
  - **Spacing rhythm**: Do sidebearings follow the expected patterns (=n, =o relationships)?
  - **Terminal family consistency**: Do terminals (on c, e, s, f, etc.) have consistent shapes and angles?
  - **Stroke contrast**: Is the ratio of vertical stem to horizontal bar consistent?
- Return a structured report with per-glyph issues and font-wide summary

**Files to modify:**
- `fontra-coach/src/analysis/font-auditor.js` — implement `conductAudit()`

---

## Feature A5: Fill in Knowledge Base Data

**Problem:** `commonMistakes`, `reusableComponents`, and `optical corrections` arrays are all empty `[]` for every glyph in `type-design-knowledge.json`. The UI has full rendering support for these sections but they never display content.

**Implementation — populate for key glyphs:**

### Common Mistakes (examples)
- **n**: "Stems not equal width", "Arch too flat or too round", "Shoulder not reaching mid-stem"
- **o**: "Asymmetric sidebearings", "Overshoot missing or too small", "Stress angle inconsistent with other round glyphs"
- **a**: "Counter too small relative to o", "Terminal angle inconsistent with c/e/s", "Bowl not matching o's curvature"
- **h**: "Ascender height not matching l/k", "Arch identical to n (should be slightly different)", "Shoulder width inconsistent"

### Reusable Components (examples)
- **n**: "Bowl from o (for arch)", "Stem from l"
- **h**: "Base from n (add ascender)", "Ascender from l"
- **b**: "Base from n (flip + extend)", "Bowl from o"
- **d**: "Base from n (flip + extend)", "Bowl from o"
- **m**: "Base from n (add second arch)"
- **u**: "Base from n (flip vertically)"

### Optical Corrections (examples)
- **o**: Link to OPT-001 (overshoot compensation), OPT-003 (counter correction)
- **n**: Link to OPT-002 (stem weight balance)
- **e**: Link to OPT-004 (eye size correction), OPT-005 (terminal angle)

**Files to modify:**
- `src-js/fontra-core/assets/data/type-design-knowledge.json` — populate empty arrays
- `fontra-coach/knowledge/v1/knowledge-cards.json` — add common mistakes and reusable components

---

## Feature A6: Implement Ghost/Comparison Overlays

**Problem:** The DNA panel has a "Toggle Ghost Overlay" button that only logs to console. The concept of overlaying a related glyph is designed but not implemented.

**Implementation:**
- When the user clicks "Toggle Ghost Overlay" for a DNA relationship (e.g., n → h):
  - Load the referenced glyph's path data from the font backend
  - Render it as a semi-transparent overlay on the current glyph's canvas
  - Use a distinct color (e.g., light blue at 30% opacity)
  - Allow the user to toggle the overlay on/off
  - Support overlaying multiple related glyphs simultaneously

**Files to modify:**
- `fontra-coach/src/ui/dna-panel.js` — wire up the toggle button to actual overlay rendering
- `fontra-coach/src/ui/overlay-layer.js` — add a `GhostOverlayRenderer` class

---

## Dependencies

- None — these features build on existing code only
- A1 is a prerequisite for A2–A6 to be visible to users

## Estimated Effort

| Feature | Effort | Risk |
|---------|--------|------|
| A1: Wire plugin | Low | Low — mostly wiring |
| A2: Curve detection | Medium | Medium — requires bezier math |
| A3: Overlay visualization | Medium | Low — Canvas2D rendering is straightforward |
| A4: Font-wide audit | Medium | Medium — needs careful cross-glyph comparison |
| A5: Knowledge base data | Low | Low — content authoring |
| A6: Ghost overlays | Medium | Low — rendering + data loading |
