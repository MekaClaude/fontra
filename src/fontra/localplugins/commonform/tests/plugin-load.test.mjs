// tests/plugin-load.test.mjs
//
// The plugin has to load and register in a plain browser page, with no build
// step and no Fontra import. These tests check exactly that — and they do it
// in plain Node, with a very small DOM stub.
//
// The DOM stub is installed *before* the plugin's modules are imported, so the
// import is dynamic: a static import would be evaluated before the stub
// exists, and the panel's `class SimpleElement extends HTMLElement` would
// throw at module scope.

import { test } from "node:test";
import assert from "node:assert/strict";

/** A DOM small enough to construct the panel, and no smaller. */
function installDomStub() {
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
      this.shadowRoot = null;
      this._textContent = "";
    }
    attachShadow() {
      this.shadowRoot = new FakeElement("shadow-root");
      return this.shadowRoot;
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    appendChild(node) {
      this.children.push(node);
      return node;
    }
    replaceChildren(...nodes) {
      this.children = [...nodes];
    }
    setAttribute() {}
    removeAttribute() {}
    addEventListener() {}
    removeEventListener() {}
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
  globalThis.localStorage = {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null;
    },
    setItem(key, value) {
      this.store.set(key, String(value));
    },
  };
}

/** A fake editor: just enough for the plugin to register itself. */
function makeFakeEditor() {
  const added = [];
  return {
    added,
    visualizationLayers: {
      definitions: [],
      toggle() {},
    },
    visualizationLayersSettings: { model: {} },
    canvasController: { requestUpdate() {} },
    addSidebarPanel(panel, side) {
      added.push({ panel, side });
    },
    fontController: {
      glyphMap: {},
      readOnly: false,
      hasGlyph: () => false,
      async getGlyph() {
        return null;
      },
    },
    sceneController: {
      selection: new Set(),
      editingLayerNames: [],
      sceneSettings: { selectedGlyphName: null },
      sceneModel: {
        async getGlyphInstance() {
          return null;
        },
      },
    },
  };
}

installDomStub();

// ---------------------------------------------------------------------------

test("every module of the plugin loads", async () => {
  const engine = await import("../commonform-engine.js");
  assert.equal(typeof engine.findMatches, "function");
  assert.equal(typeof engine.prepareContour, "function");
  assert.equal(typeof engine.summarizeMatches, "function");

  const font = await import("../commonform-font.js");
  assert.equal(typeof font.buildQuery, "function");
  assert.equal(typeof font.collectCandidates, "function");

  const state = await import("../commonform-state.js");
  assert.equal(state.state.matches.length, 0);
  assert.equal(state.state.toleranceFloor, 2);

  const layer = await import("../commonform-layer.js");
  assert.equal(typeof layer.registerLayer, "function");
  assert.equal(layer.LAYER_IDENTIFIER, "com.fontra.plugins.commonform.highlight");
});

test("the panel module loads and defines its custom element", async () => {
  const module = await import("../commonform-panel.js");
  assert.equal(typeof module.default, "function");
  assert.ok(globalThis.customElements.get("panel-commonform-plugin"));
});

test("registerPlugin adds the panel to the right sidebar", async () => {
  const { registerPlugin } = await import("../start.js");
  const editor = makeFakeEditor();
  registerPlugin(editor, "/localplugins/commonform/");
  assert.equal(editor.added.length, 1);
  assert.equal(editor.added[0].side, "right");
  assert.ok(editor.added[0].panel);
});

test("registerPlugin registers the highlight layer", async () => {
  const { registerPlugin } = await import("../start.js");
  const editor = makeFakeEditor();
  registerPlugin(editor, "/localplugins/commonform/");
  const definitions = editor.visualizationLayers.definitions;
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].identifier, "com.fontra.plugins.commonform.highlight");
  assert.equal(typeof definitions[0].draw, "function");
  assert.equal(definitions[0].defaultOn, true);
});

test("the layer draws the contours that matched", async () => {
  const { registerLayer } = await import("../commonform-layer.js");
  const { state } = await import("../commonform-state.js");
  const editor = makeFakeEditor();
  registerLayer(editor);

  const calls = [];
  const context = {
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    arc() {},
    stroke() {},
    setLineDash() {},
    fill() {},
    set strokeStyle(value) {
      calls.push(["strokeStyle", value]);
    },
    set fillStyle(value) {
      calls.push(["fillStyle", value]);
    },
    set lineWidth(value) {
      calls.push(["lineWidth", value]);
    },
  };

  const path = {
    iterContourDecomposedSegments: () => [
      { type: "line", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    ],
  };

  state.matches = [
    { glyphName: "d", contourIndex: 0, tier: "identical", mirrored: false },
  ];

  editor.visualizationLayers.definitions[0].draw({
    context,
    positionedGlyph: { glyphName: "d", glyph: { path } },
    parameters: {
      strokeWidth: 1,
      dashLength: 5,
      dashGap: 4,
      markerSize: 5,
      identicalColor: "#1D9E75",
      sameColor: "#185FA5",
      nearColor: "#B8860B",
      mirroredColor: "#E24B4A",
    },
  });

  assert.ok(
    calls.some(([name, value]) => name === "strokeStyle" && value === "#1D9E75"),
    "an identical match is drawn in the identical colour"
  );
});
