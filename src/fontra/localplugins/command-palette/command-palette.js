// Command Palette overlay: a searchable launcher for every action the editor
// has registered. Built entirely with createElement + textContent (no
// innerHTML), isolated in a shadow root so it needs no CSS from the page.
//
// Plugins are loaded with a native dynamic import, so `@fontra/...`
// specifiers cannot be resolved here. Everything comes from the
// `editor.actionExecutor` object the editor exposes to plugins.

import { rankEntries } from "./palette-filter.js";

const MAX_RESULTS = 40;

const cssText = `
  :host {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: none;
    background: rgba(0, 0, 0, 0.2);
  }
  :host(.open) {
    display: block;
  }
  .palette {
    display: flex;
    flex-direction: column;
    width: min(560px, 92vw);
    margin: 10vh auto 0;
    border-radius: 10px;
    background-color: var(--background-color, #fff);
    color: var(--foreground-color, #000);
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.15));
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }
  .palette-input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.65em 0.9em;
    font-size: 15px;
    font-family: inherit;
    background-color: transparent;
    color: var(--foreground-color, #000);
    border: none;
    outline: none;
  }
  .palette-input::placeholder {
    color: var(--foreground-color, #000);
    opacity: 0.4;
  }
  .palette-list {
    max-height: 45vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.3em 0;
    border-top: 1px solid var(--border-color, rgba(0, 0, 0, 0.15));
    border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.15));
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.7em;
    padding: 0.42em 0.9em;
    cursor: pointer;
    user-select: none;
  }
  .item .title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item .topic {
    max-width: 28%;
    font-size: 11px;
    opacity: 0.55;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item .kbd {
    font-size: 11px;
    opacity: 0.7;
    white-space: nowrap;
    font-family: var(--mono-font, ui-monospace, monospace);
  }
  .item.selected {
    background-color: color-mix(
      in srgb,
      var(--editor-tool-button-selected-background-color, #888888) 25%,
      transparent
    );
  }
  .item.disabled {
    cursor: default;
  }
  .item.disabled .title,
  .item.disabled .topic,
  .item.disabled .kbd {
    opacity: 0.35;
  }
  .empty {
    padding: 0.9em;
    text-align: center;
    opacity: 0.5;
    font-size: 13px;
  }
  .palette-footer {
    display: flex;
    gap: 1.4em;
    padding: 0.4em 0.9em;
    font-size: 11px;
    opacity: 0.6;
  }
  .palette-footer kbd {
    font-family: var(--mono-font, ui-monospace, monospace);
  }
`;

// Topic keys are translated by the core localization table, which plugins
// cannot import; these are the display labels for the topics that exist.
// Topics are registered with a numeric sort prefix ("0030-action-topics...."),
// which normalizeTopic() strips before lookup.
const TOPIC_LABELS = {
  "action-topics.tools": "Tools",
  "action-topics.menu.view": "View",
  "action-topics.menu.edit": "Edit",
  "action-topics.menu.glyph": "Glyph",
  "action-topics.sidebars": "Sidebars",
  "action-topics.designspace-navigation": "Designspace",
  "action-topics.glyph-editor-appearance": "Appearance",
  "action-topics.selection-transformations": "Selection",
  "action-topics.reference-font": "Reference font",
  "action-topics.export-as": "Export",
};

// Mirrors the numeric ordering the core gives each topic.
const TOPIC_ORDER = {
  "action-topics.tools": 10,
  "action-topics.menu.view": 20,
  "action-topics.menu.edit": 30,
  "action-topics.menu.glyph": 35,
  "action-topics.export-as": 35,
  "action-topics.sidebars": 40,
  "action-topics.designspace-navigation": 50,
  "action-topics.glyph-editor-appearance": 60,
  "action-topics.selection-transformations": 70,
  "action-topics.reference-font": 200,
};

function normalizeTopic(topic) {
  return (topic || "").replace(/^\d{4}-/, "");
}

export class CommandPalette {
  constructor(editor) {
    this.editor = editor;
    this.actions = editor.actionExecutor || null;
    this._open = false;
    this._lastQuery = "";
    this._entries = [];
    this._results = [];
    this._selectedIndex = 0;
    this._rowByIdentifier = new Map();
    this._buildDom();
  }

  toggle() {
    if (this._open) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    if (this._open) {
      return;
    }
    if (!this.actions) {
      console.warn(
        "[Command Palette] editor.actionExecutor is not available; " +
          "the plugin needs a Fontra version that exposes it."
      );
      return;
    }
    this._entries = this._buildEntries();
    this._open = true;
    this._host.classList.add("open");
    this._input.value = this._lastQuery;
    this._refilter();
    this._input.focus();
  }

  close() {
    if (!this._open) {
      return;
    }
    this._open = false;
    this._host.classList.remove("open");
    this._input.blur();
    const canvas = this.editor?.canvasController?.canvas;
    if (canvas) {
      canvas.focus();
    }
  }

  // ------------------------------------------------------------------
  // Entries

  _buildEntries() {
    const {
      getActionIdentifiers,
      getActionTitle,
      getActionInfo,
      getShortCutRepresentationFromActionIdentifier,
      canPerformAction,
    } = this.actions;

    const entries = [];
    for (const identifier of getActionIdentifiers()) {
      if (identifier === "action.command-palette") {
        continue;
      }
      const info = getActionInfo(identifier) || {};
      let title = getActionTitle(identifier);
      if (!title || title === identifier) {
        title = prettifyIdentifier(identifier);
      }
      entries.push({
        identifier,
        title,
        topic: info.topic || "",
        topicDisplay:
          TOPIC_LABELS[normalizeTopic(info.topic)] ||
          prettifyIdentifier(normalizeTopic(info.topic)),
        shortcut: getShortCutRepresentationFromActionIdentifier(identifier),
        enabled: canPerformAction(identifier),
      });
    }

    const topicRank = (topic) => TOPIC_ORDER[normalizeTopic(topic)] ?? 1000;
    entries.sort(
      (a, b) =>
        topicRank(a.topic) - topicRank(b.topic) ||
        compareStrings(a.title, b.title) ||
        compareStrings(a.identifier, b.identifier)
    );
    return entries;
  }

  // ------------------------------------------------------------------
  // Rendering

  _buildDom() {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = cssText;
    shadow.appendChild(style);

    const palette = document.createElement("div");
    palette.className = "palette";

    this._input = document.createElement("input");
    this._input.className = "palette-input";
    this._input.type = "text";
    this._input.placeholder = "Type a command…";
    this._input.setAttribute("aria-label", "Search commands");
    palette.appendChild(this._input);

    this._list = document.createElement("div");
    this._list.className = "palette-list";
    this._list.setAttribute("role", "listbox");
    palette.appendChild(this._list);

    const footer = document.createElement("div");
    footer.className = "palette-footer";
    for (const [key, label] of [
      ["↑↓", "navigate"],
      ["↵", "run"],
      ["esc", "close"],
    ]) {
      const item = document.createElement("span");
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      item.appendChild(kbd);
      item.appendChild(document.createTextNode(` ${label}`));
      footer.appendChild(item);
    }
    palette.appendChild(footer);

    shadow.appendChild(palette);

    host.addEventListener("pointerdown", (event) => {
      if (event.target === host) {
        this.close();
      }
    });
    // While the palette is open, no key event inside it should reach the
    // editor's global (window-level) key handler.
    host.addEventListener("keydown", (event) => event.stopPropagation());
    host.addEventListener("keyup", (event) => event.stopPropagation());

    this._input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          this._moveSelection(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          this._moveSelection(-1);
          break;
        case "Enter":
          event.preventDefault();
          this._runSelected();
          break;
        case "Escape":
          event.preventDefault();
          this.close();
          break;
        default:
          if (
            event.shiftKey &&
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "p"
          ) {
            // Re-pressing the open shortcut closes the palette again.
            event.preventDefault();
            this.close();
          }
          break;
      }
    });
    this._input.addEventListener("input", () => {
      this._lastQuery = this._input.value;
      this._refilter();
    });

    this._emptyRow = document.createElement("div");
    this._emptyRow.className = "empty";
    this._emptyRow.textContent = "No matching commands";

    document.body.appendChild(host);
    this._host = host;
  }

  _makeRow() {
    const row = document.createElement("div");
    row.className = "item";
    row.setAttribute("role", "option");

    const title = document.createElement("span");
    title.className = "title";
    const topic = document.createElement("span");
    topic.className = "topic";
    const kbd = document.createElement("span");
    kbd.className = "kbd";
    row.append(title, topic, kbd);

    row.addEventListener("mousedown", (event) => event.preventDefault());
    row.addEventListener("pointermove", () => {
      const index = this._results.indexOf(row._entry);
      if (index >= 0) {
        this._setSelected(index);
      }
    });
    row.addEventListener("click", () => {
      if (row._entry) {
        this._run(row._entry);
      }
    });

    return row;
  }

  _updateRow(row, entry) {
    row._entry = entry;
    const [title, topic, kbd] = row.children;
    title.textContent = entry.title;
    topic.textContent = entry.topicDisplay;
    kbd.textContent = entry.shortcut;
    row.classList.toggle("disabled", !entry.enabled);
    row.setAttribute("aria-selected", "false");
  }

  _refilter() {
    const results = rankEntries(this._input.value, this._entries).slice(
      0,
      MAX_RESULTS
    );

    // Reuse row elements keyed by action identifier: append in result order
    // (moving existing rows) and drop the ones that fell out of the list.
    const seen = new Set();
    for (const entry of results) {
      seen.add(entry.identifier);
      let row = this._rowByIdentifier.get(entry.identifier);
      if (!row) {
        row = this._makeRow();
        this._rowByIdentifier.set(entry.identifier, row);
      }
      if (row._entry !== entry) {
        this._updateRow(row, entry);
      }
      this._list.appendChild(row);
    }
    for (const [identifier, row] of this._rowByIdentifier) {
      if (!seen.has(identifier) && row.parentNode === this._list) {
        this._list.removeChild(row);
      }
    }

    const hadEmpty = !!this._emptyRow.parentNode;
    if (!results.length && !hadEmpty) {
      this._list.appendChild(this._emptyRow);
    } else if (results.length && hadEmpty) {
      this._list.removeChild(this._emptyRow);
    }

    const previousSelected = this._results[this._selectedIndex];
    this._results = results;
    const previousIndex = results.findIndex(
      (entry) => entry === previousSelected
    );
    this._setSelected(previousIndex >= 0 ? previousIndex : 0, false);
  }

  _setSelected(index, scroll = true) {
    if (!this._results.length) {
      this._selectedIndex = 0;
      return;
    }
    index = Math.max(0, Math.min(index, this._results.length - 1));
    const previousRow = this._rowByIdentifier.get(
      this._results[this._selectedIndex]?.identifier
    );
    if (previousRow) {
      previousRow.classList.remove("selected");
      previousRow.setAttribute("aria-selected", "false");
    }
    this._selectedIndex = index;
    const row = this._rowByIdentifier.get(
      this._results[index]?.identifier
    );
    if (row) {
      row.classList.add("selected");
      row.setAttribute("aria-selected", "true");
      if (scroll) {
        row.scrollIntoView({ block: "nearest" });
      }
    }
  }

  _moveSelection(step) {
    if (!this._results.length) {
      return;
    }
    let index = this._selectedIndex;
    for (let count = 0; count < this._results.length; count++) {
      index += step;
      if (index < 0 || index >= this._results.length) {
        return;
      }
      if (this._results[index].enabled) {
        break;
      }
    }
    this._setSelected(index);
  }

  _runSelected() {
    const entry = this._results[this._selectedIndex];
    if (entry) {
      this._run(entry);
    }
  }

  _run(entry) {
    this.close();
    if (!entry.enabled) {
      return;
    }
    // A synthetic event, so callbacks that expect one (and may call
    // preventDefault on it) get a real event object.
    this.actions.doPerformAction(entry.identifier, makeSyntheticEvent());
  }
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A minimal stand-in for MouseEvent so the palette also works (and tests)
 * in non-DOM runtimes.
 */
function makeSyntheticEvent() {
  if (typeof MouseEvent === "function") {
    return new MouseEvent("click");
  }
  return {
    type: "click",
    preventDefault() {},
    stopPropagation() {},
  };
}

/**
 * "action.zoom-fit-selection" -> "Zoom fit selection"; used when an action
 * has no human-readable title registered.
 */
export function prettifyIdentifier(identifier) {
  if (!identifier) {
    return "";
  }
  return identifier
    .replace(/^action(-topics)?\./, "")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}
