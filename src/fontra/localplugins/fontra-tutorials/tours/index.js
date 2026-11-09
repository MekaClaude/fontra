// Fontra Tutorials: the tours and lessons, in the order the panel lists
// them. Each lives in a file of its own; the mechanics are in ../tour.js,
// the panel in ../panel.js.
//
// A tour: {title, kind: "tour" | "lesson", minutes, about (one line for
// the panel), view (the page it is on, "editor" by default), then (the
// tour offered after the last step), steps}.
//
// A step:
//   id          its name, remembered when the editor reloads mid-way
//   title       the element's name as Fontra shows it in English
//   text        what the bubble says
//   anchor      a CSS selector ("a >>> b": b in a's shadow root); the step is
//               left out when it is absent from the editor (unless it has
//               `until`); none: the bubble is centred
//   placement   right | left | top | bottom | inside-top | inside-bottom |
//               inside-right; by default beside the anchor, towards the middle
//   offset      [dx, dy] added to the bubble's place
//   ring        false: no ring around the anchor
//   open        the editor's sidebar panel to open first
//   view, hash  the page it is on (fontoverview, fontinfo,
//               applicationsettings) and its panel (axes-panel…): the
//               plug-in lives in the editor, so the bubble stays here,
//               centred, and says where to go
//   until       a lesson's step: ({editor, fontController, sceneSettings})
//               => true (or a promise of it) once it is done; see lib.js
//   learn       the page of docs.fontra.xyz that says more
//   next, skip  the buttons' words, when not Next and Skip
//
// How to write them:
// - One bubble, one idea, 25 to 45 words, in the imperative; the title is
//   the element's name as Fontra shows it in English.
// - The first sentence says what it is for, the second how to use it, the
//   third (if any) the trap to avoid.
// - `learn` only to a page that really adds something.
// - Anchors: ids and data-* attributes, never the words (Fontra is
//   translated); check each one in the real editor.
// - No clicks made for the visitor on Fontra's menus: say where to click.
// - Texts valid for any font: never "this font has…".
// - English only for now.
//
// Copyright (c) 2026 Jérémie Hornus / U+Type — GPLv3, see LICENSE.

import { editor } from "./editor.js";
import { firstFont } from "./first-font.js";
import { fontInfo } from "./font-info.js";
import { fontOverview } from "./font-overview.js";
import { fromGlyphs } from "./from-glyphs.js";
import { fromRoboFont } from "./from-robofont.js";

export const TOURS = {
  editor,
  "first-font": firstFont,
  "font-info": fontInfo,
  "font-overview": fontOverview,
  "from-glyphs": fromGlyphs,
  "from-robofont": fromRoboFont,
};
