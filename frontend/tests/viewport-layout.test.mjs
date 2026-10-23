import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../src/hooks/useViewportLayout.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

// Exercise the production hook against browser event sequences. Dimensions are
// independent of React's rendered shell, as they are in the real browser.
function setup() {
  let state, cleanup;
  let nextId = 0;
  const frames = new Map();
  const timers = new Map();
  const surface = (values = {}) => ({
    ...values,
    listeners: new Map(),
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      this.listeners.get(type)?.delete(callback);
    },
    emit(type) {
      for (const callback of this.listeners.get(type) || []) callback();
    },
  });
  class Element {
    isContentEditable = false;
  }
  class Input extends Element {
    type = "text";
    readOnly = false;
    disabled = false;
  }
  class Textarea extends Element {
    readOnly = false;
    disabled = false;
  }
  const viewport = surface({ height: 760, scale: 1 });
  const mobile = surface({ matches: true });
  const document = surface({ activeElement: null });
  const window = surface({
    innerHeight: 760,
    innerWidth: 390,
    screen: { availWidth: 390, availHeight: 844 },
    visualViewport: viewport,
    matchMedia: () => mobile,
    requestAnimationFrame(callback) {
      frames.set(++nextId, callback);
      return nextId;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout(callback) {
      timers.set(++nextId, callback);
      return nextId;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    window,
    document,
    HTMLElement: Element,
    HTMLInputElement: Input,
    HTMLTextAreaElement: Textarea,
    require: () => ({
      useState(initial) {
        state = initial();
        return [
          state,
          (update) => {
            state = update(state);
          },
        ];
      },
      useEffect(effect) {
        cleanup = effect();
      },
    }),
  });
  module.exports.useViewportLayout();
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback();
  };
  const resize = (values, visualHeight = values.innerHeight) => {
    Object.assign(window, values);
    viewport.height = visualHeight;
    viewport.emit("resize");
    window.emit("resize");
    flush();
  };
  const focus = (element = new Textarea()) => {
    document.activeElement = element;
    document.emit("focusin");
    flush();
  };
  const blur = () => {
    document.activeElement = null;
    document.emit("focusout");
    for (const callback of timers.values()) callback();
    timers.clear();
    flush();
  };
  return {
    window,
    viewport,
    mobile,
    document,
    Input,
    Textarea,
    frames,
    timers,
    state: () => state,
    flush,
    resize,
    focus,
    blur,
    cleanup: () => cleanup(),
  };
}

test("keyboard follows both iOS visual viewport and Android layout resizing", () => {
  for (const android of [false, true]) {
    const h = setup();
    h.focus();
    h.resize({ innerHeight: android ? 440 : 760 }, 440);
    assert.equal(h.state().keyboardOpen, true);
    assert.equal(h.state().viewportHeight, 440);
    assert.equal(h.state().keyboardInset, 320);
    h.resize({ innerHeight: 760 }, 760);
    assert.equal(
      h.state().keyboardOpen,
      false,
      "keyboard can close with focus retained",
    );
    h.cleanup();
  }
});

test("rotating with Android keyboard open retains keyboard layout in both directions", () => {
  const h = setup();
  h.focus();
  h.resize({ innerHeight: 440 }, 440);
  h.window.emit("orientationchange"); // Event can arrive before dimensions.
  h.flush();
  assert.equal(h.state().keyboardOpen, true);
  h.resize({ innerWidth: 844, innerHeight: 180 }, 180);
  assert.equal(h.state().keyboardOpen, true);
  assert.equal(h.state().viewportHeight, 180);
  assert.equal(h.state().keyboardInset, 210);
  h.resize({ innerHeight: 350 }, 350);
  assert.equal(
    h.state().keyboardOpen,
    false,
    "keyboard dismissal after rotation is detected",
  );
  h.blur();
  h.resize({ innerHeight: 350 }, 350);
  h.focus();
  h.resize({ innerHeight: 180 }, 180);
  assert.equal(h.state().keyboardOpen, true);
  h.resize({ innerWidth: 390, innerHeight: 440 }, 440);
  h.window.emit("orientationchange"); // It can also arrive after dimensions.
  h.flush();
  assert.equal(h.state().keyboardOpen, true);
  assert.equal(
    h.state().keyboardInset,
    320,
    "returning orientation uses its real resting height",
  );
  h.cleanup();
});

test("focus transfers do not replace the pre-keyboard baseline", () => {
  const h = setup();
  h.focus();
  h.resize({ innerHeight: 440 }, 440);
  h.document.activeElement = null;
  h.document.emit("focusout");
  h.focus(new h.Input());
  assert.equal(h.timers.size, 0, "pending blur was cancelled");
  assert.equal(h.state().keyboardOpen, true);
  assert.equal(h.state().keyboardInset, 320);
  h.blur();
  assert.equal(h.state().keyboardOpen, false);
  h.cleanup();
});

test("pinch zoom, desktop resizing and non-editable controls do not open keyboard layout", () => {
  const h = setup();
  h.focus();
  h.viewport.scale = 2;
  h.resize({ innerHeight: 760 }, 380);
  assert.equal(h.state().keyboardOpen, false);
  h.viewport.scale = 1;
  h.mobile.matches = false;
  h.resize({ innerHeight: 760 }, 440);
  assert.equal(h.state().keyboardOpen, false);
  h.mobile.matches = true;
  const readonly = new h.Input();
  readonly.readOnly = true;
  h.focus(readonly);
  assert.equal(h.state().keyboardOpen, false);
  h.cleanup();
});

test("unmount removes viewport, orientation and focus listeners and queued work", () => {
  const h = setup();
  h.document.emit("focusout");
  h.viewport.emit("resize");
  h.cleanup();
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
  for (const target of [h.window, h.viewport, h.mobile, h.document])
    for (const listeners of target.listeners.values())
      assert.equal(listeners.size, 0);
});
