# Category B: Guided Build Order & Workflow

> Beginner Onboarding — help new users know WHAT to draw and in WHAT order

## Context

The Glyphs sketching tutorial emphasizes: "Do not start with the a. Start with the n." The `fontra-coach/` plugin already has a `workflow-panel.js` showing 7 build stages and a `glyph-dna.json` mapping 20 glyphs' structural relationships. Neither has progress tracking or interactive guidance.

---

## Feature B1: Interactive Workflow Tracker

**Problem:** The workflow panel shows 7 stages but has no progress tracking. Users can't tell which glyphs they've completed or what to do next.

**Implementation:**

### Progress Detection
- For each glyph in the workflow sequence, check:
  - Does the glyph exist in the font? (has any sources/layers)
  - Does it have non-empty paths? (at least one contour with points)
  - Does it have metrics set? (advance width > 0)
  - Does it have sidebearings assigned? (LSB and RSB are not default)
- Store completion state per glyph

### UI Display
- Show a checklist with each glyph in the current stage
- Green checkmark for completed glyphs
- Gray circle for not-yet-started glyphs
- Highlight the "next recommended glyph" with an accent color and arrow
- Show overall progress bar: "Stage 3 of 7 — 42% complete"

### State Persistence
- Store progress in localStorage or the font's notes/metadata
- Resume where the user left off when they reopen the font

**Files to modify:**
- `fontra-coach/src/ui/workflow-panel.js` — add progress tracking logic and UI
- `fontra-coach/knowledge/v1/workflow-sequences.json` — may need glyph-level completion criteria

---

## Feature B2: "Start with n" Wizard

**Problem:** Beginners don't know which letter to draw first. They often start with `a` or `A`, which is structurally complex and discouraging.

**Implementation:**

### First-Run Experience
- Detect if the font has no drawn glyphs (empty font)
- Show a welcome modal: "Let's start building your font! We recommend beginning with the letter 'n' — its shapes reoccur in many other letters."
- Offer two paths:
  1. **Guided mode**: Step-by-step wizard that walks through each letter
  2. **Free mode**: Dismiss the wizard, show the workflow panel as a reference

### Wizard Flow
1. **Step 1: Draw n**
   - Show a reference image of a well-drawn `n`
   - Show the Glyphs tutorial steps: "Place nodes approximately, then align, then add curves"
   - Open the `n` glyph in the editor
   - Wait for the user to draw a non-empty `n`
2. **Step 2: Draw o**
   - Explain: "The o establishes your round shapes and sidebearings"
   - Show reference image
   - Auto-suggest the test string `noononno` in the text panel
3. **Step 3: Draw h**
   - Explain: "The h is built from n — just add an ascender"
   - Offer a "Copy from n" button that pre-fills the `h` with `n`'s paths
4. **Continue through the sequence...**

### Skip/Exit
- User can skip any step or exit the wizard at any time
- Wizard state is saved so they can return to it later

**Files to create/modify:**
- `fontra-coach/src/ui/wizard-modal.js` — new component for the guided wizard
- `fontra-coach/src/plugin.js` — register the wizard modal
- `fontra-coach/knowledge/v1/workflow-sequences.json` — add reference images and tips per step

---

## Feature B3: Letter DNA Visualizer

**Problem:** The DNA panel exists but doesn't show actionable relationships. Users can see that `h` is derived from `n` but can't act on that information.

**Implementation:**

### DNA Panel Enhancements
- When editing `h`, display:
  - **"Built from:"** section showing `n` with derivation method `add_ascender`
  - **"Feeds into:"** section showing `b`, `d`, `p`, `q` with their derivation methods
  - **"Shares DNA with:"** section showing glyphs that use similar structural elements

### Actionable Buttons
- **"Copy stems from n"**: Copies the stem width and position from `n` to the current glyph
- **"Copy arch from n"**: Copies the arch path data from `n` to the current glyph
- **"Sync sidebearings from n"**: Sets the current glyph's LSB/RSB to reference `n`

### Visual DNA Map
- A small node-graph visualization showing the glyph relationship tree
- Color-coded by derivation type (vertical_flip, add_ascender, add_bowl, etc.)
- Clickable nodes that jump to editing that glyph

**Files to modify:**
- `fontra-coach/src/ui/dna-panel.js` — enhance with actionable buttons and visual map
- `fontra-coach/knowledge/v1/glyph-dna.json` — verify all derivation methods are captured

---

## Dependencies

- A1 (wiring the coach plugin) is a prerequisite for B1–B3 to be visible
- B2 (wizard) is independent of B1 and B3

## Estimated Effort

| Feature | Effort | Risk |
|---------|--------|------|
| B1: Workflow tracker | Medium | Low — detection + UI |
| B2: Start with n wizard | High | Medium — UX flow design, modal component |
| B3: DNA visualizer | Medium | Low — data exists, needs UI actions |
