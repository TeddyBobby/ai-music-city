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
const [componentCode, providersCode] = await Promise.all([
  compile("../src/components/AssistantConnectionSettings.tsx"),
  compile("../src/lib/assistantProviders.ts"),
]);
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(setImmediate);
const savedConfig = {
  hermes_base_url: "https://saved.example.test/v1",
  has_hermes_api_key: true,
  source: "custom",
  default_configured: true,
};
const available = {
  chat: { available: true, model_count: 2 },
};

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Run the actual component and provider helpers; all API calls stay in memory.
function setup({ config = savedConfig, api = {} } = {}) {
  const hooks = [],
    effects = [],
    calls = [],
    conversation = [];
  let index = 0,
    component,
    tree,
    unmounted = false;
  const render = () => {
    index = 0;
    tree = component();
    for (const [slot, effect] of effects.splice(0)) {
      hooks[slot].cleanup?.();
      hooks[slot].cleanup = effect();
    }
  };
  const react = {
    useId() {
      index++;
      return "connection";
    },
    useRef(value) {
      const slot = index++;
      hooks[slot] ??= { current: value };
      return hooks[slot];
    },
    useState(value) {
      const slot = index++;
      hooks[slot] ??= {
        value: typeof value === "function" ? value() : value,
      };
      return [
        hooks[slot].value,
        (next) => {
          assert.equal(unmounted, false, "no state updates after unmount");
          const value =
            typeof next === "function" ? next(hooks[slot].value) : next;
          if (Object.is(value, hooks[slot].value)) return;
          hooks[slot].value = value;
          render();
        },
      ];
    },
    useEffect(effect, deps) {
      const slot = index++,
        previous = hooks[slot];
      if (
        !previous ||
        deps.some((dep, i) => !Object.is(dep, previous.deps[i]))
      ) {
        hooks[slot] = { ...previous, deps };
        effects.push([slot, effect]);
      }
    },
  };
  const defaults = {
    config: async () => ({ ...config }),
    checkConfig: async () => available,
    saveConfig: async (patch) => ({
      ...config,
      hermes_base_url: patch.hermes_base_url,
      has_hermes_api_key: true,
      source: "custom",
    }),
    check: async () => available,
  };
  const assistantApi = Object.fromEntries(
    Object.keys(defaults).map((method) => [
      method,
      (...args) => {
        const hasPatch = method === "checkConfig" || method === "saveConfig";
        calls.push({
          method,
          ...(hasPatch ? { patch: plain(args[0]) } : {}),
          signal: args[hasPatch ? 1 : 0],
        });
        return (api[method] || defaults[method])(...args);
      },
    ]),
  );
  const providersModule = { exports: {} };
  vm.runInNewContext(providersCode, {
    module: providersModule,
    exports: providersModule.exports,
  });
  const module = { exports: {} };
  vm.runInNewContext(componentCode, {
    module,
    exports: module.exports,
    AbortController,
    fetch() {
      throw new Error("Connection tests must not use the network");
    },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      if (name === "@mantine/core") return { Select: "Select" };
      if (name === "./ui") return { Button: "Button", Input: "Input" };
      if (name === "../lib/assistant") return { assistantApi };
      if (name === "../lib/assistantProviders") return providersModule.exports;
      if (name === "../lib/utils")
        return { errorMessage: (error) => error.message };
      if (name === "../lib/assistantConversation")
        return {
          assistantConversation: {
            setConnected: (value) => conversation.push(["connected", value]),
            refreshModels: async () => conversation.push(["refreshModels"]),
          },
        };
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected import ${name}`);
    },
  });
  component = module.exports.AssistantConnectionSettings;
  render();
  const all = (node) =>
    !node || typeof node !== "object"
      ? []
      : Array.isArray(node)
        ? node.flatMap(all)
        : [node, ...all(node.props?.children)];
  const find = (predicate) => all(tree).find(predicate);
  const button = (label) =>
    find((node) => node.type === "Button" && node.props.children === label);
  const input = (type) =>
    find((node) => node.type === "Input" && node.props.type === type);
  return {
    calls: (method) => calls.filter((call) => call.method === method),
    conversation,
    button,
    input,
    form: () => find((node) => node.type === "form"),
    picker: () => find((node) => node.type === "Select"),
    notice: () =>
      all(tree)
        .filter((node) => ["status", "alert"].includes(node.props?.role))
        .at(-1)?.props,
    enter(type, value) {
      input(type).props.onChange({ target: { value } });
    },
    click(label) {
      const target = button(label);
      assert.ok(target, `button exists: ${label}`);
      assert.equal(
        target.props.disabled || false,
        false,
        `button enabled: ${label}`,
      );
      target.props.onClick();
    },
    submit() {
      assert.equal(button("保存配置").props.disabled, false);
      let prevented = false;
      find((node) => node.type === "form").props.onSubmit({
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(prevented, true);
    },
    unmount() {
      unmounted = true;
      hooks.forEach((hook) => hook?.cleanup?.());
    },
  };
}

test("testing uses the unsaved draft without saving or replacing the active models", async () => {
  const result = deferred();
  const app = setup({ api: { checkConfig: () => result.promise } });
  await settle();
  app.enter("url", " https://draft.example.test/v1/// ");
  app.enter("password", " fixture-draft-key ");
  app.click("测试连接");
  assert.deepEqual(app.calls("checkConfig")[0].patch, {
    hermes_base_url: "https://draft.example.test/v1",
    hermes_api_key: "fixture-draft-key",
  });
  assert.equal(app.button("测试中…").props.disabled, true);
  assert.equal(app.picker().props.disabled, true);
  result.resolve(available);
  await settle();
  assert.match(app.notice().children, /连接成功.*2/);
  assert.equal(app.input("password").props.value, " fixture-draft-key ");
  assert.equal(app.calls("saveConfig").length, 0);
  assert.equal(app.calls("check").length, 0);
  assert.deepEqual(app.conversation, []);
  app.unmount();
});

test("changing provider or URL clears the typed key and cannot reuse another service's saved key", async () => {
  const app = setup();
  await settle();
  for (const select of [
    () => app.picker().props.onChange("openai"),
    () => app.enter("url", "https://another.example.test/v1"),
    () => app.picker().props.onChange("kimi"),
  ]) {
    app.enter("password", "fixture-never-forward-this-key");
    select();
    assert.equal(app.input("password").props.value, "");
    assert.equal(app.input("password").props.placeholder, "输入 API Key");
    assert.equal(app.button("测试连接").props.disabled, true);
    assert.equal(app.button("保存配置").props.disabled, true);
  }
  assert.equal(app.input("url").props.value, "https://api.moonshot.cn/v1");
  assert.equal(app.calls("checkConfig").length, 0);
  assert.equal(app.calls("saveConfig").length, 0);
  app.unmount();
});

test("a saved custom key can be kept only for the same normalized service URL", async () => {
  const app = setup();
  await settle();
  app.enter("url", " https://saved.example.test/v1/// ");
  assert.equal(app.input("password").props.value, "");
  assert.equal(app.input("password").props.placeholder, "已保存 API Key");
  assert.equal(app.button("保存配置").props.disabled, true);
  app.click("测试连接");
  await settle();
  assert.deepEqual(app.calls("checkConfig")[0].patch, {
    hermes_base_url: savedConfig.hermes_base_url,
  });
  assert.equal(app.calls("saveConfig").length, 0);
  app.unmount();

  for (const config of [
    { ...savedConfig, source: "default" },
    { ...savedConfig, has_hermes_api_key: false },
  ]) {
    const noOwnKey = setup({ config });
    await settle();
    assert.equal(noOwnKey.button("测试连接").props.disabled, true);
    assert.equal(noOwnKey.button("保存配置").props.disabled, true);
    noOwnKey.unmount();
  }
});

test("a completed save clears the input secret and refreshes the account's selectable models", async () => {
  const save = deferred(),
    check = deferred();
  const app = setup({
    api: { saveConfig: () => save.promise, check: () => check.promise },
  });
  await settle();
  app.picker().props.onChange("deepseek");
  app.enter("password", "fixture-new-service-key");
  app.submit();
  assert.deepEqual(app.calls("saveConfig")[0].patch, {
    hermes_base_url: "https://api.deepseek.com",
    hermes_api_key: "fixture-new-service-key",
  });
  assert.deepEqual(
    app.conversation,
    [],
    "do not refresh models before the save succeeds",
  );
  save.resolve({ ...savedConfig, hermes_base_url: "https://api.deepseek.com" });
  await settle();
  assert.deepEqual(app.conversation, [["connected", false], ["refreshModels"]]);
  assert.equal(app.input("password").props.value, "");
  assert.equal(app.input("password").props.placeholder, "已保存 API Key");
  assert.equal(app.calls("check").length, 1);
  assert.match(app.notice().children, /配置已保存/);
  check.resolve(available);
  await settle();
  assert.deepEqual(app.conversation.at(-1), ["connected", true]);
  assert.equal(app.button("保存配置").props.disabled, true);
  assert.equal(app.button("测试连接").props.disabled, false);
  assert.match(app.notice().children, /配置已保存.*连接成功/);
  app.unmount();
});

test("a post-save connection error keeps the successful save explicit and permits retry", async () => {
  const app = setup({
    api: {
      check: async () => {
        throw new Error("连接超时");
      },
    },
  });
  await settle();
  app.enter("password", "fixture-replacement-key");
  app.submit();
  await settle();
  assert.equal(app.notice().role, "alert");
  assert.match(app.notice().children, /配置已保存.*连接超时/);
  assert.equal(app.input("password").props.value, "");
  assert.deepEqual(app.conversation, [["connected", false], ["refreshModels"]]);
  app.click("测试连接");
  await settle();
  assert.deepEqual(app.calls("checkConfig")[0].patch, {
    hermes_base_url: savedConfig.hermes_base_url,
  });
  assert.equal(app.calls("saveConfig").length, 1);
  app.unmount();
});

test("a failed save retains the draft and does not refresh the active connection", async () => {
  const app = setup({
    api: {
      saveConfig: async () => {
        throw new Error("保存失败");
      },
    },
  });
  await settle();
  app.enter("password", "fixture-unsaved-key");
  app.submit();
  await settle();
  assert.equal(app.notice().role, "alert");
  assert.equal(app.notice().children, "保存失败");
  assert.equal(app.input("password").props.value, "fixture-unsaved-key");
  assert.equal(app.button("保存配置").props.disabled, false);
  assert.equal(app.calls("check").length, 0);
  assert.deepEqual(app.conversation, []);
  app.unmount();
});

test("configuration load failures offer a retry that restores the form", async () => {
  const retry = deferred();
  let attempts = 0;
  const app = setup({
    api: {
      config: async () => {
        if (++attempts === 1) throw new Error("读取配置失败");
        return retry.promise;
      },
    },
  });
  await settle();
  assert.equal(app.form(), undefined);
  assert.equal(app.notice().role, "alert");
  assert.equal(app.notice().children, "读取配置失败");
  app.click("重新加载");
  assert.equal(app.calls("config").length, 2);
  assert.equal(app.calls("config")[0].signal.aborted, true);
  assert.equal(app.notice().role, "status");
  assert.equal(app.button("重新加载"), undefined);
  retry.resolve(savedConfig);
  await settle();
  assert.ok(app.form());
  assert.equal(app.input("url").props.value, savedConfig.hermes_base_url);
  assert.equal(app.input("password").props.value, "");
  app.unmount();
});

test("leaving during a request aborts it and ignores late results", async () => {
  const load = deferred();
  const loading = setup({ api: { config: () => load.promise } });
  loading.unmount();
  assert.equal(loading.calls("config")[0].signal.aborted, true);
  load.resolve(savedConfig);
  await settle();

  const save = deferred();
  const app = setup({ api: { saveConfig: () => save.promise } });
  await settle();
  app.enter("password", "fixture-cancelled-key");
  app.submit();
  app.unmount();
  assert.equal(app.calls("saveConfig")[0].signal.aborted, true);
  save.resolve(savedConfig);
  await settle();
  assert.deepEqual(app.conversation, []);
  assert.equal(app.calls("check").length, 0);
});
