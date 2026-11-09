// « Compose these bases with these marks » (step 6a, decision 6): the section
// of the target's Edit… dialog that writes rules from the anchors in a batch.
//
//   Compose these bases with these marks
//   Bases  ( the target's ▾ )  [filter]      Marks  [filter]
//   ☑ e  ☑ o  ☐ n …                           ☑ caron.alt  ☐ commaaccent …
//   Anchor [ top ▾ ]   Name [ base_mark ]   6 rules, 1 already there   [Add]
//
// The rules are manual, their glyphs go into the target's list; the plug-in
// never ticks anything on its own (decision 7). This file only draws and
// reports; marks-panel.js works out the anchors, the count, and writes.

import { button, element, replaceChildren, select, setOptions } from "./ui.js";

export class MatrixView {
  /**
   * `lists`: {bases: {target: [names], font: [names]}, marks: [names]};
   * `pattern`: the document's; callbacks: onChange(state), onAdd(state).
   */
  constructor({ lists, pattern }, callbacks = {}) {
    this.lists = lists;
    this.callbacks = callbacks;
    this.ticked = { bases: new Set(), marks: new Set() };
    this.baseScope = lists.bases.target.length ? "target" : "font";
    this.filters = { bases: "", marks: "" };

    this.baseLists = element("div", { class: "umarks-matrix-list", "data-list": "matrix-bases" });
    this.markLists = element("div", { class: "umarks-matrix-list", "data-list": "matrix-marks" });
    this.scopeSelect = select(
      [
        { value: "target", label: `the glyph set's (${lists.bases.target.length})` },
        { value: "font", label: `the font's (${lists.bases.font.length})` },
      ],
      this.baseScope,
      (value) => {
        this.baseScope = value;
        this.drawList("bases");
        this.changed();
      },
      { title: "Bases from the glyph set, or from the whole font" }
    );
    this.scopeSelect.dataset.field = "matrix-base-scope";
    this.anchorSelect = select([], "", () => this.changed(), { title: "The anchor every ticked base and mark has" });
    this.anchorSelect.dataset.field = "matrix-anchor";
    this.patternInput = element("input", {
      type: "text",
      spellcheck: "false",
      class: "umarks-matrix-pattern",
      "data-field": "matrix-pattern",
      title: "How the glyphs are named: base_mark, or {base} and {mark} anywhere",
      oninput: () => this.changed(),
    });
    this.patternInput.value = pattern;
    this.preview = element("span", { class: "umarks-matrix-preview", "data-role": "matrix-preview" });
    this.addButton = button("Add", () => this.callbacks.onAdd?.(this.state()), {
      className: "umarks-button--small",
      title: "Write these rules, by hand, and put their glyphs into the glyph set",
    });
    this.addButton.dataset.action = "matrix-add";
    this.addButton.disabled = true;

    const column = (kind, title, extra) =>
      element("div", { class: "umarks-matrix-column" }, [
        element("div", { class: "umarks-matrix-head" }, [
          element("span", { class: "umarks-matrix-title", text: title }),
          extra,
          element("input", {
            type: "search",
            placeholder: "filter",
            class: "umarks-matrix-filter",
            "data-field": `matrix-filter-${kind}`,
            oninput: (event) => {
              this.filters[kind] = event.target.value.trim();
              this.drawList(kind);
            },
          }),
        ]),
        kind === "bases" ? this.baseLists : this.markLists,
        element("div", { class: "umarks-matrix-all" }, [
          element("a", { href: "#", text: "all", onclick: (event) => this.tickAll(event, kind, true) }),
          element("span", { text: " · " }),
          element("a", { href: "#", text: "none", onclick: (event) => this.tickAll(event, kind, false) }),
        ]),
      ]);

    this.element = element("div", { class: "umarks-matrix", "data-role": "matrix" }, [
      element("div", { class: "umarks-matrix-heading", text: "Compose these bases with these marks" }),
      element("div", { class: "umarks-matrix-columns" }, [
        column("bases", "Bases", this.scopeSelect),
        column("marks", "Marks", null),
      ]),
      element("div", { class: "umarks-matrix-line" }, [
        element("label", { text: "Anchor" }),
        this.anchorSelect,
        element("label", { text: "Name" }),
        this.patternInput,
      ]),
      element("div", { class: "umarks-matrix-line" }, [this.preview, this.addButton]),
    ]);
    this.drawList("bases");
    this.drawList("marks");
    this.setAnchors([], "");
    this.setPreview("Tick bases and marks.", false);
  }

  names(kind) {
    return kind === "bases" ? this.lists.bases[this.baseScope] : this.lists.marks;
  }

  drawList(kind) {
    const filter = this.filters[kind].toLowerCase();
    const names = this.names(kind).filter((name) => !filter || name.toLowerCase().includes(filter));
    const node = kind === "bases" ? this.baseLists : this.markLists;
    replaceChildren(
      node,
      names.length
        ? names.map((name) => {
            const input = element("input", {
              type: "checkbox",
              dataset: { matrix: kind, glyphName: name },
              onchange: (event) => {
                event.target.checked ? this.ticked[kind].add(name) : this.ticked[kind].delete(name);
                this.changed();
              },
            });
            input.checked = this.ticked[kind].has(name);
            return element("label", { class: "umarks-matrix-item", title: name }, [input, element("span", { text: name })]);
          })
        : [element("div", { class: "umarks-note", text: kind === "bases" ? "no base" : "no mark with an _ anchor" })]
    );
  }

  tickAll(event, kind, on) {
    event.preventDefault();
    const filter = this.filters[kind].toLowerCase();
    for (const name of this.names(kind)) {
      if (!filter || name.toLowerCase().includes(filter)) {
        on ? this.ticked[kind].add(name) : this.ticked[kind].delete(name);
      }
    }
    this.drawList(kind);
    this.changed();
  }

  /** The ticked glyphs in the order of the lists, the anchor, the pattern. */
  state() {
    const inOrder = (kind, names) => names.filter((name) => this.ticked[kind].has(name));
    return {
      bases: inOrder("bases", this.names("bases")),
      marks: inOrder("marks", this.lists.marks),
      anchor: this.anchorSelect.value || null,
      pattern: this.patternInput.value.trim(),
    };
  }

  changed() {
    this.callbacks.onChange?.(this.state());
  }

  setAnchors(anchors, value) {
    setOptions(
      this.anchorSelect,
      anchors.length ? anchors.map((anchor) => ({ value: anchor, label: anchor })) : [{ value: "", label: "—" }],
      anchors.includes(value) ? value : anchors[0] ?? ""
    );
    this.anchorSelect.disabled = !anchors.length;
  }

  setPreview(text, canAdd) {
    this.preview.textContent = text;
    this.addButton.disabled = !canAdd;
  }
}

/** The dialog's styles for the matrix, appended to Fontra's dialog. */
export const MATRIX_STYLE = `
  .umarks-matrix { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 0.5em;
    border-top: 1px solid #8884; padding-top: 0.8em; margin-top: 0.4em; }
  .umarks-matrix-heading { font-weight: bold; }
  .umarks-matrix-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8em; }
  .umarks-matrix-column { display: flex; flex-direction: column; gap: 0.3em; min-width: 0; }
  .umarks-matrix-head { display: flex; gap: 0.4em; align-items: center; }
  .umarks-matrix-title { font-weight: 500; }
  .umarks-matrix-filter { width: 6em; flex: 1; min-width: 4em; }
  .umarks-matrix-list { height: 10em; overflow: auto; border: 1px solid #8884; border-radius: 0.3em;
    padding: 0.2em 0.4em; display: grid; grid-template-columns: repeat(auto-fill, minmax(7em, 1fr));
    grid-auto-rows: max-content; align-content: start; gap: 0 0.4em; }
  .umarks-matrix-item { display: flex; gap: 0.25em; align-items: center; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; text-align: left; }
  .umarks-matrix-all { font-size: 0.85em; opacity: 0.8; }
  .umarks-matrix-all a { color: inherit; }
  .umarks-matrix-line { display: flex; gap: 0.5em; align-items: center; flex-wrap: wrap; }
  .umarks-matrix-pattern { width: 10em; }
  .umarks-matrix-preview { flex: 1; opacity: 0.8; }
`;
