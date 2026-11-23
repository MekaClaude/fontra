// Quick Menu settings — choose which action lives in which segment.
//
// The dialog shows the current layout as two rows of slot cells (inner
// ring first, outer ring second) plus a palette of the actions the menu
// ships with. Interaction: click a slot to select it, then click a
// palette entry to place it there. If that action already lives in
// another slot, the two slots swap — a layout can therefore never hold
// the same action twice.
//
// "Réinitialiser" restores the default layout (still editable), and
// "Enregistrer" persists the layout to localStorage, where
// quick-menu.js picks it up the next time the menu opens.

import {
  getActionTitle,
  getShortCutRepresentationFromActionIdentifier,
} from "@fontra/core/actions.js";
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { InlineSVG } from "@fontra/web-components/inline-svg.js";
import { dialogSetup } from "@fontra/web-components/modal-dialog.js";
import { RadialMenu } from "@fontra/web-components/radial-menu.js";
import {
  getDefaultQuickMenuSlots,
  getQuickMenuSlots,
  quickMenuPalette,
  saveQuickMenuSlots,
} from "./quick-menu.js";

const RINGS = [
  { ringName: "inner", titleKey: "quickmenu.ring-inner" },
  { ringName: "outer", titleKey: "quickmenu.ring-outer" },
];

// The dialog styles its own content: modal-dialog injects its static
// styles at the top of its shadow root, so these rules (appended
// later, same specificity) override where they need to.
const SETTINGS_CSS = `
  dialog .quickmenu-settings {
    display: grid;
    gap: 0.75em;
    text-align: left;
    overflow: auto;
    max-height: 55vh;
    padding-right: 0.25em;
  }

  .quickmenu-settings .qm-hint {
    margin: 0;
    font-size: 0.9em;
    opacity: 0.85;
  }

  .quickmenu-settings .qm-ring {
    display: grid;
    gap: 0.4em;
  }

  .quickmenu-settings .qm-ring-title {
    font-size: 0.8em;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    opacity: 0.7;
  }

  .quickmenu-settings .qm-slots {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4em;
  }

  .quickmenu-settings .qm-cell {
    display: inline-flex;
    align-items: center;
    gap: 0.45em;
    padding: 0.35em 0.6em;
    border: 1px solid var(--border-color, #8888);
    border-radius: 0.4em;
    background-color: var(--text-input-background-color, transparent);
    color: inherit;
    font-family: fontra-ui-regular, sans-serif;
    font-size: 0.85em;
    cursor: pointer;
  }

  .quickmenu-settings .qm-cell:hover {
    filter: brightness(1.15);
  }

  .quickmenu-settings .qm-cell.selected {
    outline: 2px solid var(--fontra-red-color, #e22);
    outline-offset: 1px;
  }

  .quickmenu-settings .qm-palette {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4em;
    padding-top: 0.75em;
    border-top: 1px solid var(--border-color, #8888);
  }

  .quickmenu-settings .qm-cell inline-svg {
    display: inline-flex;
    width: 1.15em;
    height: 1.15em;
  }

  .quickmenu-settings .qm-cell inline-svg svg {
    width: 100%;
    height: 100%;
    fill: currentColor;
  }

  .quickmenu-settings .qm-reset {
    justify-self: start;
    padding: 0.3em 1em;
    border: 1px solid var(--border-color, #8888);
    border-radius: 1em;
    background-color: transparent;
    color: inherit;
    font-family: fontra-ui-regular, sans-serif;
    font-size: 0.85em;
    cursor: pointer;
  }
`;

export async function openQuickMenuSettings() {
  if (document.querySelector("modal-dialog")?.isActive()) {
    // Another dialog is already open (double shortcut press, or the
    // action invoked while e.g. the glyph search is up): showModal()
    // on an open dialog would throw, so leave the current dialog alone.
    return;
  }

  // An open menu would keep showing the old layout: close it.
  RadialMenu.openMenu?.dismiss();

  const slots = getQuickMenuSlots();
  const temp = { inner: [...slots.inner], outer: [...slots.outer] };
  let selected = null; // { ringName, index }

  const paletteById = new Map(
    quickMenuPalette.map((slot) => [slot.actionIdentifier, slot])
  );

  const theDialog = await dialogSetup(translate("quickmenu.settings-title"), null, [
    { title: translate("dialog.cancel"), isCancelButton: true },
    {
      title: translate("dialog.save"),
      isDefaultButton: true,
      resultValue: true,
    },
  ]);

  const ringTitles = {};
  const slotButtons = { inner: [], outer: [] };
  const slotContainers = {};

  const titleFor = (actionIdentifier) => getActionTitle(actionIdentifier);

  const tooltipFor = (actionIdentifier) => {
    const title = getActionTitle(actionIdentifier);
    const shortcut = getShortCutRepresentationFromActionIdentifier(actionIdentifier);
    return shortcut ? `${title}  (${shortcut})` : title;
  };

  // Enter on a content button must activate that button, not the
  // dialog's default button: keep the keydown from reaching the
  // dialog's own handler (it would otherwise save and close).
  const stopEnter = (event) => {
    if (event.key === "Enter") {
      event.stopPropagation();
    }
  };

  const setSelected = (next) => {
    if (selected) {
      const old = slotButtons[selected.ringName][selected.index];
      old.classList.remove("selected");
      old.setAttribute("aria-pressed", "false");
    }
    selected = next;
    if (selected) {
      const cell = slotButtons[selected.ringName][selected.index];
      cell.classList.add("selected");
      cell.setAttribute("aria-pressed", "true");
    }
  };

  const buildSlotCell = (ringName, index) => {
    const actionIdentifier = temp[ringName][index];
    const base = paletteById.get(actionIdentifier);
    const isSelected = selected?.ringName === ringName && selected?.index === index;
    const cell = html.button(
      {
        class: `qm-cell qm-slot${isSelected ? " selected" : ""}`,
        title: tooltipFor(actionIdentifier),
        onclick: () => {
          if (selected?.ringName === ringName && selected?.index === index) {
            setSelected(null);
          } else {
            setSelected({ ringName, index });
          }
        },
        onkeydown: stopEnter,
      },
      [
        html.span({ class: "qm-icon" }, [new InlineSVG(base.icon)]),
        html.span({ class: "qm-label" }, [titleFor(actionIdentifier)]),
      ]
    );
    cell.setAttribute(
      "aria-label",
      `${ringTitles[ringName]} ${index + 1}: ${titleFor(actionIdentifier)}`
    );
    cell.setAttribute("aria-pressed", String(isSelected));
    return cell;
  };

  const refreshSlot = (ringName, index) => {
    const fresh = buildSlotCell(ringName, index);
    slotButtons[ringName][index].replaceWith(fresh);
    slotButtons[ringName][index] = fresh;
  };

  const refreshAllSlots = () => {
    for (const { ringName } of RINGS) {
      for (let index = 0; index < temp[ringName].length; index++) {
        refreshSlot(ringName, index);
      }
    }
  };

  const findSlot = (actionIdentifier) => {
    for (const { ringName } of RINGS) {
      const index = temp[ringName].indexOf(actionIdentifier);
      if (index !== -1) {
        return { ringName, index };
      }
    }
    return null;
  };

  const assign = (actionIdentifier) => {
    if (!selected) {
      return; // no slot selected yet: ignore the palette click
    }
    const target = selected;
    const elsewhere = findSlot(actionIdentifier);
    const displaced = temp[target.ringName][target.index];
    temp[target.ringName][target.index] = actionIdentifier;
    const swapped =
      elsewhere &&
      !(elsewhere.ringName === target.ringName && elsewhere.index === target.index);
    if (swapped) {
      // The action already lives in another slot: swap the two, so the
      // layout can never hold the same action twice.
      temp[elsewhere.ringName][elsewhere.index] = displaced;
    }
    setSelected(null);
    refreshSlot(target.ringName, target.index);
    if (swapped) {
      refreshSlot(elsewhere.ringName, elsewhere.index);
    }
  };

  const buildPaletteButton = (entry) => {
    const actionIdentifier = entry.actionIdentifier;
    const button = html.button(
      {
        class: "qm-cell qm-action",
        title: tooltipFor(actionIdentifier),
        onclick: () => assign(actionIdentifier),
        onkeydown: stopEnter,
      },
      [
        html.span({ class: "qm-icon" }, [new InlineSVG(entry.icon)]),
        html.span({ class: "qm-label" }, [titleFor(actionIdentifier)]),
      ]
    );
    button.setAttribute("aria-label", titleFor(actionIdentifier));
    return button;
  };

  for (const { ringName, titleKey } of RINGS) {
    ringTitles[ringName] = translate(titleKey);
    const container = html.div({ class: "qm-slots" });
    slotContainers[ringName] = container;
    for (let index = 0; index < temp[ringName].length; index++) {
      const cell = buildSlotCell(ringName, index);
      slotButtons[ringName].push(cell);
      container.appendChild(cell);
    }
  }

  const resetButton = html.button(
    {
      class: "qm-reset",
      onclick: () => {
        const defaults = getDefaultQuickMenuSlots();
        temp.inner = [...defaults.inner];
        temp.outer = [...defaults.outer];
        setSelected(null);
        refreshAllSlots();
      },
      onkeydown: stopEnter,
    },
    [translate("quickmenu.settings-reset")]
  );

  const content = html.div({ class: "quickmenu-settings" }, [
    html.style({}, [SETTINGS_CSS]),
    html.div({ class: "qm-hint" }, [translate("quickmenu.settings-message")]),
    ...RINGS.map(({ ringName, titleKey }) =>
      html.div({ class: "qm-ring" }, [
        html.div({ class: "qm-ring-title" }, [translate(titleKey)]),
        slotContainers[ringName],
      ])
    ),
    html.div({ class: "qm-ring-title" }, [translate("quickmenu.settings-palette")]),
    html.div({ class: "qm-palette" }, quickMenuPalette.map(buildPaletteButton)),
    resetButton,
  ]);

  theDialog.setContent(content);

  const save = await theDialog.run();
  if (save) {
    saveQuickMenuSlots(temp);
  }
}
