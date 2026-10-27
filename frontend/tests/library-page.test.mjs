import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  await readFile(
    new URL("../src/pages/LibraryPage.tsx", import.meta.url),
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
const song = (id, instrumental = false) => ({
  id,
  title: `歌曲 ${id}`,
  kind: "create",
  status: "done",
  params: {
    style: instrumental ? "纯音乐，钢琴" : "中文民谣",
    lyrics: instrumental ? "[Instrumental]" : "[Verse]\n清晨的光",
  },
  artifacts: { audio: "audio.flac" },
  timing: { audio_seconds: 90 },
  created_at: "2026-10-27T00:00:00Z",
});
const text = (node) =>
  node == null || typeof node === "boolean"
    ? ""
    : typeof node !== "object"
      ? String(node)
      : Array.isArray(node)
        ? node.map(text).join("")
        : text(node.props?.children);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Execute the actual page and its handlers. Only API, player, and UI-library
// boundaries are replaced; a bubbled click follows the page's rendered tree.
function setup({
  jobs = [song("a"), song("b", true), song("c")],
  desktop = true,
} = {}) {
  const hooks = [],
    effects = [],
    intervals = new Map(),
    listeners = new Map();
  const requests = [],
    loads = [],
    plays = [],
    opened = [],
    removed = [],
    toasts = [];
  let cursor = 0,
    tree,
    component,
    scheduled = false,
    unmounted = false,
    timer = 0;
  let records = jobs.slice(),
    params = new URLSearchParams(),
    nextHeldDoneLoad = null;
  const player = {
    queue: jobs.slice(),
    current: jobs.at(-1),
    playing: false,
    play: (list, index) =>
      plays.push({ ids: list.map((job) => job.id), index }),
    toggle: () => plays.push("toggle"),
    remove(id) {
      removed.push(id);
      this.queue = this.queue.filter((job) => job.id !== id);
      if (this.current?.id === id) this.current = null;
    },
  };
  const overlay = {
    opened: false,
    jobId: "",
    open: (id) => opened.push(id),
    close() {
      this.opened = false;
    },
  };
  function schedule() {
    if (scheduled || unmounted) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!unmounted) render();
    });
  }
  function render() {
    cursor = 0;
    tree = component();
    for (const [slot, effect] of effects.splice(0)) {
      hooks[slot].cleanup?.();
      hooks[slot].cleanup = effect();
    }
  }
  const sameDeps = (a, b) =>
    a && b && a.length === b.length && b.every((v, i) => Object.is(v, a[i]));
  const react = {
    useState(initial) {
      const slot = cursor++;
      hooks[slot] ??= {
        value: typeof initial === "function" ? initial() : initial,
      };
      return [
        hooks[slot].value,
        (next) => {
          assert.equal(unmounted, false, "no state updates after unmount");
          const value =
            typeof next === "function" ? next(hooks[slot].value) : next;
          if (!Object.is(value, hooks[slot].value)) {
            hooks[slot].value = value;
            schedule();
          }
        },
      ];
    },
    useRef(value) {
      const slot = cursor++;
      hooks[slot] ??= { current: value };
      return hooks[slot];
    },
    useEffect(effect, deps) {
      const slot = cursor++,
        previous = hooks[slot];
      if (!sameDeps(previous?.deps, deps)) {
        hooks[slot] = { ...previous, deps };
        effects.push([slot, effect]);
      }
    },
    useMemo(factory, deps) {
      const slot = cursor++,
        previous = hooks[slot];
      if (!sameDeps(previous?.deps, deps))
        hooks[slot] = { value: factory(), deps };
      return hooks[slot].value;
    },
    useCallback(callback, deps) {
      return react.useMemo(() => callback, deps);
    },
  };
  const app = {
    status: { ffmpeg: true },
    toast: (...args) => toasts.push(args),
    refresh: async () => {},
  };
  const useApp = (select) => (select ? select(app) : app);
  useApp.getState = () => app;
  const usePlayer = (select) => (select ? select(player) : player);
  usePlayer.getState = () => player;
  const usePlayerOverlay = (select) => (select ? select(overlay) : overlay);
  usePlayerOverlay.getState = () => overlay;
  function deletion(ids, type) {
    const request = { ids: [...ids], type, ...deferred() };
    requests.push(request);
    return request.promise.then((result) => {
      const deleted = type === "single" ? ids : result?.deleted || [];
      records = records.filter((job) => !deleted.includes(job.id));
      return result;
    });
  }
  const emit = (name) => {
    for (const listener of listeners.get(name) || []) listener(new Event(name));
  };
  const context = {
    exports: {},
    Error,
    Event,
    URLSearchParams,
    AbortController,
    document: { getElementById: () => null },
    window: {
      setInterval(fn) {
        const id = ++timer;
        intervals.set(id, fn);
        return id;
      },
      clearInterval(id) {
        intervals.delete(id);
      },
      addEventListener(name, fn) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(fn);
      },
      removeEventListener(name, fn) {
        listeners.get(name)?.delete(fn);
      },
      dispatchEvent(event) {
        emit(event.type);
      },
    },
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
          useSearchParams: () => [
            params,
            (next) => {
              params = next;
              schedule();
            },
          ],
        };
      if (name === "@mantine/core")
        return {
          Checkbox: "Checkbox",
          SegmentedControl: "SegmentedControl",
          UnstyledButton: "UnstyledButton",
          Menu: Object.assign("Menu", {
            Target: "Menu.Target",
            Dropdown: "Menu.Dropdown",
            Item: "Menu.Item",
            Divider: "Menu.Divider",
          }),
        };
      if (name === "@mantine/hooks") return { useMediaQuery: () => desktop };
      if (name === "lucide-react")
        return new Proxy({}, { get: (_, key) => String(key) });
      if (name === "../lib/api")
        return {
          api: {
            async jobs(query = {}) {
              loads.push(plain(query));
              const states = (query.status || "done").split(",");
              const matching = records.filter(
                (job) =>
                  states.includes(job.status) &&
                  (!query.music_kind ||
                    (job.params.lyrics === "[Instrumental]"
                      ? "instrumental"
                      : "vocal") === query.music_kind),
              );
              const result = {
                jobs: matching.slice(
                  query.offset || 0,
                  (query.offset || 0) + (query.limit || 40),
                ),
                total: matching.length,
                summary: {
                  audio_seconds: matching.reduce(
                    (sum, job) => sum + job.timing.audio_seconds,
                    0,
                  ),
                },
              };
              if (query.status === "done" && nextHeldDoneLoad) {
                const held = nextHeldDoneLoad;
                nextHeldDoneLoad = null;
                held.snapshot = result;
                return held.promise;
              }
              return result;
            },
            job: async (id) => ({ job: records.find((job) => job.id === id) }),
            remove: (id) => deletion([id], "single"),
            batchRemoveSongs: (ids) => deletion(ids, "batch"),
            cancel: async () => ({ status: 202 }),
          },
        };
      if (name === "../lib/shareSong")
        return {
          songDownload: (job) => ({
            url: `/audio/${job.id}`,
            name: `${job.id}.mp3`,
          }),
        };
      if (name === "../lib/generationDetail")
        return {
          draftFromJob: (job) => ({
            musicKind:
              job.params.lyrics === "[Instrumental]" ? "instrumental" : "vocal",
          }),
        };
      if (name === "../lib/utils")
        return {
          duration: (n) => String(n),
          errorMessage: (e) => e.message || String(e),
          titleOf: (job) => job.title,
          when: () => "今天",
        };
      if (name === "../state/app") return { useApp };
      if (name === "../state/player") return { usePlayer };
      if (name === "../state/playerOverlay") return { usePlayerOverlay };
      if (name === "../components/ui")
        return {
          Artwork: "Artwork",
          Button: "Button",
          Dialog: "Dialog",
          EmptyState: "EmptyState",
          IconButton: "IconButton",
        };
      if (name === "../components/ShareSongDialog")
        return { ShareSongDialog: "ShareSongDialog" };
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected import ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  component = context.exports.LibraryPage;
  render();
  function nodes(node, parents = []) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node))
      return node.flatMap((child) => nodes(child, parents));
    return [
      { node, parents },
      ...nodes(node.props?.children, [...parents, node]),
    ];
  }
  const findAll = (predicate, root = tree) =>
    nodes(root)
      .map(({ node }) => node)
      .filter(predicate);
  const find = (predicate, root = tree) => {
    const node = findAll(predicate, root)[0];
    assert.ok(node, "expected rendered element");
    return node;
  };
  const button = (label, root = tree) =>
    find(
      (node) =>
        ["Button", "button"].includes(node.type) && text(node) === label,
      root,
    );
  function click(node) {
    const found = nodes(tree).find((entry) => entry.node === node);
    assert.ok(found, "click target is still rendered");
    if (node.props?.disabled) return;
    let stopped = false;
    const event = {
      stopPropagation() {
        stopped = true;
      },
      preventDefault() {},
      target: {},
      currentTarget: {},
    };
    for (const current of [node, ...found.parents.toReversed()]) {
      current.props?.onClick?.(event);
      if (stopped) break;
    }
  }
  function check(node) {
    if (node.props.disabled) return;
    node.props.onChange?.({
      currentTarget: { checked: !node.props.checked },
      target: { checked: !node.props.checked },
    });
    click(node);
  }
  return {
    find,
    findAll,
    button,
    click,
    check,
    requests,
    loads,
    plays,
    opened,
    removed,
    toasts,
    player,
    row: (id) => find((node) => node.props?.id === `song-${id}`),
    checkbox: (id) =>
      find(
        (node) =>
          node.type === "Checkbox" &&
          node.props?.["aria-label"] === `选择 歌曲 ${id}`,
      ),
    allCheckbox: () =>
      find(
        (node) =>
          node.type === "Checkbox" &&
          (node.props?.label === "全选" ||
            node.props?.["aria-label"] === "全选"),
      ),
    dialog: () => findAll((node) => node.type === "Dialog")[0],
    async manage() {
      click(button("管理"));
      await flush();
    },
    async select(id) {
      check(this.checkbox(id));
      await flush();
    },
    async askDelete() {
      click(find((node) => node.type === "Button" && /^删除/.test(text(node))));
      await flush();
    },
    confirm() {
      click(button("确认删除", this.dialog()));
    },
    setJobs(next) {
      records = next;
      emit("yue2:jobs-updated");
    },
    holdNextDoneLoad() {
      const held = deferred();
      nextHeldDoneLoad = held;
      return held;
    },
    poll() {
      for (const callback of intervals.values()) callback();
    },
    unmount() {
      unmounted = true;
      for (const hook of hooks) hook?.cleanup?.();
    },
  };
}

for (const desktop of [true, false]) {
  test(`management checkboxes, cover and title select exactly once without playback (${desktop ? "desktop" : "mobile"})`, async () => {
    const h = setup({ desktop });
    await flush();
    await h.manage();
    await h.select("a");
    assert.equal(
      h.checkbox("a").props.checked,
      true,
      "checkbox click must not also toggle the row",
    );
    h.click(
      h.find(
        (node) => node.props?.className === "simple-song-cover",
        h.row("b"),
      ),
    );
    await flush();
    assert.equal(h.checkbox("b").props.checked, true);
    h.click(
      h.find(
        (node) => node.props?.className === "simple-song-title",
        h.row("c"),
      ),
    );
    await flush();
    assert.equal(h.checkbox("c").props.checked, true);
    assert.deepEqual(h.plays, []);
    assert.deepEqual(h.opened, []);
    assert.equal(
      h.findAll((node) => node.props?.className === "simple-song-actions")
        .length,
      0,
    );
    assert.equal(h.allCheckbox().props.checked, true);
    h.check(h.allCheckbox());
    await flush();
    assert.equal(
      h.findAll((node) => node.type === "Checkbox" && node.props.checked)
        .length,
      0,
    );
    h.unmount();
  });
}

test("changing the music filter clears previous selection before showing new songs", async () => {
  const h = setup();
  await flush();
  await h.manage();
  await h.select("a");
  h.find(
    (node) => node.props?.["aria-label"] === "筛选音乐类型",
  ).props.onChange("instrumental");
  await flush();
  assert.equal(h.findAll((node) => node.props?.id === "song-a").length, 0);
  assert.ok(h.row("b"));
  assert.equal(
    h.findAll((node) => node.type === "Checkbox" && node.props.checked).length,
    0,
  );
  assert.equal(h.requests.length, 0);
  assert.equal(h.dialog(), undefined);
  h.unmount();
});

test("a failed delete preserves selected songs and the confirmation for deliberate retry", async () => {
  const h = setup();
  await flush();
  await h.manage();
  await h.select("a");
  await h.select("b");
  await h.askDelete();
  h.confirm();
  await flush();
  assert.deepEqual(h.requests[0].ids, ["a", "b"]);
  h.requests[0].reject(new Error("网络中断"));
  await flush();
  assert.ok(h.dialog());
  assert.equal(h.checkbox("a").props.checked, true);
  assert.equal(h.checkbox("b").props.checked, true);
  assert.deepEqual(h.removed, []);
  assert.equal(h.player.queue.length, 3);
  assert.ok(h.toasts.some(([message]) => message.includes("网络中断")));
  h.confirm();
  await flush();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[1].ids, ["a", "b"]);
  h.requests[1].resolve({ deleted: ["a", "b"], skipped: [] });
  await flush();
  h.unmount();
});

test("confirmation cannot close or submit twice while a deletion is in flight", async () => {
  const h = setup();
  await flush();
  await h.manage();
  await h.select("a");
  await h.askDelete();
  const confirm = h.button("确认删除", h.dialog());
  // Both events arrive before React has committed its busy state.
  confirm.props.onClick();
  confirm.props.onClick();
  await flush();
  assert.equal(h.requests.length, 1);
  h.dialog().props.onClose();
  assert.equal(h.button("取消", h.dialog()).props.disabled, true);
  assert.equal(h.button("完成").props.disabled, true);
  assert.equal(
    h.find((node) => node.props?.["aria-label"] === "筛选音乐类型").props
      .disabled,
    true,
  );
  h.click(h.button("取消", h.dialog()));
  await flush();
  assert.ok(h.dialog());
  h.requests[0].resolve(null);
  await flush();
  assert.equal(h.dialog(), undefined);
  assert.deepEqual(h.removed, ["a"]);
  h.unmount();
});

test("partial delete removes only confirmed IDs from the list and player queue", async () => {
  const h = setup();
  await flush();
  await h.manage();
  await h.select("a");
  await h.select("b");
  await h.askDelete();
  h.confirm();
  await flush();
  h.requests[0].resolve({ deleted: ["a"], skipped: ["b"] });
  await flush();
  assert.deepEqual(h.removed, ["a"]);
  assert.deepEqual(
    h.player.queue.map((job) => job.id),
    ["b", "c"],
  );
  assert.equal(h.player.current.id, "c");
  assert.equal(h.findAll((node) => node.props?.id === "song-a").length, 0);
  assert.ok(h.row("b"));
  assert.equal(
    h.checkbox("b").props.checked,
    true,
    "skipped songs remain selected",
  );
  h.unmount();
});

test("delete confirmation keeps its original jobs even if a background refresh changes the list", async () => {
  const h = setup();
  await flush();
  await h.manage();
  await h.select("a");
  await h.select("b");
  await h.askDelete();
  h.setJobs([{ ...song("a"), title: "刷新后的标题" }, song("c")]);
  await flush();
  assert.ok(text(h.dialog()).includes("歌曲 a"));
  assert.ok(text(h.dialog()).includes("歌曲 b"));
  assert.equal(text(h.dialog()).includes("刷新后的标题"), false);
  h.confirm();
  await flush();
  assert.deepEqual(h.requests[0].ids, ["a", "b"]);
  h.requests[0].resolve({ deleted: ["a"], skipped: ["b"] });
  await flush();
  assert.deepEqual(h.removed, ["a"]);
  h.unmount();
});

test("a later batch failure preserves only remaining selections and retries no successful deletion", async () => {
  const jobs = Array.from({ length: 205 }, (_, index) =>
    song(`retry-${index}`),
  );
  const h = setup({ jobs });
  await flush();
  while (
    h.findAll(
      (node) => node.type === "article" && /^song-/.test(node.props?.id || ""),
    ).length < jobs.length
  ) {
    h.click(h.button("查看更多"));
    await flush();
  }
  await h.manage();
  h.check(h.allCheckbox());
  await flush();
  await h.askDelete();
  h.confirm();
  await flush();
  h.requests[0].resolve({ deleted: h.requests[0].ids, skipped: [] });
  await flush();
  const remaining = jobs.slice(200).map((job) => job.id);
  assert.deepEqual(h.requests[1].ids, remaining);
  h.requests[1].reject(new Error("第二批连接失败"));
  await flush();
  assert.ok(h.dialog());
  assert.equal(h.removed.length, 200);
  assert.deepEqual(
    h.player.queue.map((job) => job.id),
    remaining,
  );
  for (const id of remaining) assert.equal(h.checkbox(id).props.checked, true);
  h.confirm();
  await flush();
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.requests[2].ids, remaining);
  h.requests[2].resolve({ deleted: remaining, skipped: [] });
  await flush();
  assert.equal(h.removed.length, 205);
  assert.equal(new Set(h.removed).size, 205);
  assert.equal(h.dialog(), undefined);
  h.unmount();
});

test("large selected collections respect the backend's 200-ID batch limit", async () => {
  const jobs = Array.from({ length: 205 }, (_, index) =>
    song(`track-${index}`),
  );
  const h = setup({ jobs });
  await flush();
  while (
    h.findAll(
      (node) => node.type === "article" && /^song-/.test(node.props?.id || ""),
    ).length < jobs.length
  ) {
    h.click(h.button("查看更多"));
    await flush();
  }
  await h.manage();
  h.check(h.allCheckbox());
  await flush();
  await h.askDelete();
  h.confirm();
  await flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].ids.length, 200);
  h.requests[0].resolve({ deleted: h.requests[0].ids, skipped: [] });
  await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].ids.length, 5);
  assert.equal(new Set(h.requests.flatMap((r) => r.ids)).size, 205);
  h.requests[1].resolve({ deleted: h.requests[1].ids, skipped: [] });
  await flush();
  assert.equal(h.removed.length, 205);
  assert.equal(h.dialog(), undefined);
  h.unmount();
});

test("a stale poll cannot restore deleted songs between batches, and fresh loads resume afterward", async () => {
  const jobs = Array.from({ length: 205 }, (_, index) => song(`race-${index}`));
  const h = setup({ jobs });
  await flush();
  while (
    h.findAll(
      (node) => node.type === "article" && /^song-/.test(node.props?.id || ""),
    ).length < jobs.length
  ) {
    h.click(h.button("查看更多"));
    await flush();
  }
  await h.manage();
  h.check(h.allCheckbox());
  await flush();
  await h.askDelete();

  // Start a real polling callback before deletion, then delay its pre-delete
  // response until batch one has succeeded and batch two is still pending.
  const oldPoll = h.holdNextDoneLoad();
  h.poll();
  await flush();
  assert.equal(oldPoll.snapshot.jobs.length, 205);
  h.confirm();
  await flush();
  h.requests[0].resolve({ deleted: h.requests[0].ids, skipped: [] });
  await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.removed.length, 200);

  oldPoll.resolve(oldPoll.snapshot);
  await flush();
  const remaining = jobs.slice(200).map((job) => job.id);
  assert.deepEqual(
    h
      .findAll(
        (node) =>
          node.type === "article" && /^song-/.test(node.props?.id || ""),
      )
      .map((node) => node.props.id.slice(5)),
    remaining,
    "the old response must not resurrect the first deleted batch",
  );
  for (const id of remaining) assert.equal(h.checkbox(id).props.checked, true);
  assert.deepEqual(
    h.player.queue.map((job) => job.id),
    remaining,
  );

  const loadsWhileBusy = h.loads.length;
  h.poll();
  await flush();
  assert.equal(
    h.loads.length,
    loadsWhileBusy,
    "polling pauses during deletion",
  );
  h.requests[1].resolve({ deleted: remaining, skipped: [] });
  await flush();
  assert.equal(
    h.findAll(
      (node) => node.type === "article" && /^song-/.test(node.props?.id || ""),
    ).length,
    0,
  );

  h.setJobs([song("fresh-result")]);
  await flush();
  assert.ok(
    h.row("fresh-result"),
    "a post-delete reload still updates the library",
  );
  assert.equal(
    h.findAll((node) => node.type === "Checkbox" && node.props.checked).length,
    0,
  );
  assert.equal(h.requests.length, 2);
  h.unmount();
});
