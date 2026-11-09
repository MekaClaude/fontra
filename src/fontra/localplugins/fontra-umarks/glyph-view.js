// The open glyph (step 4 quater), under the path: what the glyph being edited
// is to the target and to the rules, and the gestures on it alone.
//
// On a base (`e`):
//   e   base · in the target
//   Ghosts    [ all 9 ▾ ]                      needs 1 and 2
//   Composes  è é ê ë ē ė ę ě                  need 3: ✓ made · ○ to make · possible
//             (a click: the rule, its accent and anchor, add to the glyph set or take out)
//   ⚠ top of e moved 20 u up since it was made   [Update 3]
//
// On a composed glyph (`eacute`): its rule (base, accent @ anchor, editable,
// suggested or manual, Keep), its state (made, moved off its anchors by how
// much, waiting for what, can't be built yet and why), Make, Update, Decompose; the ghost
// is the result of the rule. On an accent (`acutecomb`): the bases of the rules
// that use it, all as ghosts, and the same menu to keep only one.
//
// This file only draws and reports clicks.

import { staleListText } from "./target.js";
import { button, element, replaceChildren, select } from "./ui.js";

const STATUS_MARKS = { made: "✓", "to-make": "○", possible: "·" };
const STATUS_TITLES = {
  made: "made: in the font",
  "to-make": "in the glyph set, to make",
  possible: "possible — not in your glyph set",
};

function provenanceBadge(rule) {
  const manual = rule?.source === "manual";
  return element("span", {
    class: `umarks-badge umarks-badge--${manual ? "manual" : "suggested"}`,
    "data-role": "provenance",
    text: manual ? "✎ manual" : "auto",
    title: manual
      ? "Written or changed by you: it never moves on its own"
      : "Suggested from Unicode and the names: it follows the font until you change it or Keep it",
  });
}

export class GlyphView {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.element = element("div", { class: "umarks-glyph-view" });
    this.selectedComposable = null;
    // the causes whose ▸ is open, kept across a re-render (6d § 1)
    this.openCauses = new Set();
  }

  /** `info`: null when no glyph is open, else what marks-panel.js worked out. */
  set(info) {
    this.info = info;
    if (!info) {
      replaceChildren(
        this.element,
        element("div", { class: "umarks-empty", text: "Open a glyph to see what it composes, and its accents on the canvas." })
      );
      return;
    }
    if (
      this.selectedComposable &&
      !(info.composes || []).some((entry) => entry.glyph === this.selectedComposable) &&
      this.selectedComposable !== this.focusName
    ) {
      this.selectedComposable = null;
    }
    // a re-render while the name is being typed keeps the focus in it
    const typing = this.element.getRootNode?.()?.activeElement?.dataset?.field === "rule-name";
    replaceChildren(this.element, [
      this.heading(info),
      info.drawing ? this.drawingRow(info.drawing) : null,
      this.ghostsRow(info),
      info.kind === "composed" ? this.ruleBlock(info) : null,
      info.composes ? this.composesBlock(info) : null,
      info.bases ? this.basesBlock(info) : null,
      info.warning ? this.warningRow(info.warning) : null,
    ]);
    if (typing) {
      const input = this.element.querySelector('[data-field="rule-name"]');
      input?.focus();
      input?.setSelectionRange?.(input.value.length, input.value.length);
    }
  }

  heading(info) {
    const what = { composed: "composed", base: "base", mark: "accent" }[info.kind] || "";
    const where = info.inTarget
      ? "in the glyph set"
      : info.partOfTarget
        ? "used by the glyph set"
        : info.hasTarget
          ? "not in the glyph set"
          : null;
    const parts = [what, where, info.stateText]
      .filter((text) => text)
      .join(" · ");
    return element("div", { class: "umarks-glyph-heading" }, [
      element("span", { class: "umarks-glyph-name", "data-role": "glyph-name", text: info.glyphName }),
      element("span", { class: "umarks-glyph-what", "data-role": "glyph-what", text: parts }),
    ]);
  }

  /** A part not drawn everywhere: where and why (5 bis § 5). */
  drawingRow(drawing) {
    const what = {
      absent: "to add",
      empty: "still to draw",
      incomplete: "missing in some sources — usable, Make leaves those out",
    }[drawing.status] || drawing.status;
    return element("div", { class: "umarks-glyph-row-line" }, [
      element("span", { class: "umarks-glyph-label", text: "Drawing" }),
      element("span", {
        class: `umarks-state umarks-state--${drawing.status === "incomplete" ? "waiting" : "missing"}`,
        "data-role": "drawing",
        text: [what, ...(drawing.why || [])].join(": "),
      }),
    ]);
  }

  ghostsRow(info) {
    const ghost = info.ghost;
    let control;
    if (!ghost.options.length) {
      control = element("span", { class: "umarks-note", "data-role": "ghost-note", text: ghost.note });
    } else if (info.kind === "composed") {
      control = element("span", { class: "umarks-note", "data-role": "ghost-note", text: "the result of its rule" });
    } else {
      control = select(ghost.options, ghost.value, (value) => this.callbacks.onGhostChoice?.(value), {
        title: "All the accents of the rules, or only one",
      });
      control.dataset.field = "ghosts";
    }
    return element("div", { class: "umarks-glyph-row-line" }, [
      element("span", { class: "umarks-glyph-label", text: "Ghosts" }),
      control,
    ]);
  }

  // --- a composed glyph: its rule, its state, its buttons

  markRow(glyphName, rule, mark, index, choices, { editable = true } = {}) {
    const glyphMenu = select(
      (choices.variants[index] || [mark.glyph]).map((name) => ({ value: name, label: name })),
      mark.glyph,
      (value) => this.callbacks.onMarkGlyphChange?.(glyphName, index, value),
      { title: "The accent: the variants the font has" }
    );
    glyphMenu.dataset.field = `mark-glyph-${index}`;
    glyphMenu.disabled = !editable;
    const anchorMenu = select(
      (choices.anchors[index] || [mark.anchor]).map((name) => ({ value: name, label: name })),
      mark.anchor,
      (value) => this.callbacks.onMarkAnchorChange?.(glyphName, index, value),
      { title: "The anchor of the base it sits on" }
    );
    anchorMenu.dataset.field = `mark-anchor-${index}`;
    anchorMenu.disabled = !editable;
    return element("span", { class: "umarks-mark-row" }, [
      element("span", { class: "umarks-at", text: "+" }),
      glyphMenu,
      element("span", { class: "umarks-at", text: "@" }),
      mark.on ? element("span", { class: "umarks-on", text: `${mark.on}'s` }) : null,
      anchorMenu,
    ]);
  }

  ruleLine(glyphName, rule, choices, options = {}) {
    if (rule.legacy) {
      // a legacy accent: one component of its `…comb`, the margins computed
      const combMenu = select(
        (choices.combs?.length ? choices.combs : [rule.legacy]).map((name) => ({ value: name, label: name })),
        rule.legacy,
        (value) => this.callbacks.onLegacyChange?.(glyphName, value),
        { title: "The combining accent it is made of; the margins are computed" }
      );
      combMenu.dataset.field = "legacy-comb";
      combMenu.disabled = options.editable === false;
      return element("div", { class: "umarks-rule-line", "data-role": "rule" }, [
        element("span", { class: "umarks-base", text: "spacing accent, from" }),
        combMenu,
      ]);
    }
    return element("div", { class: "umarks-rule-line", "data-role": "rule" }, [
      element("span", { class: "umarks-base", text: [rule.base, ...(rule.append || [])].join(" + ") }),
      ...(rule.marks || []).map((mark, index) => this.markRow(glyphName, rule, mark, index, choices, options)),
    ]);
  }

  ruleBlock(info) {
    const { rule } = info;
    const keep =
      rule.source !== "manual"
        ? button("Keep", () => this.callbacks.onKeep?.(info.glyphName), {
            className: "umarks-button--small",
            title: "Take this rule as it is: it stops following the font",
          })
        : null;
    const actions = [
      button("Make", () => this.callbacks.onMake?.(info.glyphName), {
        className: "umarks-button--small",
        disabled: !info.canMake,
        title: "Make this glyph from its rule",
      }),
      button("Update", () => this.callbacks.onRecompute?.([info.glyphName]), {
        className: "umarks-button--small",
        disabled: !info.canRecompute,
        title: "Put the components back where the anchors say",
      }),
      button("Decompose", () => this.callbacks.onDecompose?.(), {
        className: "umarks-button--small",
        disabled: !info.canDecompose,
        title: "Replace the components by their outlines (Fontra's own Decompose)",
      }),
    ];
    return element("div", { class: "umarks-glyph-block" }, [
      element("div", { class: "umarks-glyph-row-line" }, [
        element("span", { class: "umarks-glyph-label", text: "Rule" }),
        element("span", { class: "umarks-rule-wrap" }, [
          this.ruleLine(info.glyphName, rule, info.choices),
          provenanceBadge(rule),
          keep,
        ]),
      ]),
      element("div", { class: "umarks-glyph-row-line" }, [
        element("span", { class: "umarks-glyph-label", text: "State" }),
        element("span", {
          class: `umarks-state umarks-state--${info.stateKind || "pending"}`,
          "data-role": "state",
          text: info.stateLines.join("; "),
        }),
      ]),
      info.note ? element("div", { class: "umarks-note", text: info.note }) : null,
      // an information, not a warning (6d § 2)
      info.shapingNote
        ? element("div", { class: "umarks-note umarks-shaping-note", "data-role": "shaping-note", text: info.shapingNote })
        : null,
      element("div", { class: "umarks-buttons" }, actions),
    ]);
  }

  // --- a base: what it composes

  composesBlock(info) {
    const chips = info.composes.map((entry) => {
      const chip = element(
        "button",
        {
          class: `umarks-chip umarks-chip--${entry.status}${entry.glyph === this.selectedComposable ? " selected" : ""}`,
          title: `${entry.glyph}: ${STATUS_TITLES[entry.status]}`,
          dataset: { composable: entry.glyph, status: entry.status },
          onclick: () => {
            this.selectedComposable = this.selectedComposable === entry.glyph ? null : entry.glyph;
            this.set(this.info);
          },
          ondblclick: () => this.callbacks.onOpen?.(entry.glyph),
        },
        [
          element("span", { class: "umarks-chip-char", text: entry.character }),
          element("span", { class: "umarks-chip-mark", text: STATUS_MARKS[entry.status] }),
        ]
      );
      return chip;
    });
    const selected = info.composes.find((entry) => entry.glyph === this.selectedComposable);
    return element("div", { class: "umarks-glyph-block" }, [
      element("div", { class: "umarks-glyph-row-line" }, [
        element("span", { class: "umarks-glyph-label", text: "Composes" }),
        chips.length
          ? element("span", { class: "umarks-chips", "data-role": "composes" }, chips)
          : element("span", { class: "umarks-note", text: "nothing yet: its anchors and the font's accents say what" }),
      ]),
      chips.length
        ? element("div", { class: "umarks-legend", text: "✓ made · ○ to make · dashed: not in the glyph set" })
        : null,
      selected ? this.composableDetail(selected, info) : null,
      info.anchorComposes?.length ? this.anchorComposesBlock(info) : null,
    ]);
  }

  /**
   * After what Unicode gives: the marks its anchors accept (6a, decision 5),
   * one line per anchor, « possible ». A click writes the rule `base_mark`,
   * manual, into the target, and opens it here to be renamed.
   */
  anchorComposesBlock(info) {
    return element("div", { class: "umarks-anchor-composes", "data-role": "anchor-composes" }, [
      element("div", { class: "umarks-subheading", text: "What its anchors would allow" }),
      ...info.anchorComposes.map((group) =>
        element("div", { class: "umarks-glyph-row-line" }, [
          element("span", { class: "umarks-glyph-label", text: group.anchor }),
          element(
            "span",
            { class: "umarks-chips" },
            group.entries.map((entry) =>
              element(
                "button",
                {
                  class: `umarks-chip umarks-chip--named umarks-chip--${entry.status}`,
                  title: `${entry.glyph} = ${info.glyphName} + ${entry.mark} @ ${group.anchor}: a click writes this rule`,
                  dataset: { anchorMark: entry.mark, anchor: group.anchor, status: entry.status },
                  onclick: () => this.callbacks.onAnchorRule?.(info.glyphName, entry.mark, group.anchor),
                },
                [element("span", { class: "umarks-chip-char", text: entry.mark })]
              )
            )
          ),
        ])
      ),
      element("div", {
        class: "umarks-legend",
        text: "Not Unicode's: a click writes the rule, by hand, into the glyph set",
      }),
    ]);
  }

  composableDetail(entry, info) {
    const choices = info.composableChoices?.[entry.glyph] || { anchors: [], variants: [] };
    // a glyph without a character, not made yet: its name is the designer's
    // (a rule from the anchors, `e_caron.alt`), renamed here
    const renamable = [...entry.character].length > 1 && entry.status !== "made" && !!info.rules?.[entry.glyph];
    let nameControl = element("span", { class: "umarks-glyph-name", text: `${entry.glyph} =` });
    let renameRow = null;
    if (renamable) {
      const input = element("input", {
        type: "text",
        spellcheck: "false",
        class: "umarks-name-input",
        "data-field": "rule-name",
        title: "The name of the glyph this rule makes",
        // what is typed survives the panel's next refresh of this view
        oninput: () => {
          this.nameDraft = { glyph: entry.glyph, value: input.value };
        },
        onkeydown: (event) => {
          if (event.key === "Enter") {
            this.callbacks.onRenameRule?.(entry.glyph, input.value.trim());
          }
        },
      });
      input.value = this.nameDraft?.glyph === entry.glyph ? this.nameDraft.value : entry.glyph;
      nameControl = element("span", { class: "umarks-rule-wrap" }, [input, element("span", { text: "=" })]);
      renameRow = button("Rename", () => this.callbacks.onRenameRule?.(entry.glyph, input.value.trim()), {
        className: "umarks-button--small",
        title: "Give the glyph this rule makes another name",
      });
      if (this.focusName === entry.glyph) {
        this.focusName = null;
        setTimeout(() => {
          input.focus();
          input.select();
        }, 0);
      }
    }
    return element("div", { class: "umarks-composable", "data-role": "composable-detail" }, [
      element("div", { class: "umarks-rule-wrap" }, [
        nameControl,
        entry.rule
          ? this.ruleLine(entry.glyph, entry.rule, choices)
          : element("span", { class: "umarks-note", text: "no rule can be worked out from the font yet" }),
        entry.rule && info.rules?.[entry.glyph] ? provenanceBadge(info.rules[entry.glyph]) : null,
      ]),
      element("div", { class: "umarks-buttons" }, [
        info.hasTarget
          ? button(
              entry.inTarget ? "Take out of the glyph set" : "Add to the glyph set",
              () => this.callbacks.onToggleTarget?.(entry.glyph, !entry.inTarget),
              { className: "umarks-button--small" }
            )
          : null,
        entry.status === "made"
          ? button("Open", () => this.callbacks.onOpen?.(entry.glyph), { className: "umarks-button--small" })
          : null,
        renameRow,
      ]),
    ]);
  }

  /** Open a composable's detail — a rule just written from the anchors —, its name ready to change. */
  openComposable(glyphName, { focusName = false } = {}) {
    this.selectedComposable = glyphName;
    this.focusName = focusName ? glyphName : null;
    this.nameDraft = null;
  }

  // --- an accent: the bases it sits on

  basesBlock(info) {
    return element("div", { class: "umarks-glyph-row-line" }, [
      element("span", { class: "umarks-glyph-label", text: "Sits on" }),
      element("span", { class: "umarks-bases", "data-role": "bases", text: info.bases.join(" · ") }),
    ]);
  }

  /**
   * The glyphs of a base its anchors no longer match, condensed (6d § 1): per
   * cause, the cause once, then « 8 glyphs have moved off their anchors: agrave, … » on one
   * line that cuts cleanly, the detail per glyph behind a ▸; six lines at
   * most, the rest scrolls.
   */
  staleBlock(warning, recompute) {
    const groups = warning.groups.map((group) => {
      const open = this.openCauses.has(group.cause);
      const list = staleListText(group.glyphs);
      const toggle = element("button", {
        class: `umarks-stale-toggle${open ? " open" : ""}`,
        "data-field": "stale-toggle",
        title: open ? "Hide the detail" : "The detail, glyph by glyph",
        text: "▸",
        onclick: () => {
          if (this.openCauses.has(group.cause)) {
            this.openCauses.delete(group.cause);
          } else {
            this.openCauses.add(group.cause);
          }
          this.set(this.info);
        },
      });
      return element("div", { class: "umarks-stale-group", "data-role": "stale-group" }, [
        element("div", { class: "umarks-stale-cause", "data-role": "stale-cause", text: `⚠ ${group.cause}` }),
        element("div", { class: "umarks-stale-line" }, [
          element("span", { class: "umarks-stale-list", "data-role": "stale-list", text: list, title: list }),
          toggle,
        ]),
        open
          ? element(
              "div",
              { class: "umarks-stale-details", "data-role": "stale-details" },
              group.details.map((detail) =>
                element(
                  "div",
                  {
                    class: "umarks-stale-detail",
                    title: "Double-click to open the glyph",
                    ondblclick: () => this.callbacks.onOpen?.(detail.glyph),
                  },
                  [
                    element("span", { class: "umarks-row-name", text: detail.glyph }),
                    element("span", { class: "umarks-row-detail", text: detail.text }),
                  ]
                )
              )
            )
          : null,
      ]);
    });
    return element("div", { class: "umarks-warning umarks-warning--stale", "data-role": "warning" }, [
      element("div", { class: "umarks-warning-body" }, groups),
      recompute,
    ]);
  }

  warningRow(warning) {
    const recompute = warning.names?.length
      ? button(warning.names.length > 1 ? `Update ${warning.names.length}` : "Update", () => this.callbacks.onRecompute?.(warning.names), {
          className: "umarks-button--small",
          title: "Put the components back where the anchors say",
        })
      : null;
    if (warning.groups) {
      return this.staleBlock(warning, recompute);
    }
    if (!warning.choice) {
      return element("div", { class: "umarks-warning", "data-role": "warning" }, [
        element("span", { text: `⚠ ${warning.text}` }),
        recompute,
      ]);
    }
    // a composed glyph off its anchor: the choice, said (5 bis § 6)
    const choice = warning.choice;
    return element("div", { class: "umarks-warning", "data-role": "warning" }, [
      element("span", { text: `⚠ ${warning.text}` }),
      element("div", {
        class: "umarks-note",
        "data-role": "offset-choice",
        text: choice.left ? "Left as it is: ⑥ goes on counting it until it is updated." : choice.text,
      }),
      element("div", { class: "umarks-buttons" }, [
        recompute,
        choice.left
          ? null
          : button("Leave it", () => this.callbacks.onLeave?.(choice.glyph), {
              className: "umarks-button--small",
              title: "Keep the component where it is; ⑥ will go on counting it",
            }),
      ]),
    ]);
  }
}
