# Category H: Learning & Reference

> Built-in education and diagnostic tools for continuous improvement

## Context

The fontra-coach knowledge base already contains `commonTerms` definitions (overshoot, counter, stem, bowl, etc.) and optical correction rules (OPT-001 through OPT-005), but neither is exposed to users. The Glyphs tutorial uses terminology that beginners may not understand.

---

## Feature H1: Terminology Tooltips

**Problem:** The knowledge base has a `commonTerms` dictionary but no code applies the `.pro-advice-term` CSS class to terminology in the advice text. Beginners encounter unfamiliar terms without explanation.

**Implementation:**

### Term Detection
- When rendering advice text in the Pro Advice panel:
  - Scan for known terms from the `commonTerms` dictionary
  - Wrap each occurrence in a `<span class="pro-advice-term">` element
  - Terms include: overshoot, counter, stem, bowl, shoulder, terminal, serif, sans, ascender, descender, x-height, cap-height, baseline, sidebearing, kerning, ligature, extrema, handle, node, contour, path, component

### Tooltip Display
- On hover, show a tooltip with:
  - The term's definition from the knowledge base
  - A small diagram showing the term visually (e.g., a diagram of a letter with the overshoot labeled)
  - A link to a relevant Glyphs tutorial for deeper reading (external link)

### Progressive Disclosure
- For "learner" verbosity level: show all term tooltips
- For "practitioner" level: only show tooltips for less common terms
- For "expert" level: hide tooltips (experts know the terms)

**Files to modify:**
- `src-js/views-editor/src/panel-pro-advice.js` — add term detection and tooltip rendering
- `src-js/fontra-core/assets/data/type-design-knowledge.json` — verify `commonTerms` has definitions
- New: `src-js/fontra-webcomponents/src/tooltip.js` — reusable tooltip web component (or use existing modal system)

---

## Feature H2: "What's Wrong?" Diagnostic Mode

**Problem:** Beginners don't know what's wrong with their glyph or how to fix it. They need a prioritized list of issues with actionable fixes.

**Implementation:**

### Diagnostic Toggle
- A button in the Pro Advice panel: "Diagnose glyph" or "Check for issues"
- When activated, runs all analysis checks on the current glyph

### Issue List
- Display a prioritized list of issues:
  - **Red (Critical)**: Missing overshoots, stems at wildly different widths, missing extrema
  - **Yellow (Suggestion)**: Curves slightly bumpy, handles not axis-aligned, counter inconsistency
  - **Green (Good)**: Things that pass checks (positive reinforcement!)

### For Each Issue
- **Description**: "Vertical stems are 62 and 68 units — should be equal"
- **Location**: Highlight the affected nodes/segments on the canvas
- **Fix button**: One-click action that applies the recommended fix
- **Learn more**: Link to relevant tutorial or knowledge base entry

### Issue Categories
Based on the existing analysis and knowledge base:

| Category | Issues Checked |
|----------|---------------|
| **Stems** | Inconsistent stem widths, stems not parallel, missing stems |
| **Overshoots** | Missing overshoots, inconsistent overshoot amounts |
| **Curves** | Missing extrema, bumpy curves, curvature reversals, handle alignment |
| **Spacing** | Sidebearings not following patterns, inconsistent spacing |
| **Structure** | Components could be reused, paths could be simplified |

### Auto-Run Option
- Toggle: "Auto-diagnose while editing"
- When enabled, runs diagnosis after each edit action (with debouncing)
- Shows a small badge on the Pro Advice panel icon with the issue count

**Files to modify:**
- `src-js/views-editor/src/panel-pro-advice.js` — add diagnostic mode UI
- `fontra-coach/src/knowledge/rule-evaluator.js` — ensure all rules produce actionable issue objects
- `fontra-coach/src/analysis/curve-inspector.js` — implement detection (see Category A)
- `fontra-coach/src/ui/overlay-layer.js` — implement issue highlighting on canvas (see Category A)

---

## Feature H3: Progress Dashboard

**Problem:** Beginners don't have a holistic view of their font's quality and completion status. They focus on individual glyphs without seeing the big picture.

**Implementation:**

### Dashboard View
A new panel or view (accessible from the font overview) showing:

#### Completion Metrics
- **Glyphs drawn**: X of Y required glyphs (with progress bar)
- **Spacing completion**: X of Y glyphs have custom sidebearings
- **Kerning completion**: X kern pairs defined
- **Quality score**: Based on analysis results (0-100)

#### Quality Breakdown
- **Stem consistency**: Score based on stem width variance across glyphs
- **Overshoot consistency**: Score based on overshoot amount variance
- **Curve quality**: Score based on number of curve issues detected
- **Spacing rhythm**: Score based on sidebearing pattern adherence

#### Visual Summary
- Heat map of the glyph grid:
  - Dark green: Drawn + spaced + quality checks pass
  - Light green: Drawn + spaced
  - Yellow: Drawn but not spaced
  - Gray: Not drawn
- Clicking a cell jumps to editing that glyph

#### Recommendations
- "Next steps" list:
  - "Draw 'g' — it's needed for basic Latin and uses your existing 'o' and 'c' shapes"
  - "Space your uppercase — you've spaced lowercase but uppercase still has defaults"
  - "Check stem consistency — your stems range from 58 to 72 units"

### Export Readiness
- Traffic light system:
  - **Red**: Cannot export (missing required glyphs)
  - **Yellow**: Can export but with warnings (inconsistent quality)
  - **Green**: Ready to export (all checks pass)

**Files to create/modify:**
- New: `src-js/views-fontoverview/src/panel-dashboard.js` — dashboard panel
- `src-js/views-fontoverview/src/fontoverview.js` — register dashboard panel
- `src/fontra/core/font_analysis.py` — new module for font-wide analysis aggregation
- `src-js/fontra-core/src/font-controller.js` — expose font-wide analysis data

---

## Dependencies

- H1 (terminology tooltips) is independent
- H2 (diagnostic mode) depends on A2 (curve detection), A3 (overlay visualization), and C1 (live analysis)
- H3 (progress dashboard) depends on C1 (live analysis) and G2 (checklist data)

## Estimated Effort

| Feature | Effort | Risk |
|---------|--------|------|
| H1: Terminology tooltips | Low | Low — text processing + tooltip |
| H2: Diagnostic mode | Medium | Medium — depends on analysis features |
| H3: Progress dashboard | Medium | Medium — aggregation + new view |
