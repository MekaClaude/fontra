# Triangle Guardian Plugin - Execution Checklist

## Phase 1: Critical Bug Fixes

### Task 1.1: Register TriangleGuardianPanel as Custom Element
- [x] 1.1.1 Read `triangle-guardian/triangle-guardian-panel.js`
- [x] 1.1.2 Add `static register(targetFontra) { targetFontra.addPanelType(...) }` method
- [x] 1.1.3 Export class properly for Fontra plugin system

### Task 1.2: Fix Import Path Resolution
- [x] 1.2.1 Read `triangle-guardian/triangle-guardian-panel.js`
- [x] 1.2.2 Replace `@fontra/view` imports with relative paths
  - `@fontra/editor/panel.js` → `../../src-js/views-editor/src/panel.js`
  - `@fontra/core/observable-object.js` → `../../src-js/fontra-client/src/observable-object.js`
  - `@fontra/core/html-utils.js` → `../../src-js/fontra-client/src/html-utils.js`

### Task 1.3: Fix iconPath Timing Issue
- [x] 1.3.1 Read `triangle-guardian/triangle-guardian-panel.js`
- [x] 1.3.2 Use `inlineSVG` class property instead of post-construction assignment

## Phase 2: Code Quality Improvements

### Task 2.1: Eliminate Duplicate Geometry Code
- [x] 2.1.1 Read `triangle-guardian/triangle-guardian-panel.js`
- [x] 2.1.2 Import from shared `./triangle-guardian-geometry.js` module
- [x] 2.1.3 Remove 40+ lines of duplicate inline functions

### Task 2.2: Fix getGlyphInstance API Call
- [x] 2.2.1 Read `triangle-guardian/triangle-guardian-panel.js`
- [x] 2.2.2 Use correct pattern: `sceneController.sceneModel.getGlyphInstance(glyphName)`

### Task 2.3: Add Error Handling
- [x] 2.3.1 Add try/catch in `_runViolationScan()` with user-friendly error message
- [x] 2.3.2 Add try/catch in layer `draw()` function
- [x] 2.3.3 Add null checks for glyph, path, and instance objects

### Task 2.4: Add JSDoc Documentation
- [x] 2.4.1 Add `@module` declarations to all files
- [x] 2.4.2 Document all exported functions with `@param` and `@returns`
- [x] 2.4.3 Add inline comments for complex logic

### Task 2.5: Verify Panel Layer Integration
- [x] 2.5.1 Read `triangle-guardian-layer.js`
- [x] 2.5.2 Ensure panel integration works correctly
- [x] 2.5.3 Fix import paths in layer file

## Phase 3: Testing & Verification

### Task 3.1: Verify Plugin Loads
- [ ] 3.1.1 Test plugin registration in Fontra
- [ ] 3.1.2 Verify no console errors

### Task 3.2: Verify Triangle Visualization
- [ ] 3.2.1 Test with a glyph that has cubic curves
- [ ] 3.2.2 Verify triangle guidelines render correctly
- [ ] 3.2.3 Test S-curve detection
- [ ] 3.2.4 Test violation markers
- [ ] 3.2.5 Test opacity slider

## Status Log

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-04-07 | 1.1 | ✅ | Added `static register()` method |
| 2026-04-07 | 1.2 | ✅ | Fixed all import paths to relative |
| 2026-04-07 | 1.3 | ✅ | Using `inlineSVG` class property |
| 2026-04-07 | 2.1 | ✅ | Removed duplicate geometry functions |
| 2026-04-07 | 2.2 | ✅ | Verified API against working Fontra code |
| 2026-04-07 | 2.3 | ✅ | Added try/catch blocks in panel and layer |
| 2026-04-07 | 2.4 | ✅ | JSDoc added to all modules |
| 2026-04-07 | 2.5 | ✅ | Layer imports fixed |
| 2026-04-07 | 3.x | ⏳ | Requires manual testing in Fontra |

## Files Changed

| File | Lines Changed | Summary |
|------|---------------|---------|
| `triangle-guardian-panel.js` | ~230 → ~210 | Fixed imports, removed duplicate functions, added error handling, JSDoc |
| `triangle-guardian-layer.js` | ~160 → ~210 | Fixed imports, added try/catch, JSDoc |
| `triangle-guardian-geometry.js` | ~60 → ~100 | Added comprehensive JSDoc |
| `triangle-guardian-state.js` | ~7 → ~25 | Added JSDoc with property descriptions |
| `start.js` | ~5 → ~15 | Fixed registration pattern, added JSDoc |
