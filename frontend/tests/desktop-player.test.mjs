import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  await readFile(
    new URL("../src/components/PlayerBar.tsx", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;

function setup({ desktop = true, fullscreen = false, current = true } = {}) {
  const listeners = new Map(),
    cleanups = [];
  let toggles = 0,
    autoHide,
    dialog = false;
  class Element {
    constructor(interactive = false) {
      this.interactive = interactive;
    }
    closest() {
      return this.interactive ? this : null;
    }
  }
  const player = {
    current: current ? { id: "song", title: "音乐" } : null,
    queue: [],
    volume: 0.7,
    time: 0,
    duration: 30,
    toggle: () => toggles++,
  };
  const context = {
    exports: {},
    Element,
    document: { querySelector: () => (dialog ? {} : null) },
    window: {
      addEventListener: (type, callback) => listeners.set(type, callback),
      removeEventListener: (type, callback) => {
        if (listeners.get(type) === callback) listeners.delete(type);
      },
    },
    require(name) {
      if (name === "react")
        return {
          useState: (value) => [value, () => {}],
          useEffect: (effect) => {
            const cleanup = effect();
            if (cleanup) cleanups.push(cleanup);
          },
        };
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      if (name === "react-router-dom")
        return { useLocation: () => ({ key: "home" }) };
      if (name === "@mantine/hooks") return { useMediaQuery: () => desktop };
      if (name === "@mantine/core")
        return {
          Popover: { Target: "Target", Dropdown: "Dropdown" },
          Slider: "Slider",
          UnstyledButton: "Button",
        };
      if (name === "lucide-react")
        return new Proxy({}, { get: (_, key) => String(key) });
      if (name === "../state/player") return { usePlayer: () => player };
      if (name === "../state/playerOverlay")
        return {
          usePlayerOverlay: (selector) =>
            selector({ open: () => {}, opened: fullscreen }),
        };
      if (name === "../lib/utils")
        return { duration: String, titleOf: (song) => song.title };
      if (name === "../hooks/useAutoHidePlayerBar")
        return {
          useAutoHidePlayerBar: (options) => {
            autoHide = options;
            return { hidden: false, reveal: () => {} };
          },
        };
      if (name === "./ui")
        return { Artwork: "Artwork", IconButton: "IconButton" };
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected module: ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  context.exports.PlayerBar();
  return {
    autoHide,
    get toggles() {
      return toggles;
    },
    setDialog(value) {
      dialog = value;
    },
    key(overrides = {}) {
      let prevented = false;
      listeners.get("keydown")?.({
        code: "Space",
        target: new Element(),
        preventDefault: () => {
          prevented = true;
        },
        ...overrides,
      });
      return prevented;
    },
    interactive: () => new Element(true),
    unmount: () => cleanups.forEach((cleanup) => cleanup()),
  };
}

test("desktop dock stays visible while mobile retains scroll hiding", () => {
  assert.equal(setup().autoHide.locked, true);
  assert.equal(setup({ desktop: false }).autoHide.locked, false);
});

test("desktop space toggles the selected music and prevents page scrolling", () => {
  const host = setup();
  assert.equal(host.key(), true);
  assert.equal(host.toggles, 1);
  host.unmount();
  assert.equal(host.key(), false);
  assert.equal(host.toggles, 1);
});

test("typing, focused controls and dialogs keep their own keyboard behavior", () => {
  const host = setup();
  assert.equal(host.key({ target: host.interactive() }), false);
  host.setDialog(true);
  assert.equal(host.key(), false);
  assert.equal(host.toggles, 0);
});

test("held keys, text composition and modified shortcuts do not toggle playback", () => {
  const host = setup();
  for (const flag of [
    "repeat",
    "isComposing",
    "altKey",
    "ctrlKey",
    "metaKey",
    "shiftKey",
    "defaultPrevented",
  ]) {
    assert.equal(host.key({ [flag]: true }), false);
  }
  assert.equal(host.key({ code: "Enter" }), false);
  assert.equal(host.toggles, 0);
});

test("fullscreen owns its shortcut; mobile and empty queues do not register it", () => {
  for (const state of [
    { fullscreen: true },
    { desktop: false },
    { current: false },
  ]) {
    const host = setup(state);
    assert.equal(host.key(), false);
    assert.equal(host.toggles, 0);
  }
});
