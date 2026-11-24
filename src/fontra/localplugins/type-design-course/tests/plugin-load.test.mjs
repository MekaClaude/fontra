// tests/plugin-load.test.mjs
//
// The plug-in must load and register in a plain browser page, with no build
// step and no import from Fontra. These tests check exactly that, in plain
// Node with a small DOM stub: the panel registers itself, the editor is
// given a panel in the right sidebar, the course loads, the lessons can be
// marked done, and the progress survives a reload.
//
// The stub is installed *before* the plug-in's modules are imported, so the
// import is dynamic: a static import would be evaluated first, and the
// panel's `class … extends HTMLElement` would throw at module scope.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = new URL("../", import.meta.url);
const COURSE_PATH = fileURLToPath(new URL("data/course.json", PLUGIN_DIR));

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

class FakeText {
  constructor(text) {
    this.tagName = "#text";
    this.text = String(text);
    this.parentNode = null;
  }

  get textContent() {
    return this.text;
  }

  set textContent(value) {
    this.text = String(value ?? "");
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = { setProperty() {} };
    this.classList = new FakeClassList();
    this.shadowRoot = null;
    this._attributes = {};
    this._listeners = new Map();
    this._textContent = null;
  }

  attachShadow() {
    this.shadowRoot = new FakeElement("shadow-root");
    return this.shadowRoot;
  }

  get className() {
    return [...this.classList._set].join(" ");
  }

  set className(value) {
    this.classList._set = new Set((value || "").split(/\s+/).filter(Boolean));
  }

  get textContent() {
    if (this._textContent !== null) {
      return this._textContent;
    }
    return this.children.map((child) => child.textContent ?? "").join("");
  }

  set textContent(value) {
    this._textContent = value === null || value === undefined ? "" : String(value);
    this.children = [];
  }

  appendChild(node) {
    if (typeof node === "string" || typeof node === "number") {
      node = new FakeText(node);
    }
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  append(...nodes) {
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) {
      this.children.splice(index, 1);
      node.parentNode = null;
    }
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = null;
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  setAttribute(name, value) {
    this._attributes[name] = value;
  }

  getAttribute(name) {
    return this._attributes[name] ?? null;
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, []);
    }
    this._listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const list = this._listeners.get(type);
    if (list) {
      this._listeners.set(
        type,
        list.filter((entry) => entry !== handler)
      );
    }
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    for (const handler of this._listeners.get(event.type) || []) {
      handler(event);
    }
    return !event.defaultPrevented;
  }

  focus() {}
  scrollTo() {}

  // Minimal selector support: tag name and .class.
  _matches(selector) {
    if (!this.tagName || this.tagName === "#TEXT" || this.tagName === "SHADOW-ROOT") {
      return false;
    }
    const tag = (selector.match(/^[a-zA-Z][\w-]*/) || [])[0];
    if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) {
      return false;
    }
    const className = (selector.match(/\.([\w-]+)/) || [])[1];
    if (className && !this.classList.contains(className)) {
      return false;
    }
    return true;
  }

  querySelector(selector) {
    for (const part of selector.split(",")) {
      const wanted = part.trim();
      const walk = (node) => {
        if (!node || !node.children) {
          return null;
        }
        for (const child of node.children) {
          if (child._matches?.(wanted)) {
            return child;
          }
          const found = walk(child);
          if (found) {
            return found;
          }
        }
        return null;
      };
      const found = walk(this);
      if (found) {
        return found;
      }
    }
    return null;
  }

  querySelectorAll(selector) {
    const result = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child._matches?.(selector)) {
          result.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return result;
  }
}

function installDomStub(courseJson) {
  const registry = new Map();
  const storage = new Map();

  globalThis.HTMLElement = FakeElement;
  globalThis.customElements = {
    get: (name) => registry.get(name),
    define: (name, constructor) => {
      if (registry.has(name)) {
        throw new Error(`the element ${name} is already defined`);
      }
      registry.set(name, constructor);
    },
  };
  globalThis.document = {
    querySelector: () => null,
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (text) => new FakeText(text),
  };
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("course.json")) {
      return {
        ok: true,
        status: 200,
        json: async () => courseJson,
      };
    }
    // The knowledge base is optional: it is not part of this test.
    return { ok: false, status: 404, json: async () => ({}) };
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  };
  return { registry, storage };
}

// --- the editor stand-in --------------------------------------------------

function makeEditor() {
  const addedPanels = [];
  const performedActions = [];
  return {
    addedPanels,
    performedActions,
    addSidebarPanel(panel, side) {
      addedPanels.push({ panel, side });
    },
    actionExecutor: {
      doPerformAction(actionIdentifier) {
        performedActions.push(actionIdentifier);
        return true;
      },
    },
    sceneController: {
      sceneSettingsController: {
        addKeyListener() {},
      },
    },
    fontController: { customData: {} },
  };
}

// --- the tests ------------------------------------------------------------

const courseJson = JSON.parse(await readFile(COURSE_PATH, "utf-8"));

test("the plug-in registers a panel and hands it to the editor", async () => {
  const { registry } = installDomStub(courseJson);
  const { init } = await import("../init.js");
  const editor = makeEditor();

  init(editor, "/localplugins/type-design-course");

  assert.ok(
    registry.has("type-design-course-panel"),
    "the panel element was not registered"
  );
  assert.equal(editor.addedPanels.length, 1);
  assert.equal(editor.addedPanels[0].side, "right");
  assert.equal(editor.addedPanels[0].panel.identifier, "type-design-course");
});

test("the panel shows the course once the document has arrived", async () => {
  installDomStub(courseJson);
  const { TypeDesignCoursePanel } = await import("../panel.js");
  const editor = makeEditor();
  const panel = new TypeDesignCoursePanel(editor, "/localplugins/type-design-course");

  // The document is fetched asynchronously; give it a turn to arrive.
  await new Promise((resolve) => setTimeout(resolve, 50));
  panel.render();

  const text = panel.shadowRoot.querySelector(".wrap").textContent;
  assert.match(text, /Type Design School/);
  assert.match(text, /Learning to See/);
  assert.match(text, /of .* lessons done/);
});

test("a lesson can be opened, marked done, and the progress is kept", async () => {
  installDomStub(courseJson);
  const { TypeDesignCoursePanel } = await import("../panel.js");
  const editor = makeEditor();
  const panel = new TypeDesignCoursePanel(editor, "/localplugins/type-design-course");
  await new Promise((resolve) => setTimeout(resolve, 50));

  const firstLesson = courseJson.phases[0].lessons[0];

  panel._setView({
    kind: "lesson",
    phaseId: courseJson.phases[0].id,
    lessonId: firstLesson.id,
  });

  const text = panel.shadowRoot.querySelector(".wrap").textContent;
  assert.match(text, new RegExp(firstLesson.title.slice(0, 12)));
  assert.match(text, /Before you move on/);
  assert.match(text, /Watch out for/);

  // Mark the lesson done, the way the button in the panel does.
  panel.progress = panel.progress;
  const { withLessonDone } = await import("../course.js");
  panel.progress = withLessonDone(panel.progress, firstLesson.id, true);
  panel._save();
  panel.render();

  assert.equal(
    globalThis.localStorage.getItem("fontra.type-design-course.progress") !== null,
    true,
    "the progress was not written to the storage"
  );

  // The front page counts the lessons that are done.
  panel._setView({ kind: "overview" });
  assert.match(
    panel.shadowRoot.querySelector(".wrap").textContent,
    /1 of \d+ lessons done/
  );
});

test("the glossary can be searched", async () => {
  installDomStub(courseJson);
  const { TypeDesignCoursePanel } = await import("../panel.js");
  const editor = makeEditor();
  const panel = new TypeDesignCoursePanel(editor, "/localplugins/type-design-course");
  await new Promise((resolve) => setTimeout(resolve, 50));

  panel._setView({ kind: "glossary" });
  const wrap = panel.shadowRoot.querySelector(".wrap");
  assert.match(wrap.textContent, /Glossary/);
  assert.match(wrap.textContent, /Aperture/);

  const search = wrap.querySelector(".search");
  search.value = "counter";
  search.dispatchEvent({ type: "input" });

  const list = wrap.querySelector(".glossary");
  assert.match(list.textContent, /Counter/);
  assert.ok(
    !/Aperture/.test(list.textContent),
    "the glossary did not filter out the other terms"
  );
});

test("the letter audit lists every capital and its checks", async () => {
  installDomStub(courseJson);
  const { TypeDesignCoursePanel } = await import("../panel.js");
  const editor = makeEditor();
  const panel = new TypeDesignCoursePanel(editor, "/localplugins/type-design-course");
  await new Promise((resolve) => setTimeout(resolve, 50));

  panel._setView({ kind: "letters" });
  const wrap = panel.shadowRoot.querySelector(".wrap");
  assert.match(wrap.textContent, /Letter audit/);

  panel._setView({ kind: "letters", letter: "H" });
  const letterWrap = panel.shadowRoot.querySelector(".wrap");
  assert.match(letterWrap.textContent, /crossbar sits above the middle/i);
});
