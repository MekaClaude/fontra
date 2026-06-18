# Category C: Live Analysis & Real-Time Feedback

> Connect server-side analysis to the UI for immediate feedback while editing

## Context

The Python `glyph_analysis.py` module (544 lines) performs stem detection, overshoot measurement, and curve analysis on the server side. The JavaScript `fontra-coach/src/analysis/geom-analyzer.js` performs similar analysis on the client side. Neither is connected to the editing UI — the Pro Advice panel only shows static JSON tips.

The Glyphs sketching tutorial emphasizes precision steps: align nodes, equalize stems, add overshoot, adjust curvatures. These are all measurable and could be checked in real-time.

---

## Feature C1: Live Glyph Analysis on Edit

**Problem:** The `AnalysisEngine.onGlyphEdited()` method exists in the coach plugin but nothing calls it. No live feedback loop exists.

**Implementation:**

### Hook into Edit Events
- In `scene-controller.js` or `editor.js`, after a glyph modification is applied:
  1. Send the updated glyph path data to the server for analysis (or run client-side analysis)
  2. Receive `GlyphAnalysis` results (vertical stems, horizontal stems, overshoots, curves)
  3. Compare against expected values from the knowledge base
  4. Generate warnings/info items
  5. Display them in the Pro Advice panel and/or as overlay visualizations

### Debouncing
- Don't analyze on every mouse move — debounce to ~500ms after the last edit action
- Only analyze when the user completes a discrete action (place point, move point, close path)

### Performance
- Use the client-side `geom-analyzer.js` for fast feedback
- Use the server-side `glyph_analysis.py` for detailed analysis (less frequent, e.g., on save or explicit request)

**Files to modify:**
- `src-js/views-editor/src/scene-controller.js` — add post-edit analysis hook
- `src-js/views-editor/src/panel-pro-advice.js` — accept live analysis results in addition to static KB
- `fontra-coach/src/event-broker.js` — ensure glyph edit events are broadcast to analysis consumers

---

## Feature C2: Stem Equalization Helper

**Problem:** Per the Glyphs tutorial: "Select the four nodes that make up the stem... make sure both stems have the same width." Beginners often draw stems at inconsistent widths without noticing.

**Implementation:**

### Detection
- After analysis, compare all detected vertical stem widths
- If any two stems that should be equal (e.g., both stems of `n`) differ by more than a threshold (e.g., 3 units):
  - Flag as a warning

### Visual Feedback
- Show dimension arrows on each stem with their width values
- Color-code: green if equal, yellow if close (within 5 units), red if significantly different
- In the Pro Advice panel, show: "Stem 1: 62 units, Stem 2: 68 units — should be equal"

### One-Click Fix
- "Equalize stems" button that:
  - Calculates the average stem width
  - Adjusts all stem nodes to match the average
  - Works via the change system (creates a proper undo-able change)

### Smart Detection
- Determine which stems should be equal by:
  - Stems within the same glyph that are approximately vertical and parallel
  - Stems at similar y-ranges (e.g., the two stems of `n`)
  - Reference the glyph's DNA to know structural expectations

**Files to modify:**
- `fontra-coach/src/analysis/geom-analyzer.js` — enhance `measureStems()` to group related stems
- `fontra-coach/src/knowledge/rule-evaluator.js` — add stem equality rule
- `src-js/views-editor/src/panel-pro-advice.js` — display stem comparison with fix button
- New: `fontra-coach/src/ui/stem-equalizer.js` — stem equalization action logic

---

## Feature C3: Overshoot Calculator

**Problem:** Per the Glyphs tutorial: "The extremum point of the top arch needs to be slightly above the x-height... Most overshoots are between 10 and 15 units." Beginners either forget overshoots entirely or use inconsistent values.

**Implementation:**

### Detection
- Use `glyph_analysis.py`'s `measure_overshoots()` or implement client-side equivalent
- Given metric lines (baseline, x-height, cap-height, descender, ascender):
  - Find the extreme Y-coordinates of curves that approach each metric line
  - Calculate the overshoot distance (how far past the line the curve extends)

### Display
- Show a small label next to each overshoot: "+12 units past x-height"
- Color-code: green if within acceptable range (8-15 units), yellow if borderline, red if missing

### Smart Suggestions
- Based on the font's intended use:
  - **Display size** (large): suggest 8-10 unit overshoot
  - **Text size** (small): suggest 10-15 unit overshoot
  - **Caption size** (very small): suggest 15-20 unit overshoot
- Default to 12 units if unknown

### One-Click Fix
- "Apply standard overshoot" button that:
  - Finds the curve approaching the metric line
  - Adjusts the extreme point to be exactly the recommended overshoot distance past the line
  - Works for baseline, x-height, and cap-height independently

**Files to modify:**
- `src/fontra/core/glyph_analysis.py` — verify `measure_overshoots()` works correctly
- `fontra-coach/src/analysis/geom-analyzer.js` — implement client-side `measureOvershoot()` (currently stubbed)
- `fontra-coach/src/knowledge/rule-evaluator.js` — add overshoot range rule
- `src-js/views-editor/src/panel-pro-advice.js` — display overshoot values with fix button

---

## Feature C4: Curvature Visualization Enhancement

**Problem:** Fontra already has a SpeedPunk panel for curvature visualization, but it doesn't show numeric values or highlight problems at extremum points.

**Implementation:**

### Numeric Curvature Display
- When SpeedPunk is active, overlay curvature percentage numbers on each segment
- The Glyphs tutorial specifies: "A curvature of 55% is elliptical... we usually need something higher... at least 57 or 58%... usually just under 80%"
- Show the actual curvature % on each segment

### Extremum Bump Detection
- Per the Glyphs tutorial: "Perhaps you see something that looks like a little bump in the curve, pretty much exactly where the two curve segments meet in the extremum node"
- At each extremum point, compare the curvature of the incoming and outgoing segments
- If the curvature changes abruptly (e.g., one side is 60% and the other is 75%), flag as a potential bump

### Harmonize Action
- "Harmonize curves" button that:
  - Adjusts handle lengths at extremum points to smooth curvature transitions
  - This is the digital equivalent of the Glyphs "G2 continuity" technique described in the tutorial
  - Implement as a path transformation that equalizes curvature on both sides of an extremum

**Files to modify:**
- `src-js/views-editor/src/panel-speedpunk.js` or equivalent — add numeric overlay
- `fontra-coach/src/analysis/curve-inspector.js` — implement bump detection logic
- New: `fontra-coach/src/ui/curvature-harmonizer.js` — harmonize action

---

## Dependencies

- A1 (wiring the coach plugin) is a prerequisite for C1–C4 to be visible
- C1 (live analysis hook) is a prerequisite for C2–C4 to receive data
- C2, C3, C4 are independent of each other

## Estimated Effort

| Feature | Effort | Risk |
|---------|--------|------|
| C1: Live analysis hook | Medium | Medium — event system integration |
| C2: Stem equalizer | Medium | Medium — path manipulation |
| C3: Overshoot calculator | Medium | Low — analysis exists, needs UI |
| C4: Curvature enhancement | Medium | Medium — requires curvature math |
