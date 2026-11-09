// Fontra Tutorials — tour 1, "Around the editor": two minutes on the font
// that is open. Rules for the text: index.js.
//
// Copyright (c) 2026 Jérémie Hornus / U+Type — GPLv3, see LICENSE.

import { DOCS } from "./lib.js";

export const editor = {
  title: "Around the editor",
  kind: "tour",
  minutes: 2,
  about: "The canvas, the tools and the panels.",
  steps: [
    {
      id: "welcome",
      title: "Welcome to Fontra",
      text:
        "This is Fontra, the font editor: its interface runs in your browser, your files stay " +
        "with you. A two-minute tour of the editor? It is in the Tutorials panel whenever you " +
        "want it again.",
      next: "Take the tour",
      skip: "Not now",
    },
    {
      id: "canvas",
      anchor: "#edit-canvas",
      placement: "inside-bottom",
      ring: false,
      title: "The canvas",
      text:
        "Your font, as text. Double-click a glyph to edit its outline; double-click an empty " +
        "grey place to create that glyph. Scroll to pan, pinch or ⌘-scroll to zoom.",
      learn: DOCS + "/reference/editor-view/canvas/glyph-editor/",
    },
    {
      id: "text",
      anchor: '.sidebar-tab[data-sidebar-name="text-entry"]',
      open: "text-entry",
      title: "Preview text",
      text:
        "Type any text here and the canvas shows it in your font — including the glyphs " +
        "you have not drawn yet.",
      learn: DOCS + "/reference/editor-view/panels/preview-text",
    },
    {
      id: "tools",
      anchor: "#edit-tools",
      placement: "bottom",
      title: "Tools",
      text:
        "Pointer, pen, shapes, knife, ruler, hand, metrics — click and hold a tool for its " +
        "variants. The shape tool draws rectangles and ellipses: the quickest way to a first " +
        "letter.",
      learn: DOCS + "/reference/editor-view/tools/",
    },
    {
      id: "designspace",
      anchor: '.sidebar-tab[data-sidebar-name="designspace-navigation"]',
      open: "designspace-navigation",
      title: "Designspace",
      text:
        "One slider per axis of the font. Drag them: the canvas interpolates between the " +
        "sources. Each source is a drawing; edit any of them, or add one at any location.",
      learn: DOCS + "/reference/editor-view/panels/designspace",
    },
    {
      id: "glyph-info",
      anchor: '.sidebar-tab[data-sidebar-name="selection-info"]',
      open: "selection-info",
      title: "Glyph info",
      text:
        "The selected glyph's name, Unicode, advance width and sidebearings; the selected " +
        "points' coordinates. Type exact values here when a drawing must be precise.",
      learn: DOCS + "/reference/editor-view/panels/glyph-info",
    },
    {
      id: "export",
      title: "Export as",
      text:
        "File › Export as writes what you did: .fontra, designspace and UFOs, or a compiled " +
        "TTF or OTF. Font › Font Info is where axes, sources and names live. This tour is in " +
        "the Tutorials panel whenever you want it again.",
      learn: DOCS + "/reference/menu/file/export-as",
      next: "Done",
    },
  ],
};
