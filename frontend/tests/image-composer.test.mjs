import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compile = async (path) =>
  ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const componentCode = await compile("../src/components/ImageComposer.tsx");
const creationCode = await compile("../src/lib/imageMusic.ts");
const mood = {
  title: "山间薄雾",
  summary: "阳光穿过山林间的晨雾。",
  mood: "宁静温暖",
  style: "Warm piano, airy strings, slow pace",
};
const response = (value = mood, ok = true) => ({
  ok,
  json: async () => value,
});
const settle = () => new Promise(setImmediate);
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Exercise real selection, image analysis and request lifecycle code. Only the
// browser/HTTP and downstream music-engine boundaries are replaced.
function setup({
  recognize = async () => response(),
  kind = "instrumental",
} = {}) {
  const hooks = [],
    effects = [],
    requests = [],
    submissions = [],
    created = [],
    revoked = [],
    busyStates = [];
  let cursor = 0,
    tree,
    component,
    unmounted = false,
    nextBlob = 0;
  function render() {
    cursor = 0;
    tree = component({
      musicKind: kind,
      onCreated: (job) => created.push(job),
      onBusyChange: (busy) => busyStates.push(busy),
    });
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
      hooks[slot] ??= { value };
      return [
        hooks[slot].value,
        (next) => {
          assert.equal(unmounted, false, "no state updates after unmount");
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
  const creation = { exports: {} };
  vm.runInNewContext(creationCode, {
    exports: creation.exports,
    module: creation,
    Error,
    DOMException,
    FormData,
    fetch: (url, options) => {
      requests.push({ url, options });
      return recognize(url, options);
    },
    require(name) {
      if (name === "./accountBoundary")
        return {
          accountFetch: (url, options) => {
            requests.push({ url, options });
            return recognize(url, options);
          },
        };
      assert.equal(name, "./musicCreation");
      return {
        generateFromSuggestion: async (draft, options) => {
          submissions.push({ draft, options, path: "suggestion" });
          return { id: "image-job" };
        },
        generateFromPrompt: async (prompt, options) => {
          submissions.push({ prompt, options, path: "prompt" });
          return { id: "image-job" };
        },
      };
    },
  });
  const module = { exports: {} };
  vm.runInNewContext(componentCode, {
    exports: module.exports,
    module,
    Error,
    AbortController,
    URL: {
      createObjectURL: () => `blob:image-${++nextBlob}`,
      revokeObjectURL: (url) => revoked.push(url),
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
      if (name === "../lib/imageMusic") return creation.exports;
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  component = module.exports.ImageComposer;
  render();
  const all = (node) =>
    !node || typeof node !== "object"
      ? []
      : Array.isArray(node)
        ? node.flatMap(all)
        : [node, ...all(node.props?.children)];
  const find = (predicate) => {
    const node = all(tree).find(predicate);
    assert.ok(node, "expected element");
    return node;
  };
  return {
    requests,
    submissions,
    created,
    revoked,
    busyStates,
    choose(file = new File(["image"], "forest.jpg", { type: "image/jpeg" })) {
      find((node) => node.props?.type === "file").props.onChange({
        currentTarget: { files: [file], value: "" },
      });
    },
    description(value) {
      find(
        (node) => node.props?.className === "image-music-description",
      ).props.onChange({
        target: { value },
      });
    },
    generate() {
      find((node) => node.type === "form").props.onSubmit({
        preventDefault() {},
      });
    },
    cancel() {
      find((node) => node.props?.className === "image-cancel").props.onClick();
    },
    preview: () => all(tree).find((node) => node.type === "img")?.props.src,
    alert: () =>
      all(tree).find((node) => node.props?.role === "alert")?.props.children,
    changeKind(next) {
      kind = next;
      render();
    },
    unmount() {
      unmounted = true;
      for (const hook of hooks) hook?.cleanup?.();
    },
  };
}

test("failed image recognition retains the picture and description for a successful retry", async () => {
  let attempts = 0;
  const app = setup({
    recognize: async () =>
      ++attempts === 1
        ? response({ error: { message: "图片识别暂不可用" } }, false)
        : response(),
  });
  app.choose();
  const preview = app.preview();
  app.description("木吉他、温暖一点");
  app.generate();
  await settle();
  assert.match(app.alert(), /暂不可用/);
  assert.equal(app.submissions.length, 0);
  assert.equal(app.preview(), preview);
  assert.equal(app.busyStates.at(-1), false);
  app.generate();
  await settle();
  assert.equal(
    app.requests[1].options.body.get("description"),
    "木吉他、温暖一点",
  );
  assert.equal(app.requests[1].options.body.get("file").name, "forest.jpg");
  assert.equal(app.submissions.length, 1);
  assert.equal(app.created[0].id, "image-job");
  app.unmount();
});

test("canceling image analysis prevents music submission even if recognition resolves later", async () => {
  const pending = deferred();
  const app = setup({ recognize: () => pending.promise });
  app.choose();
  app.generate();
  app.cancel();
  assert.equal(app.requests[0].options.signal.aborted, true);
  pending.resolve(response());
  await settle();
  assert.equal(app.submissions.length, 0);
  assert.equal(app.created.length, 0);
  assert.equal(app.alert(), undefined);
  assert.ok(app.preview());
  assert.equal(app.busyStates.at(-1), false);
  app.unmount();
});

test("repeated submit uses one analysis and snapshots the selected music type", async () => {
  const pending = deferred();
  const app = setup({ recognize: () => pending.promise, kind: "instrumental" });
  app.choose();
  app.generate();
  app.generate();
  app.changeKind("vocal");
  app.generate();
  assert.equal(app.requests.length, 1);
  pending.resolve(response());
  await settle();
  assert.equal(app.submissions.length, 1);
  assert.equal(app.submissions[0].options.musicKind, "instrumental");
  assert.equal(app.submissions[0].path, "suggestion");
  assert.equal(app.created.length, 1);
  app.unmount();
});

test("leaving image creation aborts analysis and releases its preview without a stale job", async () => {
  const pending = deferred();
  const app = setup({ recognize: () => pending.promise });
  app.choose();
  const preview = app.preview();
  app.generate();
  app.unmount();
  assert.equal(app.requests[0].options.signal.aborted, true);
  assert.deepEqual(app.revoked, [preview]);
  pending.resolve(response());
  await settle();
  assert.equal(app.submissions.length, 0);
  assert.equal(app.created.length, 0);
  assert.equal(app.busyStates.at(-1), false);
});
