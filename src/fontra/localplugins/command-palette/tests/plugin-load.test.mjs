// tests/plugin-load.test.mjs
//
// The palette must load and register in a plain browser page with no build
// step and no Fontra imports. These tests check that in plain Node with a
// small DOM stub, plus the open/filter/run flow against a fake action
// executor.

import { test } from "node:test";
import assert from "node:assert/strict";

/** A DOM stub just big enough to construct and drive the palette. */
function installDomStub() {
  class FakeClassList {
    constructor() {
      this._set = new Set();
    }
    add(...names) {
      for (const name of names) this._set.add(name);
    }
    remove(...names) {
      for (const name of names) this._set.delete(name);
    }
    toggle(name, force) {
      if (force === undefined) {
        this._set.has(name) ? this._set.delete(name) : this._set.add(name);
      } else if (force) {
        this._set.add(name);
      } else {
        this._set.delete(name);
      }
    }
    contains(name) {
      return this._set.has(name);
    }
  }

  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.parentNode = null;
      this.dataset = {};
      this.style = {};
      this.classList = new FakeClassList();
      this.shadowRoot = null;
      this.value = "";
      this._textContent = "";
      this.focused = false;
    }
    attachShadow() {
      this.shadowRoot = new FakeElement("shadow-root");
      return this.shadowRoot;
    }
    append(...nodes) {
      for (const node of nodes) this.appendChild(node);
    }
    get className() {
      return [...this.classList._set].join(" ");
    }
    set className(value) {
      this.classList._set = new Set(
        (value || "").split(/\s+/).filter(Boolean)
      );
    }
    appendChild(node) {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
      node.parentNode = this;
      this.children.push(node);
      return node;
    }
    removeChild(node) {
      const index = this.children.indexOf(node);
      if (index >= 0) {
        this.children.splice(index, 1);
        node.parentNode = null;
      }
      return node;
    }
    setAttribute(name, value) {
      this._attributes = this._attributes || {};
      this._attributes[name] = value;
    }
    getAttribute(name) {
      return this._attributes?.[name] ?? null;
    }
    addEventListener() {}
    removeEventListener() {}
    scrollIntoView() {}
    focus() {
      this.focused = true;
    }
    blur() {
      this.focused = false;
    }
    set textContent(value) {
      this._textContent = value;
    }
    get textContent() {
      return this._textContent;
    }
  }

  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (text) => ({ text }),
    body: new FakeElement("body"),
  };
  globalThis.customElements = {
    registry: new Map(),
    get(name) {
      return this.registry.get(name);
    },
    define(name, constructor) {
      this.registry.set(name, constructor);
    },
  };
}

function makeFakeActionExecutor() {
  const actions = {
    "action.zoom-fit": { title: "Zoom Fit Selection", topic: "action-topics.menu.view" },
    "action.undo": { title: "Undo", topic: "action-topics.menu.edit" },
    "action.no-callback": { title: "Broken Action", topic: "action-topics.menu.view" },
  };
  const performed = [];
  const registered = [];
  return {
    performed,
    registered,
    getActionIdentifiers: () => Object.keys(actions),
    getActionInfo: (id) => actions[id],
    getActionTitle: (id) => actions[id]?.title || id,
    getShortCutRepresentationFromActionIdentifier: (id) =>
      id === "action.zoom-fit" ? "Ctrl+Shift+Z" : "",
    canPerformAction: (id) => id !== "action.no-callback",
    doPerformAction: (id, event) => performed.push({ id, event }),
    registerAction: (...args) => registered.push(args),
  };
}

function makeFakeEditor() {
  return {
    actionExecutor: makeFakeActionExecutor(),
    canvasController: {
      canvas: { focused: false, focus() { this.focused = true; } },
    },
  };
}

installDomStub();

const { registerPlugin } = await import("../start.js");
const { CommandPalette, prettifyIdentifier } = await import("../command-palette.js");

test("registerPlugin wires the palette and registers its action", () => {
  const editor = makeFakeEditor();
  const palette = registerPlugin(editor, "/localplugins/command-palette/");
  assert.ok(palette instanceof CommandPalette);
  assert.equal(editor.__commandPalette, palette);

  assert.equal(editor.actionExecutor.registered.length, 1);
  const [identifier, actionInfo, callback, enabled, title] =
    editor.actionExecutor.registered[0];
  assert.equal(identifier, "action.command-palette");
  assert.deepEqual(actionInfo.defaultShortCuts, [
    { baseKey: "p", commandKey: true, shiftKey: true },
  ]);
  assert.equal(actionInfo.allowGlobalOverride, true);
  assert.equal(typeof callback, "function");
  assert.equal(enabled, null);
  assert.equal(title(), "Command Palette");
});

test("registerPlugin is idempotent", () => {
  const editor = makeFakeEditor();
  const first = registerPlugin(editor, "/localplugins/command-palette/");
  const second = registerPlugin(editor, "/localplugins/command-palette/");
  assert.equal(first, second);
  assert.equal(editor.actionExecutor.registered.length, 1);
});

test("the palette DOM is built in a shadow root with an input and a list", () => {
  const palette = new CommandPalette(makeFakeEditor());
  const shadow = palette._host.shadowRoot;
  assert.ok(shadow);
  assert.ok(shadow.children.some((child) => child.tagName === "style"));
  // The host must be attached to the document, or the overlay never shows.
  assert.ok(globalThis.document.body.children.includes(palette._host));
  const paletteBox = shadow.children.find(
    (child) => child.classList && child.classList.contains("palette")
  );
  assert.ok(paletteBox, "the palette box exists");
  assert.equal(paletteBox.children[0].tagName, "input");
  assert.equal(paletteBox.children[1].tagName, "div");
  assert.equal(paletteBox.children[1].classList.contains("palette-list"), true);
});

test("open() populates the list with every registered action", async () => {
  const palette = new CommandPalette(makeFakeEditor());
  palette.open();
  assert.equal(palette._open, true);
  assert.equal(palette._entries.length, 3);
});

test("open(), filter and run through the fake executor", async () => {
  const editor = makeFakeEditor();
  const palette = new CommandPalette(editor);
  palette.open();

  // Three registered actions, minus the palette's own (not registered on the
  // fake executor) -> 3 entries.
  assert.equal(palette._entries.length, 3);
  assert.equal(palette._results.length, 3);

  palette._input.value = "undo";
  palette._refilter();
  assert.equal(palette._results.length, 1);
  assert.equal(palette._results[0].identifier, "action.undo");

  palette._runSelected();
  assert.equal(palette._open, false);
  assert.equal(editor.actionExecutor.performed.length, 1);
  assert.equal(editor.actionExecutor.performed[0].id, "action.undo");
  assert.equal(editor.canvasController.canvas.focused, true);
});

test("disabled actions are shown but not run", () => {
  const editor = makeFakeEditor();
  const palette = new CommandPalette(editor);
  palette.open();
  palette._input.value = "broken";
  palette._refilter();
  assert.equal(palette._results.length, 1);
  assert.equal(palette._results[0].enabled, false);
  const performedBefore = editor.actionExecutor.performed.length;
  palette._runSelected();
  assert.equal(editor.actionExecutor.performed.length, performedBefore);
});

test("prettifyIdentifier humanizes raw action identifiers", () => {
  assert.equal(prettifyIdentifier("action.zoom-fit-selection"), "Zoom fit selection");
  assert.equal(prettifyIdentifier("action-topics.menu.view"), "Menu view");
  assert.equal(prettifyIdentifier(""), "");
});
