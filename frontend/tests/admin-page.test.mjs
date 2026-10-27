import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compile = async (file) =>
  ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const pageSource = await compile("../src/pages/AdminPage.tsx");
const apiSource = await compile("../src/lib/admin.ts");
const flush = () => new Promise(setImmediate);
const user = (id = "a") => ({
  id,
  email: `${id}@example.com`,
  is_admin: false,
  legacy_owner: false,
  created_at: 1700000000,
  last_login: null,
  active: 1,
  stats: {
    jobs_total: 1,
    done: 1,
    failed: 0,
    running: 0,
    queued: 0,
    cancelled: 0,
    audio_seconds: 60,
    last_created_at: null,
  },
});
const job = (id = "song-a") => ({
  id,
  title: id,
  kind: "create",
  status: "done",
  music_kind: "vocal",
  params: { style: "民谣", lyrics: "[Verse]\n清晨的风" },
  timing: { audio_seconds: 60 },
  created_at: "2026-10-27T00:00:00Z",
  audio_url: `/api/admin/users/a/jobs/${id}/audio`,
  download_url: `/api/admin/users/a/jobs/${id}/audio?download=1`,
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const children = (node) =>
  Array.isArray(node) ? node : node && typeof node === "object" ? [node] : [];
function walk(node, predicate) {
  for (const item of children(node)) {
    if (predicate(item)) return item;
    const found = walk(item.props?.children, predicate);
    if (found) return found;
  }
}
const text = (node) =>
  node == null || typeof node === "boolean"
    ? ""
    : Array.isArray(node)
      ? node.map(text).join("")
      : typeof node === "object"
        ? text(node.props?.children)
        : String(node);

// Run the real page functions and request helper. React's scheduling and the
// network/audio boundaries are controlled, so stale responses can be released
// in an order that a normal successful page load would not exercise.
function setup(
  name,
  { props = {}, auth = { id: "admin", is_admin: true }, handle } = {},
) {
  const hooks = [],
    effects = [],
    requests = [],
    audioCalls = [];
  let cursor = 0,
    tree,
    scheduled = false,
    closed = false;
  const audio = {
    pause: () => audioCalls.push("pause"),
    removeAttribute: (name) => audioCalls.push(`remove:${name}`),
    load: () => audioCalls.push("load"),
  };
  const api = {
    get(path) {
      requests.push(path);
      if (handle) return handle(path);
      if (path === "/api/admin/overview")
        return Promise.resolve({
          users_total: 41,
          songs_total: 60,
          users_active_1d: 3,
          job_totals: {},
        });
      if (/\/users\?/.test(path))
        return Promise.resolve({ users: [user()], total: 41 });
      if (/\/jobs\?/.test(path))
        return Promise.resolve({ jobs: [job()], total: 41 });
      return Promise.resolve({ user: user() });
    },
  };
  const apiModule = { exports: {} };
  vm.runInNewContext(apiSource, {
    module: apiModule,
    exports: apiModule.exports,
    URLSearchParams,
    require: () => ({ api }),
  });
  function schedule() {
    if (scheduled || closed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!closed) render();
    });
  }
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const slot = cursor++;
      hooks[slot] ??= {
        value: typeof initial === "function" ? initial() : initial,
      };
      return [
        hooks[slot].value,
        (next) => {
          assert.equal(closed, false, "no state updates after unmount");
          const value =
            typeof next === "function" ? next(hooks[slot].value) : next;
          if (!Object.is(value, hooks[slot].value)) {
            hooks[slot].value = value;
            schedule();
          }
        },
      ];
    },
    useRef(current) {
      const slot = cursor++;
      return (hooks[slot] ??= { current });
    },
    useEffect(effect, deps) {
      const slot = cursor++;
      if (!same(hooks[slot]?.deps, deps)) {
        hooks[slot] = { ...hooks[slot], deps };
        effects.push([slot, effect]);
      }
    },
  };
  const Table = Object.assign("Table", {
    Thead: "Thead",
    Tbody: "Tbody",
    Tr: "Tr",
    Th: "Th",
    Td: "Td",
  });
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    Error,
    URLSearchParams,
    require(path) {
      if (path === "react") return react;
      if (path === "react/jsx-runtime")
        return {
          jsx: (type, props, key) => ({ type, props, key }),
          jsxs: (type, props, key) => ({ type, props, key }),
        };
      if (path === "@mantine/hooks")
        return {
          useMediaQuery: () => false,
          useDebouncedValue: (value) => [value],
        };
      if (path === "@mantine/core")
        return new Proxy(
          { Table },
          { get: (target, prop) => target[prop] || prop },
        );
      if (path === "lucide-react")
        return new Proxy({}, { get: (_, prop) => prop });
      if (path === "../state/auth")
        return { useAuth: (select) => select({ user: auth }) };
      if (path === "../state/player")
        return {
          usePlayer: {
            getState: () => ({
              pause: () => audioCalls.push("personal:pause"),
            }),
          },
        };
      if (path === "../lib/admin") return apiModule.exports;
      if (path.endsWith(".css")) return {};
      throw new Error(`Unexpected import ${path}`);
    },
  };
  vm.runInNewContext(pageSource, context);
  function render() {
    cursor = 0;
    tree = context[name](props);
    const media = walk(tree, (node) => node.type === "audio");
    if (media?.props.ref) media.props.ref.current = audio;
    for (const [slot, effect] of effects.splice(0)) {
      hooks[slot].cleanup?.();
      hooks[slot].cleanup = effect();
    }
  }
  render();
  return {
    requests,
    audioCalls,
    get tree() {
      return tree;
    },
    find(predicate) {
      const found = walk(tree, predicate);
      assert.ok(found, "expected rendered control");
      return found;
    },
    field(label) {
      return this.find((node) => node.props?.["aria-label"] === label);
    },
    async changeProps(next) {
      props = next;
      render();
      await flush();
    },
    unmount() {
      hooks.forEach((hook) => hook.cleanup?.());
      closed = true;
    },
  };
}

test("non-admin accounts cannot render the console or start admin requests", () => {
  for (const auth of [null, { id: "member", is_admin: false }]) {
    const h = setup("AdminPage", { auth });
    assert.match(text(h.tree), /仅管理员可访问/);
    assert.equal(h.requests.length, 0);
    h.unmount();
  }
});

test("switching the signed-in administrator remounts all console data", () => {
  const a = setup("AdminPage", { auth: { id: "admin-a", is_admin: true } });
  const b = setup("AdminPage", { auth: { id: "admin-b", is_admin: true } });
  assert.equal(a.tree.key, "admin-a");
  assert.equal(b.tree.key, "admin-b");
});

test("user search resets pagination and encodes query text", async () => {
  const h = setup("AdminConsole");
  await flush();
  h.find((node) => node.type?.name === "Pager").props.onChange(2);
  await flush();
  assert.ok(h.requests.some((path) => path.includes("offset=20")));
  h.field("搜索用户").props.onChange({
    currentTarget: { value: "a+b@example.com" },
  });
  await flush();
  const query = new URL(h.requests.at(-1), "http://localhost").searchParams;
  assert.equal(query.get("q"), "a+b@example.com");
  assert.equal(query.get("offset"), "0");
  h.unmount();
});

test("a slower previous user's response cannot replace the selected user's data", async () => {
  const firstUser = deferred(),
    firstJobs = deferred();
  const h = setup("UserDetail", {
    props: { userId: "a", reload: 0 },
    handle: (path) => {
      if (path === "/api/admin/users/a") return firstUser.promise;
      if (path.startsWith("/api/admin/users/a/jobs?")) return firstJobs.promise;
      if (path.includes("/jobs?"))
        return Promise.resolve({ jobs: [job("song-b")], total: 1 });
      return Promise.resolve({ user: user("b") });
    },
  });
  await h.changeProps({ userId: "b", reload: 0 });
  assert.ok(
    h.find((node) => node.type?.name === "AccountIdentity").props.user.id ===
      "b",
  );
  firstUser.resolve({ user: user("a") });
  firstJobs.resolve({ jobs: [job("song-a")], total: 1 });
  await flush();
  assert.equal(
    h.find((node) => node.type?.name === "AccountIdentity").props.user.id,
    "b",
  );
  assert.match(text(h.tree), /song-b/);
  assert.doesNotMatch(text(h.tree), /song-a/);
  h.unmount();
});

test("generation filters reset pagination and ignore obsolete records", async () => {
  const oldJobs = deferred();
  const h = setup("UserDetail", {
    props: { userId: "a", reload: 0 },
    handle: (path) => {
      if (!path.includes("/jobs?")) return Promise.resolve({ user: user() });
      if (!path.includes("status=failed")) return oldJobs.promise;
      return Promise.resolve({
        jobs: [{ ...job("failed-song"), status: "failed", audio_url: null }],
        total: 1,
      });
    },
  });
  await flush();
  h.field("筛选生成状态").props.onChange("failed");
  await flush();
  assert.ok(h.requests.at(-1).includes("status=failed"));
  assert.ok(h.requests.at(-1).includes("offset=0"));
  oldJobs.resolve({ jobs: [job("obsolete-song")], total: 1 });
  await flush();
  assert.match(text(h.tree), /failed-song/);
  assert.doesNotMatch(text(h.tree), /obsolete-song/);
  h.unmount();
});

test("song preview uses tenant-scoped media and releases it on unmount", () => {
  const h = setup("JobDetail", { props: { job: job() } });
  const audio = h.find((node) => node.type === "audio");
  assert.equal(audio.props.src, "/api/admin/users/a/jobs/song-a/audio");
  assert.equal(
    h.find((node) => node.props?.component === "a").props.href,
    "/api/admin/users/a/jobs/song-a/audio?download=1",
  );
  audio.props.onPlay?.();
  assert.ok(h.audioCalls.includes("personal:pause"));
  h.unmount();
  assert.deepEqual(h.audioCalls.slice(-3), ["pause", "remove:src", "load"]);
});

test("closing a user detail ignores requests that finish after unmount", async () => {
  const pending = deferred();
  const h = setup("UserDetail", {
    props: { userId: "a", reload: 0 },
    handle: () => pending.promise,
  });
  h.unmount();
  pending.resolve({ user: user(), jobs: [job()], total: 1 });
  await flush();
});
