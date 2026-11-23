// Quick Menu (radial menu) — MVP implementation.
//
// A circular, pointer-local command menu, in the spirit of the Affinity
// Quick Menu / Blender pie menus / Krita popup palette. Two rings:
//
//   - Inner ring: everyday essentials (cut / copy / paste / delete / select all)
//   - Outer ring: frequently used glyph-editing commands, dimmed when the
//     action registry says they are not available in the current context.
//
// Every slot maps to an action identifier, so titles, shortcuts and
// enabled state always reflect the real state of the editor.
//
// The slot layout itself is customizable: which action sits in which
// segment is persisted in localStorage (see the "Personalization"
// section below), and the settings editor picks from a closed palette
// of actions that each ship their own phosphor icon and i18n key.

import { canPerformAction, registerAction } from "@fontra/core/actions.js";
import { translate } from "@fontra/core/localization.js";
import { RadialMenu, showRadialMenu } from "@fontra/web-components/radial-menu.js";
import { openQuickMenuSettings } from "./quick-menu-settings.js";

export const quickMenuInnerSlots = [
  { actionIdentifier: "action.cut", icon: "/phosphor-icons/scissors.svg" },
  { actionIdentifier: "action.copy", icon: "/phosphor-icons/copy.svg" },
  { actionIdentifier: "action.paste", icon: "/phosphor-icons/clipboard-text.svg" },
  { actionIdentifier: "action.delete", icon: "/phosphor-icons/trash.svg" },
  { actionIdentifier: "action.select-all", icon: "/phosphor-icons/selection-all.svg" },
];

// shortTitle holds an i18n key: it is translated in buildQuickMenuModel(),
// when the language strings are loaded, not at module import time.
export const quickMenuOuterSlots = [
  {
    actionIdentifier: "action.join-contours",
    icon: "/phosphor-icons/arrows-merge.svg",
    shortTitle: "quickmenu.join",
  },
  {
    actionIdentifier: "action.break-contour",
    icon: "/phosphor-icons/arrows-split.svg",
    shortTitle: "quickmenu.break",
  },
  {
    actionIdentifier: "action.reverse-contour",
    icon: "/phosphor-icons/arrows-counter-clockwise.svg",
    shortTitle: "quickmenu.reverse",
  },
  {
    actionIdentifier: "action.set-contour-start",
    icon: "/phosphor-icons/crosshair.svg",
    shortTitle: "quickmenu.start",
  },
  {
    actionIdentifier: "action.decompose-component",
    icon: "/phosphor-icons/stack.svg",
    shortTitle: "quickmenu.decompose",
  },
  {
    actionIdentifier: "action.add-component",
    icon: "/phosphor-icons/puzzle-piece.svg",
    shortTitle: "quickmenu.component",
  },
  {
    actionIdentifier: "action.add-anchor",
    icon: "/phosphor-icons/anchor.svg",
    shortTitle: "quickmenu.anchor",
  },
  {
    actionIdentifier: "action.zoom-fit-selection",
    icon: "/phosphor-icons/arrows-out.svg",
    shortTitle: "quickmenu.zoom",
  },
];

// --- Personalization ---------------------------------------------------
//
// Which action sits in which segment is user data, persisted in
// localStorage under `fontra-quickmenu-slots` as
// `{ inner: [actionIdentifier × 5], outer: [actionIdentifier × 8] }`.
//
// The palette is a closed set: every entry carries its phosphor icon
// and i18n key right here, so a persisted layout can only ever
// reference labels and icons we actually ship. A stored layout that
// fails validation (corrupted, unknown action, wrong ring sizes,
// duplicate action) is ignored and the defaults are used instead —
// loading never throws and never overwrites what the user stored.

const SLOTS_STORAGE_KEY = "fontra-quickmenu-slots";

export const quickMenuPalette = [...quickMenuInnerSlots, ...quickMenuOuterSlots];

const paletteById = new Map(
  quickMenuPalette.map((slot) => [slot.actionIdentifier, slot])
);

export function getDefaultQuickMenuSlots() {
  return {
    inner: quickMenuInnerSlots.map((slot) => slot.actionIdentifier),
    outer: quickMenuOuterSlots.map((slot) => slot.actionIdentifier),
  };
}

export function isValidQuickMenuSlots(slots) {
  const defaults = getDefaultQuickMenuSlots();
  if (!slots || typeof slots !== "object") {
    return false;
  }
  for (const ringName of ["inner", "outer"]) {
    const ring = slots[ringName];
    if (!Array.isArray(ring) || ring.length !== defaults[ringName].length) {
      return false;
    }
    if (!ring.every((actionIdentifier) => paletteById.has(actionIdentifier))) {
      return false;
    }
  }
  // Each action may appear only once across the whole menu.
  const all = [...slots.inner, ...slots.outer];
  return new Set(all).size === all.length;
}

export function loadQuickMenuSlots() {
  let raw;
  try {
    raw = localStorage.getItem(SLOTS_STORAGE_KEY);
  } catch {
    return null; // storage unavailable (private mode, blocked cookies)
  }
  if (!raw) {
    return null;
  }
  try {
    const slots = JSON.parse(raw);
    return isValidQuickMenuSlots(slots) ? slots : null;
  } catch {
    return null;
  }
}

export function saveQuickMenuSlots(slots) {
  if (!isValidQuickMenuSlots(slots)) {
    return false;
  }
  try {
    localStorage.setItem(
      SLOTS_STORAGE_KEY,
      JSON.stringify({
        inner: [...slots.inner],
        outer: [...slots.outer],
      })
    );
    return true;
  } catch {
    return false;
  }
}

export function resetQuickMenuSlots() {
  try {
    localStorage.removeItem(SLOTS_STORAGE_KEY);
  } catch {
    // nothing to clean up if storage is unavailable
  }
}

// The layout the menu actually runs with: the user's saved slots if
// they are valid, otherwise the default layout above.
export function getQuickMenuSlots() {
  return loadQuickMenuSlots() ?? getDefaultQuickMenuSlots();
}

export function buildQuickMenuModel() {
  const slots = getQuickMenuSlots();
  const withState = (actionIdentifier) => {
    const base = paletteById.get(actionIdentifier);
    return {
      actionIdentifier,
      icon: base.icon,
      shortTitle: base.shortTitle ? translate(base.shortTitle) : undefined,
      enabled: canPerformAction(actionIdentifier),
    };
  };
  return {
    inner: slots.inner.map(withState),
    outer: slots.outer.map(withState),
  };
}

let lastPointerPosition = null;

// Track the real pointer position anywhere in the window, so the menu opens
// under the pointer even when it is not over the canvas.
window.addEventListener(
  "pointermove",
  (event) => {
    lastPointerPosition = { x: event.clientX, y: event.clientY };
  },
  { passive: true }
);

export function toggleQuickMenu(position, centerLabel = "Q") {
  if (RadialMenu.openMenu) {
    RadialMenu.openMenu.dismiss();
    return;
  }
  showRadialMenu(buildQuickMenuModel(), position, {
    centerLabel,
    centerHint: translate("quickmenu.esc"),
    ariaLabel: translate("action.toggle-quickmenu"),
  });
}

export function registerQuickMenuAction(editorController) {
  registerAction(
    "action.toggle-quickmenu",
    {
      topic: "0020-action-topics.menu.view",
      titleKey: "action.toggle-quickmenu",
      defaultShortCuts: [{ baseKey: "q" }],
      // The editor dismisses menus and other transient UI on Escape,
      // but we never want typing a bare "q" in a text field to toggle the menu.
    },
    () => {
      const editorPosition = editorController.currentPointerPosition;
      const position =
        lastPointerPosition ??
        (editorPosition && (editorPosition.x || editorPosition.y)
          ? editorPosition
          : {
              x: window.innerWidth / 2,
              y: window.innerHeight / 2,
            });
      toggleQuickMenu(position, "Q");
    }
  );

  registerAction(
    "action.quickmenu-settings",
    {
      topic: "0020-action-topics.menu.view",
      titleKey: "action.quickmenu-settings",
      // No default shortcut: the settings dialog is one command-palette
      // search away, and users can assign a shortcut if they want one.
    },
    () => {
      openQuickMenuSettings();
    }
  );
}
