import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../src/lib/scrollFocusedField.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

function setup() {
  class Element {
    constructor({
      top = 0,
      height = 440,
      contentHeight = height,
      overflow = "visible",
      parent = null,
    } = {}) {
      this.top = top;
      this.height = height;
      this.clientHeight = height;
      this.clientTop = 0;
      this.scrollHeight = contentHeight;
      this.scrollTop = 0;
      this.overflow = overflow;
      this.parentElement = parent;
    }
    getBoundingClientRect() {
      let top = this.top;
      for (
        let parent = this.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        top -= parent.scrollTop;
      }
      return { top, bottom: top + this.height, height: this.height };
    }
    scrollIntoView() {
      assert.fail("must not pan the document with scrollIntoView");
    }
  }
  const documentElement = new Element({
    contentHeight: 1500,
    overflow: "auto",
  });
  const body = new Element({
    contentHeight: 1500,
    overflow: "auto",
    parent: documentElement,
  });
  const document = { body, documentElement };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    document,
    getComputedStyle: (element) => ({ overflowY: element.overflow }),
    window: { scrollTo: () => assert.fail("must not scroll the window") },
  });
  return {
    Element,
    body,
    documentElement,
    scrollFocusedField: module.exports.scrollFocusedField,
  };
}

test("an already visible input is not moved when iOS pans the visual viewport", () => {
  const h = setup();
  const scroller = new h.Element({
    top: 180,
    height: 440,
    contentHeight: 900,
    overflow: "auto",
    parent: h.body,
  });
  const field = new h.Element({ top: 450, height: 100, parent: scroller });
  h.scrollFocusedField(field, 180, 440);
  assert.equal(scroller.scrollTop, 0);
  assert.equal(h.body.scrollTop, 0);
  assert.equal(h.documentElement.scrollTop, 0);
});

test("a field obscured by the keyboard moves only its internal scroll container", () => {
  const h = setup();
  const scroller = new h.Element({
    top: 180,
    height: 440,
    contentHeight: 900,
    overflow: "auto",
    parent: h.body,
  });
  const field = new h.Element({ top: 610, height: 40, parent: scroller });
  h.scrollFocusedField(field, 180, 440);
  assert.equal(scroller.scrollTop, 42);
  assert.equal(field.getBoundingClientRect().bottom, 608);
  assert.equal(h.body.scrollTop, 0);
  assert.equal(h.documentElement.scrollTop, 0);
});

test("the root document never becomes a fallback scroll container", () => {
  const h = setup();
  const field = new h.Element({ top: 700, height: 40, parent: h.body });
  h.scrollFocusedField(field, 180, 440);
  assert.equal(h.body.scrollTop, 0);
  assert.equal(h.documentElement.scrollTop, 0);
});

test("a tall textarea keeps its visible start instead of scrolling to its bottom", () => {
  const h = setup();
  const scroller = new h.Element({
    top: 180,
    height: 440,
    contentHeight: 1200,
    overflow: "auto",
    parent: h.body,
  });
  const field = new h.Element({ top: 230, height: 600, parent: scroller });
  h.scrollFocusedField(field, 180, 440);
  assert.equal(scroller.scrollTop, 0);
  assert.equal(field.getBoundingClientRect().top, 230);
});

test("container clipping is respected even when the field is inside the viewport", () => {
  const h = setup();
  const scroller = new h.Element({
    top: 250,
    height: 200,
    contentHeight: 800,
    overflow: "scroll",
    parent: h.body,
  });
  const field = new h.Element({ top: 440, height: 40, parent: scroller });
  h.scrollFocusedField(field, 180, 440);
  assert.equal(scroller.scrollTop, 42);
  assert.equal(field.getBoundingClientRect().bottom, 438);
});

test("hidden and non-scrollable wrappers are not scrolled", () => {
  for (const [overflow, contentHeight] of [
    ["hidden", 900],
    ["auto", 440],
  ]) {
    const h = setup();
    const wrapper = new h.Element({
      top: 180,
      height: 440,
      contentHeight,
      overflow,
      parent: h.body,
    });
    const field = new h.Element({ top: 610, height: 40, parent: wrapper });
    h.scrollFocusedField(field, 180, 440);
    assert.equal(wrapper.scrollTop, 0);
  }
});

test("an input clipped above the visible viewport scrolls back into view", () => {
  const h = setup();
  const scroller = new h.Element({
    top: 180,
    height: 440,
    contentHeight: 900,
    overflow: "auto",
    parent: h.body,
  });
  scroller.scrollTop = 100;
  const field = new h.Element({ top: 250, height: 40, parent: scroller });
  h.scrollFocusedField(field, 180, 440);
  assert.equal(scroller.scrollTop, 58);
  assert.equal(field.getBoundingClientRect().top, 192);
});

test("nested scrolling remeasures the field before considering the outer container", () => {
  const h = setup();
  const outer = new h.Element({
    top: 180,
    height: 440,
    contentHeight: 1200,
    overflow: "auto",
    parent: h.body,
  });
  const inner = new h.Element({
    top: 200,
    height: 200,
    contentHeight: 800,
    overflow: "auto",
    parent: outer,
  });
  const field = new h.Element({ top: 410, height: 40, parent: inner });
  h.scrollFocusedField(field, 180, 440);
  assert.equal(inner.scrollTop, 62);
  assert.equal(outer.scrollTop, 0);
  assert.equal(field.getBoundingClientRect().bottom, 388);
});

test("an offscreen nested container reveals its input before the outer container scrolls", () => {
  const h = setup();
  const outer = new h.Element({ top: 180, height: 440, contentHeight: 1400, overflow: "auto", parent: h.body });
  const inner = new h.Element({ top: 700, height: 200, contentHeight: 800, overflow: "auto", parent: outer });
  const field = new h.Element({ top: 1100, height: 40, parent: inner });
  h.scrollFocusedField(field, 180, 440);
  const inputBounds = field.getBoundingClientRect();
  const innerBounds = inner.getBoundingClientRect();
  assert.ok(inputBounds.top >= innerBounds.top + 12);
  assert.ok(inputBounds.bottom <= innerBounds.bottom - 12, "the field must not remain clipped by its inner container");
  assert.ok(inputBounds.top >= 192);
  assert.ok(inputBounds.bottom <= 608);
  assert.equal(h.body.scrollTop, 0);
  assert.equal(h.documentElement.scrollTop, 0);
});
