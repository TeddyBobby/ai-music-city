import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../src/hooks/useAutoHidePlayerBar.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

// A small hook host and DOM event surface keep timing and gesture sequences deterministic.
function setup() {
  let time = 0,
    timerId = 0,
    cursor = 0;
  const timers = new Map(),
    slots = [],
    effects = [];
  const depsEqual = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((item, index) => Object.is(item, b[index]));
  class Element {
    constructor(parent = null, options = {}) {
      this.parentElement = parent;
      this.scrollTop = 0;
      this.scrollHeight = 1000;
      this.clientHeight = 300;
      this.clientWidth = 184;
      this.offsetWidth = 200;
      this.clientTop = 0;
      this.overflowY = "auto";
      this.listeners = new Map();
      Object.assign(this, options);
    }
    getBoundingClientRect() {
      return { left: 0, right: 200, top: 0, bottom: 300 };
    }
    contains(element) {
      for (let node = element; node; node = node.parentElement)
        if (node === this) return true;
      return false;
    }
    closest() {
      for (let node = this; node; node = node.parentElement)
        if (node.excluded) return node;
      return null;
    }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
    }
    removeEventListener(type, callback) {
      this.listeners.get(type)?.delete(callback);
    }
    emit(type, event) {
      for (const callback of this.listeners.get(type) || [])
        callback({ target: this, ...event });
    }
  }
  const main = new Element(),
    document = new Element();
  document.body = new Element();
  document.documentElement = new Element();
  document.getElementById = (id) => (id === "main-content" ? main : null);
  const React = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: initial };
      return [
        slots[index].value,
        (value) => {
          slots[index].value =
            typeof value === "function" ? value(slots[index].value) : value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || !depsEqual(slots[index].dependencies, dependencies))
        slots[index] = { callback, dependencies };
      return slots[index].callback;
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      if (
        !slots[index] ||
        !depsEqual(slots[index].dependencies, dependencies)
      ) {
        const old = slots[index];
        slots[index] = { dependencies };
        effects.push(() => {
          old?.cleanup?.();
          slots[index].cleanup = callback();
        });
      }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    require: () => React,
    document,
    Element,
    HTMLElement: Element,
    getComputedStyle: (element) => ({
      overflowY: element.overflowY,
      borderLeftWidth: "0px",
      borderRightWidth: "0px",
      direction: "ltr",
    }),
    performance: { now: () => time },
    setTimeout: (callback, delay) => {
      timers.set(++timerId, { callback, at: time + delay });
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  let props = { locked: false, resetKey: "/create:song-a" };
  function render(next) {
    props = { ...props, ...next };
    cursor = 0;
    let value = module.exports.useAutoHidePlayerBar(props);
    while (effects.length) effects.shift()();
    cursor = 0;
    value = module.exports.useAutoHidePlayerBar(props);
    return value;
  }
  render();
  const wheel = (target, deltaY, deltaX = 0) =>
    main.emit("wheel", { target, deltaY, deltaX });
  const scroll = (target, top) => {
    target.scrollTop = top;
    main.emit("scroll", { target });
  };
  function advance(ms) {
    const end = time + ms;
    while (true) {
      const next = [...timers.entries()]
        .filter(([, item]) => item.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    time = end;
  }
  return {
    Element,
    main,
    document,
    render,
    wheel,
    scroll,
    advance,
    timers,
    unmount: () => slots.forEach((slot) => slot?.cleanup?.()),
  };
}

test("downward user scroll hides until 800ms after the last actual scroll", () => {
  const h = setup();
  h.wheel(h.main, 20);
  h.scroll(h.main, 20);
  assert.equal(h.render().hidden, true);
  h.advance(100);
  h.wheel(h.main, 30);
  h.scroll(h.main, 50);
  h.advance(799);
  assert.equal(h.render().hidden, true);
  h.advance(1);
  assert.equal(h.render().hidden, false);
});

test("upward scroll reveals immediately; sub-4px downward jitter does not hide", () => {
  const h = setup();
  h.wheel(h.main, 2);
  h.scroll(h.main, 2);
  assert.equal(h.render().hidden, false);
  h.wheel(h.main, 20);
  h.scroll(h.main, 22);
  assert.equal(h.render().hidden, true);
  h.wheel(h.main, -2);
  h.scroll(h.main, 20);
  assert.equal(h.render().hidden, false);
});

test("model-driven scroll, no movement, horizontal gestures, and scroll beyond the gate do not hide", () => {
  const h = setup();
  h.scroll(h.main, 30);
  assert.equal(h.render().hidden, false);
  h.wheel(h.main, 40);
  assert.equal(h.render().hidden, false);
  h.advance(450);
  h.scroll(h.main, 70);
  assert.equal(h.render().hidden, false);
  h.wheel(h.main, 0, 50);
  h.scroll(h.main, 100);
  assert.equal(h.render().hidden, false);
});

test("only the user-targeted nested scroller qualifies; text fields and overlays are ignored", () => {
  const h = setup();
  const messages = new h.Element(h.main),
    history = new h.Element(h.main);
  h.wheel(history, 20);
  h.scroll(messages, 200);
  assert.equal(h.render().hidden, false);
  h.scroll(history, 20);
  assert.equal(h.render().hidden, true);
  h.render().reveal();
  const textArea = new h.Element(h.main, { excluded: true });
  h.wheel(textArea, 20);
  h.scroll(textArea, 20);
  assert.equal(h.render().hidden, false);
  const overlay = new h.Element(h.main, { excluded: true });
  h.wheel(overlay, 20);
  h.scroll(overlay, 20);
  assert.equal(h.render().hidden, false);
});

test("locks, route changes, keyboard Tab, and teardown restore state and clean timers", () => {
  const h = setup();
  h.wheel(h.main, 20);
  h.scroll(h.main, 20);
  assert.equal(h.render({ locked: true }).hidden, false);
  assert.equal(h.timers.size, 0);
  h.wheel(h.main, 20);
  h.scroll(h.main, 40);
  assert.equal(h.render().hidden, false);
  h.render({ locked: false });
  h.wheel(h.main, 20);
  h.scroll(h.main, 60);
  assert.equal(h.render().hidden, true);
  assert.equal(h.render({ resetKey: "/assistant:song-b" }).hidden, false);
  h.wheel(h.main, 20);
  h.scroll(h.main, 80);
  h.document.emit("keydown", { key: "Tab" });
  assert.equal(h.render().hidden, false);
  h.wheel(h.main, 20);
  h.scroll(h.main, 100);
  h.unmount();
  assert.equal(h.timers.size, 0);
  assert.equal(
    [...h.main.listeners.values()].reduce(
      (n, listeners) => n + listeners.size,
      0,
    ),
    0,
  );
  assert.equal(
    [...h.document.listeners.values()].reduce(
      (n, listeners) => n + listeners.size,
      0,
    ),
    0,
  );
});

test("keyboard and touch gestures require real vertical movement", () => {
  const h = setup();
  h.document.emit("keydown", { target: h.main, key: "PageDown" });
  assert.equal(h.render().hidden, false);
  h.scroll(h.main, 100);
  assert.equal(h.render().hidden, true);
  h.render().reveal();
  h.main.emit("touchstart", {
    touches: [{ identifier: 1, clientX: 0, clientY: 100 }],
  });
  h.main.emit("touchmove", {
    touches: [{ identifier: 1, clientX: 0, clientY: 70 }],
  });
  h.scroll(h.main, 130);
  assert.equal(h.render().hidden, true);
  h.main.emit("touchend", {});
  h.advance(100);
  h.scroll(h.main, 150);
  h.advance(800);
  assert.equal(h.render().hidden, false);
});

test("coalesced wheel events preserve the unconsumed scroll baseline and allow a delayed first frame", () => {
  const h = setup();
  h.wheel(h.main, 20);
  h.main.scrollTop = 20;
  h.advance(100);
  h.wheel(h.main, 20);
  h.scroll(h.main, 20);
  assert.equal(h.render().hidden, true);
  h.render().reveal();
  h.wheel(h.main, 20);
  h.advance(350);
  h.scroll(h.main, 40);
  assert.equal(h.render().hidden, true);
});

test("dragging the scrollbar qualifies while ordinary content dragging does not", () => {
  const h = setup();
  h.main.emit("pointerdown", {
    pointerType: "mouse",
    button: 0,
    clientX: 50,
    clientY: 100,
  });
  h.scroll(h.main, 40);
  assert.equal(h.render().hidden, false);
  h.main.emit("pointerdown", {
    pointerType: "mouse",
    button: 0,
    clientX: 195,
    clientY: 100,
  });
  h.scroll(h.main, 80);
  assert.equal(h.render().hidden, true);
  h.document.emit("pointermove", { buttons: 1 });
  h.scroll(h.main, 70);
  assert.equal(h.render().hidden, false);
  h.scroll(h.main, 100);
  assert.equal(h.render().hidden, true);
  h.document.emit("pointerup", {});
  h.advance(800);
  assert.equal(h.render().hidden, false);
  h.scroll(h.main, 200);
  assert.equal(h.render().hidden, false);
});
