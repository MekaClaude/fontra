// fontra-umarks — the entry point Fontra's editor calls (EditorController.initPlugins).
// A plug-in cannot import anything from the bundled Fontra client: everything
// comes from `editorController`. See the README, "Fontra contracts".

import { GhostsLayer, installGhostsLayer } from "./marks-layer.js";
import { makeMarksPanel } from "./marks-panel.js";
import { readRulesData } from "./rules.js";

const PANEL_ELEMENT_NAME = "panel-umarks";

/**
 * Fontra calls this as soon as the editor is built — before the font's
 * sources, axes and customData are read (`initPlugins` runs in the
 * constructor, `fontController.initialize` in `start`). Nothing that reads
 * the font runs until the font controller says it is ready (6a, decision 3):
 * a panel that did, asked for sources that were not there yet, and the
 * plug-in did not load (a family of 18 sources, first load).
 *
 * The panel's shell is added at once, all the same: the editor puts back the
 * sidebar the designer left open once the plug-ins are called, and toggles
 * it — a panel added later would be toggled shut again. Its content, the
 * ghosts layer and `editorController.umarks` come with the font.
 */
export function init(editorController, pluginPath) {
  if (editorController.umarks || editorController.umarksLoading) {
    // already loaded, or loading (the address registered twice)
    return editorController.umarks || editorController.umarksLoading;
  }
  // the rules document, read fresh from the font each time: another session may
  // have changed it, and Make/Suggest will write to it from the panel
  const getRulesData = () => readRulesData(editorController.fontController.customData).data;
  const ghostsLayer = new GhostsLayer(editorController, getRulesData);

  const Panel = Object.getPrototypeOf(
    editorController.getSidebarPanel("glyph-note").constructor
  );
  const MarksPanel = makeMarksPanel(Panel, pluginPath, ghostsLayer);
  if (!customElements.get(PANEL_ELEMENT_NAME)) {
    customElements.define(PANEL_ELEMENT_NAME, MarksPanel);
  }
  const panel = new (customElements.get(PANEL_ELEMENT_NAME))(editorController);
  editorController.addSidebarPanel(panel, "right");

  editorController.umarksLoading = (async () => {
    try {
      await editorController.fontController.ensureInitialized;
      installGhostsLayer(editorController, ghostsLayer);
      ghostsLayer.attach();
      await panel.start();
      // a rules change from another collaborator makes the ghosts stale too
      editorController.fontController.addChangeListener({ customData: null }, () =>
        ghostsLayer.requestUpdate()
      );
      editorController.umarks = { ghostsLayer, panel, pluginPath };
      return editorController.umarks;
    } catch (error) {
      console.error("U+Marks: the plug-in could not load", error);
      throw error;
    } finally {
      delete editorController.umarksLoading;
    }
  })();
  return editorController.umarksLoading;
}
