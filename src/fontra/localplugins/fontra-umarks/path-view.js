// The path (step 4 quater): the panel follows the designer's work, top to
// bottom, one line per step, each with what it counts, one action, and a fold
// with the glyphs concerned.
//
//   ① Glyph set   [ GF Latin Core ▾ ] + 3 − 1   [Edit…] [… ▾]
//              239 glyphs · 132 accented glyphs, built from 21 parts · 81 done
//   ▸ ② Draw      15 glyphs to add · 6 still to draw (6 bases)  [Add 15 missing glyphs]
//   ▸ ③ Anchors   11 drawn glyphs have no anchors yet   [Place anchors]
//   ▸ ④ Check     2 anchors out of place · 3 moved by hand  [Re-place 2]
//   ▸ ⑤ Compose   7 ready · 32 waiting for A, E to be drawn · 61 can't be built yet  [Make 7]
//   ▸ ⑥ Update    8 glyphs have moved off their anchors  [Update 8]
//
// The folds are the items of Fontra's own `ui-accordion`, all closed when the
// panel opens; a line with nothing left reads « done » in green, and folds.
// Ticking glyphs in a fold narrows that line's action, and its button says so
// (« Make 5 »). A double-click on a glyph opens it.
//
// Like every view of the panel, this file only draws and reports what is
// clicked; target.js decides, marks-panel.js acts.

import { accordion, button, element, focusedIn, iconButton, reconcileChildren, replaceChildren, showFontraMenu } from "./ui.js";

export const STEPS = [
  { id: "draw", number: "②", name: "Draw" },
  { id: "anchors", number: "③", name: "Anchors" },
  { id: "check", number: "④", name: "Check" },
  { id: "compose", number: "⑤", name: "Compose" },
  { id: "update", number: "⑥", name: "Update" },
];

/** Set a node's text only when it changes: the same text is not written again. */
function setText(node, text) {
  if (node.textContent !== text) {
    node.textContent = text;
  }
}

export const stepItemId = (id) => `umarks-step-${id}`;

export class PathView {
  constructor(callbacks = {}, { stylesheet } = {}) {
    this.callbacks = callbacks;
    this.stylesheet = stylesheet;
    this.selection = Object.fromEntries(STEPS.map((step) => [step.id, new Set()]));
    this.steps = {};
    // how many rows were built since the panel opened: a test reads it (6b § 0)
    this.rowsBuilt = 0;
    this.build();
  }

  build() {
    // ① the glyph set: a menu of the ones chosen for this font (and Add a glyph set…), our own list, Edit…
    this.targetSelect = element("select", {
      "data-field": "target",
      title: "The glyph set you want to end up with",
      onchange: (event) => this.callbacks.onTargetChange?.(event.target.value),
    });
    this.targetList = element("span", { class: "umarks-target-list", "data-role": "target-list" });
    this.editButton = button("Edit…", () => this.callbacks.onEdit?.(), {
      className: "umarks-button--small",
      title: "Name the glyph set, add glyphs to it or take some out, or remove it from the menu",
    });
    // `…`: Fontra's own menu (6a, decision 4) — export the rules, import a
    // file of rules, whatever wrote it
    this.moreButton = iconButton("menu-2", (event) => {
      event.stopPropagation();
      this.showMoreMenu();
    }, { title: "Export or import the rules", dataset: { field: "target-more" } });
    this.moreButton.classList.add("umarks-more");
    // `?`: the guide, in a new tab (6b § 2)
    this.helpButton = button("?", () => this.callbacks.onHelp?.(), {
      className: "umarks-help",
      title: "The U+Marks guide",
    });
    this.helpButton.dataset.field = "help";
    this.fileInput = element("input", {
      type: "file",
      accept: ".json,application/json",
      hidden: "",
      "data-field": "import-file",
      onchange: (event) => {
        const file = event.target.files?.[0];
        if (file) {
          this.callbacks.onImportFile?.(this.fileKind, file);
        }
        event.target.value = "";
      },
    });
    this.targetInfo = element("div", { class: "umarks-target-info", "data-role": "target-info" });
    this.busyElement = element("div", { class: "umarks-busy", hidden: "" });
    // the first pass (6b § 3): one short message at a time, under ①
    this.tipText = element("span", { class: "umarks-tip-text" });
    this.tipElement = element("div", { class: "umarks-tip", "data-role": "tip", hidden: "" }, [
      this.tipText,
      button("×", () => this.callbacks.onTipClose?.(this.tipId), {
        className: "umarks-tip-close",
        title: "Don't show this again",
      }),
    ]);
    this.targetElement = element("div", { class: "umarks-target", "data-step": "target" }, [
      element("div", { class: "umarks-target-line" }, [
        element("span", { class: "umarks-step-name", text: "① Glyph set" }),
        this.targetSelect,
        this.targetList,
        this.editButton,
        this.moreButton,
        this.helpButton,
        this.fileInput,
      ]),
      this.targetInfo,
      this.tipElement,
      this.busyElement,
    ]);

    // ②–⑥ the folds
    const items = STEPS.map((step) => {
      const count = element("span", { class: "umarks-step-count", "data-count": step.id });
      const label = element("span", { class: "umarks-step-label" }, [
        element("span", { class: "umarks-step-name", text: `${step.number} ${step.name}` }),
        count,
      ]);
      const action = button("", (event) => {
        // the button sits in the fold's header: a click on it must not fold it
        event.stopPropagation();
        this.callbacks.onAction?.(step.id);
      }, { className: "umarks-step-action" });
      action.dataset.action = step.id;
      action.disabled = true;
      const action_ = element("span", { class: "umarks-step-aux" }, [action]);
      action_.addEventListener("click", (event) => event.stopPropagation());
      const note = element("div", { class: "umarks-note umarks-step-note", "data-note": step.id, hidden: "" });
      const list = element("div", { class: "umarks-glyph-list", "data-list": step.id });
      const extra = element("div", { class: "umarks-step-extra" });
      const content = element("div", { class: "umarks-section-body umarks-step-body" }, [note, list, extra]);
      this.steps[step.id] = { count, action, note, list, extra, done: null, nodes: new Map() };
      return {
        id: stepItemId(step.id),
        label,
        content,
        open: false,
        auxiliaryHeaderElement: action_,
      };
    });
    this.items = items;
    this.accordion = accordion(items, { stylesheet: this.stylesheet });
    this.accordion.onItemOpenClose = (item, open) => {
      const step = STEPS.find((candidate) => stepItemId(candidate.id) === item.id);
      if (step) {
        this.callbacks.onFoldChange?.(step.id, open);
      }
    };

    this.element = element("div", { class: "umarks-path" }, [this.targetElement, this.accordion]);
  }

  // --- ①

  /**
   * `groups`: [{label, options: [{value, label, placeholder}]}]; a group without
   * label is plain options. A `placeholder` option is what the closed menu
   * reads while nothing is chosen: it is not in the list that opens.
   */
  setTargetOptions(groups, value) {
    const key = JSON.stringify([groups, value]);
    if (key === this.targetOptionsKey) {
      return;
    }
    this.targetOptionsKey = key;
    const children = [];
    for (const group of groups) {
      const options = group.options.map((option) =>
        element("option", {
          value: option.value,
          text: option.label,
          hidden: option.placeholder ? "" : undefined,
          disabled: option.placeholder ? "" : undefined,
        })
      );
      if (group.label) {
        children.push(element("optgroup", { label: group.label }, options));
      } else {
        children.push(...options);
      }
    }
    replaceChildren(this.targetSelect, children);
    this.targetSelect.value = value;
  }

  /** {list: "+ 3 − 1", info: "312 glyphs · …", done, canEdit, error}. */
  setTarget({ list = "", info = "", done = false, canEdit = false, error = null }) {
    setText(this.targetList, list);
    this.targetList.hidden = !list;
    setText(this.targetInfo, error || info);
    this.targetInfo.classList.toggle("umarks-target-info--error", !!error);
    this.targetInfo.classList.toggle("umarks-done", !error && done);
    this.editButton.disabled = !canEdit;
  }

  /** The message of the first pass: {id, text}, or null for none. */
  setTip(tip) {
    this.tipId = tip?.id ?? null;
    this.tipElement.dataset.tip = this.tipId || "";
    setText(this.tipText, tip?.text || "");
    this.tipElement.hidden = !tip;
  }

  /** The entries of `…`: [{value, title}]. */
  moreMenuItems() {
    return [
      { value: "export", title: "Export rules…" },
      { value: "import", title: "Import rules…" },
    ];
  }

  /** Open `…` under its button, as Fontra's panels open theirs. */
  showMoreMenu() {
    const rect = this.moreButton.getBoundingClientRect();
    this.moreMenu = showFontraMenu(
      this.moreMenuItems().map((item) => ({
        title: item.title,
        callback: () => this.callbacks.onMore?.(item.value),
      })),
      { x: rect.left, y: rect.bottom }
    );
    return this.moreMenu;
  }

  /** Open the file picker for an import; `kind` comes back with the file. */
  askFile(kind) {
    this.fileKind = kind;
    this.fileInput.click();
  }

  setBusy(text) {
    this.busyElement.textContent = text || "";
    this.busyElement.hidden = !text;
  }

  // --- ②–⑥

  isOpen(id) {
    return !!this.items.find((item) => item.id === stepItemId(id))?.open;
  }

  setOpen(id, open) {
    const item = this.items.find((candidate) => candidate.id === stepItemId(id));
    if (item && item.open !== open && typeof this.accordion.openCloseAccordionItem === "function") {
      this.accordion.openCloseAccordionItem(item, open);
    }
  }

  /** The ticked glyphs of a fold, among those it shows. */
  selected(id) {
    return [...this.selection[id]];
  }

  /**
   * One line: `count` {text, done}, `action` {label, enabled, title},
   * `groups` [{title, rows: [{glyph, detail, selectable}]}], `extra` a node
   * shown under the list (the positions in ③, Adjust in ④), `empty` what the
   * fold says when it lists nothing, `note` a half line at the head of the
   * fold (⑤: shaped on the canvas, not yet in the font — 6d § 2).
   */
  setStep(id, { count, action, groups = [], extra = null, empty = "", note = "" }) {
    const step = this.steps[id];
    setText(step.note, note);
    step.note.hidden = !note;
    setText(step.count, count.text);
    step.count.classList.toggle("umarks-done", !!count.done);
    if (count.done && step.done === false) {
      this.setOpen(id, false); // a line that has nothing left folds
    }
    step.done = !!count.done;

    setText(step.action, action.label);
    step.action.disabled = !action.enabled;
    step.action.title = action.title || "";

    // what can still be ticked: the glyphs the fold shows with a box
    const selectable = new Set(
      groups.flatMap((group) => group.rows.filter((row) => row.selectable).map((row) => row.glyph))
    );
    for (const name of [...this.selection[id]]) {
      if (!selectable.has(name)) {
        this.selection[id].delete(name);
      }
    }

    // only what changed is built again (6b § 0): a row, a heading, the line
    // saying the fold is empty are kept by what they show, and the row that
    // holds the focus is never rebuilt
    const previous = step.nodes;
    const kept = new Map();
    const node = (key, build) => {
      let found = kept.has(key) ? null : previous.get(key);
      if (!found) {
        found = build();
        this.rowsBuilt += 1;
      }
      kept.set(key, found);
      return found;
    };
    const nodes = [];
    for (const group of groups) {
      if (!group.rows.length) {
        continue;
      }
      if (group.title) {
        nodes.push(node(`h ${group.title}`, () => element("div", { class: "umarks-subheading", text: group.title })));
      }
      for (const row of group.rows) {
        const key = `r ${JSON.stringify([row, this.selection[id].has(row.glyph)])}`;
        const focusedRow = [...previous.entries()].find(
          ([oldKey, oldNode]) => oldKey !== key && oldNode.dataset.glyphName === row.glyph && focusedIn(oldNode)
        );
        if (focusedRow && !kept.has(focusedRow[0])) {
          kept.set(focusedRow[0], focusedRow[1]);
          nodes.push(focusedRow[1]);
          continue;
        }
        nodes.push(node(key, () => this.buildRow(id, row)));
      }
    }
    if (!nodes.length && empty) {
      nodes.push(node(`e ${empty}`, () => element("div", { class: "umarks-empty", text: empty })));
    }
    step.nodes = kept;
    reconcileChildren(step.list, nodes);
    if (extra && step.extra.firstChild !== extra) {
      replaceChildren(step.extra, extra);
    }
  }

  buildRow(id, row) {
    const children = [];
    if (row.selectable) {
      const tick = element("input", {
        type: "checkbox",
        title: "Only these, for the button above",
        onchange: (event) => {
          if (event.target.checked) {
            this.selection[id].add(row.glyph);
          } else {
            this.selection[id].delete(row.glyph);
          }
          this.callbacks.onSelectionChange?.(id);
        },
      });
      tick.checked = this.selection[id].has(row.glyph);
      children.push(tick);
    } else {
      children.push(element("span", { class: "umarks-row-spacer" }));
    }
    children.push(element("span", { class: "umarks-row-name", text: row.glyph }));
    // a row may say what its hover shows (the causes of an impossible rule,
    // 5 bis § 7); otherwise the hover repeats a detail too long to be seen whole
    const hover = row.title !== undefined ? row.title : row.detail || "";
    children.push(element("span", { class: "umarks-row-detail", text: row.detail || "", title: hover }));
    return element(
      "div",
      {
        class: `umarks-glyph-row${row.state ? ` umarks-glyph-row--${row.state}` : ""}`,
        dataset: { glyphName: row.glyph },
        title: "Double-click to open the glyph",
        ondblclick: () => this.callbacks.onOpenGlyph?.(row.glyph),
      },
      children
    );
  }
}
