# Fontra Panel Custom Elements Skill

> **Purpose**: Prevent and fix `TypeError: Illegal constructor` when creating new sidebar panels in Fontra.  
> **Applies to**: Any new `Panel` subclass added to `src-js/views-editor/src/panel-*.js`.

---

## The Rule

**Every class that extends `Panel` (or any `HTMLElement` subclass) MUST be registered with `customElements.define()` before it is instantiated with `new`.**

Fontra's `Panel` class inherits:

```
Panel → SimpleElement → HTMLElement
```

`SimpleElement` calls `super()` (i.e. `HTMLElement`'s constructor), which **requires** the class to be registered as a custom element. If you call `new MyPanel()` before `customElements.define("my-panel", MyPanel)`, modern browsers throw:

```
Uncaught (in promise) TypeError: Illegal constructor.
    SimpleElement  html-utils.js:38
    Panel          panel.js:41
    MyPanel        panel-my-feature.js:23
    initSidebars   editor.js:1079
```

---

## Required Pattern

### 1. Register the custom element at module scope

At the **bottom** of every `panel-*.js` file, add:

```js
customElements.define("panel-<identifier>", <ClassName>);
```

**Example** (from `panel-settings.js`):

```js
export default class SettingsPanel extends Panel {
  identifier = "settings";
  inlineSVG = `...`;
  // ...
}

customElements.define("panel-settings", SettingsPanel);
```

### 2. Verify against existing panels

All 10+ existing panels follow this exact pattern:

| Panel file | Registration line |
|-----------|-------------------|
| `panel-text-entry.js` | `customElements.define("panel-text-entry", TextEntryPanel);` |
| `panel-reference-font.js` | `customElements.define("panel-reference-font", ReferenceFontPanel);` |
| `panel-transformation.js` | `customElements.define("panel-transformation", TransformationPanel);` |
| `panel-selection-info.js` | `customElements.define("panel-selection-info", SelectionInfoPanel);` |
| `panel-glyph-note.js` | `customElements.define("panel-glyph-note", GlyphNotePanel);` |
| `panel-designspace-navigation.js` | `customElements.define("panel-designspace-navigation", DesignspaceNavigationPanel);` |
| `panel-related-glyphs.js` | `customElements.define("panel-related-glyph", RelatedGlyphPanel);` |
| `panel-glyph-search.js` | `customElements.define("panel-glyph-search", GlyphSearchPanel);` |
| `panel-characters-glyphs.js` | `customElements.define("panel-characters-glyphs", CharactersGlyphsPanel);` |
| `panel-pro-advice.js` | `customElements.define("panel-pro-advice", ProAdvicePanel);` |

**If your new panel does not have `customElements.define()`, the editor will crash on load.**

---

## Quick Checklist for New Panels

Before testing a new panel in the browser, verify:

- [ ] Class `extends Panel` (imported from `./panel.js`)
- [ ] `identifier` property is set (used as `data-sidebarName`)
- [ ] `iconPath` or `inlineSVG` property is set (for the tab icon)
- [ ] `customElements.define("panel-<name>", ClassName)` exists at module scope
- [ ] `getContentElement()` returns a DOM element
- [ ] `toggle(on, focus)` method exists (can be empty)
- [ ] Panel is added in `editor.js` via `this.addSidebarPanel(new MyPanel(this), "left" | "right")`

---

## Debugging

### Symptom: `Illegal constructor` in console

**Cause**: Missing or incorrect `customElements.define()`.

**Fix**:
1. Open the panel's `.js` file.
2. Search for `customElements.define`.
3. If missing, add it at the bottom of the file.
4. If present, check that the tag name matches the class name and the identifier.

### Symptom: Panel tab appears but content is blank

**Cause**: `getContentElement()` returns `undefined` or throws.

**Fix**: Add a `try/catch` in `getContentElement()` and log errors.

### Symptom: `toggle is not a function`

**Cause**: Class does not extend `Panel` or `Panel`'s prototype is lost.

**Fix**: Ensure `import Panel from "./panel.js";` and `class MyPanel extends Panel`.

---

## Related Files

| File | Role |
|------|------|
| `src-js/views-editor/src/panel.js` | Base `Panel` class extending `SimpleElement` |
| `src-js/fontra-core/src/html-utils.js` | `SimpleElement` class extending `HTMLElement` |
| `src-js/views-editor/src/sidebar.js` | Sidebar system that appends panels to the DOM |
| `src-js/views-editor/src/editor.js` | `initSidebars()` where panels are instantiated |

---

## References

- [MDN: Custom Elements](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_custom_elements)
- Fontra `panel.js` source: `src-js/views-editor/src/panel.js`
- Fontra `html-utils.js` source: `src-js/fontra-core/src/html-utils.js`
