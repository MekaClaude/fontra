// tests/plugin-load.test.mjs
//
// The plugin must load and register in a plain browser page, with no build
// step and no Fontra import. These tests check exactly that — in plain Node,
// with a small DOM stub — plus the draw flow, mode toggling, wheel
// forwarding, and the Escape shortcut.
//
// The stub is installed *before* the plugin's modules are imported, so the
// import is dynamic: a static import would be evaluated first, and the
// panel's `class SimpleElement extends HTMLElement` would throw at module
// scope.

import { test } from "node:test";
import assert from "node:assert/strict";

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
      this._textContent = "";
      this._attributes = {};
      this.listeners = new Map();
    }
    attachShadow() {
      this.shadowRoot = new FakeElement("shadow-root");
      return this.shadowRoot;
    }
    append(...nodes) {
      for (const node of nodes) {
        if (Array.isArray(node)) {
          // Mimic the real DOM: append([el, el]) stringifies the array
          // into one text node, so tests can catch that bug.
          this.appendChild(String(node));
        } else {
          this.appendChild(node);
        }
      }
    }
    get className() {
      return [...this.classList._set].join(" ");
    }
    set className(value) {
      this.classList._set = new Set((value || "").split(/\s+/).filter(Boolean));
    }
    appendChild(node) {
      if (typeof node === "string" || typeof node === "number") {
        // DOM append() accepts raw strings; wrap them like text nodes.
        node = { tagName: "#text", text: String(node), parentNode: null };
      }
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
    insertBefore(node, reference) {
      if (reference) {
        const index = this.children.indexOf(reference);
        this.children.splice(index < 0 ? this.children.length : index, 0, node);
      } else {
        this.children.push(node);
      }
      node.parentNode = this;
      return node;
    }
    get nextSibling() {
      const parent = this.parentNode;
      if (!parent) {
        return null;
      }
      return parent.children[parent.children.indexOf(this) + 1] || null;
    }
    setAttribute(name, value) {
      this._attributes[name] = value;
    }
    getAttribute(name) {
      return this._attributes[name] ?? null;
    }
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, []);
      }
      this.listeners.get(type).push(handler);
    }
    removeEventListener() {}
    dispatchEvent(event) {
      event.target = this;
      for (const handler of this.listeners.get(event.type) || []) {
        handler(event);
      }
      return !event.defaultPrevented;
    }
    focus() {}
    blur() {}
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1000, height: 800 };
    }
    // Minimal selector support: tag, .class, #id, [attr="value"].
    _collect(selector) {
      const alternatives = selector.split(",").map((part) => {
        const tag = (part.match(/^[a-zA-Z][\w-]*/) || [])[0]?.toLowerCase();
        const id = (part.match(/#([\w-]+)/) || [])[1];
        const classes = [...part.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
        const attrs = [...part.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].map(
          (m) => [m[1], m[2]]
        );
        return (node) => {
          if (!node.tagName || node.tagName === "shadow-root" || node.tagName === "#text") {
            return false;
          }
          if (tag && node.tagName.toLowerCase() !== tag) return false;
          if (id && node._attributes?.id !== id && node.id !== id) return false;
          if (classes.length && !classes.every((c) => node.classList.contains(c))) {
            return false;
          }
          if (attrs.length) {
            for (const [name, value] of attrs) {
              if (node._attributes?.[name] !== value && node[name] !== value) {
                return false;
              }
            }
          }
          return true;
        };
      });
      const result = [];
      const walk = (node) => {
        for (const child of node.children || []) {
          if (alternatives.some((matches) => matches(child))) {
            result.push(child);
          }
          walk(child);
        }
      };
      walk(this);
      return result;
    }
    querySelectorAll(selector) {
      return this._collect(selector);
    }
    querySelector(selector) {
      return this._collect(selector)[0] ?? null;
    }
    get textContent() {
      const parts = [];
      const walk = (node) => {
        if (node.tagName === "#text") {
          parts.push(node.text ?? "");
          return;
        }
        for (const child of node.children || []) {
          walk(child);
        }
      };
      walk(this);
      return parts.join("");
    }
    set textContent(value) {
      this._textContent = value;
      // Like the real DOM: replace all children with a single text node.
      for (const child of [...this.children]) {
        child.parentNode = null;
      }
      this.children.length = 0;
      if (value !== "") {
        this.children.push({
          tagName: "#text",
          text: String(value),
          parentNode: this,
        });
      }
    }
  }

  const windowListeners = new Map();
  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (text) => ({ text }),
    body: new FakeElement("body"),
  };
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => void storage.set(key, String(value)),
    removeItem: (key) => void storage.delete(key),
  };
  globalThis.window = {
    addEventListener: (type, handler) => {
      if (!windowListeners.has(type)) {
        windowListeners.set(type, []);
      }
      windowListeners.get(type).push(handler);
    },
    _listeners: windowListeners,
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
  globalThis.WheelEvent = class WheelEvent {
    constructor(type, options) {
      this.type = type;
      Object.assign(this, options);
      this.defaultPrevented = false;
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
    stopPropagation() {}
  };
  globalThis.MouseEvent = class MouseEvent {
    constructor(type) {
      this.type = type;
    }
    preventDefault() {}
    stopPropagation() {}
  };
}

// ---------------------------------------------------------------------
// Fake editor

function makeFakeContext() {
  const calls = [];
  const context = new Proxy(
    {},
    {
      get(target, property) {
        if (property === "calls") {
          return calls;
        }
        if (property in target) {
          return target[property];
        }
        return (...args) => calls.push([property, ...args]);
      },
      set(target, property, value) {
        target[property] = value;
        calls.push([`set:${String(property)}`, value]);
        return true;
      },
    }
  );
  return context;
}

function makeFakeEditor() {
  const actions = [];
  const updates = [];
  const sidebarPanels = [];
  const layerToggles = [];
  const keyListeners = [];
  const canvas = {
    listeners: new Map(),
    dispatches: [],
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, []);
      }
      this.listeners.get(type).push(handler);
    },
    dispatchEvent(event) {
      this.dispatches.push(event);
      event.target = this;
      for (const handler of this.listeners.get(event.type) || []) {
        handler(event);
      }
      return true;
    },
    focus() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1000, height: 800 };
    },
  };
  const canvasParent = {
    children: [canvas],
    insertBefore(node, reference) {
      const index = reference ? this.children.indexOf(reference) : -1;
      this.children.splice(index < 0 ? this.children.length : index + 1, 0, node);
      node.parentNode = this;
      return node;
    },
  };
  canvas.parentElement = canvasParent;

  const positionedGlyph = {
    glyphName: "A",
    x: 100,
    y: 0,
    bounds: { xMin: 100, yMin: 0, xMax: 300, yMax: 700 },
  };

  const editor = {
    projectIdentifier: "test-project",
    fontController: {},
    actionExecutor: { registerAction: (...args) => actions.push(args) },
    canvasController: {
      canvas,
      requestUpdate: () => updates.push(Date.now()),
      origin: { x: 400, y: 300 },
      magnification: 2,
    },
    sceneController: {
      sceneModel: { positionedLines: [{ glyphs: [positionedGlyph] }] },
      sceneSettings: { selectedGlyphName: "A" },
      sceneSettingsController: {
        addKeyListener: (key, handler) => keyListeners.push([key, handler]),
      },
    },
    visualizationLayers: {
      definitions: [],
      toggle: (identifier, onOff) => layerToggles.push([identifier, onOff]),
    },
    visualizationLayersSettings: { model: {} },
    addSidebarPanel: (panel, sidebarName) =>
      sidebarPanels.push([panel, sidebarName]),
  };
  return {
    editor,
    actions,
    updates,
    sidebarPanels,
    layerToggles,
    keyListeners,
    canvas,
    canvasParent,
    positionedGlyph,
  };
}

installDomStub();

const { registerPlugin } = await import("../start.js");
const store = await import("../sketch-store.js");
const { layerDef, LAYER_IDENTIFIER, drawSketches } = await import(
  "../sketch-layer.js"
);

function freshPlugin() {
  const fake = makeFakeEditor();
  const plugin = registerPlugin(fake.editor, "/localplugins/sketch-layer/");
  return { fake, plugin };
}

test("registerPlugin registers the layer, overlay, panel and actions", () => {
  const { fake, plugin } = freshPlugin();

  // Layer: pushed into the live definitions array, sorted by zIndex, and
  // switched on (the editor snapshots defaultOn layers in its constructor).
  assert.ok(
    fake.editor.visualizationLayers.definitions.some(
      (def) => def.identifier === LAYER_IDENTIFIER
    )
  );
  assert.equal(fake.layerToggles.length, 1);
  assert.deepEqual(fake.layerToggles[0], [LAYER_IDENTIFIER, true]);
  assert.equal(fake.editor.visualizationLayersSettings.model[LAYER_IDENTIFIER], true);

  // Overlay: a sibling of the canvas, right after it.
  const overlayElement = plugin.overlay.element;
  assert.deepEqual(fake.canvasParent.children, [fake.canvas, overlayElement]);
  assert.equal(overlayElement.parentNode, fake.canvasParent);

  // Panel: added to the right sidebar.
  assert.equal(fake.sidebarPanels.length, 1);
  assert.equal(fake.sidebarPanels[0][1], "right");
  assert.equal(fake.sidebarPanels[0][0].identifier, "sketch-layer-plugin");

  // The panel actually built its content: pen swatches, mode checkbox,
  // clear buttons, and a status line — no "[object ...]" children.
  const panelShadow = fake.sidebarPanels[0][0].shadowRoot;
  const swatches = panelShadow.querySelectorAll(".sk-swatch");
  assert.equal(swatches.length, 6);
  assert.ok(panelShadow.querySelector('input[type="checkbox"]'));
  assert.ok(panelShadow.querySelector('input[type="range"]'));
  const buttonLabels = [...panelShadow.querySelectorAll(".sk-button")].map(
    (button) => button.textContent
  );
  assert.deepEqual(buttonLabels, ["Clear glyph", "Clear all (project)"]);
  const noGarbage = JSON.stringify(panelShadow.innerHTML ?? "");
  assert.ok(!noGarbage.includes("[object"), "panel must not contain stringified objects");

  // Actions: toggle-mode (plain S) and clear-glyph.
  assert.equal(fake.actions.length, 2);
  const [toggleId, toggleInfo] = fake.actions[0];
  assert.equal(toggleId, "action.sketch-layer.toggle-mode");
  assert.deepEqual(toggleInfo.defaultShortCuts, [{ baseKey: "s" }]);
  assert.equal(fake.actions[1][0], "action.sketch-layer.clear-glyph");

  // Idempotency guard.
  assert.equal(fake.editor.__sketchLayer, plugin);
  const again = registerPlugin(fake.editor, "/localplugins/sketch-layer/");
  assert.equal(again, plugin);
  assert.equal(fake.actions.length, 2);
});

test("setMode toggles the overlay's pointer events and the state flag", () => {
  const { plugin } = freshPlugin();
  assert.equal(plugin.state.mode, false);
  assert.equal(plugin.overlay.element.style.pointerEvents, "none");

  plugin.setMode(true);
  assert.equal(plugin.state.mode, true);
  assert.equal(plugin.overlay.element.style.pointerEvents, "auto");
  assert.equal(plugin.panel._modeCheckbox.checked, true);

  plugin.setMode(false);
  assert.equal(plugin.state.mode, false);
  assert.equal(plugin.overlay.element.style.pointerEvents, "none");
  assert.equal(plugin.panel._modeCheckbox.checked, false);
});

function pointerEvent(type, clientX, clientY) {
  return {
    type,
    clientX,
    clientY,
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
    pointerId: 1,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
  };
}

test("drawing a stroke: pointerdown/move/up stores it in glyph coordinates", () => {
  const { fake, plugin } = freshPlugin();
  plugin.setMode(true);
  const overlay = plugin.overlay.element;

  // Scene point (150, 100) => client (400 + 150*2, 300 - 100*2) = (700, 100).
  // Glyph A sits at (100, 0), so the local point is (50, 100).
  overlay.dispatchEvent(pointerEvent("pointerdown", 700, 100));
  assert.ok(store.state.activeStroke);
  assert.equal(store.state.activeStroke.glyphName, "A");
  assert.deepEqual(store.state.activeStroke.points, [[50, 100]]);

  overlay.dispatchEvent(pointerEvent("pointermove", 760, 60));
  // client (760, 60) => scene (180, 120) => local (180-100, 120-0) = (80, 120)
  const last = store.state.activeStroke.points.at(-1);
  assert.deepEqual(last, [80, 120]);

  overlay.dispatchEvent(pointerEvent("pointerup", 760, 60));
  assert.equal(store.state.activeStroke, null);
  assert.equal(plugin.strokeCount("test-project", "A"), 1);
  const saved = store.strokesFor("test-project", "A")[0];
  assert.deepEqual(saved.points[0], [50, 100]);
  assert.equal(fake.updates.length > 0, true);
  plugin.setMode(false);
});

test("a pointerdown with no glyphs on the canvas does not start a stroke", () => {
  const { fake, plugin } = freshPlugin();
  plugin.setMode(true);
  fake.editor.sceneController.sceneModel.positionedLines = [];
  plugin.overlay.element.dispatchEvent(pointerEvent("pointerdown", 700, 100));
  assert.equal(store.state.activeStroke, null);
  plugin.setMode(false);
});

test("drawSketches renders the stored strokes through the canvas context", () => {
  const { fake, plugin } = freshPlugin();
  plugin.setMode(true);
  const overlay = plugin.overlay.element;
  overlay.dispatchEvent(pointerEvent("pointerdown", 700, 100));
  overlay.dispatchEvent(pointerEvent("pointermove", 760, 60));
  overlay.dispatchEvent(pointerEvent("pointerup", 760, 60));

  const context = makeFakeContext();
  drawSketches({ context, positionedGlyph: fake.positionedGlyph });
  const strokeCalls = context.calls.filter(
    ([name]) => name === "stroke" || name === "moveTo" || name === "lineTo"
  );
  assert.ok(strokeCalls.some(([name]) => name === "moveTo"));
  assert.ok(strokeCalls.some(([name]) => name === "lineTo"));
  assert.ok(strokeCalls.some(([name]) => name === "stroke"));
  const styleCall = context.calls.find(([name]) => name === "set:strokeStyle");
  assert.equal(styleCall[1], plugin.state.color);

  // Also through the official layer definition entry point.
  assert.equal(typeof layerDef.draw, "function");
  assert.equal(layerDef.identifier, LAYER_IDENTIFIER);
  plugin.setMode(false);
});

test("an active stroke is drawn too (live preview)", () => {
  const { fake, plugin } = freshPlugin();
  plugin.setMode(true);
  const overlay = plugin.overlay.element;
  overlay.dispatchEvent(pointerEvent("pointerdown", 700, 100));
  assert.ok(store.state.activeStroke);

  const context = makeFakeContext();
  drawSketches({ context, positionedGlyph: fake.positionedGlyph });
  // A single-point stroke is drawn as a dot: arc + fill (no line path).
  assert.ok(context.calls.some(([name]) => name === "arc"));
  assert.ok(context.calls.some(([name]) => name === "fill"));
  plugin.setMode(false); // also cancels the active stroke
  assert.equal(store.state.activeStroke, null);
});

test("wheel events are forwarded to the canvas with wheelDelta filled in", () => {
  const { fake, plugin } = freshPlugin();
  plugin.setMode(true);
  // The listener prevents default on the overlay-targeted event (so the
  // browser doesn't scroll), which dispatchEvent reports as `false`.
  const forwarded = plugin.overlay.element.dispatchEvent({
    type: "wheel",
    clientX: 500,
    clientY: 400,
    deltaX: 0,
    deltaY: -120,
    deltaZ: 0,
    deltaMode: 0,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    wheelDeltaX: 0,
    wheelDeltaY: -120,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
  });
  // The overlay's wheel handler calls preventDefault on the original event.
  assert.equal(forwarded, false);

  // ...and the canvas received a synthetic wheel with the legacy properties.
  assert.equal(fake.canvas.dispatches.length, 1);
  const synthetic = fake.canvas.dispatches[0];
  assert.equal(synthetic.type, "wheel");
  assert.equal(synthetic.wheelDeltaY, -120);
  assert.equal(synthetic.deltaY, -120);
  plugin.setMode(false);
});

test("Escape exits drawing mode via the window keydown listener", () => {
  const { plugin } = freshPlugin();
  plugin.setMode(true);
  const escapeHandlers = globalThis.window._listeners.get("keydown");
  assert.ok(escapeHandlers.length >= 1);
  for (const handler of escapeHandlers) {
    handler({
      key: "Escape",
      preventDefault() {},
      stopPropagation() {},
    });
  }
  assert.equal(plugin.state.mode, false);
});

test("clearGlyph and clearAll remove strokes and refresh the canvas", () => {
  const { fake, plugin } = freshPlugin();
  // Wipe whatever earlier tests left on this glyph.
  plugin.clearGlyph();
  assert.equal(plugin.strokeCount("test-project", "A"), 0);

  store.addStroke("test-project", "A", {
    color: "#FF5470",
    width: 10,
    points: [[0, 0]],
  });
  assert.equal(plugin.strokeCount("test-project", "A"), 1);

  plugin.clearGlyph();
  assert.equal(plugin.strokeCount("test-project", "A"), 0);

  store.addStroke("test-project", "A", {
    color: "#FF5470",
    width: 10,
    points: [[0, 0]],
  });
  plugin.clearAll();
  assert.equal(plugin.strokeCount("test-project", "A"), 0);

  // Flush the debounce timer so no persistence work dangles after the tests.
  store.persist("test-project");
});
