# Triangle Guardian Module — Code Review

## Summary

The module has **3 critical bugs** that will prevent it from working, plus **2 moderate issues** and **1 minor issue**.

---

## 🔴 Critical Issues (Will Break the Plugin)

### Bug 1: `TriangleGuardianPanel` is Not Registered as a Custom Element

**Files**: [triangle-guardian-panel.js](file:///d:/DEVWEB/MINIMAX%20AGENT/fontra/fontra/triangle-guardian/triangle-guardian-panel.js)

The panel extends `Panel` which extends `SimpleElement` which extends `HTMLElement`. Every class extending `HTMLElement` **must** be registered with `customElements.define()` before it can be instantiated. The triangle-guardian panel is missing this call entirely.

Compare with the working [panel-pro-advice.js](file:///d:/DEVWEB/MINIMAX%20AGENT/fontra/fontra/src-js/views-editor/src/panel-pro-advice.js#L350):
```js
// ProAdvicePanel — WORKS ✅
customElements.define("panel-pro-advice", ProAdvicePanel);
```

The triangle-guardian panel has NO such line. When `start.js` does `new TriangleGuardianPanel(editor)`, the browser will throw:

```
Uncaught TypeError: Illegal constructor
```

> **Fix**: Add `customElements.define("panel-triangle-guardian", TriangleGuardianPanel);` at the bottom of `triangle-guardian-panel.js`.

---

### Bug 2: Import Paths Use `@fontra/` Aliases That Don't Resolve for Plugins

**Files**: [triangle-guardian-layer.js](file:///d:/DEVWEB/MINIMAX%20AGENT/fontra/fontra/triangle-guardian/triangle-guardian-layer.js#L1-L4), [triangle-guardian-panel.js](file:///d:/DEVWEB/MINIMAX%20AGENT/fontra/fontra/triangle-guardian/triangle-guardian-panel.js#L1-L4)

The plugin uses bare module specifiers like:
```js
import { registerVisualizationLayerDefinition } from "@fontra/editor/visualization-layer-definitions.js";
import Panel from "@fontra/editor/panel.js";
import { ObservableController } from "@fontra/core/observable-object.js";
import { div, label, input, span } from "@fontra/core/html-utils.js";
```

These `@fontra/...` paths work inside the bundled Fontra source because they are resolved by the build system's import map. However, **plugins are loaded at runtime via dynamic `import()`** (see [editor.js:731](file:///d:/DEVWEB/MINIMAX%20AGENT/fontra/fontra/src-js/views-editor/src/editor.js#L731)):

```js
module = await import(`${pluginPath}/${initScript}`);
```

Whether these `@fontra/` imports resolve for the plugin depends on whether the application's import map covers the plugin's module graph. Look at the **working spacing-studio plugin** — it also uses `@fontra/core/...` imports. So if Fontra's import map is application-wide (set on the HTML page), these imports should resolve.

> **Verdict**: This is likely fine IF the Fontra import map is set up correctly. But if the plugin fails to load, module resolution is the first thing to check in the browser console.

---

### Bug 3: `SpacingStudioPanel` Pattern vs `TriangleGuardianPanel` — Missing Web Component Registration

**Files**: [triangle-guardian-panel.js](file:///d:/DEVWEB/MINIMAX%20AGENT/fontra/fontra/triangle-guardian/triangle-guardian-panel.js), [start.js](file:///d:/DEVWEB/MINIMAX%20AGENT/fontra/fontra/triangle-guardian/start.js)

Looking at the **working** `SpacingStudioPanel` class ([spacing-studio-panel.js](file:///d:/DEVWEB/MINIMAX%20AGENT/fontra/fontra/fontra-spacing-studio/src/spacing-studio-panel.js#L7)):

```js
export class SpacingStudioPanel {
  identifier = "spacing-studio";
  iconPath = "./fontra-spacing-studio/icon.svg";
  // ... NOT extending Panel at all!
```

The spacing-studio panel is a **plain JavaScript class** — it does NOT extend `Panel`/`SimpleElement`/`HTMLElement`. The `Sidebar.addPanel()` method ([sidebar.js:15-58](file:///d:/DEVWEB/MINIMAX%20AGENT/fontra/fontra/src-js/views-editor/src/sidebar.js#L15-L58)) wraps the panel element in a `div` and appends it. For plain objects with a `getContentElement()` method, this works fine.

But `TriangleGuardianPanel` extends `Panel` (a `SimpleElement` → `HTMLElement`). This means:
1. It **must** be registered with `customElements.define()` (Bug 1 above)
2. Its constructor calls `super()` which calls `this.attachShadow()` and `this.getContentElement()` **during construction** — before it's added to the DOM

This is actually a valid pattern (the built-in panels like `ProAdvicePanel` do the same), but **only if the custom element is registered first**.

---

## 🟡 Moderate Issues

### Issue 4: `iconPath` Is Set Too Late (After Construction)

**File**: [start.js](file:///d:/DEVWEB/MINIMAX%20AGENT/fontra/fontra/triangle-guardian/start.js#L5-L6)

```js
const panel = new TriangleGuardianPanel(editor);
panel.iconPath = `${pluginPath}/icon.svg`;  // ← Too late!
editor.addSidebarPanel(panel, "right");
```

The `Panel` constructor calls `getContentElement()` during construction. By the time `panel.iconPath` is set on line 6, the panel's content has already been built. The `Sidebar.addPanel()` reads `panelElement.iconPath` to create the tab icon:

```js
// sidebar.js:40-42
const iconElement = panelElement.inlineSVG
  ? html.createDomElement("inline-svg")
  : html.createDomElement("inline-svg", { src: panelElement.iconPath });
```

Since `addSidebarPanel` happens AFTER `iconPath` is set, the tab icon assignment **will work**, but only because `addSidebarPanel` is called after the assignment. This is fragile but functional.

> **Recommendation**: Set `iconPath` as a class field (like `ProAdvicePanel` does with `inlineSVG`) or pass it to the constructor. Alternatively, use `inlineSVG` with inline SVG content instead.

---

### Issue 5: `getGlyphInstance` Call May Not Match the Actual API

**File**: [triangle-guardian-panel.js:155](file:///d:/DEVWEB/MINIMAX%20AGENT/fontra/fontra/triangle-guardian/triangle-guardian-panel.js#L155)

```js
const instance = await sceneModel.getGlyphInstance(glyphName);
```

Looking at how `SpacingStudioPanel` calls this API:
```js
// spacing-studio-panel.js:439-440
const glyphController = await this.sceneController.sceneModel.getGlyphInstance(
  this._currentGlyphName,
  this.sceneController.sceneSettings.editLayerName
);
```

The second parameter (`editLayerName`) may be important. Without it, the method may return a different result or throw depending on the implementation.

---

## 🔵 Minor Issues

### Issue 6: `segment.parentPointIndices` Might Not Exist on Decomposed Segments

**File**: [triangle-guardian-layer.js:44](file:///d:/DEVWEB/MINIMAX%20AGENT/fontra/fontra/triangle-guardian/triangle-guardian-layer.js#L44)

```js
const indices = segment.parentPointIndices;
```

Looking at the path code in [var-path.js:1009-1016](file:///d:/DEVWEB/MINIMAX%20AGENT/fontra/fontra/src-js/fontra-core/src/var-path.js#L1009-L1016):

```js
function* decomposeSegment(parentSegment, filterCoords) {
  for (const segment of decomposeSegmentFuncs[parentSegment.type](parentSegment)) {
    // ...
    segment.parentPointIndices = parentSegment.pointIndices;
    yield segment;
  }
}
```

Good news: `parentPointIndices` IS set on decomposed segments. However, within `iterContourDecomposedSegments`, the segment also gets a `points` array (converted from coordinates). The code accesses `segment.points` as `[P0, P1, P2, P3]`, and these points are simple `{x, y}` objects — which is correct.

> **Verdict**: This is actually fine. The `parentPointIndices` property is correctly set by the decomposition pipeline.

---

## Fix Priority

| # | Severity | Fix |
|---|----------|-----|
| 1 | 🔴 Critical | Add `customElements.define("panel-triangle-guardian", TriangleGuardianPanel)` at bottom of panel file |
| 2 | 🟡 Moderate | Set `iconPath` as a class field or use `inlineSVG` |
| 3 | 🟡 Moderate | Verify `getGlyphInstance` call signature matches current API |

> [!IMPORTANT]
> **Bug 1 is almost certainly the reason the plugin "is not working".** Without `customElements.define()`, `new TriangleGuardianPanel(editor)` will throw an `Illegal constructor` error, and the entire plugin registration will fail silently (the error is caught by the plugin loader at [editor.js:739-741](file:///d:/DEVWEB/MINIMAX%20AGENT/fontra/fontra/src-js/views-editor/src/editor.js#L737-L743)).
