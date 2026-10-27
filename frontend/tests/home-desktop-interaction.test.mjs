import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  await readFile(new URL("../src/pages/HomePage.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;

const promptContext = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    await readFile(
      new URL("../src/lib/musicPrompt.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText,
  promptContext,
);
const shortcutContext = {
  exports: {},
  requestAnimationFrame: (callback) => callback(),
  require(name) {
    if (name === "react/jsx-runtime")
      return {
        jsx: (type, props) => ({ type, props }),
        jsxs: (type, props) => ({ type, props }),
      };
    if (name === "@mantine/core") return { UnstyledButton: "UnstyledButton" };
    if (name === "../lib/musicPrompt") return promptContext.exports;
    if (name.endsWith(".css")) return {};
    throw new Error(`Unexpected shortcut import: ${name}`);
  },
};
vm.runInNewContext(
  ts.transpileModule(
    await readFile(
      new URL("../src/components/MusicPromptShortcuts.tsx", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText,
  shortcutContext,
);

function setup({ authenticated = true } = {}) {
  const hooks = [],
    effects = [],
    submissions = [],
    navigations = [];
  let cursor = 0,
    tree,
    component,
    submitEvents = 0;
  function render() {
    cursor = 0;
    tree = component();
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
  const useApp = { getState: () => ({ refresh: async () => {} }) };
  const context = {
    exports: {},
    AbortController,
    URLSearchParams,
    sessionStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame: (fn) => fn(),
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
          useSearchParams: () => [new URLSearchParams(), () => {}],
        };
      if (name === "lucide-react")
        return new Proxy({}, { get: (_, key) => String(key) });
      if (name === "../state/app") return { useApp };
      if (name === "../state/auth")
        return {
          useAuth: {
            getState: () => ({
              user: authenticated ? { id: "test-user" } : null,
            }),
          },
        };
      if (name === "../lib/api")
        return {
          api: {
            submit(body) {
              submissions.push(body);
              return new Promise(() => {});
            },
          },
        };
      if (name === "../lib/musicCreation")
        return {
          readMusicStatus: async () => ({ models: { present: true } }),
          defaultMusicOptions: () => ({ preset: "fast" }),
        };
      if (name === "../lib/musicPrompt") return promptContext.exports;
      if (name === "../components/MusicPromptShortcuts")
        return shortcutContext.exports;
      if (name.startsWith("../components/")) {
        const key = name.split("/").at(-1);
        return { [key]: key };
      }
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected import ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  component = context.exports.HomePage;
  render();
  const all = (node) =>
    !node || typeof node !== "object"
      ? []
      : Array.isArray(node)
        ? node.flatMap(all)
        : [node, ...all(node.props?.children)];
  const find = (predicate) => {
    const found = all(tree).find(predicate);
    assert.ok(found, "expected page control");
    return found;
  };
  const field = () => find((node) => node.type === "textarea");
  return {
    submissions,
    navigations,
    find,
    get value() {
      return field().props.value;
    },
    get submitEvents() {
      return submitEvents;
    },
    edit(value) {
      field().props.onChange({ target: { value } });
    },
    shortcut(label) {
      const node = find(
        (node) => node.type === shortcutContext.exports.MusicPromptShortcuts,
      );
      const controls = node.type(node.props);
      const button = all(controls).find(
        (node) => node.props?.children === label,
      );
      assert.ok(button, `expected shortcut ${label}`);
      assert.equal(button.props.type, "button");
      button.props.onClick();
    },
    key(overrides = {}) {
      let prevented = false;
      field().props.onKeyDown({
        key: "Enter",
        ctrlKey: true,
        metaKey: false,
        repeat: false,
        nativeEvent: { isComposing: false, keyCode: 13 },
        preventDefault() {
          prevented = true;
        },
        currentTarget: {
          form: {
            requestSubmit() {
              submitEvents++;
              void find((node) => node.type === "form").props.onSubmit({
                preventDefault() {},
              });
            },
          },
        },
        ...overrides,
      });
      return prevented;
    },
    close() {
      for (const hook of hooks) hook?.cleanup?.();
    },
  };
}

test("Ctrl/Command Enter uses the normal generation form once and ignores a repeated submission", async () => {
  for (const modifier of [
    { ctrlKey: true },
    { ctrlKey: false, metaKey: true },
  ]) {
    const h = setup();
    h.edit("森林里安静的钢琴");
    assert.equal(h.key(modifier), true);
    await new Promise(setImmediate);
    assert.equal(h.submissions.length, 1);
    assert.equal(h.submissions[0].kind, "create");
    assert.equal(h.submissions[0].params.description, "森林里安静的钢琴");
    assert.equal(h.submissions[0].params.style, "");
    assert.equal(h.submissions[0].params.lyrics, "");
    assert.equal(h.submissions[0].params.music_kind, "vocal");
    assert.equal(h.key(modifier), false);
    assert.equal(h.submitEvents, 1);
    h.close();
  }
});

test("guests reach login without submitting a generation job", async () => {
  const h = setup({ authenticated: false });
  h.edit("森林里安静的钢琴");
  assert.equal(h.key(), true);
  await new Promise(setImmediate);
  assert.deepEqual(h.navigations, ["/login"]);
  assert.equal(h.submissions.length, 0);
  h.close();
});

test("empty drafts, normal newlines and IME confirmation never start music generation", () => {
  const h = setup();
  assert.equal(h.key(), false);
  h.edit("正在输入的灵感");
  for (const event of [
    { ctrlKey: false, metaKey: false },
    { repeat: true },
    { nativeEvent: { isComposing: true, keyCode: 13 } },
    { nativeEvent: { isComposing: false, keyCode: 229 } },
  ])
    assert.equal(h.key(event), false);
  assert.equal(h.submitEvents, 0);
  assert.equal(h.submissions.length, 0);
  h.close();
});

test("choosing inspiration only fills the composer and leaves generation explicit", () => {
  const h = setup();
  h.find(
    (node) => node.props?.["aria-label"] === "用林间民谣作为创作灵感",
  ).props.onClick();
  assert.match(h.value, /木吉他/);
  assert.equal(h.submissions.length, 0);
  assert.equal(h.submitEvents, 0);
  h.close();
});

test("home shortcuts preserve freeform text and music kind without auto-generation", () => {
  const h = setup();
  const original = "写给即将离家的朋友\n副歌保留：门前的灯还亮着";
  h.edit(original);
  h.find((node) => node.type === "MusicKindToggle").props.onChange(
    "instrumental",
  );
  h.shortcut("音乐风格");
  assert.equal(h.value, `${original}\n音乐风格：`);
  h.shortcut("歌词/歌词风格");
  assert.equal(h.value, `${original}\n音乐风格：\n歌词/歌词风格：`);
  h.shortcut("音乐风格");
  assert.equal(h.value, `${original}\n音乐风格：\n歌词/歌词风格：`);
  assert.equal(
    h.find((node) => node.type === "MusicKindToggle").props.value,
    "instrumental",
  );
  assert.equal(h.submissions.length, 0);
  assert.equal(h.submitEvents, 0);
  h.close();
});

test("empty shortcut templates cannot submit until an actual requirement is entered", async () => {
  const h = setup();
  for (const label of promptContext.exports.MUSIC_PROMPT_LABELS)
    h.shortcut(label);
  assert.equal(
    h.find((node) => node.props?.type === "submit").props.disabled,
    true,
  );
  assert.equal(h.key(), false);
  assert.equal(h.submitEvents, 0);
  assert.equal(h.submissions.length, 0);
  h.edit(h.value + "不要电音");
  assert.equal(
    h.find((node) => node.props?.type === "submit").props.disabled,
    false,
  );
  assert.equal(h.key(), true);
  await new Promise(setImmediate);
  assert.equal(h.submissions.length, 1);
  assert.equal(h.submissions[0].params.description, h.value);
  h.close();
});
