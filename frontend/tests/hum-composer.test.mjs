import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../src/components/HumComposer.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const creationCompiled = ts.transpileModule(
  await readFile(
    new URL("../src/lib/musicCreation.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;
const settle = async () => {
  await new Promise(setImmediate);
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

// Render the actual component with device/HTTP boundaries replaced. The sequence tests
// cover recording lifecycle races that a static markup assertion cannot catch.
function setup({
  available = true,
  adapter = "",
  getUserMedia,
  prepare,
  musicKind,
  instrumentalModels = true,
} = {}) {
  const hooks = [],
    effects = [],
    recordings = [],
    revoked = [],
    submissions = [],
    uploads = [],
    created = [],
    phases = [],
    intervals = new Map();
  let index = 0,
    tree,
    component,
    unmounted = false,
    timerId = 0,
    draftCalls = 0;
  const microphone = {
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
  const status = {
    hum: { available, adapters: adapter ? [adapter] : [] },
    memory: { machine_ram_gib: 16 },
    models: { present: true, precisions: ["4bit", "8bit"] },
    loras: {
      adapters: instrumentalModels
        ? ["ar_lora_inst_v3abc.bf16", "nar_lora_joint_v4.bf16"].map((name) => ({
            name,
            valid: true,
          }))
        : [],
    },
  };
  const render = () => {
    index = 0;
    tree = component({
      onCreated: (job) => created.push(job),
      onBusyChange: (busy) => phases.push(busy),
      musicKind,
    });
    const pending = effects.splice(0);
    for (const [slot, effect] of pending) {
      hooks[slot].cleanup?.();
      hooks[slot].cleanup = effect();
    }
  };
  const react = {
    useId() {
      index += 1;
      return "hum-file";
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
          assert.equal(unmounted, false, "no state updates after unmount");
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
    constructor(stream, opts) {
      this.stream = stream;
      this.mimeType = opts?.mimeType || "audio/webm";
      this.state = "inactive";
      recordings.push(this);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({
        data: new Blob(["test-audio"], { type: this.mimeType }),
      });
      this.onstop?.();
    }
  }
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    Blob,
    File,
    FormData,
    Error,
    AbortController,
    DOMException,
    navigator: {
      mediaDevices: { getUserMedia: getUserMedia || (async () => microphone) },
    },
    MediaRecorder: Recorder,
    URL: {
      createObjectURL: () => `blob:recording-${recordings.length}`,
      revokeObjectURL: (url) => revoked.push(url),
    },
    setInterval: (fn) => {
      intervals.set(++timerId, fn);
      return timerId;
    },
    clearInterval: (id) => intervals.delete(id),
    fetch: async (url, options) => {
      uploads.push({ url, options });
      return {
        ok: true,
        json: async () => ({ upload_id: "uploaded-hum", seconds: 12 }),
      };
    },
    require(name) {
      if (name.endsWith("/accountBoundary"))
        return {
          accountFetch: async (url, options) => {
            uploads.push({ url, options });
            return {
              ok: true,
              json: async () => ({ upload_id: "uploaded-hum", seconds: 12 }),
            };
          },
        };
      if (name === "react") return react;
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      if (name === "lucide-react")
        return new Proxy({}, { get: (_, key) => String(key) });
      if (name.endsWith("/api"))
        return {
          api: {
            status: async () => status,
            submit: async (body) => {
              submissions.push(body);
              return { job: { id: "new-hum-job" } };
            },
          },
        };
      if (name.endsWith("/musicCreation")) {
        const creation = { exports: {} };
        vm.runInNewContext(creationCompiled, {
          exports: creation.exports,
          module: creation,
          DOMException,
          Error,
          require(path) {
            if (path === "./api") return {};
            if (path === "./assistant")
              return {
                assistantApi: {
                  newSession: async () => ({ id: "session" }),
                  stop: async () => {},
                },
                streamMessage: async (_session, _body, options) =>
                  options.onEvent({
                    type: "done",
                    message: {
                      suggestion: {
                        title: "我的歌",
                        description: "温暖流行",
                        lyrics: "第一句歌词\n第二句歌词",
                      },
                    },
                  }),
              };
            throw new Error(`Unexpected import: ${path}`);
          },
        });
        return {
          ...creation.exports,
          prepareMusicDraft: async (...args) => {
            draftCalls += 1;
            return prepare
              ? prepare(...args)
              : creation.exports.prepareMusicDraft(...args);
          },
        };
      }
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  component = module.exports.HumComposer;
  render();
  const all = (node) =>
    !node || typeof node !== "object"
      ? []
      : Array.isArray(node)
        ? node.flatMap((entry) => all(entry))
        : [node, ...all(node.props?.children)];
  const find = (predicate) => {
    const node = all(tree).find(predicate);
    assert.ok(node, "expected element");
    return node;
  };
  return {
    microphone,
    recordings,
    revoked,
    submissions,
    uploads,
    created,
    phases,
    intervals,
    status,
    get draftCalls() {
      return draftCalls;
    },
    click: (label) =>
      find((n) => n.props?.["aria-label"] === label).props.onClick(),
    generate: () =>
      find((n) => n.props?.className === "hum-generate").props.onClick(),
    cancel: () =>
      find((n) => n.props?.className === "hum-cancel").props.onClick(),
    choose: (file = new File(["audio"], "hum.wav", { type: "audio/wav" })) =>
      find((n) => n.type === "input" && n.props.type === "file").props.onChange(
        { currentTarget: { files: [file], value: "" } },
      ),
    idea: (value) =>
      find((n) => n.props?.className === "hum-idea").props.onChange({
        currentTarget: { value },
      }),
    alert: () =>
      all(tree).find((n) => n.props?.role === "alert")?.props.children,
    audio: () => all(tree).find((n) => n.type === "audio"),
    unmount() {
      unmounted = true;
      for (const hook of hooks) hook?.cleanup?.();
    },
  };
}

test("recordings remain playable when models are missing, without an AI request", async () => {
  const app = setup({ available: false });
  app.choose();
  assert.ok(app.audio());
  app.generate();
  await settle();
  assert.match(app.alert(), /暂未启用/);
  assert.equal(app.draftCalls, 0);
  assert.equal(app.uploads.length, 0);
  assert.equal(app.submissions.length, 0);
  app.unmount();
  assert.equal(app.revoked.length, 1);
});

test("a recording generates a continuation with automatic lyrics and the installed adapter", async () => {
  const app = setup({ adapter: "hum_adapter_v1_combined" });
  await app.click("开始录音");
  await settle();
  assert.equal(app.recordings[0].state, "recording");
  app.click("结束录音");
  assert.ok(app.audio());
  assert.equal(app.microphone.stopped, 1);
  app.generate();
  await settle();
  assert.equal(app.submissions.length, 1);
  const sent = app.submissions[0];
  assert.equal(sent.kind, "hum");
  assert.equal(sent.preset, "custom");
  assert.equal(sent.precision, "4bit");
  assert.equal(sent.ode_steps, 8);
  assert.equal(sent.params.upload_id, "uploaded-hum");
  assert.equal(sent.params.adapter, "hum_adapter_v1_combined");
  assert.equal(sent.params.melody, "continue");
  assert.equal(sent.params.lyrics, "第一句歌词\n第二句歌词");
  assert.equal(app.uploads[0].options.body.get("file").name, "我的哼唱.m4a");
  assert.equal(app.created[0].id, "new-hum-job");
  app.unmount();
});

test("score continuation works without the optional prosody adapter", async () => {
  const app = setup();
  app.choose();
  app.generate();
  await settle();
  assert.equal(app.submissions[0].params.adapter, null);
  app.unmount();
});

for (const musicKind of ["instrumental", "vocal"]) {
  test(`a hum generates ${musicKind} while retaining its uploaded melody and influence`, async () => {
    const app = setup({ musicKind, adapter: "hum_adapter_v1_combined" });
    app.choose();
    app.idea(
      musicKind === "vocal" ? "安静的钢琴纯音乐，无人声" : "温柔的人声情歌",
    );
    app.generate();
    await settle();
    assert.equal(app.submissions.length, 1);
    const sent = app.submissions[0];
    assert.equal(sent.kind, "hum");
    assert.equal(sent.params.upload_id, "uploaded-hum");
    assert.equal(sent.params.melody, "continue");
    assert.equal(sent.params.adapter, "hum_adapter_v1_combined");
    assert.equal(sent.params.hum_influence, 1);
    assert.equal(sent.params.offset_s, 0);
    assert.equal(sent.precision, "4bit");
    if (musicKind === "instrumental") {
      assert.equal(sent.params.lyrics, "[Intro]");
      assert.deepEqual(
        Array.from(sent.loras, ({ name }) => name),
        ["ar_lora_inst_v3abc.bf16", "nar_lora_joint_v4.bf16"],
      );
    } else {
      assert.equal(sent.params.lyrics, "第一句歌词\n第二句歌词");
      assert.equal(sent.loras.length, 0);
      assert.match(sent.params.style, /人声演唱，带歌词/);
    }
    app.unmount();
  });
}

test("humming keeps its recording and reports unavailable instrumental models without submitting vocals", async () => {
  const app = setup({ musicKind: "instrumental", instrumentalModels: false });
  app.choose();
  app.generate();
  await settle();
  assert.match(app.alert(), /纯音乐模型尚未就绪/);
  assert.equal(app.submissions.length, 0);
  assert.ok(app.audio());
  app.unmount();
});

test("canceling a pending permission request cannot tear down a later recording", async () => {
  const oldPermission = deferred();
  const newMic = {
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
  let calls = 0;
  const app = setup({
    getUserMedia: () =>
      ++calls === 1 ? oldPermission.promise : Promise.resolve(newMic),
  });
  app.click("开始录音");
  app.cancel();
  await app.click("开始录音");
  const rejected = new Error("denied");
  rejected.name = "NotAllowedError";
  oldPermission.reject(rejected);
  await settle();
  assert.equal(newMic.stopped, 0);
  assert.equal(app.recordings[0].state, "recording");
  app.unmount();
  assert.equal(newMic.stopped, 1);
  assert.equal(app.intervals.size, 0);
});

test("unmount stops a microphone whose permission resolves late", async () => {
  const permission = deferred();
  const mic = {
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
  const app = setup({ getUserMedia: () => permission.promise });
  app.click("开始录音");
  app.unmount();
  permission.resolve(mic);
  await settle();
  assert.equal(mic.stopped, 1);
  assert.equal(app.recordings.length, 0);
});

test("canceling AI preparation keeps the recording and prevents job submission", async () => {
  const draft = deferred();
  let signal;
  const app = setup({
    prepare: (_prompt, options) => {
      signal = options.signal;
      return draft.promise;
    },
  });
  app.choose();
  app.generate();
  await settle();
  app.cancel();
  assert.equal(signal.aborted, true);
  draft.resolve({
    title: "晚到的歌词",
    description: "流行",
    lyrics: "第一句歌词\n第二句歌词",
  });
  await settle();
  assert.equal(app.submissions.length, 0);
  assert.ok(app.audio());
  app.unmount();
});
