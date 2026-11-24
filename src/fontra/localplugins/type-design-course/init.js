// Type Design School: an editor plug-in for Fontra.
//
// A course, in the right sidebar: ten phases that take a beginner from
// "what even is a typeface" to a finished, spaced, proofed family. Each
// lesson has an idea, something to do, and a checklist; the panel remembers
// where the learner got to.
//
// The teaching material is in data/course.json — an original body of type
// design knowledge, written for this plug-in. Nothing here is copied from
// any book: the books that informed it were used the way a designer uses
// references, for the principles, not for the words.
//
// Loaded by Fontra from plugin.json: init(editor, pluginPath). Plain
// JavaScript on the objects the editor gives: no import from Fontra's own
// modules.

import { PANEL_ID } from "./course.js";
import { TypeDesignCoursePanel, registerPanelClass } from "./panel.js";

export function init(editor, pluginPath) {
  registerPanelClass();

  const panel = new TypeDesignCoursePanel(editor, pluginPath);
  try {
    editor.addSidebarPanel(panel, "right");
  } catch (error) {
    console.error("Type Design School: could not add the course panel.", error);
    throw error;
  }

  // Fontra looks the tab's tooltip up in its own translations; set it here
  // as well, so the tab reads correctly even before they are loaded.
  const tab = document.querySelector(`.sidebar-tab[data-sidebar-name="${PANEL_ID}"]`);
  if (tab) {
    tab.title = "Type Design School";
  }

  console.info(
    `Type Design School loaded from ${pluginPath}: the course panel is in the right sidebar.`
  );
}
