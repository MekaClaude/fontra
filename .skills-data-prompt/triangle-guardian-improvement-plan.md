# Triangle Guardian Plugin - Improvement Plan

## Overview

This document tracks the improvement plan for the triangle-guardian Fontra plugin, which visualizes Adobe control-point triangle guidelines on cubic Bézier segments.

---

## Root Cause Analysis

### The Core Problem: `@fontra/` Imports in Local Plugins

Local Fontra plugins are loaded via raw browser `import()`:
```js
module = await import(`${pluginPath}/${initScript}`);
```

The `@fontra/` paths are **webpack aliases** that only resolve during the webpack build process. They **do NOT resolve** for raw browser ES module imports. The import map in `editor.html` only maps `"fontra/": "/"`, not `@fontra/`.

This caused:
1. **404 errors** on bundled JS paths like `/js/start.3.b42fac29.js`
2. **MIME type errors** — server returns HTML error pages as `text/plain`
3. **Complete app failure** — the entire editor couldn't load

### The Solution: Self-Contained Plugin

The entire plugin now lives in a single `start.js` file with **zero external imports**. Everything is accessed through the `editor` instance Fontra passes to `registerPlugin(editor, pluginPath)`:

| Need | How to Access |
|------|---------------|
| Scene/glyph data | `editor.sceneController.sceneModel` |
| Canvas redraw | `editor.canvasController` |
| Visualization layers | `editor.visualizationLayers` |
| Layer settings | `editor.visualizationLayersSettings` |
| Sidebar | `editor.addSidebarPanel()` |
| Glyph changes | `editor.sceneController.addCurrentGlyphChangeListener()` |
| Settings | `editor.sceneSettingsController` |

---

## Bugs Identified & Fixed

### Bug 1: `@fontra/` Import Resolution (CRITICAL) ✅ FIXED
- **Issue**: `@fontra/editor/panel.js` and similar imports don't resolve for local plugins
- **Impact**: 404 on plugin JS, MIME type errors, complete editor failure
- **Fix**: Rewrote `start.js` as a self-contained module with zero imports

### Bug 2: Panel Base Class Dependency ✅ FIXED
- **Issue**: Extending Fontra's `Panel` class requires `@fontra/editor/panel.js` import
- **Impact**: Module load failure
- **Fix**: Created panel as plain DOM element with matching styling

### Bug 3: Visualization Layer Registration ✅ FIXED
- **Issue**: `registerVisualizationLayerDefinition` is a webpack-resolved export
- **Impact**: Module load failure
- **Fix**: Use `editor.visualizationLayers.addDefinition()` method

---

## Files Modified

| File | Status | Notes |
|------|--------|-------|
| `start.js` | ✅ Rewritten | Self-contained, zero imports, ~350 lines |
| `triangle-guardian-panel.js` | ⚠️ Unused | Kept for reference but not loaded |
| `triangle-guardian-layer.js` | ⚠️ Unused | Kept for reference but not loaded |
| `triangle-guardian-geometry.js` | ⚠️ Unused | Geometry helpers now inline in start.js |
| `triangle-guardian-state.js` | ⚠️ Unused | State now inline in start.js |
| `plugin.json` | ✅ Unchanged | Points to `start.js` |

---

## Verification Steps

- [ ] Editor loads without errors
- [ ] Triangle Guardian panel appears in right sidebar
- [ ] Toggle switches respond
- [ ] Triangle visualization renders on cubic Bézier segments
- [ ] S-curves detected and labeled
- [ ] Violation markers on handles outside triangle
- [ ] Opacity slider works
- [ ] No console errors

---

## Future Improvements

1. **Import from editor's Panel class** — if/when Fontra exposes it to local plugins
2. **Dark mode colors** — use `editor.isThemeDark` for color switching
3. **Persistent settings** — store preferences in localStorage
4. **Keyboard shortcuts** — integrate with editor's key binding system
5. **Unit tests** — extract geometry functions to testable module
