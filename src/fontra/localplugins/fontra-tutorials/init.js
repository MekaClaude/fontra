// Fontra Tutorials: an editor plug-in for Fontra. Guided tours and
// hands-on lessons, as bubbles anchored on the editor's interface.
//
// Loaded by Fontra from plugin.json: init(editor, pluginPath). It adds a
// "Tutorials" panel to the right sidebar, and on a first visit offers the
// tour of the editor. Everything is plain JavaScript on the objects the
// editor gives: no import from Fontra's own modules.
//
// Copyright (c) 2026 Jérémie Hornus / U+Type — GPLv3, see LICENSE.

import { PANEL_ID, TutorialsPanel } from "./panel.js";
import { offerTour, setEditor } from "./tour.js";

export function init(editor, pluginPath) {
  setEditor(editor);
  const panel = new TutorialsPanel(`${pluginPath}/icon.svg`);
  try {
    editor.addSidebarPanel(panel, "right");
  } catch (error) {
    console.error("Fontra Tutorials: could not add the Tutorials panel.", error);
    throw error;
  }
  // Fontra looks the tab's tooltip up in its own translations: set it here.
  const tab = document.querySelector(`.sidebar-tab[data-sidebar-name="${PANEL_ID}"]`);
  if (tab) tab.title = "Tutorials";
  console.info(`Fontra Tutorials loaded from ${pluginPath}: the Tutorials panel is in the right sidebar.`);
  // The welcome, once the editor is up; not again once done or skipped.
  offerTour("editor");
}
