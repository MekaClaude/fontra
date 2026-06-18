# Category G: Quick-Start Templates & Presets

> Provide starter fonts and checklists so beginners can start fast

## Context

Many beginners are overwhelmed by a blank canvas. Starter templates give them a working foundation to modify rather than creating everything from scratch. The Glyphs workflow emphasizes starting with a minimal set of glyphs and expanding outward.

---

## Feature G1: Font Starter Templates

**Problem:** Beginners face a blank canvas with hundreds of empty glyph slots. They don't know where to start or what a "good" starting point looks like.

**Implementation:**

### Template Library
Create 4-6 starter templates, each a complete `.fontra` or `.designspace` project:

| Template | Description | Glyphs Included |
|----------|-------------|-----------------|
| **Sans Serif** | Clean, geometric sans | n, o, h, m, u, a, e, i, l, d, p, b, q, c, s, r, t, g, j, k, v, w, x, y, z |
| **Serif** | Traditional roman serif | Same + serifs pre-drawn |
| **Monospace** | Fixed-width coding font | Same, with equal widths |
| **Display** | Bold, high-contrast display | Larger overshoots, thinner hairlines |
| **Handwritten** | Casual script style | Connected letterforms |

### Template Contents
Each template includes:
- Pre-drawn "essential" glyphs with proper outlines
- Sidebearing arithmetic already set up (=n, =o relationships)
- Basic OpenType features (kern, liga) pre-configured
- Variation axes defined (if variable font template)
- Font metadata set (family name, designer, license)
- A README explaining the template's design choices

### Template Selection UI
- On new font creation (File > New), show a template selector
- Options: "Blank font" | "Sans starter" | "Serif starter" | "Mono starter" | etc.
- Preview: show a few sample characters from each template
- The user selects one and gets a working starting point

### Customization
- Templates are just regular font projects — the user can modify everything
- No lock-in — the user owns the font from the start

**Files to create:**
- New: `templates/sans-starter/` — complete sans starter project
- New: `templates/serif-starter/` — complete serif starter project
- New: `templates/mono-starter/` — complete monospace starter project
- New: `templates/display-starter/` — complete display starter project
- `src/fontra/filesystem/projectmanager.py` — add template selection to new-font workflow
- New: `src-js/views-applicationsettings/src/template-selector.js` — template selection UI

---

## Feature G2: "Minimal Viable Font" Checklist

**Problem:** Beginners don't know when their font is "done enough" to use or export. They either give up too early or spend forever on glyphs that don't matter yet.

**Implementation:**

### Checklist Levels

#### Level 1: Basic Latin (Minimum Viable Font)
- Required glyphs: space, A-Z, a-z, 0-9, period, comma, hyphen, question mark, exclamation
- ~70 glyphs total
- Status indicators: Not started | In progress | Drawn | Spaced | Kerned | Ready

#### Level 2: Extended Latin
- Add: accented characters, ligatures, common punctuation
- ~200 glyphs total

#### Level 3: Full Latin
- Add: small caps, oldstyle figures, special characters
- ~400 glyphs total

### Progress Tracking
- For each glyph, track:
  - **Drawn**: Has non-empty paths
  - **Spaced**: Has custom sidebearings (not default)
  - **Kerned**: Has kerning entries
  - **Ready**: Passes basic quality checks (no missing extrema, consistent stems)

### Dashboard View
- A panel or view showing:
  - Overall completion percentage
  - Bar chart of glyph statuses
  - List of "next glyphs to work on" (prioritized by importance)
  - Export readiness: "Your font can already be used for basic Latin text"

### Export Gating
- Before export, check the checklist:
  - If Level 1 is complete: allow export with a warning "You have basic Latin coverage"
  - If Level 1 is incomplete: block export with a list of missing required glyphs
  - Always allow export if the user explicitly overrides

**Files to create/modify:**
- New: `src-js/views-fontoverview/src/panel-checklist.js` — checklist panel
- `src-js/views-fontoverview/src/fontoverview.js` — integrate checklist
- `src-js/views-editor/src/editor.js` — add export readiness check
- New: `src/fontra/core/glyph_sets.py` — define glyph sets and coverage levels

---

## Dependencies

- G1 (templates) is independent
- G2 (checklist) is independent but benefits from C1 (live analysis) for quality checks

## Estimated Effort

| Feature | Effort | Risk |
|---------|--------|------|
| G1: Starter templates | High | Low — content creation, no complex logic |
| G2: Checklist | Medium | Low — tracking + UI |
