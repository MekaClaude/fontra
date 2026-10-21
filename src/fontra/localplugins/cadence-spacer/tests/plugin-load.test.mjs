// tests/plugin-load.test.mjs
//
// The plugin has to load and register in a plain browser page, with no build
// step and no Fontra import. These tests check exactly that — in plain Node,
// with a very small DOM stub.
//
// The stub is installed *before* the plugin's modules are imported, so the
// import is dynamic: a static import would be evaluated first, and the
// panel's `class SimpleElement extends HTMLElement` would throw at module
// scope.

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
  globalThis.FileReader = class {
    readAsText() {}
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
  const engine = await import("../cadence-engine.js");
  assert.equal(typeof engine.parseCust, "function");
  assert.equal(typeof engine.runAutoSpacing, "function");
  assert.equal(typeof engine.applyPlan, "function");

  const presets = await import("../cadence-presets.js");
  assert.equal(presets.getPresetNames().length, 3);

  const state = await import("../cadence-state.js");
  assert.equal(state.state.enabled, true);
  assert.equal(state.state.plans instanceof Map, true);

  const layer = await import("../cadence-layer.js");
  assert.equal(typeof layer.registerLayer, "function");
  assert.equal(layer.LAYER_IDENTIFIER, "com.fontra.plugins.cadence-spacer.overlay");
});

test("the panel module loads and defines its custom element", async () => {
  const module = await import("../cadence-panel.js");
  assert.equal(typeof module.default, "function");
  assert.ok(globalThis.customElements.get("panel-cadence-spacer-plugin"));
});

test("registerPlugin adds the panel to the right sidebar", async () => {
  const { registerPlugin } = await import("../start.js");
  const editor = makeFakeEditor();
  registerPlugin(editor, "/localplugins/cadence-spacer/");
  assert.equal(editor.added.length, 1);
  assert.equal(editor.added[0].side, "right");
  assert.ok(editor.added[0].panel);
});

test("registerPlugin registers the overlay layer", async () => {
  const { registerPlugin } = await import("../start.js");
  const editor = makeFakeEditor();
  registerPlugin(editor, "/localplugins/cadence-spacer/");
  const definitions = editor.visualizationLayers.definitions;
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].identifier, "com.fontra.plugins.cadence-spacer.overlay");
  assert.equal(typeof definitions[0].draw, "function");
});

test("the layer draws nothing when it is switched off", async () => {
  const { registerLayer } = await import("../cadence-layer.js");
  const { state } = await import("../cadence-state.js");
  const editor = makeFakeEditor();
  registerLayer(editor);

  let strokes = 0;
  const context = {
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {
      strokes++;
    },
    setLineDash() {},
    fillRect() {},
  };

  const glyph = {
    xAdvance: 500,
    bounds: { xMin: 80, xMax: 420, yMin: 0, yMax: 700 },
  };

  state.enabled = false;
  editor.visualizationLayers.definitions[0].draw({
    context,
    positionedGlyph: { glyphName: "H", glyph },
    parameters: { strokeWidth: 1, tickHeight: 60, bandOpacity: 0.16, dashLength: 6, dashGap: 4, markerSize: 4 },
  });
  assert.equal(strokes, 0);

  state.enabled = true;
  editor.visualizationLayers.definitions[0].draw({
    context,
    positionedGlyph: { glyphName: "H", glyph },
    parameters: { strokeWidth: 1, tickHeight: 60, bandOpacity: 0.16, dashLength: 6, dashGap: 4, markerSize: 4 },
  });
  assert.ok(strokes > 0, "the beam is drawn when the layer is on");
});
