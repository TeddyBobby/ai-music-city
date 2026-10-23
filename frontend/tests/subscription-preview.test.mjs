import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const code = ts.transpileModule(
  await readFile(
    new URL("../src/lib/subscriptionPreview.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;

const plain = (value) => JSON.parse(JSON.stringify(value));
const free = { planId: "free", cycle: "monthly" };
const key = (userId) =>
  `amc.subscription.preview.v1:${encodeURIComponent(userId)}`;

function setup({
  data = new Map(),
  userId = "alice",
  storageBlocked = false,
} = {}) {
  let user = userId ? { id: userId } : null;
  let rendering;
  const consumers = new Set();
  const events = new Set();
  let writes = 0;
  const localStorage = {
    getItem(name) {
      if (storageBlocked) throw new Error("Storage unavailable");
      return data.get(name) ?? null;
    },
    setItem(name, value) {
      if (storageBlocked) throw new Error("Storage unavailable");
      writes++;
      data.set(name, value);
    },
  };
  const useAuth = Object.assign((selector) => selector({ user }), {
    getState: () => ({ user }),
  });
  const react = {
    useCallback: (callback) => callback,
    useSyncExternalStore(subscribe, getSnapshot) {
      const consumer = rendering;
      consumer.getSnapshot = getSnapshot;
      consumer.unsubscribe ||= subscribe(() => render(consumer));
      return getSnapshot();
    },
  };
  const context = {
    exports: {},
    window: {
      localStorage,
      addEventListener: (event, listener) => events.add(listener),
      removeEventListener: (event, listener) => events.delete(listener),
    },
    require(name) {
      if (name === "react") return react;
      if (name === "../state/auth") return { useAuth };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(code, context);
  function render(consumer) {
    rendering = consumer;
    consumer.current = context.exports.useSubscriptionPreview();
    rendering = undefined;
  }
  return {
    plans: plain(context.exports.plans),
    data,
    writes: () => writes,
    mount() {
      const consumer = {};
      consumers.add(consumer);
      render(consumer);
      return {
        get selection() {
          return plain(consumer.current.selection);
        },
        get selectPlan() {
          return consumer.current.selectPlan;
        },
        snapshot: () => consumer.getSnapshot(),
        unmount() {
          consumer.unsubscribe();
          consumers.delete(consumer);
        },
      };
    },
    setUser(id) {
      user = id ? { id } : null;
      consumers.forEach(render);
    },
    storageEvent(name, value) {
      if (name === null) data.clear();
      else if (value === null) data.delete(name);
      else data.set(name, value);
      events.forEach((listener) =>
        listener({ key: name, newValue: value, storageArea: localStorage }),
      );
    },
  };
}

test("the preview catalog exposes the agreed display prices and song counts", () => {
  assert.deepEqual(setup().plans, [
    {
      id: "free",
      name: "体验版",
      monthlyPrice: 0,
      yearlyPrice: 0,
      monthlySongs: 5,
    },
    {
      id: "inspiration",
      name: "灵感会员",
      monthlyPrice: 29,
      yearlyPrice: 288,
      monthlySongs: 50,
    },
    {
      id: "creator",
      name: "创作家",
      monthlyPrice: 79,
      yearlyPrice: 768,
      monthlySongs: 200,
    },
  ]);
});

test("plan changes synchronize all consumers and free always uses monthly", () => {
  const env = setup();
  const pricing = env.mount();
  const shell = env.mount();
  assert.deepEqual(shell.selection, free);
  assert.equal(shell.snapshot(), shell.snapshot(), "snapshot must be stable");
  pricing.selectPlan("inspiration", "yearly");
  assert.deepEqual(shell.selection, { planId: "inspiration", cycle: "yearly" });
  assert.deepEqual(shell.selection, pricing.selection);
  shell.selectPlan("free", "yearly");
  assert.deepEqual(pricing.selection, free);
  const writes = env.writes();
  shell.selectPlan("free", "monthly");
  assert.equal(
    env.writes(),
    writes,
    "unchanged selection does not write again",
  );
});

test("a fresh page restores the selected account's preview", () => {
  const env = setup();
  env.mount().selectPlan("creator", "yearly");
  const reloaded = setup({ data: env.data }).mount();
  assert.deepEqual(reloaded.selection, { planId: "creator", cycle: "yearly" });
  assert.equal(env.data.size, 1, "only preview data is persisted");
});

test("account switching updates mounted consumers and cannot reuse a stale callback", () => {
  const env = setup();
  const shell = env.mount();
  shell.selectPlan("creator", "yearly");
  const aliceAction = shell.selectPlan;
  env.setUser("bob");
  assert.deepEqual(shell.selection, free);
  aliceAction("inspiration", "monthly");
  assert.deepEqual(shell.selection, free);
  shell.selectPlan("inspiration", "monthly");
  env.setUser("alice");
  assert.deepEqual(shell.selection, { planId: "creator", cycle: "yearly" });
  env.setUser(null);
  assert.deepEqual(shell.selection, free);
  shell.selectPlan("creator", "monthly");
  assert.deepEqual(shell.selection, free);
  assert.equal(
    env.data.size,
    2,
    "anonymous users have no shared saved preview",
  );
  assert.deepEqual(setup({ data: env.data, userId: "bob" }).mount().selection, {
    planId: "inspiration",
    cycle: "monthly",
  });
});

test("broken storage and unsupported saved selections safely fall back", () => {
  for (const value of [
    "{bad json",
    "null",
    '"creator"',
    '{"planId":"unknown","cycle":"monthly"}',
    '{"planId":"creator","cycle":"weekly"}',
    '{"planId":"creator"}',
  ]) {
    const env = setup({ data: new Map([[key("alice"), value]]) });
    assert.deepEqual(env.mount().selection, free);
  }
  const env = setup({
    data: new Map([[key("alice"), '{"planId":"free","cycle":"yearly"}']]),
  });
  assert.deepEqual(env.mount().selection, free);
});

test("blocked storage still synchronizes consumers and keeps account separation", () => {
  const env = setup({ storageBlocked: true });
  const pricing = env.mount();
  const shell = env.mount();
  pricing.selectPlan("inspiration", "yearly");
  assert.deepEqual(shell.selection, { planId: "inspiration", cycle: "yearly" });
  env.setUser("bob");
  assert.deepEqual(shell.selection, free);
  shell.selectPlan("creator", "monthly");
  env.setUser("alice");
  assert.deepEqual(pricing.selection, {
    planId: "inspiration",
    cycle: "yearly",
  });
  assert.equal(env.data.size, 0);
});

test("storage events update the matching account and corrupt updates fall back", () => {
  const env = setup();
  const shell = env.mount();
  env.storageEvent(key("bob"), '{"planId":"creator","cycle":"yearly"}');
  assert.deepEqual(shell.selection, free);
  env.storageEvent(key("alice"), '{"planId":"inspiration","cycle":"yearly"}');
  assert.deepEqual(shell.selection, { planId: "inspiration", cycle: "yearly" });
  env.storageEvent(key("alice"), "{invalid");
  assert.deepEqual(shell.selection, free);
  env.setUser("bob");
  assert.deepEqual(shell.selection, { planId: "creator", cycle: "yearly" });
  env.storageEvent(null, null);
  assert.deepEqual(shell.selection, free);
  shell.unmount();
});
