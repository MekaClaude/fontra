// Fontra Tutorials: the Tutorials panel, in the editor's right sidebar —
// every tour and lesson with its length and where you are in it (✓ done,
// ● going on), Start over, and the documentation. No long text here: that
// is the documentation's job.
//
// Copyright (c) 2026 Jérémie Hornus / U+Type — GPLv3, see LICENSE.

import { Tour, forgetTour, resumeOrStart, tourState } from "./tour.js";
import { TOURS } from "./tours/index.js";
import { DOCS, el } from "./tours/lib.js";

export const PANEL_ID = "fontra-tutorials";

const STYLE = `
:host { display: block; height: 100%; overflow: auto; box-sizing: border-box;
  font-family: fontra-ui-regular, -apple-system, sans-serif; color: var(--ui-element-foreground-color, inherit); }
.wrap { padding: 1em; }
h2 { font-size: 1.1em; margin: 0 0 .25em; }
p.intro { margin: 0 0 1em; opacity: .7; font-size: .9em; line-height: 1.35; }
.tour { display: flex; gap: .6em; align-items: flex-start; width: 100%; text-align: left; padding: .55em .6em;
  margin: 0 0 .35em; border: 1px solid var(--horizontal-rule-color, #aaa8); border-radius: 6px; background: transparent;
  color: inherit; font: inherit; cursor: pointer; }
.tour:hover, .tour:focus-visible { border-color: #f11759; outline: none; }
.tour .mark { width: 1.1em; flex: none; text-align: center; color: #f11759; font-weight: bold; }
.tour .text { flex: 1; min-width: 0; line-height: 1.3; }
.tour .text b { display: block; font-weight: 600; }
.tour .text small { display: block; opacity: .7; font-size: .88em; }
.tour .length { flex: none; opacity: .65; font-size: .85em; white-space: nowrap; }
hr { border: none; border-top: 1px solid var(--horizontal-rule-color, #aaa8); margin: .8em 0; }
.row { display: flex; flex-wrap: wrap; gap: .5em 1em; font-size: .9em; }
.row button, .row a { background: none; border: 0; padding: 0; color: inherit; font: inherit; cursor: pointer; opacity: .8; text-decoration: none; }
.row button:hover, .row a:hover { opacity: 1; text-decoration: underline; }
`;

// ✓ done, ● going on, nothing otherwise (skipped is not done).
export function tourMark(name) {
  const state = tourState(name);
  if (state === "done") return "✓";
  if (state && typeof state === "object") return "●";
  return "";
}

export class TutorialsPanel extends HTMLElement {
  constructor(iconPath) {
    super();
    this.identifier = PANEL_ID;
    this.iconPath = iconPath;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.append(el("style", {}, STYLE), (this.wrap = el("div", { class: "wrap" })));
    this.render();
    window.addEventListener("fontra-tour-end", () => this.render());
  }

  // Called by Fontra when the panel is shown or hidden.
  toggle(on) {
    if (on) this.render();
  }

  render() {
    const rows = Object.entries(TOURS).map(([name, tour]) => {
      const mark = tourMark(name);
      const what = tour.kind === "lesson" ? "lesson" : "tour";
      return el(
        "button",
        {
          type: "button",
          class: "tour",
          "data-tour": name,
          title: mark === "●" ? "Go on where you left it" : "",
          onclick: () => {
            resumeOrStart(name);
            this.render();
          },
        },
        el("span", { class: "mark", "aria-label": mark === "✓" ? "done" : mark === "●" ? "going on" : "" }, mark),
        el("span", { class: "text" }, el("b", {}, tour.title), tour.about ? el("small", {}, tour.about) : null),
        el("span", { class: "length" }, `${what} · ${tour.minutes} min`)
      );
    });
    this.wrap.replaceChildren(
      el("h2", {}, "Tutorials"),
      el("p", { class: "intro" }, "A tour shows you around; a lesson waits until you have done each step. Escape ends one, the arrow keys move through it."),
      ...rows,
      el("hr"),
      el(
        "div",
        { class: "row" },
        el(
          "button",
          {
            type: "button",
            title: "Forget what you have done: every tutorial starts from the beginning",
            onclick: () => {
              Tour.current?.end(null);
              for (const name of Object.keys(TOURS)) forgetTour(name);
              this.render();
            },
          },
          "Start over"
        ),
        el("a", { href: DOCS, target: "_blank", rel: "noopener" }, "Documentation ↗")
      )
    );
  }
}

if (!customElements.get("fontra-tutorials-panel")) {
  customElements.define("fontra-tutorials-panel", TutorialsPanel);
}
