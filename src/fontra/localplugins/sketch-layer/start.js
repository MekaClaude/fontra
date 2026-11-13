// Sketch Layer plugin entry point: registers the canvas layer, the pointer
// overlay, the sidebar panel, and the editor actions.

import * as store from "./sketch-store.js";
import { registerLayer } from "./sketch-layer.js";
import { SketchOverlay } from "./sketch-overlay.js";
import SketchLayerPanel from "./sketch-panel.js";

export function registerPlugin(editor, pluginPath) {
  // Guard against double registration (e.g. a plugin listed twice).
  if (editor.__sketchLayer) {
    return editor.__sketchLayer;
  }

  store.setProject(editor.projectIdentifier || "default");
  registerLayer(editor);

  const overlay = new SketchOverlay(editor);

  const plugin = {
    editor,
    overlay,
    state: store.state,
    strokeCount: store.strokeCount,

    setMode(onOff) {
      store.state.mode = !!onOff;
      overlay.setMode(store.state.mode);
      panel?.setModeIndicator(store.state.mode);
    },

    toggleMode() {
      this.setMode(!store.state.mode);
    },

    clearGlyph() {
      const glyphName =
        editor.sceneController?.sceneSettings?.selectedGlyphName;
      if (!glyphName) {
        return;
      }
      store.clearGlyph(store.state.projectId, glyphName);
      store.schedulePersist(store.state.projectId);
      editor.canvasController.requestUpdate();
      panel?.refreshStatus();
    },

    clearAll() {
      store.clearProject(store.state.projectId);
      editor.canvasController.requestUpdate();
      panel?.refreshStatus();
    },

    refreshStatus() {
      panel?.refreshStatus();
    },
  };

  const panel = new SketchLayerPanel(plugin);
  plugin.panel = panel;
  editor.addSidebarPanel(panel, "right");

  const actionExecutor = editor.actionExecutor;
  if (actionExecutor) {
    actionExecutor.registerAction(
      "action.sketch-layer.toggle-mode",
      {
        topic: "action-topics.menu.view",
        titleKey: "action.sketch-layer.toggle-mode",
        defaultShortCuts: [{ baseKey: "s" }],
      },
      () => plugin.toggleMode(),
      null,
      () => "Sketch layer: toggle drawing mode"
    );
    actionExecutor.registerAction(
      "action.sketch-layer.clear-glyph",
      {
        topic: "action-topics.menu.view",
        titleKey: "action.sketch-layer.clear-glyph",
        defaultShortCuts: [],
      },
      () => plugin.clearGlyph(),
      null,
      () => "Sketch layer: clear sketch on selected glyph"
    );
  } else {
    console.warn(
      "[Sketch Layer] editor.actionExecutor is not available; " +
        "the plugin needs a Fontra version that exposes it."
    );
  }

  // Exit drawing mode with Escape (also handled on the overlay itself).
  window.addEventListener("keydown", (event) => {
    if (store.state.mode && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      plugin.setMode(false);
    }
  });

  // Make sure pending sketch edits reach localStorage before the page goes.
  window.addEventListener("pagehide", () => {
    store.persist(store.state.projectId);
  });

  editor.__sketchLayer = plugin;
  return plugin;
}
