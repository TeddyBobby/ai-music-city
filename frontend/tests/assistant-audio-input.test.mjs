import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../src/components/AssistantAudioInput.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const settle = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function microphone() {
  return {
    stopped: 0,
    getTracks() {
      return [
        {
          stop: () => {
            this.stopped += 1;
          },
        },
      ];
    },
  };
}

// Exercise the actual component's asynchronous device lifecycle with a fake microphone.
function setup({ getUserMedia, initialFile = null } = {}) {
  const hooks = [],
    effects = [],
    changes = [],
    recording = [],
    recordings = [],
    revoked = [];
  const intervals = new Map();
  const mic = microphone();
  let index = 0,
    component,
    tree,
    file = initialFile,
    unmounted = false,
    clock = 0,
    timer = 0;
  const render = () => {
    index = 0;
    tree = component({
      file,
      onChange: (next) => {
        changes.push(next);
        file = next;
        render();
      },
      onRecordingChange: (active) => recording.push(active),
    });
    for (const [slot, effect] of effects.splice(0)) {
      hooks[slot].cleanup?.();
      hooks[slot].cleanup = effect();
    }
  };
  const react = {
    useId() {
      index += 1;
      return "assistant-file";
    },
    useRef(value) {
      const slot = index++;
      hooks[slot] ??= { current: value };
      return hooks[slot];
    },
    useState(value) {
      const slot = index++;
      hooks[slot] ??= { value };
      return [
        hooks[slot].value,
        (next) => {
          assert.equal(unmounted, false, "no updates after unmount");
          hooks[slot].value =
            typeof next === "function" ? next(hooks[slot].value) : next;
          render();
        },
      ];
    },
    useEffect(effect, deps) {
      const slot = index++,
        previous = hooks[slot];
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
        hooks[slot] = { ...previous, deps };
        effects.push([slot, effect]);
      }
    },
  };
  class Recorder {
    static isTypeSupported(type) {
      return type === "audio/mp4";
    }
    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = options?.mimeType || "audio/webm";
      this.state = "inactive";
      recordings.push(this);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({
        data: new Blob(["recorded audio"], { type: this.mimeType }),
      });
      this.onstop?.();
    }
  }
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    Blob,
    File,
    Error,
    Date: { now: () => clock },
    navigator: {
      mediaDevices: { getUserMedia: getUserMedia || (async () => mic) },
    },
    MediaRecorder: Recorder,
    URL: {
      createObjectURL: (selected) => `blob:${selected.name}`,
      revokeObjectURL: (url) => revoked.push(url),
    },
    setInterval: (callback) => {
      intervals.set(++timer, callback);
      return timer;
    },
    clearInterval: (id) => intervals.delete(id),
    fetch: () => {
      throw new Error("Attachments must never be sent automatically");
    },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      if (name === "lucide-react")
        return new Proxy({}, { get: (_, key) => String(key) });
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected import ${name}`);
    },
  });
  component = module.exports.AssistantAudioInput;
  render();
  const all = (node) =>
    !node || typeof node !== "object"
      ? []
      : Array.isArray(node)
        ? node.flatMap(all)
        : [node, ...all(node.props?.children)];
  const find = (predicate) => {
    const result = all(tree).find(predicate);
    assert.ok(result, "expected element");
    return result;
  };
  return {
    mic,
    changes,
    recording,
    recordings,
    revoked,
    intervals,
    click: (label) =>
      find((node) => node.props?.["aria-label"] === label).props.onClick(),
    cancel: () =>
      find(
        (node) => node.props?.className === "assistant-audio-cancel",
      ).props.onClick(),
    choose: (next) => {
      const target = { files: [next], value: "chosen" };
      find((node) => node.type === "input").props.onChange({
        currentTarget: target,
      });
      assert.equal(target.value, "", "same file can be selected again");
    },
    alert: () =>
      all(tree).find((node) => node.props?.role === "alert")?.props.children,
    audio: () => all(tree).find((node) => node.type === "audio"),
    advance: (seconds) => {
      clock += seconds * 1000;
      [...intervals.values()].forEach((callback) => callback());
    },
    unmount: () => {
      unmounted = true;
      hooks.forEach((hook) => hook?.cleanup?.());
    },
  };
}

test("recording becomes a playable draft attachment without sending", async () => {
  const app = setup();
  await app.click("开始录音");
  assert.equal(app.recording.at(-1), true);
  assert.equal(app.changes.length, 0);
  app.click("结束录音");
  assert.equal(app.changes[0].name, "我的录音.m4a");
  assert.equal(app.audio().props.src, "blob:我的录音.m4a");
  assert.equal(app.mic.stopped, 1);
  assert.equal(app.recording.at(-1), false);
  app.unmount();
  assert.deepEqual(app.revoked, ["blob:我的录音.m4a"]);
});

test("a parent-owned audio draft remains playable after leaving and returning", () => {
  const file = new File(["saved recording"], "我的灵感.m4a", {
    type: "audio/mp4",
  });
  const first = setup();
  first.choose(file);
  first.unmount();
  assert.deepEqual(
    first.changes,
    [file],
    "unmount must not clear the parent's draft",
  );
  assert.deepEqual(first.revoked, ["blob:我的灵感.m4a"]);
  const returned = setup({ initialFile: first.changes[0] });
  assert.equal(returned.audio().props.src, "blob:我的灵感.m4a");
  assert.equal(returned.changes.length, 0);
  assert.equal(returned.recordings.length, 0);
  returned.unmount();
});

test("pending permission is cancellable and a late microphone is released", async () => {
  const permission = deferred(),
    mic = microphone();
  const app = setup({ getUserMedia: () => permission.promise });
  app.click("开始录音");
  app.cancel();
  permission.resolve(mic);
  await settle();
  assert.equal(mic.stopped, 1);
  assert.equal(app.recordings.length, 0);
  assert.equal(app.changes.length, 0);
  assert.equal(app.recording.at(-1), false);
  app.unmount();
});

test("an old permission failure cannot interrupt a newer recording", async () => {
  const permission = deferred(),
    mic = microphone();
  let count = 0;
  const app = setup({
    getUserMedia: () =>
      ++count === 1 ? permission.promise : Promise.resolve(mic),
  });
  app.click("开始录音");
  app.cancel();
  await app.click("开始录音");
  permission.reject(new Error("old request rejected"));
  await settle();
  assert.equal(mic.stopped, 0);
  assert.equal(app.recordings[0].state, "recording");
  assert.equal(app.recording.at(-1), true);
  app.unmount();
  assert.equal(mic.stopped, 1);
});

test("leaving the page stops recording without keeping an unfinished attachment", async () => {
  const app = setup();
  await app.click("开始录音");
  app.unmount();
  assert.equal(app.mic.stopped, 1);
  assert.equal(app.intervals.size, 0);
  assert.equal(app.changes.length, 0);
  assert.equal(app.recording.at(-1), false);
});

test("permission resolving after unmount releases its microphone", async () => {
  const permission = deferred(),
    mic = microphone();
  const app = setup({ getUserMedia: () => permission.promise });
  app.click("开始录音");
  app.unmount();
  permission.resolve(mic);
  await settle();
  assert.equal(mic.stopped, 1);
  assert.equal(app.recordings.length, 0);
});

test("recording automatically finishes at two minutes", async () => {
  const app = setup();
  await app.click("开始录音");
  app.advance(120);
  assert.equal(app.recordings[0].state, "inactive");
  assert.equal(app.changes.length, 1);
  assert.equal(app.intervals.size, 0);
  assert.equal(app.mic.stopped, 1);
  app.unmount();
});

test("invalid audio is rejected while the previous playable attachment is preserved", () => {
  const app = setup();
  const valid = new File(["audio"], "melody.wav", { type: "audio/wav" });
  app.choose(valid);
  app.choose(new File(["text"], "notes.txt"));
  assert.match(app.alert(), /可播放/);
  app.choose({ name: "large.mp3", size: 20 * 1024 * 1024 + 1 });
  assert.match(app.alert(), /20 MB/);
  assert.equal(app.changes.length, 1);
  assert.equal(app.audio().props.src, "blob:melody.wav");
  app.click("移除音频");
  assert.equal(app.changes.at(-1), null);
  assert.equal(app.audio(), undefined);
  assert.deepEqual(app.revoked, ["blob:melody.wav"]);
  app.unmount();
});

test("recorder errors release the microphone and explain how to retry", async () => {
  const app = setup();
  await app.click("开始录音");
  app.recordings[0].onerror();
  assert.match(app.alert(), /录音中断/);
  assert.equal(app.mic.stopped, 1);
  assert.equal(app.intervals.size, 0);
  assert.equal(app.recording.at(-1), false);
  assert.equal(app.changes.length, 0);
  app.unmount();
});
