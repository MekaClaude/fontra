// The anchor tools of the path (docs/brief.md § 4.2, § 4.6; step 4 quater):
// two pieces the panel places in its steps instead of a tab of their own.
//
//   positionsElement   in ③ Anchors, under its line: the positions Place
//                      anchors uses, each one a sentence, its fields on a click,
//                      and the sentence of what Place would write
//
//     ☑ top     base   center · x-height + 10 · caps: cap height + 10
//     ☑ _top    mark   center · bottom
//     + anchor
//     « Place 30 anchors (top, _top) in 18 glyphs, 2 sources — 12 already there, kept. »
//
//   adjustElement      in ④ Check, under its line: Move, Align, Copy from,
//                      Mirror, Derive variants, the italic angle (Re-place is
//                      the line's own button, 6b § 1) — one operation at a time, with the sentence that
//                      says what Apply will write
//
// The anchors of the glyph being edited are not here: they are on the canvas
// and in Fontra's Selection info, where they are edited one by one.
//
// This file only draws and reports clicks; what is decided is view-model.js's,
// what to do about a click is marks-panel.js's.

import {
  CASE_CHOICES,
  OPERATIONS,
  X_CHOICES,
  Y_CHOICES,
  choiceValue,
  describePreset,
} from "./view-model.js";
import {
  button,
  checkbox,
  element,
  focusedIn,
  numberField,
  reconcileChildren,
  select,
  setOptions,
} from "./ui.js";

function numberOf(input) {
  const number = Number(input.value);
  return input.value.trim() && Number.isFinite(number) ? number : 0;
}

function labelled(text, control, className = "umarks-field") {
  return element("label", { class: className }, [element("span", { text }), control]);
}

function textField(attributes = {}) {
  return element("input", { type: "text", spellcheck: "false", ...attributes });
}

function sentence(role) {
  return element("div", { class: "umarks-sentence", dataset: { role } });
}

/** The menu of an Align coordinate: leave it, or put it on one of the positions. */
function alignChoices(choices, extra = []) {
  return [{ value: "", label: "leave" }, ...choices.filter((c) => c.value !== "reference"), ...extra, { value: "reference", label: "as on a glyph" }];
}

export class AnchorsView {
  constructor(callbacks = {}, { stylesheet } = {}) {
    this.callbacks = callbacks;
    this.stylesheet = stylesheet;
    this.inputs = {};
    this.lastPresets = null;
    this.openPreset = null;
    // whether ④ is unfolded: the panel says so, the previews wait for it
    this.adjustOpen = false;
    this.build();

    // a click anywhere but on the open position closes it
    this.closeOnClickElsewhere = (event) => {
      if (!this.openPreset) {
        return;
      }
      const row = this.presetRows?.get(this.openPreset);
      if (row && !event.composedPath().includes(row)) {
        this.setOpenPreset(null);
      }
    };
    window.addEventListener("pointerdown", this.closeOnClickElsewhere, true);
  }

  build() {
    // --- the positions, and Place
    this.presetsElement = element("div", { class: "umarks-presets" });

    this.inputs.newName = textField({
      placeholder: "name, _name for a mark",
      "data-field": "new-name",
      onkeydown: (event) => {
        if (event.key === "Enter") {
          this.callbacks.onPresetAdd?.(this.inputs.newName.value);
        }
      },
    });
    this.addRow = element("div", { class: "umarks-add-row", hidden: "" }, [
      this.inputs.newName,
      button("Add", () => this.callbacks.onPresetAdd?.(this.inputs.newName.value), {
        className: "umarks-button--small",
      }),
    ]);
    this.addButton = button("+ anchor", () => {
      this.addRow.hidden = false;
      this.addButton.hidden = true;
      this.inputs.newName.focus();
    }, { className: "umarks-link-button", title: "Add a position to place" });

    this.placeSentence = sentence("place-sentence");

    this.positionsElement = element("div", { class: "umarks-section-body umarks-positions" }, [
      element("div", { class: "umarks-subheading", text: "Positions" }),
      this.presetsElement,
      element("div", { class: "umarks-add" }, [this.addButton, this.addRow]),
      this.placeSentence,
    ]);

    // --- Adjust: one operation at a time
    const italic = checkbox("umarks-follow-italic", "Follow the italic angle", false, (checked) =>
      this.callbacks.onItalicChange?.(checked)
    );
    italic.input.dataset.field = "follow-italic";
    italic.row.title =
      "Every anchor Place and Re-place put, and every position Check compares with, is slanted by the source's italic angle.";
    this.italicCheckbox = italic.input;

    this.operationSelect = select(OPERATIONS, "check", () => this.operationChanged());
    this.operationSelect.dataset.field = "op";

    this.operationGroups = this.buildOperations();
    this.previewElement = sentence("preview");
    this.applyButton = button("Apply", () => this.callbacks.onApply?.(), {
      className: "umarks-primary umarks-apply",
    });
    this.applyButton.disabled = true;

    // the names the anchor fields suggest; it lives next to them, in the
    // accordion's shadow root, where `list=` finds it
    this.namesList = element("datalist", { id: "umarks-anchor-names" });
    const adjustContent = element("div", { class: "umarks-section-body umarks-adjust" }, [
      this.namesList,
      element("div", { class: "umarks-subheading", text: "Adjust" }),
      italic.row,
      labelled("operation", this.operationSelect, "umarks-field umarks-field--inline"),
      ...Object.values(this.operationGroups),
      this.previewElement,
      element("div", { class: "umarks-buttons" }, [this.applyButton]),
    ]);
    // any value typed in the operation's fields asks for a new preview
    const fieldsChanged = (event) => {
      if (event.target === this.operationSelect || event.target === this.italicCheckbox) {
        return;
      }
      this.fieldsChanged();
    };
    adjustContent.addEventListener("input", fieldsChanged);
    adjustContent.addEventListener("change", fieldsChanged);

    this.adjustElement = adjustContent;
    this.operationChanged({ silent: true });
  }

  buildOperations() {
    const inputs = this.inputs;
    const anchorName = (field) =>
      textField({ list: "umarks-anchor-names", "data-field": field, value: "top", class: "umarks-name" });

    inputs.moveName = anchorName("move-name");
    inputs.moveDx = numberField({ "data-field": "move-dx", value: "0" });
    inputs.moveDy = numberField({ "data-field": "move-dy", value: "0" });

    inputs.alignName = anchorName("align-name");
    inputs.alignX = select(
      alignChoices(X_CHOICES, [{ value: "base-anchor", label: "the base's anchor" }]),
      "",
      () => this.referenceShown()
    );
    inputs.alignX.dataset.field = "align-x";
    inputs.alignXRef = textField({ "data-field": "align-x-ref", placeholder: "glyph", class: "umarks-name", hidden: "" });
    inputs.alignY = select(alignChoices(Y_CHOICES), "", () => this.referenceShown());
    inputs.alignY.dataset.field = "align-y";
    inputs.alignYRef = textField({ "data-field": "align-y-ref", placeholder: "glyph", class: "umarks-name", hidden: "" });
    inputs.alignDx = numberField({ "data-field": "align-dx", value: "0" });
    inputs.alignDy = numberField({ "data-field": "align-dy", value: "0" });

    inputs.copyMode = select(
      [
        { value: "glyph", label: "a glyph" },
        { value: "source", label: "a source" },
      ],
      "glyph",
      () => this.copyModeChanged()
    );
    inputs.copyMode.dataset.field = "copy-mode";
    inputs.copyGlyph = textField({ placeholder: "o", "data-field": "copy-glyph", class: "umarks-name" });
    inputs.copyFrom = select([], undefined, () => {});
    inputs.copyFrom.dataset.field = "copy-from";
    inputs.copyTo = select([], undefined, () => {});
    inputs.copyTo.dataset.field = "copy-to";
    inputs.copyNames = textField({ placeholder: "all", "data-field": "copy-names" });
    const copyReplace = checkbox("umarks-copy-replace", "overwrite anchors that are there", false, () => {});
    copyReplace.input.dataset.field = "copy-replace";
    inputs.copyReplace = copyReplace.input;

    inputs.mirrorName = anchorName("mirror-name");
    inputs.mirrorAngle = numberField({ "data-field": "mirror-angle", step: "any", placeholder: "source angle" });
    inputs.mirrorSource = select([], undefined, () => {});
    inputs.mirrorSource.dataset.field = "mirror-source";

    inputs.deriveCategory = select([], undefined, () => this.categoryChanged());
    inputs.deriveCategory.dataset.field = "derive-category";
    inputs.deriveSuffix = textField({ "data-field": "derive-suffix", placeholder: ".cap", class: "umarks-name" });
    inputs.deriveScale = numberField({ "data-field": "derive-scale", value: "100", step: "any" });
    inputs.deriveDy = numberField({ "data-field": "derive-dy", value: "0" });

    this.copyGlyphRow = element("div", { class: "umarks-field-row" }, [labelled("glyph", inputs.copyGlyph)]);
    this.copySourceRow = element("div", { class: "umarks-field-row", hidden: "" }, [
      labelled("from", inputs.copyFrom),
      labelled("to", inputs.copyTo),
    ]);

    const group = (op, ...children) =>
      element("div", { class: "umarks-op", dataset: { op } }, children);
    const row = (...children) => element("div", { class: "umarks-field-row" }, children);
    const note = (text) => element("div", { class: "umarks-note", text });

    return {
      check: group("check", note("Compares the anchors ticked in ③ with their positions, on the glyph set.")),
      move: group(
        "move",
        row(labelled("anchor", inputs.moveName), labelled("dx", inputs.moveDx), labelled("dy", inputs.moveDy))
      ),
      align: group(
        "align",
        row(labelled("anchor", inputs.alignName)),
        row(labelled("x on", inputs.alignX), inputs.alignXRef, labelled("dx", inputs.alignDx)),
        row(labelled("y on", inputs.alignY), inputs.alignYRef, labelled("dy", inputs.alignDy))
      ),
      copy: group(
        "copy",
        row(labelled("from", inputs.copyMode)),
        this.copyGlyphRow,
        this.copySourceRow,
        row(labelled("only these anchors", inputs.copyNames)),
        copyReplace.row
      ),
      mirror: group(
        "mirror",
        row(labelled("anchor", inputs.mirrorName), labelled("angle °", inputs.mirrorAngle)),
        row(labelled("in", inputs.mirrorSource))
      ),
      derive: group(
        "derive",
        row(labelled("for", inputs.deriveCategory), labelled("suffix", inputs.deriveSuffix)),
        row(labelled("scale %", inputs.deriveScale), labelled("dy", inputs.deriveDy))
      ),
    };
  }

  // --- the positions

  /**
   * Draw the positions. `checked` is the set of ticked names. A position is
   * redrawn only when it changed (6b § 0), and the one that holds the focus is
   * never rebuilt: its fields are brought up to date where they are, so that a
   * key held down in its dx keeps counting. `force` redraws regardless (a
   * refused value has to go back to what the preset says).
   */
  setPresets(presets, checked, { force = false } = {}) {
    const key = JSON.stringify([presets, [...checked]]);
    if (!force && key === this.lastPresets) {
      return;
    }
    this.lastPresets = key;
    const names = Object.keys(presets);
    const options = names.map((name) => element("option", { value: name }));
    if (names.join(" ") !== [...this.namesList.options].map((option) => option.value).join(" ")) {
      this.namesList.replaceChildren(...options);
    }
    if (this.openPreset && !(this.openPreset in presets)) {
      this.openPreset = null;
    }
    const previous = this.presetRows || new Map();
    this.presetRows = new Map();
    const rows = Object.entries(presets).map(([name, preset]) => {
      const rowKey = JSON.stringify([preset, checked.has(name)]);
      let row = previous.get(name);
      if (!row || (row.dataset.key !== rowKey && !focusedIn(row)) || (force && !focusedIn(row))) {
        row = this.buildPreset(name, preset, checked);
        this.presetBuilds = (this.presetBuilds || 0) + 1;
      } else if (row.dataset.key !== rowKey || force) {
        this.updatePreset(row, name, preset, checked);
      }
      row.dataset.key = rowKey;
      this.presetRows.set(name, row);
      return row;
    });
    reconcileChildren(
      this.presetsElement,
      rows.length
        ? rows
        : [this.emptyPresets ??= element("div", { class: "umarks-empty", text: "No position yet: + anchor adds one." })]
    );
  }

  /** A position that holds the focus, brought up to date in place: every field but the focused one. */
  updatePreset(row, name, preset, checked) {
    const active = focusedIn(row);
    const tick = row.querySelector("[data-preset-check]");
    if (tick && tick !== active) {
      tick.checked = checked.has(name);
    }
    for (const field of row.querySelectorAll("[data-field]")) {
      if (field === active) {
        continue;
      }
      const name_ = field.dataset.field;
      if (name_ === "dx" || name_ === "dy") {
        field.value = preset[name_] === undefined ? "" : String(preset[name_]);
      } else if (name_ === "case") {
        field.value = preset.case || "";
      } else if (name_ === "x" || name_ === "y") {
        field.value = choiceValue(preset[name_]);
      } else if (name_ === "x-ref" || name_ === "y-ref") {
        const spec = preset[name_[0]];
        field.value = spec?.startsWith("reference:") ? spec.slice("reference:".length) : "";
        field.hidden = choiceValue(spec) !== "reference";
      }
    }
    const phrase = row.querySelector("[data-preset-phrase]");
    if (phrase) {
      phrase.replaceChildren(...this.phraseParts(preset));
    }
  }

  phraseParts(preset) {
    return describePreset(preset)
      .split(" · ")
      .flatMap((part, index) => [index ? " · " : null, element("span", { class: "umarks-phrase-part", text: part })])
      .filter((part) => part !== null);
  }

  setOpenPreset(name) {
    this.openPreset = name;
    for (const [rowName, row] of this.presetRows || []) {
      const open = rowName === name;
      row.classList.toggle("open", open);
      row.querySelector(".umarks-preset-fields").hidden = !open;
    }
  }

  buildPreset(name, preset, checked) {
    const change = (field, value) => this.callbacks.onPresetChange?.(name, field, value);

    const tick = element("input", {
      type: "checkbox",
      "data-preset-check": name,
      title: "Place this anchor",
      onchange: (event) => this.callbacks.onPlaceToggle?.(name, event.target.checked),
    });
    tick.checked = checked.has(name);

    // x and y: a menu, and a glyph name when the position is « as on a glyph »
    const position = (field, choices) => {
      const spec = preset[field];
      const reference = textField({
        "data-preset": name,
        "data-field": `${field}-ref`,
        placeholder: "glyph",
        class: "umarks-name",
        onchange: (event) => {
          const glyph = event.target.value.trim();
          if (glyph) {
            change(field, `reference:${glyph}`);
          }
        },
      });
      reference.value = spec?.startsWith("reference:") ? spec.slice("reference:".length) : "";
      reference.hidden = choiceValue(spec) !== "reference";
      const menu = select(choices, choiceValue(spec), (value) => {
        reference.hidden = value !== "reference";
        if (value !== "reference") {
          change(field, value);
        } else if (reference.value.trim()) {
          change(field, `reference:${reference.value.trim()}`);
        } else {
          reference.focus();
        }
      });
      menu.dataset.preset = name;
      menu.dataset.field = field;
      return [menu, reference];
    };
    const delta = (field) => {
      const input = numberField({
        "data-preset": name,
        "data-field": field,
        placeholder: "0",
        onchange: (event) => change(field, event.target.value),
      });
      input.value = preset[field] === undefined ? "" : String(preset[field]);
      return input;
    };
    const caseMenu = select(CASE_CHOICES, preset.case || "", (value) => change("case", value));
    caseMenu.dataset.preset = name;
    caseMenu.dataset.field = "case";

    const [xMenu, xReference] = position("x", X_CHOICES);
    const [yMenu, yReference] = position("y", Y_CHOICES);
    const open = this.openPreset === name;
    const fields = element("div", { class: "umarks-preset-fields", hidden: open ? null : "" }, [
      element("div", { class: "umarks-field-row" }, [labelled("x", xMenu), xReference, labelled("dx", delta("dx"))]),
      element("div", { class: "umarks-field-row" }, [labelled("y", yMenu), yReference, labelled("dy", delta("dy"))]),
      element("div", { class: "umarks-field-row" }, [
        labelled("case", caseMenu),
        button(`Remove ${name}`, () => this.callbacks.onPresetRemove?.(name), {
          className: "umarks-button--small umarks-remove",
          title: "Remove this position from the list",
        }),
      ]),
    ]);

    const line = element(
      "div",
      {
        class: "umarks-preset-line",
        title: "Click to edit the position",
        onclick: (event) => {
          if (event.target !== tick) {
            this.setOpenPreset(this.openPreset === name ? null : name);
          }
        },
      },
      [
        tick,
        element("span", { class: "umarks-base", text: name }),
        element("span", { class: "umarks-on", text: preset.on === "marks" ? "mark" : "base" }),
        // each part of the sentence stays on one line: « cap height + 10 » never breaks
        element("span", { class: "umarks-phrase", dataset: { presetPhrase: name } }, this.phraseParts(preset)),
      ]
    );
    return element("div", { class: `umarks-preset${open ? " open" : ""}`, dataset: { preset: name } }, [
      line,
      fields,
    ]);
  }

  presetAdded() {
    this.inputs.newName.value = "";
    this.addRow.hidden = true;
    this.addButton.hidden = false;
  }

  // --- Place

  /** {text, ready}: the sentence of what Place anchors would write. */
  setPlaceSentence({ text }) {
    if (this.placeSentence.textContent !== (text || "")) {
      this.placeSentence.textContent = text || "";
    }
  }

  setBusy(text) {
    this.applyButton.disabled = this.applyButton.disabled || !!text;
  }

  // --- Adjust

  setItalic(on) {
    this.italicCheckbox.checked = !!on;
  }

  get operation() {
    return this.operationSelect.value;
  }

  operationChanged({ silent = false } = {}) {
    for (const [op, node] of Object.entries(this.operationGroups)) {
      node.hidden = op !== this.operation;
    }
    this.setPreview(null);
    if (!silent) {
      this.callbacks.onOperationChange?.(this.operation);
    }
  }

  fieldsChanged() {
    this.setPreview(null);
    this.callbacks.onFieldsChange?.(this.operation);
  }

  /** The values of the operation shown, as the panel's planners want them. */
  operationValues() {
    const inputs = this.inputs;
    const axis = (menu, reference) =>
      menu.value === "reference"
        ? reference.value.trim()
          ? `reference:${reference.value.trim()}`
          : ""
        : menu.value;
    switch (this.operation) {
      case "move":
        return {
          name: inputs.moveName.value.trim(),
          dx: numberOf(inputs.moveDx),
          dy: numberOf(inputs.moveDy),
        };
      case "align":
        return {
          name: inputs.alignName.value.trim(),
          x: axis(inputs.alignX, inputs.alignXRef),
          y: axis(inputs.alignY, inputs.alignYRef),
          dx: numberOf(inputs.alignDx),
          dy: numberOf(inputs.alignDy),
        };
      case "copy":
        return {
          mode: inputs.copyMode.value,
          glyph: inputs.copyGlyph.value.trim(),
          fromSource: inputs.copyFrom.value,
          toSource: inputs.copyTo.value,
          names: inputs.copyNames.value.split(/[\s,]+/).filter((name) => name && name !== "all"),
          replace: inputs.copyReplace.checked,
        };
      case "mirror":
        return {
          name: inputs.mirrorName.value.trim(),
          angle: inputs.mirrorAngle.value.trim() ? Number(inputs.mirrorAngle.value) : null,
          source: inputs.mirrorSource.value,
        };
      case "derive":
        return {
          category: inputs.deriveCategory.value,
          suffix: inputs.deriveSuffix.value.trim(),
          scale: numberOf(inputs.deriveScale) / 100 || 1,
          dy: numberOf(inputs.deriveDy),
        };
      default:
        return {};
    }
  }

  /**
   * {text, ready} | null: the sentence that says what Apply will write. Apply
   * is enabled only while a sentence is shown and says there is something to do.
   */
  setPreview(preview) {
    const text = preview?.text ?? "…";
    if (this.previewElement.textContent !== text) {
      this.previewElement.textContent = text;
    }
    this.previewElement.classList.toggle("umarks-sentence--waiting", !preview);
    this.applyButton.disabled = !preview?.ready;
  }

  referenceShown() {
    this.inputs.alignXRef.hidden = this.inputs.alignX.value !== "reference";
    this.inputs.alignYRef.hidden = this.inputs.alignY.value !== "reference";
  }

  copyModeChanged() {
    const bySource = this.inputs.copyMode.value === "source";
    this.copyGlyphRow.hidden = bySource;
    this.copySourceRow.hidden = !bySource;
  }

  /** `sources`: [{identifier, name}], for the Copy from and Mirror menus. */
  setSources(sources) {
    const options = sources.map((source) => ({ value: source.identifier, label: source.name }));
    const key = JSON.stringify(options);
    if (key === this.sourcesKey) {
      return;
    }
    this.sourcesKey = key;
    const inputs = this.inputs;
    const previous = [inputs.copyFrom.value, inputs.copyTo.value, inputs.mirrorSource.value];
    setOptions(inputs.copyFrom, options, previous[0]);
    setOptions(inputs.copyTo, [{ value: "*", label: "all the others" }, ...options], previous[1] || "*");
    setOptions(inputs.mirrorSource, [{ value: "*", label: "all sources" }, ...options], previous[2] || "*");
  }

  setCategories(categories) {
    const key = JSON.stringify(categories);
    if (key === this.categoriesKey) {
      return;
    }
    this.categoriesKey = key;
    setOptions(
      this.inputs.deriveCategory,
      categories.map(({ category }) => ({ value: category, label: category })),
      this.inputs.deriveCategory.value
    );
    this.categories = categories;
    this.categoryChanged();
  }

  categoryChanged() {
    const found = (this.categories || []).find(
      ({ category }) => category === this.inputs.deriveCategory.value
    );
    this.inputs.deriveSuffix.value = found?.suffix ?? "";
  }
}
