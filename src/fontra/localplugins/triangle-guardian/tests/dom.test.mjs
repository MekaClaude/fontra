import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal DOM stub so the shared helper can run under Node.
class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
  }
  append(...n) {
    this.children.push(...n);
  }
}
globalThis.document = { createElement: (t) => new FakeElement(t) };

const { el, div } = await import("../../_shared/dom.js");

test("el flattens array children instead of stringifying them", () => {
  const a = new FakeElement("a");
  const b = new FakeElement("b");
  const out = div({ id: "x" }, [a, b]);
  assert.equal(out.children.length, 2);
  assert.equal(out.children[0], a);
  assert.equal(out.children[1], b);
  assert.notEqual(String(out), "[object HTMLDivElement]");
});
