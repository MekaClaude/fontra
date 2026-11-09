// Fontra Tutorials: the guided tours and lessons.
//
// A bubble beside a part of the interface, a ring around it, Back / Next,
// and the steps of tours/index.js (one file per tour). Done or skipped is
// remembered in localStorage, as is the step a tour was left at.
//
// A tour is watched (Next after Next); a lesson is done: a step with
// `until` waits for the thing to be done — its Next reads "I did it" until
// then (to go on anyway), and a check shows once it is done.
//
// An editor plug-in loads in the editor only, so a step that belongs to
// another of Fontra's pages (Font Info, the font overview, Settings) is
// shown here, centred, with a line saying where to go; its `until` still
// reads the font, which the editor shares with those pages.
//
// The bubble is a native popover (top layer, above Fontra's overlays) when
// the browser has them, else an element of its own at the end of <body>.
//
// Adapted from the tours of Fontra Hive's "Try Fontra" (try-tour.js).
// Copyright (c) 2026 Jérémie Hornus / U+Type — GPLv3, see LICENSE.

import { TOURS } from "./tours/index.js";
import { el } from "./tours/lib.js";

const KEY = "fontra.tutorials"; // {"<tour>": "done" | "skipped" | {step: "<id>"}}
const GAP = 12; // between the ring and the bubble
const RING_PAD = 4;
const POLL = 300; // ms, between two looks at a step's `until`
const NARROW = 900; // px: below, the bubble sits at the bottom of the screen

// Where a step on another page is, said in the bubble.
const VIEW_NAMES = {
  fontoverview: "the Font overview (Font menu › Font overview)",
  fontinfo: "Font Info (Font menu › Font Info)",
  applicationsettings: "Settings (Fontra menu › Application settings)",
};
const PANEL_NAMES = {
  "font-info-panel": "Font info",
  "axes-panel": "Axes",
  "sources-panel": "Sources",
  "cross-axis-mapping-panel": "Cross-axis mapping",
  "opentype-feature-code-panel": "OpenType feature code",
  "development-status-definitions-panel": "Development status definitions",
  "conditional-substitutions-panel": "Conditional substitutions",
  "editor-behavior-panel": "Editor behavior",
  "theme-settings-panel": "Theme settings",
  "shortcuts-panel": "Shortcuts",
  "display-language-panel": "Display language",
  "clipboard-panel": "Clipboard",
};

const STYLE = `
.fontra-tour, .fontra-tour-ring { box-sizing: border-box; }
.fontra-tour {
  position: fixed; inset: auto; margin: 0; padding: 14px 16px 12px; width: 320px; max-width: calc(100vw - 24px);
  border: 0; border-radius: 12px; background: #222; color: #f4f1ea;
  font: 13px/1.45 fontra-ui-regular, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  box-shadow: 0 8px 30px rgba(0,0,0,.35); z-index: 1002; overflow: visible; /* the arrow sticks out */
}
.fontra-tour:popover-open { display: block; }
.fontra-tour h3 { font-size: 15px; font-weight: 600; margin: 0 0 6px; padding-right: 48px; }
.fontra-tour h3 .check { display: none; color: #7bd88f; margin-left: 6px; }
.fontra-tour.done h3 .check { display: inline; }
.fontra-tour p { margin: 0 0 10px; color: #e2ddd2; }
.fontra-tour p.where { color: #a9a397; font-size: 12px; }
.fontra-tour p.where b { color: #ff6b8f; font-weight: 600; }
.fontra-tour .count { position: absolute; top: 14px; right: 16px; font-size: 12px; color: #a9a397; }
.fontra-tour .row { display: flex; align-items: center; gap: 8px; }
.fontra-tour .row .grow { flex: 1; }
.fontra-tour p.more { margin: -4px 0 10px; }
.fontra-tour p.more a { color: #ff6b8f; text-decoration: none; font-size: 12px; }
.fontra-tour p.more a:hover { text-decoration: underline; }
.fontra-tour button {
  font: inherit; color: #fff; background: #f11759; border: 0; border-radius: 999px;
  padding: 5px 12px; cursor: pointer; text-decoration: none; white-space: nowrap;
}
.fontra-tour button.plain, .fontra-tour button.waiting { background: transparent; color: #f4f1ea; border: 1px solid #555; }
.fontra-tour button.link { background: transparent; color: #a9a397; border: 0; padding: 5px 4px; }
.fontra-tour .arrow { position: absolute; width: 14px; height: 14px; background: #222; transform: rotate(45deg); }
.fontra-tour[data-side="right"] .arrow { left: -7px; top: 20px; }
.fontra-tour[data-side="left"] .arrow { right: -7px; top: 20px; }
.fontra-tour[data-side="bottom"] .arrow { top: -7px; left: 24px; }
.fontra-tour[data-side="top"] .arrow { bottom: -7px; left: 24px; }
.fontra-tour-ring {
  position: fixed; pointer-events: none; z-index: 1001; border: 2px solid #f11759; border-radius: 8px;
  box-shadow: 0 0 0 4px rgba(241, 23, 89, .25);
}
`;

// --- What is remembered ----------------------------------------------------

function remembered() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null") || {};
  } catch (error) {
    return {};
  }
}

function remember(name, state) {
  try {
    const all = remembered();
    if (state === undefined) delete all[name];
    else all[name] = state;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (error) {
    // no localStorage: offered again next time
  }
}

export function tourState(name) {
  return remembered()[name] || null;
}

// Forget a tour: it starts over, and is offered again.
export function forgetTour(name) {
  remember(name, undefined);
}

// --- Where things are ------------------------------------------------------

function stepView(tour, step) {
  return step.view || tour.view || "editor";
}

// A selector, through open shadow roots: "a >>> b" is b in a's shadow root.
export function deepQuery(selector, root = document) {
  let node = root;
  for (const part of selector.split(">>>").map((s) => s.trim())) {
    const scope = node === root ? root : node.shadowRoot;
    node = scope?.querySelector(part);
    if (!node) return null;
  }
  return node;
}

let editorController = null;

// The editor the plug-in was given (init.js); window.editorController as a fallback.
export function setEditor(editor) {
  editorController = editor;
}

// The tours say ⌘. Elsewhere Fontra's command key is Ctrl: say what is on
// the reader's keyboard. (Fontra's own test for a Mac, in utils.ts.)
const IS_MAC = navigator.userAgent.indexOf("Mac") != -1;

export function forKeyboard(text, isMac = IS_MAC) {
  return isMac ? text : text.replace(/⌘(-?)/g, (_, dash) => (dash ? "Ctrl-" : "Ctrl+"));
}

// What a step's `until` gets: Fontra's public objects.
function context() {
  const editor = editorController || window.editorController || null;
  return {
    editor,
    fontController: editor?.fontController || null,
    sceneSettings: editor?.sceneSettings || null,
  };
}

function install() {
  if (!document.getElementById("fontra-tour-style")) {
    document.head.append(el("style", { id: "fontra-tour-style" }, STYLE));
  }
}

// The sidebar panel's tab is "selected" when the panel is open.
function openPanel(name) {
  const tab = document.querySelector(`.sidebar-tab[data-sidebar-name="${name}"]`);
  if (!tab || tab.classList.contains("selected")) return;
  const editor = editorController || window.editorController;
  if (editor && typeof editor.toggleSidebar === "function") editor.toggleSidebar(name);
  else tab.click();
}

// The area two boxes {left, top, right, bottom} share.
function overlap(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0.5 && h > 0.5 ? w * h : 0;
}

// --- The tour --------------------------------------------------------------

export class Tour {
  constructor(name, tour = TOURS[name]) {
    this.name = name;
    this.tour = tour;
    // A step whose part of the interface is absent from the editor is left
    // out — unless it is on another page, or waits for something to be done
    // (what it points at may come later).
    this.steps = tour.steps.filter(
      (step) => !step.anchor || step.until || stepView(tour, step) !== "editor" || deepQuery(step.anchor)
    );
    this.index = -1;
    this.bubble = null;
    this.ring = null;
    this.done = false;
    this.polling = null;
    this.onKey = (event) => this.key(event);
    this.onMove = () => this.place();
    // The part of the interface a step points at may grow, shrink or move
    // while it is shown (a panel resized, the window, a sidebar opening):
    // the bubble and the ring follow it. The anchor and every box it sits
    // in are watched.
    this.watched = null;
    this.watchedOthers = [];
    this.placing = 0;
    const later = () => {
      if (this.placing) return;
      this.placing = requestAnimationFrame(() => {
        this.placing = 0;
        this.place();
      });
    };
    this.observer = typeof ResizeObserver === "function" ? new ResizeObserver(later) : null;
    this.added = typeof MutationObserver === "function" ? new MutationObserver(later) : null;
  }

  static current = null;

  start(index = 0) {
    if (Tour.current) Tour.current.end(null);
    Tour.current = this;
    install();
    this.bubble = el("div", { class: "fontra-tour", role: "dialog", "aria-label": this.tour.title });
    if ("showPopover" in this.bubble) this.bubble.setAttribute("popover", "manual");
    this.ring = el("div", { class: "fontra-tour-ring", hidden: "" });
    document.body.append(this.ring, this.bubble);
    if (this.bubble.showPopover) this.bubble.showPopover();
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.onMove);
    window.addEventListener("scroll", this.onMove, true);
    this.added?.observe(document.body, { childList: true });
    this.show(index);
    return this;
  }

  get step() {
    return this.steps[this.index];
  }

  // Is the current step's part of the interface in the editor?
  get here() {
    return stepView(this.tour, this.step) === "editor";
  }

  // "In Font Info (Font menu › Font Info), Axes."
  where() {
    const step = this.step;
    const view = stepView(this.tour, step);
    if (view === "editor") return null;
    const panel = step.hash && PANEL_NAMES[step.hash] ? `, ${PANEL_NAMES[step.hash]}` : "";
    return el("p", { class: "where" }, el("b", {}, "Where: "), `in ${VIEW_NAMES[view] || view}${panel}.`);
  }

  show(index) {
    this.polling = null;
    this.done = false;
    this.index = Math.max(0, Math.min(index, this.steps.length - 1));
    const step = this.step;
    const last = this.index === this.steps.length - 1;
    // No Back on the first step, nor to the welcome from the step after it.
    const first = this.index === 0 || (this.index === 1 && this.steps[0].id === "welcome");
    if (this.here && step.open) openPanel(step.open);
    if (!step.transient && step.id !== "welcome") remember(this.name, { step: step.id });
    const count = this.steps.length > 1 && step.id !== "welcome" ? `${this.index}/${this.steps.length - 1}` : "";
    this.primary = el("button", { type: "button", class: "next", onclick: () => this.next() });
    const parts = [
      el("span", { class: "arrow", hidden: "" }),
      count ? el("span", { class: "count" }, count) : null,
      el("h3", {}, step.title, el("span", { class: "check", "aria-label": "done" }, "✓")),
      this.where(),
      el("p", {}, forKeyboard(step.text)),
      step.learn
        ? el("p", { class: "more" }, el("a", { class: "learn", href: step.learn, target: "_blank", rel: "noopener" }, "Learn more ↗"))
        : null,
      el(
        "div",
        { class: "row" },
        el("span", { class: "grow" }),
        first ? null : el("button", { type: "button", class: "plain", onclick: () => this.back() }, "Back"),
        last
          ? null
          : el("button", { type: "button", class: "link", onclick: () => this.end("skipped") }, step.skip || "Skip"),
        last && TOURS[this.tour.then]
          ? el(
              "button",
              { type: "button", class: "plain", onclick: () => this.keepGoing() },
              "Keep going: " + TOURS[this.tour.then].title
            )
          : null,
        this.primary
      ),
    ];
    this.bubble.replaceChildren(...parts.filter((part) => part));
    this.bubble.classList.remove("done");
    this.label();
    this.primary.focus();
    this.place();
    if (step.until) this.poll(step);
    // The sidebar may be sliding open: follow it for a moment.
    const until = performance.now() + 700;
    const follow = () => {
      if (!this.bubble || performance.now() > until) return;
      this.place();
      requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
  }

  // The main button: "I did it" while a lesson's step is not done; Next,
  // or the step's own word.
  label() {
    const step = this.step;
    const last = this.index === this.steps.length - 1;
    let text;
    let waiting = false;
    if (step.until && !this.done) {
      text = "I did it";
      waiting = true;
    } else text = step.next || (last ? "Done" : "Next");
    this.primary.textContent = text;
    this.primary.classList.toggle("waiting", waiting);
  }

  // Look at a step's `until` every POLL ms while it is shown.
  poll(step) {
    const token = {};
    this.polling = token;
    const check = async () => {
      if (this.polling !== token) return;
      let ok = false;
      try {
        ok = !!(await step.until(context()));
      } catch (error) {
        ok = false;
      }
      if (this.polling !== token || !this.bubble) return;
      if (ok !== this.done) {
        this.done = ok;
        this.bubble.classList.toggle("done", ok);
        this.label();
      }
      setTimeout(check, POLL);
    };
    check();
  }

  // The last step: on to the tour that follows this one.
  keepGoing() {
    const then = this.tour.then;
    this.end("done");
    forgetTour(then);
    startTour(then);
  }

  next() {
    if (this.index < this.steps.length - 1) this.show(this.index + 1);
    else this.end("done");
  }

  back() {
    if (this.index > 0) this.show(this.index - 1);
  }

  // Escape ends the tour; the arrows move through it while the bubble has
  // the focus (the editor keeps them otherwise).
  key(event) {
    if (!this.bubble) return;
    const inBubble = this.bubble.contains(document.activeElement);
    if (event.key === "Escape") this.end("skipped");
    else if (event.key === "ArrowRight" && inBubble) this.next();
    else if (event.key === "ArrowLeft" && inBubble) this.back();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  // What the bubble must leave in view besides its anchor: the open sidebar
  // panels, the panels' tabs, and the step's own `avoid` — but not the
  // anchor or a panel it is in. Their boxes, and GAP around.
  avoided(anchor) {
    const selectors = [".sidebar-container.visible", ".sidebar-tab", ...(this.step.avoid || [])];
    const boxes = [];
    for (const element of document.querySelectorAll(selectors.join(", "))) {
      if (anchor && (element === anchor || element.contains(anchor))) continue;
      const r = element.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      boxes.push({
        element,
        box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        left: r.left - GAP,
        top: r.top - GAP,
        right: r.right + GAP,
        bottom: r.bottom + GAP,
      });
    }
    return boxes;
  }

  // The bubble beside its anchor (or centred, with no anchor, or at the
  // bottom of a narrow screen), the ring around the anchor.
  place() {
    if (!this.bubble) return;
    const step = this.step;
    const bubble = this.bubble;
    const arrow = bubble.querySelector(".arrow");
    const anchor = this.here && step.anchor ? deepQuery(step.anchor) : null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
    const [dx, dy] = step.offset || [0, 0];
    const avoid = anchor ? this.avoided(anchor) : [];
    this.watch(anchor, avoid.map((box) => box.element));
    const r = anchor ? anchor.getBoundingClientRect() : null;
    if (!r || (r.width === 0 && r.height === 0) || step.ring === false) {
      this.ring.hidden = true;
    } else {
      this.ring.hidden = false;
      this.ring.style.left = r.left - RING_PAD + "px";
      this.ring.style.top = r.top - RING_PAD + "px";
      this.ring.style.width = r.width + 2 * RING_PAD + "px";
      this.ring.style.height = r.height + 2 * RING_PAD + "px";
    }
    if (!r || vw < NARROW) {
      arrow.hidden = true;
      bubble.removeAttribute("data-side");
      bubble.style.left = Math.round((vw - bw) / 2) + "px";
      // Narrow: at the bottom, the ring alone shows the place.
      bubble.style.top = Math.round(r ? Math.max(8, vh - bh - 24) : (vh - bh) / 2) + "px";
      return;
    }
    const preferred = step.placement || (r.left + r.width / 2 < vw / 2 ? "right" : "left");
    if (preferred.startsWith("inside-")) {
      // Inside its anchor (the canvas): nothing to point at, nothing to avoid.
      let left;
      let top;
      if (preferred === "inside-bottom") {
        left = r.left + (r.width - bw) / 2;
        top = r.bottom - bh - 24;
      } else if (preferred === "inside-top") {
        left = r.left + (r.width - bw) / 2;
        top = r.top + 24;
      } else {
        left = r.right - bw - 24;
        top = r.top + 24;
      }
      arrow.hidden = true;
      bubble.removeAttribute("data-side");
      bubble.style.left = Math.round(clamp(left + dx, 8, vw - bw - 8)) + "px";
      bubble.style.top = Math.round(clamp(top + dy, 8, vh - bh - 8)) + "px";
      return;
    }
    // The side asked for, else the one across, else the other two; on each,
    // next to the anchor or moved out past what is to be left in view. The
    // first place on screen that covers neither the ring nor any of it (nor
    // the margin around it) wins; else the one that covers least.
    const across = { left: "right", right: "left", top: "bottom", bottom: "top" };
    const sides = [preferred, across[preferred], ...Object.keys(across).filter((s) => s !== preferred && s !== across[preferred])];
    const ring = { left: r.left - RING_PAD, top: r.top - RING_PAD, right: r.right + RING_PAD, bottom: r.bottom + RING_PAD };
    let best = null;
    for (const side of sides) {
      for (const at of this.beside(side, r, bw, bh, avoid)) {
        const left = clamp(at.left + dx, 8, vw - bw - 8);
        const top = clamp(at.top + dy, 8, vh - bh - 8);
        const box = { left, top, right: left + bw, bottom: top + bh };
        // Pushed back on screen across its own axis, a bubble may slide over
        // what it points at: that place does not fit.
        const fits = side === "left" || side === "right" ? left === at.left + dx : top === at.top + dy;
        let cost = 1000 * overlap(box, ring) + (fits ? 0 : 1);
        for (const a of avoid) cost += 100 * overlap(box, a.box) + overlap(box, a);
        if (!best || cost < best.cost) best = { side, left, top, cost };
      }
      if (best.cost === 0) break;
    }
    const { side, left, top } = best;
    bubble.setAttribute("data-side", side);
    bubble.style.left = Math.round(left) + "px";
    bubble.style.top = Math.round(top) + "px";
    // The arrow points at the anchor, wherever the bubble had to go.
    arrow.hidden = false;
    if (side === "left" || side === "right") {
      arrow.style.left = "";
      arrow.style.top = Math.round(clamp(r.top + Math.min(r.height / 2, 20) - Math.round(top) - 7, 8, bh - 22)) + "px";
    } else {
      arrow.style.top = "";
      arrow.style.left = Math.round(clamp(r.left + Math.min(r.width / 2, 40) - Math.round(left) - 7, 12, bw - 26)) + "px";
    }
  }

  // Where the bubble may go on one side of the anchor (rectangle r), before
  // it is kept on screen: next to it; when that covers something to be left
  // in view, moved further out past it, as long as that stays on screen; or
  // slid along the anchor, as far as its arrow still reaches it.
  beside(side, r, bw, bh, avoid) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const across = side === "left" || side === "right";
    // The point the arrow shows: the anchor's middle, near its start when it is long.
    const target = across ? r.top + Math.min(r.height / 2, 20) : r.left + Math.min(r.width / 2, 40);
    const base = across
      ? { left: side === "right" ? r.right + GAP + RING_PAD : r.left - GAP - RING_PAD - bw, top: target - 27 }
      : { left: target - 31, top: side === "bottom" ? r.bottom + GAP + RING_PAD : r.top - GAP - RING_PAD - bh };
    const covering = (at) => avoid.filter((a) => overlap({ left: at.left, top: at.top, right: at.left + bw, bottom: at.top + bh }, a));
    if (!covering(base).length) return [base];
    const places = [base];
    // Out, past what it covers.
    let out = { ...base };
    for (let rounds = 0, hit = covering(out); hit.length && rounds < 8; rounds++, hit = covering(out)) {
      for (const a of hit) {
        if (side === "left") out.left = Math.min(out.left, a.left - bw);
        else if (side === "right") out.left = Math.max(out.left, a.right);
        else if (side === "top") out.top = Math.min(out.top, a.top - bh);
        else out.top = Math.max(out.top, a.bottom);
      }
    }
    const onScreen = across ? out.left >= 8 && out.left + bw <= vw - 8 : out.top >= 8 && out.top + bh <= vh - 8;
    if (onScreen) places.push(out);
    // Along, with the arrow (8 to bh - 22 px down, 12 to bw - 26 px in) still on the target.
    for (const a of covering(base)) {
      if (across) {
        for (const top of [a.bottom, a.top - bh]) {
          if (target - 7 - top >= 8 && target - 7 - top <= bh - 22) places.push({ left: base.left, top });
        }
      } else {
        for (const left of [a.right, a.left - bw]) {
          if (target - 7 - left >= 12 && target - 7 - left <= bw - 26) places.push({ left, top: base.top });
        }
      }
    }
    return places;
  }

  // Watch the step's anchor and the boxes it sits in (through shadow roots),
  // up to <body>, and what the bubble must leave in view.
  watch(anchor, others = []) {
    if (!this.observer) return;
    const same =
      anchor === this.watched &&
      others.length === this.watchedOthers.length &&
      others.every((element, i) => element === this.watchedOthers[i]);
    if (same) return;
    this.observer.disconnect();
    this.watched = anchor;
    this.watchedOthers = others;
    for (let node = anchor; node && node !== document.documentElement; ) {
      this.observer.observe(node);
      node = node.parentElement || node.getRootNode?.().host || null;
    }
    for (const element of others) this.observer.observe(element);
  }

  // Take the bubble away.
  close() {
    this.polling = null;
    this.observer?.disconnect();
    this.added?.disconnect();
    this.watched = null;
    this.watchedOthers = [];
    if (this.placing) cancelAnimationFrame(this.placing);
    this.placing = 0;
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.onMove);
    window.removeEventListener("scroll", this.onMove, true);
    if (this.bubble?.hidePopover && this.bubble.matches(":popover-open")) this.bubble.hidePopover();
    this.bubble?.remove();
    this.ring?.remove();
    this.bubble = null;
    this.ring = null;
    if (Tour.current === this) Tour.current = null;
  }

  // state: "done", "skipped", or null (replaced by another tour).
  end(state) {
    if (state) remember(this.name, state);
    this.close();
    window.dispatchEvent(new CustomEvent("fontra-tour-end", { detail: { tour: this.name, state } }));
  }
}

// `stepId`: where to start, when not at the beginning.
export function startTour(name = "editor", stepId = null) {
  if (!TOURS[name]) return null;
  const tour = new Tour(name);
  const index = stepId ? tour.steps.findIndex((step) => step.id === stepId) : -1;
  return tour.start(index < 0 ? 0 : index);
}

// Go on where a tour was left, or start it.
export function resumeOrStart(name) {
  const state = tourState(name);
  return startTour(name, state && typeof state === "object" ? state.step : null);
}

// --- When to show it -------------------------------------------------------

// The editor is up (its tools and the font), within `timeout` ms.
export function whenReady(timeout = 60000) {
  return new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      const editor = editorController || window.editorController;
      const ready = !!editor?.fontController && !!document.querySelector("#edit-tools .tool-button");
      if (ready) resolve(true);
      else if (performance.now() - started > timeout) resolve(false);
      else setTimeout(check, 250);
    };
    check();
  });
}

// On a first visit: the welcome bubble, once the editor is up; a tour left
// mid-way goes on from its step. Returns the tour, or null when it was done
// or skipped before, or the editor never came up.
export async function offerTour(name = "editor", timeout = 60000) {
  install();
  const done = (state) => state === "done" || state === "skipped";
  if (!TOURS[name]) return null;
  if (done(tourState(name))) return null;
  if (!(await whenReady(timeout))) return null;
  const state = tourState(name);
  if (done(state) || Tour.current) return null;
  return startTour(name, state && typeof state === "object" ? state.step : null);
}
