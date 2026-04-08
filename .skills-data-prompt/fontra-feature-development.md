# Fontra Feature Development Guide

> **Purpose**: Step-by-step guide for implementing new tools and panels in Fontra, with a checklist of pitfalls to avoid.
> **Date**: 2026-04-08
> **Based on**: Triangle Guardian implementation experience

---

## Golden Rules — Before Starting Any Feature

### 1. Search Existing Codebase FIRST
Before implementing anything, **always** check if Fontra already has the feature:

```
# Search for existing tools
grep -r "extends BaseTool" src-js/views-editor/src/

# Search for existing panels
grep -r "extends Panel" src-js/views-editor/src/

# Search for existing visualization layers
grep -r "registerVisualizationLayerDefinition" src-js/views-editor/src/

# Search for the requested feature by name
grep -ri "keyword" src-js/ --include="*.js"

# Check the View menu for existing toggles
grep -r "visualizationLayersSettings" src-js/views-editor/src/editor.js
```

### 2. Check All Relevant Directories
Search not just `src-js/` but also:
- `src/` (Python backend)
- `test-py/` (test data — may contain sample implementations)
- `triangle-guardian/` (standalone plugin directory — may have reference implementations)
- Any `disabled-*` or `*-old` directories

### 3. Check Editor.js Tool Registry
The definitive list of registered tools is in `src-js/views-editor/src/editor.js`:
```js
const editToolClasses = [
  PointerTools, PenTool, KnifeTool, ShapeTool,
  MetricsTool, PowerRulerTool, TriangleGuardianTool, HandTool,
];
```
If a tool class is NOT in this list, it won't appear in the toolbar even if it exists.

### 4. Inform the User
If you find an existing tool/panel that already does what the user wants:
1. Tell the user it already exists
2. Explain how to access it (toolbar icon, View menu, etc.)
3. Ask if they want to: (a) use the existing feature, (b) extend it, or (c) build something different
4. **Do not** start implementing until the user confirms

---

## How to Implement a New Tool in Fontra

### Step 1: Create the Tool Class

**File**: `src-js/views-editor/src/edit-tools-<name>.js`

```javascript
import { BaseTool } from "./edit-tools-base.js";

export class MyTool extends BaseTool {
  iconPath = "/images/my-tool.svg";     // relative to static dir
  identifier = "my-tool";                // unique, used by editor.setSelectedTool()

  constructor(editor) {
    super(editor);
    // Store reference for visualization layer access
    this.fontController = editor.fontController;
    this._layerEnabled = false;

    // Listen for visualization layer toggle
    editor.visualizationLayersSettings.addKeyListener(
      "my.tool.identifier",
      (event) => {
        this._layerEnabled = event.newValue;
        this.canvasController.requestUpdate();
      }
    );
  }

  activate() {
    super.activate();
    // Turn on visualization when tool is selected
    this._layerEnabled = true;
    this.editor.visualizationLayersSettings.model["my.tool.identifier"] = true;
    this.canvasController.requestUpdate();
  }

  deactivate() {
    super.deactivate();
    // DO NOT turn off the visualization layer here
    // if you want overlay mode to work (see notes below)
    this.canvasController.requestUpdate();
  }

  setCursor() {
    this.canvasController.canvas.style.cursor = "crosshair";
  }

  handleHover(event) {
    this.setCursor();
  }

  handleKeyDown(event) {
    if (event.key === "Escape") {
      this.editor.setSelectedTool("pointer-tool");
      return;
    }
    // Add keyboard shortcuts here
  }

  /** Main drawing logic — called by visualization layer */
  draw(context, positionedGlyph, parameters, model, controller) {
    if (!this._layerEnabled) return;

    const glyph = positionedGlyph.glyph;
    if (!glyph || !glyph.path) return;

    const path = glyph.path;
    const isToolActive = this.editor.selectedTool?.identifier === this.identifier;

    for (let ci = 0; ci < path.numContours; ci++) {
      for (const segment of path.iterContourDecomposedSegments(ci)) {
        // segment.type can be: "line", "quad", "cubic", "quadBlob"
        if (segment.type !== "cubic" || segment.points.length !== 4) continue;

        // Your drawing logic here
      }
    }
  }
}
```

### Step 2: Register the Tool in Editor

**File**: `src-js/views-editor/src/editor.js`

Find `initTools()` and add your tool class to the list:

```javascript
import MyTool from "./edit-tools-my-tool.js";

initTools() {
  const editToolClasses = [
    PointerTools,
    PenTool,
    KnifeTool,
    ShapeTool,
    MetricsTool,
    PowerRulerTool,
    TriangleGuardianTool,
    MyTool,              // <-- Add here
    HandTool,
  ];
  // ...
}
```

### Step 3: Register the Visualization Layer

In the same tool file, at module scope:

```javascript
import {
  glyphSelector,
  registerVisualizationLayerDefinition,
} from "./visualization-layer-definitions.js";

const MY_TOOL_IDENTIFIER = "my.tool.identifier";

registerVisualizationLayerDefinition({
  identifier: MY_TOOL_IDENTIFIER,
  name: "sidebar.user-settings.glyph.mytool",   // i18n key
  selectionFunc: glyphSelector("editing"),       // only draw when editing a glyph
  userSwitchable: true,                          // can be toggled in View menu
  defaultOn: false,                              // off by default
  zIndex: 200,                                   // render order (higher = on top)
  screenParameters: {
    strokeWidth: 1,
    opacity: 0.5,
  },
  colors: {
    okColor: "#1D9E75",
    violationColor: "#E24B4A",
  },
  colorsDarkMode: {
    okColor: "#3ECF9E",
    violationColor: "#FF6B6B",
  },
  // Delegate to the active tool instance
  draw: (context, positionedGlyph, parameters, model, controller) =>
    activeToolInstance?.draw(context, positionedGlyph, parameters, model, controller),
});
```

### Step 4: Create the Toolbar Icon

**File**: `src/images/my-tool.svg`

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <!-- Your icon here -->
</svg>
```

---

## How to Implement a Panel in Fontra

### Step 1: Create the Panel Class

**File**: `src-js/views-editor/src/panel-<name>.js`

```javascript
import Panel from "./panel.js";
import {
  div, label, input, span,
} from "@fontra/core/html-utils.js";
import { ObservableController } from "@fontra/core/observable-object.js";

export default class MyPanel extends Panel {
  identifier = "my-panel";
  iconPath = "/images/my-tool.svg";

  static styles = `
    #my-panel { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    .section { display: flex; flex-direction: column; gap: 6px; }
    .section-title { font-size: 11px; font-weight: 500; text-transform: uppercase; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .label { font-size: 12px; }
  `;

  constructor(editorController) {
    super(editorController);
    this.tool = null;   // reference to the tool, set by tool constructor
  }

  getContentElement() {
    this._controller = new ObservableController({
      enabled: false,
      option1: true,
      option2: false,
      value: 50,
    });

    // Sync with visualization layer setting
    const settingsModel = this.editorController.visualizationLayersSettings.model;
    this._controller.model.enabled = !!settingsModel["my.tool.identifier"];

    // Listen for external changes
    this.editorController.visualizationLayersSettings.addKeyListener(
      "my.tool.identifier",
      (event) => {
        if (this._controller.model.enabled !== event.newValue) {
          this._controller.setItem("enabled", event.newValue, { senderID: "external" });
        }
      }
    );

    // React to internal changes
    this._controller.addKeyListener("enabled", (event) => {
      const val = this._controller.model.enabled;
      settingsModel["my.tool.identifier"] = val;
      if (this.tool) {
        this.tool._layerEnabled = val;
      }
      this.editorController.canvasController.requestUpdate();
      if (event.senderID === "panel") {
        if (val) {
          this.editorController.setSelectedTool("my-tool");
        } else {
          this.editorController.setSelectedTool("pointer-tool");
        }
      }
    });

    return div({ id: "my-panel" }, [
      this._buildEnableSection(),
      this._buildOptionsSection(),
    ]);
  }

  _buildEnableSection() {
    const title = div({ class: "section-title" }, "Activation");
    this._enableBtn = input({
      type: "button",
      value: this._controller.model.enabled ? "ON" : "OFF",
      style: "width: 100%; padding: 6px 0; cursor: pointer;",
    });
    this._enableBtn.addEventListener("click", () => {
      this._controller.setItem("enabled", !this._controller.model.enabled, { senderID: "panel" });
    });
    return div({ class: "section" }, [title, this._enableBtn]);
  }

  _buildOptionsSection() {
    const title = div({ class: "section-title" }, "Options");
    const chk = input({ type: "checkbox", checked: this._controller.model.option1 });
    chk.addEventListener("change", () => {
      this._controller.setItem("option1", chk.checked, { senderID: "panel" });
    });
    return div({ class: "section" }, [title,
      div({ class: "row" }, [label({ class: "label" }, "Option 1"), chk])
    ]);
  }
}

// CRITICAL: Must register custom element
customElements.define("panel-my-tool", MyPanel);
```

### Step 2: Lazily Create and Add the Panel in the Tool

**In the tool's constructor**:

```javascript
// Lazy import to avoid circular dependency
import("./panel-my-tool.js").then((mod) => {
  const MyPanel = mod.default;
  const panel = new MyPanel(editor);
  panel.iconPath = "/images/my-tool.svg";
  panel.tool = this;              // pass tool reference to panel
  editor.addSidebarPanel(panel, "right");  // or "left"
});
```

---

## Mistakes to Avoid — Pitfall Checklist

### 1. `numContour` vs `numContours` (TYPO)
- ❌ `path.numContour` — undefined, loop never runs, nothing draws
- ✅ `path.numContours` — correct property name
- **Symptom**: Panel works, tool toggles ON, but nothing appears on canvas

### 2. Missing `customElements.define()`
- ❌ Panel class without `customElements.define("panel-name", PanelClass)`
- ✅ Must register before `new PanelClass()` is called
- **Symptom**: `TypeError: Illegal constructor` in console

### 3. `deactivate()` Turning Off Visualization Layer
- ❌ `deactivate()` sets `this._layerEnabled = false` or toggles layer OFF
- ✅ `deactivate()` should only call `super.deactivate()` (sets `isActive = false`)
- **Why**: If layer stays ON, overlay mode works — selected segments still show when pointer tool is active

### 4. Wrong Segment Type Check
- ❌ Assuming all fonts use cubic curves (`segment.type === "cubic"`)
- ✅ Many fonts (especially UFO sources) use quadratic curves (`segment.type === "quad"`)
- **Check**: `path.iterContourDecomposedSegments()` returns segments with types: `"line"`, `"quad"`, `"cubic"`, `"quadBlob"`
- **Action**: Support all relevant types, or document that your tool only works with cubic fonts

### 5. Circular Dependency Between Tool and Panel
- ❌ Tool imports Panel, Panel imports Tool → circular dependency → `undefined`
- ✅ Use lazy `import()` in tool constructor to break the cycle

### 6. `senderID` Mismatch in Panel Event Handlers
- ❌ Button click: `{ senderID: this }` where `this` is the button element
- ❌ Listener check: `event.senderID === this` where `this` is the panel
- ✅ Use consistent string identifiers: `{ senderID: "panel" }` and check `event.senderID === "panel"`

### 7. Tool Not in `editToolClasses` Array
- ❌ Creating a `BaseTool` subclass but not adding it to `editor.js` `initTools()`
- ✅ Must be listed in `editToolClasses` array in `initTools()` method
- **Symptom**: Tool class exists but no toolbar icon appears

### 8. `active` vs `_layerEnabled` Conflation
- ❌ Using one variable for both "tool is selected" and "layer is visible"
- ✅ Use `_layerEnabled` for layer visibility, `editor.selectedTool.identifier` for tool selection
- `BaseTool.isActive` tracks whether the tool is currently the selected tool

### 9. Not Using `super.activate()` / `super.deactivate()`
- ❌ Overriding `activate()` without calling `super.activate()`
- ✅ Always call `super.activate()` first — it sets `this.isActive = true` and calls `setCursor()`

### 10. Wrong `selectionFunc` in Visualization Layer
- ❌ Using wrong glyph selector — layer draws on wrong glyphs
- ✅ Use `glyphSelector("editing")` for editing-mode-only layers
- Other options: `"all"`, `"selected"`, `"hovered"`, `"notediting"`

### 11. `path.iterContourDecomposedSegments()` Returns Segments, Not Points
- ❌ `segment.points` is an array of point objects with `.x` and `.y`
- ❌ For cubic: expects 4 points `[P0, P1, P2, P3]` — check `segment.points.length !== 4`
- ✅ Always validate segment structure before accessing point properties

### 12. Not Forgetting to Call `context.save()` / `context.restore()`
- ❌ Drawing operations leak state (fillStyle, globalAlpha, etc.) to other layers
- ✅ Wrap drawing in `context.save()` / `context.restore()`

### 13. Not Using `mulScalar` for Screen Parameters
- ❌ Hardcoded pixel sizes that don't scale with zoom
- ✅ `screenParameters` are auto-scaled by `mulScalar(screenParameters, scaleFactor)` in the layer system

### 14. Missing Dark Mode Colors
- ❌ Only defining `colors` without `colorsDarkMode`
- ✅ Define both `colors` and `colorsDarkMode` for proper theme support

### 15. Not Requesting Canvas Update
- ❌ Changing state without `this.canvasController.requestUpdate()`
- ✅ Always call `requestUpdate()` after any state change that affects rendering

---

## Quick Reference: File Locations

| Purpose | File Path |
|---------|-----------|
| Tool class | `src-js/views-editor/src/edit-tools-<name>.js` |
| Panel class | `src-js/views-editor/src/panel-<name>.js` |
| Tool registration | `src-js/views-editor/src/editor.js` → `initTools()` |
| Base tool | `src-js/views-editor/src/edit-tools-base.js` |
| Base panel | `src-js/views-editor/src/panel.js` |
| Visualization layer registration | `src-js/views-editor/src/visualization-layer-definitions.js` |
| Visualization layer system | `src-js/views-editor/src/visualization-layers.js` |
| Toolbar icons | `src/images/*.svg` |
| Panel added to sidebar | `editor.addSidebarPanel(panel, "right")` or `"left"` |
| Tool selection | `editor.setSelectedTool("tool-identifier")` |
| i18n keys | `src-js/fontra-core/src/localization.js` |

---

## Verification Checklist

Before submitting a new feature:

- [ ] Tool class extends `BaseTool` and has `iconPath`, `identifier`
- [ ] Tool is listed in `editToolClasses` in `editor.js`
- [ ] Visualization layer registered with `registerVisualizationLayerDefinition()`
- [ ] Layer has both `colors` and `colorsDarkMode`
- [ ] Panel class has `customElements.define()` at module scope
- [ ] Panel uses lazy `import()` in tool constructor (no circular deps)
- [ ] `senderID` is consistent string in panel event handlers
- [ ] `numContours` (not `numContour`) in contour iteration loops
- [ ] `deactivate()` does NOT turn off visualization layer
- [ ] `context.save()` / `context.restore()` used in drawing
- [ ] `requestUpdate()` called after all state changes
- [ ] Build passes: `npm run bundle` with no errors
- [ ] Server runs without console errors
- [ ] Feature tested with both light and dark themes
- [ ] Feature tested with both cubic and quadratic fonts (if applicable)
