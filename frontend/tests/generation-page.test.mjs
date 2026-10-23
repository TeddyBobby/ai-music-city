import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  await readFile(
    new URL("../src/pages/GenerationPage.tsx", import.meta.url),
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
const flush = () => new Promise(setImmediate);
const plain = (value) => JSON.parse(JSON.stringify(value));
const song = (status = "done", extra = {}) => ({
  id: "music-1",
  title: "原来的歌",
  status,
  kind: "create",
  params: { style: "温暖钢琴", lyrics: "[Verse]\n清晨的光", title: "原来的歌" },
  artifacts: status === "done" ? { audio: "audio.flac" } : {},
  timing: { audio_seconds: 25 },
  ...extra,
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// The page's hooks, event handlers, draft persistence and conditional rendering
// are real. Transport and engine boundaries are inert, controllable stand-ins.
function setup({ storage = new Map() } = {}) {
  const hooks = [],
    effects = [],
    observers = [],
    submissions = [],
    navigations = [];
  const canceled = [],
    plays = [],
    seeks = [],
    dispatched = [],
    intervals = new Map();
  let cursor = 0,
    tree,
    component,
    unmounted = false,
    timerId = 0,
    refreshes = 0;
  const player = {
    current: null,
    playing: false,
    time: 0,
    duration: 0,
    play: (jobs) => plays.push(jobs),
    toggle: () => plays.push("toggle"),
    seekTo: (job, seconds) => seeks.push({ job, seconds }),
  };
  function render() {
    cursor = 0;
    tree = component({ id: "music-1" });
    for (const [slot, effect] of effects.splice(0)) {
      hooks[slot].cleanup?.();
      hooks[slot].cleanup = effect();
    }
  }
  const react = {
    useRef(value) {
      const slot = cursor++;
      hooks[slot] ??= { current: value };
      return hooks[slot];
    },
    useState(value) {
      const slot = cursor++;
      hooks[slot] ??= { value: typeof value === "function" ? value() : value };
      return [
        hooks[slot].value,
        (next) => {
          assert.equal(unmounted, false, "no page state updates after unmount");
          const updated =
            typeof next === "function" ? next(hooks[slot].value) : next;
          if (Object.is(updated, hooks[slot].value)) return;
          hooks[slot].value = updated;
          render();
        },
      ];
    },
    useEffect(effect, deps) {
      const slot = cursor++,
        previous = hooks[slot];
      if (
        !previous ||
        deps.some((dep, index) => dep !== previous.deps[index])
      ) {
        hooks[slot] = { ...previous, deps };
        effects.push([slot, effect]);
      }
    },
  };
  const useApp = (select) => select({ status: { ffmpeg: true } });
  useApp.getState = () => ({
    refresh: async () => {
      refreshes++;
    },
  });
  const context = {
    exports: {},
    Error,
    AbortController,
    Event,
    setInterval(fn) {
      const id = ++timerId;
      intervals.set(id, fn);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    window: { dispatchEvent: (event) => dispatched.push(event.type) },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      if (name === "react-router-dom")
        return {
          Link: "Link",
          useNavigate: () => (path) => navigations.push(path),
          useParams: () => ({ id: "music-1" }),
        };
      if (name === "lucide-react")
        return new Proxy({}, { get: (_, key) => String(key) });
      if (name === "../lib/api")
        return {
          api: {
            get: async () => ({ jobs: [] }),
            cancel: async (id) => {
              canceled.push(id);
              return { status: 202 };
            },
          },
        };
      if (name === "../lib/generationWatch")
        return {
          isGenerating: (job) => ["queued", "running"].includes(job.status),
          watchGeneration(id, callbacks) {
            const observer = {
              id,
              callbacks,
              closed: false,
              refreshes: 0,
              close() {
                this.closed = true;
              },
              refresh() {
                this.refreshes++;
              },
            };
            observers.push(observer);
            return observer;
          },
        };
      if (name === "../lib/generationDetail")
        return {
          draftFromJob: (job) => ({
            title: job.title,
            style: job.params.style,
            lyrics: job.params.lyrics,
            musicKind: "vocal",
          }),
          generationProgress: (job) => ({
            title: job.status === "done" ? "音乐已完成" : "正在生成",
            description: "当前生成状态",
            steps: [],
          }),
          submitRevision(job, draft, options) {
            const submission = {
              job,
              draft: plain(draft),
              options,
              ...deferred(),
            };
            submissions.push(submission);
            return submission.promise;
          },
        };
      if (name === "../lib/shareSong")
        return {
          songDownload: (job) => ({
            url: `/api/songs/${job.id}/audio.mp3`,
            name: "音乐.mp3",
          }),
        };
      if (name === "../lib/utils")
        return {
          duration: (v) => `${v || 0} 秒`,
          errorMessage: (e) => e.message || String(e),
          titleOf: (job) => job.title,
          when: () => "今天",
        };
      if (name === "../state/app") return { useApp };
      if (name === "../state/player") return { usePlayer: () => player };
      if (name === "../components/ui") return { Artwork: "Artwork" };
      if (name === "../components/MusicKindToggle")
        return { MusicKindToggle: "MusicKindToggle" };
      if (name === "../components/ShareSongDialog")
        return { ShareSongDialog: "ShareSongDialog" };
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected import ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  component = context.exports.GenerationPage().type;
  render();
  const all = (node) =>
    !node || typeof node !== "object"
      ? []
      : Array.isArray(node)
        ? node.flatMap(all)
        : [node, ...all(node.props?.children)];
  const findAll = (predicate) => all(tree).filter(predicate);
  const find = (predicate) => {
    const node = findAll(predicate)[0];
    assert.ok(node, "expected element");
    return node;
  };
  const field = (name) =>
    find(
      (node) =>
        node.props?.maxLength ===
        { title: 160, style: 2000, lyrics: 10000 }[name],
    );
  return {
    observers,
    submissions,
    navigations,
    canceled,
    plays,
    seeks,
    storage,
    findAll,
    find,
    field: (name) => field(name).props.value,
    edit(name, value) {
      field(name).props.onChange({ target: { value } });
    },
    push(job) {
      const observer = observers.at(-1);
      if (!observer.closed) observer.callbacks.onJob(job);
    },
    submit() {
      return find((node) => node.type === "form").props.onSubmit({
        preventDefault() {},
      });
    },
    unmount() {
      unmounted = true;
      for (const hook of hooks) hook?.cleanup?.();
    },
    player,
  };
}

test("edited drafts survive live progress updates and a page refresh without changing the original job", async () => {
  const storage = new Map();
  const h = setup({ storage });
  const original = song("running");
  h.push(original);
  h.edit("title", "新版的歌名");
  h.edit("style", "更舒缓的木吉他");
  h.edit("lyrics", "[Verse]\n新的歌词");
  h.push({ ...original, progress: { stage: "decode" } });
  assert.equal(h.field("style"), "更舒缓的木吉他");
  assert.equal(h.field("title"), "新版的歌名");
  assert.equal(original.params.style, "温暖钢琴");
  assert.equal(
    h.find((node) => node.props?.className === "generation-submit").props
      .disabled,
    true,
  );
  h.unmount();
  const refreshed = setup({ storage });
  refreshed.push(song());
  await flush();
  assert.equal(refreshed.field("title"), "新版的歌名");
  assert.equal(refreshed.field("style"), "更舒缓的木吉他");
  assert.equal(refreshed.field("lyrics"), "[Verse]\n新的歌词");
  assert.equal(
    refreshed.find((node) => node.props?.className === "generation-submit")
      .props.disabled,
    false,
  );
  refreshed.unmount();
});

test("a fast repeated revision submit creates one version and navigates to its returned id", async () => {
  const h = setup();
  h.push(song());
  h.edit("style", "更有氛围的钢琴");
  const first = h.submit();
  const duplicate = h.submit();
  assert.equal(h.submissions.length, 1);
  assert.equal(h.submissions[0].draft.style, "更有氛围的钢琴");
  assert.equal(h.find((node) => node.type === "fieldset").props.disabled, true);
  h.submissions[0].resolve(song("queued", { id: "new-version" }));
  await Promise.all([first, duplicate]);
  assert.deepEqual(h.navigations, ["/generation/new-version"]);
  h.unmount();
});

test("failed revision keeps the edited draft available for a deliberate retry", async () => {
  const h = setup();
  h.push(song("failed"));
  h.edit("style", "稀疏、温柔的钢琴");
  const sending = h.submit();
  h.submissions[0].reject(new Error("音乐模型尚未就绪"));
  await sending;
  assert.equal(h.field("style"), "稀疏、温柔的钢琴");
  assert.equal(
    h.find((node) => node.props?.className === "generation-submit").props
      .disabled,
    false,
  );
  assert.equal(
    h.find((node) => node.props?.className === "generation-action-error").props
      .children,
    "音乐模型尚未就绪",
  );
  assert.deepEqual(h.navigations, []);
  h.unmount();
});

test("leaving a running generation closes its observer without canceling the task", async () => {
  const h = setup();
  h.push(song("running"));
  h.unmount();
  await flush();
  assert.equal(h.observers[0].closed, true);
  assert.deepEqual(h.canceled, []);
  assert.deepEqual(h.submissions, []);
});

test("leaving during revision aborts preparation and a late submission response cannot navigate the old page", async () => {
  const h = setup();
  h.push(song());
  const sending = h.submit();
  h.unmount();
  assert.equal(h.submissions[0].options.signal.aborted, true);
  h.submissions[0].resolve(song("queued", { id: "late-version" }));
  await sending;
  assert.deepEqual(h.navigations, []);
  assert.deepEqual(h.canceled, []);
});

test("play, seek, download and share controls appear only for a completed result with audio", async () => {
  const h = setup();
  for (const candidate of [
    song("queued"),
    song("running"),
    song("failed"),
    song("cancelled"),
    song("done", { artifacts: {} }),
  ]) {
    h.push(candidate);
    assert.equal(
      h.findAll((node) => node.props?.className === "generation-player").length,
      0,
    );
    assert.equal(
      h.findAll((node) => node.props?.className === "generation-result-actions")
        .length,
      0,
    );
  }
  const complete = song();
  h.push(complete);
  h.find((node) => node.props?.["aria-label"] === "播放这一版").props.onClick();
  assert.deepEqual(plain(h.plays), [[complete]]);
  h.find(
    (node) => node.props?.["aria-label"] === "这一版播放进度",
  ).props.onChange({ target: { value: "12.5" } });
  assert.equal(h.seeks[0].job.id, complete.id);
  assert.equal(h.seeks[0].seconds, 12.5);
  assert.equal(
    h.findAll((node) => node.props?.className === "generation-result-actions")
      .length,
    1,
  );
  h.unmount();
  await flush();
});
