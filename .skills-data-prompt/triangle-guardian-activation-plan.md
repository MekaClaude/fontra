# Triangle Guardian — Activation/Deactivation as Independent Tool

> **Date**: 2026-04-07
> **Status**: Implementation Plan
> **Scope**: Fontra glyph editor — `triangle-guardian/` + `src-js/views-editor/`
> **Goal**: Make Triangle Guardian behave like the Power Ruler tool — activatable/deactivatable as a standalone tool, while preserving its Pointer tool integration.

---

## 1. Current State Audit

### 1.1 How Triangle Guardian Works Today

| Aspect | Current Behavior |
|--------|-----------------|
| **Activation** | Always on (layer `defaultOn: true`) |
| **Deactivation** | Only via visualization layers settings toggle |
| **Trigger** | Runs whenever a glyph is being edited, based on `state.enabled` |
| **Pointer integration** | Shows triangles for selected/hovered segments via `isSegmentSelected()` |
| **Modes** | `educationalMode` (show all), `showAllSegments` (show all), or selection-based |
| **Architecture** | Visualization layer + sidebar panel |

### 1.2 How Power Ruler Works (Target Pattern)

| Aspect | Power Ruler Behavior |
|--------|---------------------|
| **Activation** | Has a dedicated tool icon in the toolbar (`PowerRulerTool` class) |
| **Deactivation** | Click another tool (e.g., pointer) to deactivate |
| **Trigger** | Only active when its tool is selected |
| **Pointer integration** | Falls back to pointer tool when hovering on glyphs |
| **Singleton** | `thePowerRulerTool` global for layer drawing access |
| **Settings toggle** | `editor.visualizationLayersSettings` key controls rendering |
| **Architecture** | `extends BaseTool` + visualization layer definition |

### 1.3 Key Insight

The Triangle Guardian is currently **only** a visualization layer. The Power Ruler is a **tool** (`BaseTool` subclass) that *also* has a visualization layer. To match the ruler pattern, Triangle Guardian needs:

1. A `BaseTool` subclass with toolbar icon
2. A singleton reference for the visualization layer to check `this.active`
3. A visualization layer that draws only when the tool is active
4. The existing selection-based behavior (pointer integration) preserved as an "overlay" mode

---

## 2. Design Decision: Hybrid Approach

Rather than replacing the current behavior, we create a **dual-mode** system:

| Mode | Description | How to Activate |
|------|-------------|-----------------|
| **Tool mode** | Triangle Guardian is the active tool. Triangles render for ALL segments regardless of selection. Toolbar icon shows active state. | Click the Triangle Guardian tool icon in toolbar |
| **Pointer overlay mode** | Triangle Guardian is NOT the active tool. Triangles render only for selected/hovered segments (current behavior). | Click the Pointer tool icon |

This gives the user:
- **Quick toggle**: Click tool icon to activate/deactivate (like ruler)
- **Pointer integration**: When pointer tool is active, triangles still show for selected segments
- **No behavior loss**: Current selection-based visualization is preserved as the "overlay" mode

---

## 3. Implementation Plan

### Phase 1: Create the TriangleGuardianTool Class

**New file**: `triangle-guardian/triangle-guardian-tool.js`

Create a `BaseTool` subclass following the `PowerRulerTool` pattern:

```javascript
import { BaseTool } from "../../src-js/views-editor/src/edit-tools-base.js";
import { translate } from "../../src-js/fontra-core/src/localization.js";

let theTriangleGuardianTool; // singleton for layer access

export class TriangleGuardianTool extends BaseTool {
  iconPath = "/triangle-guardian/icon.svg";  // relative to plugin
  identifier = "triangle-guardian-tool";
  tooltipText = "Triangle Guardian";

  constructor(editor) {
    super(editor);
    theTriangleGuardianTool = this;
    this.active = true;

    // Sync with visualization layer setting
    editor.visualizationLayersSettings.addKeyListener(
      "com.fontra.plugins.triangle-guardian.overlay",
      (event) => {
        this.active = event.newValue;
        state.enabled = event.newValue;
      }
    );
  }

  handleHover(event) {
    // Delegate to pointer tool when not active
    if (!this.active) {
      this.editor.tools["pointer-tool"].handleHover(event);
    }
  }

  async handleDrag(eventStream, initialEvent) {
    // Delegate to pointer tool when not active
    if (!this.active) {
      await this.editor.tools["pointer-tool"].handleDrag(eventStream, initialEvent);
      return;
    }
    // When active: consume events but don't modify geometry
    // (visualization is passive — just shows triangles)
    for await (const _ of eventStream) {
      this.canvasController.requestUpdate();
    }
  }

  handleKeyDown(event) {
    // Escape deactivates the tool
    if (event.key === "Escape") {
      this.editor.setSelectedTool("pointer-tool");
    }
  }

  /** Called by the visualization layer to check if drawing is enabled */
  static isActive() {
    return theTriangleGuardianTool?.active ?? true;
  }
}
```

**Key decisions**:
- The tool is `active = true` by default (matches current behavior)
- When NOT active, all events delegate to the pointer tool
- The singleton `theTriangleGuardianTool` lets the visualization layer check active state
- `Escape` key switches back to pointer tool (like ruler behavior)

---

### Phase 2: Register the Tool with the Editor

**File to modify**: `triangle-guardian/start.js`

In `registerPlugin()`, register the tool with the editor's tool registry:

```javascript
import { TriangleGuardianTool } from "./triangle-guardian-tool.js";

export function registerPlugin(editor, pluginPath) {
  // Register the tool
  editor.addTool(TriangleGuardianTool);

  // Set as active tool (optional — matches current "always on" behavior)
  // editor.setSelectedTool("triangle-guardian-tool");

  // Register the visualization layer
  _registerLayer(editor);

  // Create and add the sidebar panel
  const panel = _createPanel(editor);
  editor.addSidebarPanel(panel, "right");
}
```

**File to modify**: `src-js/views-editor/src/editor.js`

No changes needed — `editor.addTool()` is the existing public API that `PowerRulerTool` uses.

---

### Phase 3: Update the Visualization Layer

**File to modify**: `triangle-guardian/start.js` (the `_registerLayer` function)

Update the layer's `draw` function to check tool active state:

```javascript
draw: (context, positionedGlyph, parameters, model, controller) => {
  // Check if tool is active OR if we're in overlay mode (pointer tool selected)
  const toolActive = TriangleGuardianTool.isActive();
  const pointerActive = editor.selectedTool?.identifier === "pointer-tool";

  // If neither tool mode nor overlay mode, skip drawing
  if (!toolActive && !pointerActive) return;
  if (!_state.enabled) return;

  // ... rest of existing draw logic ...

  // In tool mode: show ALL segments (ignore selection)
  // In overlay mode: show only selected/hovered segments (current behavior)
  const showAll = toolActive || _state.educationalMode || _state.showAllSegments;

  for (let ci = 0; ci < path.numContours; ci++) {
    for (const segment of path.iterContourDecomposedSegments(ci)) {
      // ... existing segment loop ...

      const isSelected = showAll || _isSegmentSelected(indices, _getSelectedSet(model), _getHoveredSet(model));
      if (!isSelected) continue;

      // ... existing draw logic ...
    }
  }
}
```

**Key behavior**:
- When Triangle Guardian tool is active → show ALL segments (like `educationalMode` but via tool activation)
- When Pointer tool is active → show only selected/hovered segments (current overlay behavior)
- When layer setting is off → show nothing

---

### Phase 4: Update the Panel Toggle

**File to modify**: `triangle-guardian/start.js` (the `_createPanel` function)

Add an "Enable/Disable" toggle at the top of the panel that switches between tool and pointer:

```javascript
// At the top of the panel:
const enableRow = document.createElement("div");
enableRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0;";

const enableLabel = document.createElement("label");
enableLabel.style.cssText = "font-size:12px;font-weight:600;";
enableLabel.textContent = "Triangle Guardian";

const enableBtn = document.createElement("button");
enableBtn.style.cssText = "font-size:11px;padding:2px 8px;cursor:pointer;";
enableBtn.textContent = _state.enabled ? "ON" : "OFF";

enableBtn.addEventListener("click", () => {
  _state.enabled = !_state.enabled;
  enableBtn.textContent = _state.enabled ? "ON" : "OFF";

  if (_state.enabled) {
    editor.setSelectedTool("triangle-guardian-tool");
  } else {
    editor.setSelectedTool("pointer-tool");
  }

  canvasController.requestUpdate();
});

enableRow.appendChild(enableLabel);
enableRow.appendChild(enableBtn);
container.insertBefore(enableRow, container.firstChild);
```

**Also update**: `triangle-guardian-panel.js` to add the same toggle for the proper Panel class version.

---

### Phase 5: Update State Management

**File to modify**: `triangle-guardian/triangle-guardian-state.js`

No changes needed — the `enabled` flag already exists and is used correctly. The tool will toggle this flag.

---

## 4. Files Summary

| File | Action | Changes |
|------|--------|---------|
| `triangle-guardian/triangle-guardian-tool.js` | **NEW** | `BaseTool` subclass with toolbar icon, drag/ hover delegation, singleton |
| `triangle-guardian/start.js` | **MODIFY** | Register tool, update layer draw to check tool state, add panel toggle button |
| `triangle-guardian/triangle-guardian-panel.js` | **MODIFY** | Add ON/OFF toggle button at top of panel |
| `triangle-guardian/triangle-guardian-layer.js` | **NO CHANGE** | Uses shared `state.enabled` — already compatible |
| `triangle-guardian/triangle-guardian-state.js` | **NO CHANGE** | `enabled` flag already exists |
| `triangle-guardian/triangle-guardian-geometry.js` | **NO CHANGE** | Pure geometry helpers |
| `triangle-guardian/plugin.json` | **NO CHANGE** | Entry point unchanged |
| `src-js/views-editor/src/editor.js` | **NO CHANGE** | Uses existing `addTool()` API |

---

## 5. Execution Order

```
Phase 1: Create TriangleGuardianTool class          → ~1h
Phase 2: Register tool with editor                  → ~0.5h
Phase 3: Update visualization layer draw logic      → ~1h
Phase 4: Add ON/OFF toggle to panel                 → ~0.5h
Phase 5: Verify state management                    → ~0.5h
                                                   ─────
Total:                                              ~3.5h
```

---

## 6. Testing Checklist

- [ ] Plugin loads without errors
- [ ] Triangle Guardian tool icon appears in toolbar
- [ ] Clicking tool icon activates Triangle Guardian (all segments visible)
- [ ] Clicking Pointer tool deactivates Triangle Guardian (only selected segments visible)
- [ ] ON/OFF button in panel toggles between tool and pointer
- [ ] Escape key switches from Triangle Guardian to Pointer tool
- [ ] Visualization layer respects `state.enabled` (layer toggle still works)
- [ ] Educational mode still works when tool is active
- [ ] Show all segments still works when tool is active
- [ ] Violation scan still runs on glyph changes
- [ ] Opacity slider works in both modes
- [ ] No console errors
- [ ] No regression on existing functionality

---

## 7. Architecture Diagram

```
┌──────────────────────────────────────────────────────┐
│                    Fontra Editor                      │
│                                                      │
│  ┌─────────────┐    ┌──────────────────────────┐    │
│  │ Toolbar     │    │  Scene Controller         │    │
│  │             │    │                           │    │
│  │ [Pointer]   │◄──►│  selection / hoverState   │    │
│  │ [TriGuard]  │    │                           │    │
│  └──────┬──────┘    └──────────┬───────────────┘    │
│         │                      │                     │
│         │              ┌───────▼───────────────┐    │
│         │              │  Visualization Layers  │    │
│         │              │                       │    │
│         │              │  Triangle Guardian    │    │
│         │              │  layer.draw()         │    │
│         │              │   checks:             │    │
│         │              │   - toolActive?       │    │
│         │              │   - state.enabled?    │    │
│         │              │   - showAll?          │    │
│         │              └───────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │  TriangleGuardianTool (singleton)            │    │
│  │   - active: bool                             │    │
│  │   - handleDrag() → delegate to pointer if !active │
│  │   - handleHover() → delegate to pointer if !active│
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │  Triangle Guardian Panel                     │    │
│  │   [ON/OFF] ──► setSelectedTool()             │    │
│  │   [x] Educational mode                       │    │
│  │   [x] Show all segments                      │    │
│  │   [x] Highlight violations                   │    │
│  │   [x] S-curve labels                         │    │
│  │   [---] Triangle opacity                     │    │
│  │   Violations: c0 s2 handle A, handle B       │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

---

## 8. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `editor.addTool()` API differs from expected | Low | Verify against `PowerRulerTool` registration in `editor.js` |
| Tool icon path doesn't resolve | Medium | Use absolute path or base64 inline SVG |
| Layer draw order changes | Low | `zIndex: 200` is well below pointer tool (600+) |
| State sync between tool and panel | Medium | Use shared `state` module, add listener sync |
