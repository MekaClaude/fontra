# Category F: Component & Reuse System

> Leverage structural relationships to speed up glyph creation

## Context

The Glyphs sketching tutorial emphasizes that the `n` "does not take a lot of imagination to turn an n into letters such as h, i, m, r, u." The fontra-coach DNA system maps these relationships in `glyph-dna.json`. Components are fundamental to efficient type design — most glyphs are built from reusable parts.

Fontra already supports components (adding, removing, decomposing) but lacks smart suggestions and automated assembly.

---

## Feature F1: Smart Component Suggestions

**Problem:** When creating a new glyph, beginners don't realize they can reuse parts from existing glyphs. They draw everything from scratch, leading to inconsistency and wasted time.

**Implementation:**

### DNA-Based Suggestions
- When the user creates a new glyph (e.g., `h`), consult `glyph-dna.json` to find:
  - What glyphs it's derived from (e.g., `n` → `h` via `add_ascender`)
  - What derivation method is used
- Display a suggestion panel: "h can be built from n. Want to start with n's shapes?"

### Shape Matching
- For glyphs not in the DNA database, use geometric analysis:
  - Compare the new glyph's bounding box and structure to existing glyphs
  - Suggest the most similar glyph as a component base
- Example: If the user draws a `d`, suggest "This looks similar to `b` — want to mirror it?"

### One-Click Assembly
- "Build from components" button that:
  1. Copies the base glyph's paths as components
  2. Applies the derivation transformation (flip, extend, add part)
  3. The user then fine-tunes the result
- This is not full automation — it's a starting point that the user refines

### Component Relationship Display
- In the Selection Info panel, when a component is selected:
  - Show which base glyph it references
  - Show the transformation applied (offset, scale, flip)
  - Offer "Update from base" if the base glyph has changed

**Files to modify:**
- `fontra-coach/src/ui/dna-panel.js` — add "Build from components" button
- `fontra-coach/knowledge/v1/glyph-dna.json` — ensure derivation methods include transformation details
- `src-js/views-editor/src/panel-selection-info.js` — enhance component info display

---

## Feature F2: Component Decomposition Assistant

**Problem:** When pasting or importing glyphs (from other fonts, SVG files, or clipboard), the result is often flat outlines with no component structure. Beginners don't know how to decompose these into reusable parts.

**Implementation:**

### Auto-Detection
- When a glyph is pasted or imported:
  - Analyze its contours for recognizable shapes
  - Compare against existing glyphs in the font
  - If a contour matches an existing glyph (within tolerance), suggest converting it to a component

### Matching Algorithm
- For each contour in the pasted glyph:
  - Calculate its bounding box, point count, and rough shape signature
  - Compare against all glyphs in the font
  - If a match is found (e.g., the left stem of the pasted `h` matches `n`'s left stem):
    - Highlight the matching region
    - Suggest: "This section matches `n`. Convert to component?"

### Manual Decomposition
- Allow the user to select a region of contours
- "Extract as component" button that:
  1. Creates a new glyph from the selected contours
  2. Replaces the selected contours with a component reference
  3. Names the new glyph based on its shape (or prompts the user)

**Files to modify:**
- New: `src/fontra/core/component_detector.py` — server-side shape matching
- New: `src-js/fontra-core/src/component-detector.js` — client-side shape matching
- `src-js/views-editor/src/editor.js` — add paste/import decomposition hook

---

## Dependencies

- F1 (smart suggestions) depends on the DNA knowledge base
- F2 (decomposition) is independent but benefits from the DNA data
- Both features benefit from A1 (wired coach plugin)

## Estimated Effort

| Feature | Effort | Risk |
|---------|--------|------|
| F1: Smart suggestions | Medium | Low — data exists, needs UI actions |
| F2: Decomposition assistant | High | Medium — shape matching is non-trivial |
