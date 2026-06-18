# Category D: Spacing & Sidebearing Tools

> Help beginners achieve good spacing without kerning — the Glyphs philosophy

## Context

The Glyphs spacing tutorial emphasizes: "Try to get as far as possible without kerning." Good sidebearings reduce the need for kerning. The tutorial introduces sidebearing arithmetic (e.g., `=n`, `=o`, `=n+20`), placeholder characters, and test strings like `noononno`.

Fontra currently has a Metrics Tool for editing sidebearings numerically, but no arithmetic, no test string generation, and no batch processing.

---

## Feature D1: Sidebearing Arithmetic

**Problem:** Per the Glyphs tutorial: "Instead of entering a number value indicating the sidebearing distance, we enter the name of another glyph!" Beginners manually set each glyph's sidebearings independently, missing opportunities for consistency.

**Implementation:**

### Parse Metrics Keys
- Extend the sidebearing input fields (LSB, RSB, Width) in the Selection Info panel to accept:
  - Plain numbers: `60`
  - Glyph references: `n` (use n's LSB/RSB)
  - Arithmetic: `=n+20` (n's value + 20)
  - Opposite sidebearing: `=|a+20` (opposite side of a + 20)
  - Master-specific: `==n+15` (only for current master)

### Auto-Update
- When a referenced glyph's sidebearing changes, all glyphs referencing it should update
- This may require a dependency graph and change propagation system
- The existing change system in `src/fontra/core/changes.py` could support this

### Display
- Show the resolved numeric value but also display the formula
- Visual indicator that the value is "linked" to another glyph (e.g., a chain icon)

### Common Patterns
- Provide a dropdown/autocomplete with common patterns:
  - `=n` for LSB of: b, h, i, k, l, m, p, r
  - `=n` for RSB of: a, h, m
  - `=o` for LSB of: c, d, e, g, q
  - `=o` for RSB of: b, p
  - `=H` for LSB of uppercase: B, D, E, F, I, K, L, M, N, P, R
  - `=O` for LSB of uppercase: C, G, Q

**Files to modify:**
- `src-js/views-editor/src/panel-selection-info.js` — extend sidebearing input parsing
- `src/fontra/core/classes.py` or `src/fontra/core/fonthandler.py` — add metrics key resolution logic
- New: `src/fontra/core/metricskeys.py` — metrics key parser and resolver

---

## Feature D2: Spacing Test String Generator

**Problem:** Per the Glyphs tutorial: "Type `noononno` and fiddle around until all letters appear equidistant." Beginners don't know which test strings to use for each glyph.

**Implementation:**

### Test String Database
Create a mapping of glyph names to optimal test strings:

```javascript
const testStrings = {
  // Lowercase
  n: "noononno",
  o: "ononono",
  h: "honoho",
  m: "momomo",
  u: "uououo",
  a: "anaoana",
  e: "eneoene",
  i: "inionio",
  l: "lololo",
  b: "bobobo",
  d: "dododo",
  p: "popopo",
  q: "qoqoqo",
  c: "cococo",
  s: "sososo",
  // Uppercase
  H: "HOHOHO",
  O: "OHOHOH",
  N: "NONONO",
  M: "MOMOMO",
  // Default
  _default: "Hamburgevons"
};
```

### Auto-Populate Text Panel
- When the user selects a glyph for spacing, offer a "Load test string" button
- Clicking it populates the text entry panel with the appropriate test string
- Place the cursor at the beginning of the current glyph's occurrences

### Smart Detection
- Detect when the user is in "spacing mode" (editing sidebearings frequently)
- Auto-suggest loading the test string

**Files to modify:**
- `src-js/views-editor/src/panel-text-entry.js` — add test string loading
- New: `src-js/fontra-core/src/spacing-test-strings.js` — test string database

---

## Feature D3: Placeholder Characters in Text

**Problem:** Per the Glyphs tutorial: "A placeholder always displays the current glyph, i.e. the glyph right after the cursor." This lets you see the glyph you're spacing in context with other letters.

**Implementation:**

### Special Character Support
- Define a special Unicode character (e.g., U+E000 PRIVATE USE AREA) as a placeholder
- In the text rendering pipeline, when a placeholder character is encountered:
  - Replace it with the glyph name of the glyph at the cursor position (or the glyph being edited)
  - Render that glyph instead of the placeholder

### Text Entry Integration
- Add a "Insert Placeholder" button in the text entry panel
- Keyboard shortcut: Ctrl/Cmd+Shift+P (matching Glyphs)

### Behavior
- Placeholders update dynamically as the user moves the cursor or selects different glyphs
- When the cursor is at the end of the text, the placeholder shows the previously typed glyph

**Files to modify:**
- `src-js/fontra-core/src/scene-model.js` — handle placeholder characters during text layout
- `src-js/fontra-core/src/glyph-controller.js` — resolve placeholder to current glyph
- `src-js/views-editor/src/panel-text-entry.js` — add insert placeholder button

---

## Feature D4: Batch Metrics Transformer

**Problem:** Per the Glyphs tutorial: "Glyph > Transform Metrics" lets you set LSB and RSB for multiple glyphs at once. Fontra only supports editing one glyph's metrics at a time.

**Implementation:**

### Multi-Select in Font Overview
- Allow selecting multiple glyphs in the font overview (cell grid)
- Show a batch metrics panel when multiple glyphs are selected

### Transform Options
- **Set absolute**: Set LSB/RSB to a specific value for all selected glyphs
- **Set relative**: Add/subtract a value from current LSB/RSB of all selected glyphs
- **Apply metrics key**: Set the same metrics key (e.g., `=n`) for all selected glyphs
- **Multiply/Divide**: Scale sidebearings by a factor

### UI
- A panel or modal that appears when multiple glyphs are selected
- Input fields for LSB, RSB, and Width with "Absolute" / "Relative" toggle
- "Apply to all selected glyphs" button
- Preview: show before/after sidebearing values for the first few selected glyphs

**Files to modify:**
- `src-js/views-fontoverview/src/fontoverview.js` — enable multi-select
- New: `src-js/views-editor/src/panel-batch-metrics.js` — batch metrics panel
- `src-js/views-editor/src/editor.js` — register the batch metrics panel

---

## Dependencies

- D1 (sidebearing arithmetic) is independent
- D2 (test strings) is independent
- D3 (placeholders) is independent
- D4 (batch metrics) requires multi-select in font overview

## Estimated Effort

| Feature | Effort | Risk |
|---------|--------|------|
| D1: Sidebearing arithmetic | High | High — change propagation system needed |
| D2: Test strings | Low | Low — simple lookup table + text panel integration |
| D3: Placeholders | Medium | Medium — text rendering pipeline modification |
| D4: Batch metrics | Medium | Medium — multi-select + batch operations |
