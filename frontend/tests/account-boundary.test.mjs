import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const compile = async (file) =>
  ts.transpileModule(
    await readFile(new URL(`../src/${file}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
const boundaryCode = await compile("lib/accountBoundary.ts");
const apiCode = await compile("lib/api.ts");
function storage(values = {}) {
  const data = new Map(Object.entries(values));
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i],
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
}
function setup(options = {}) {
  const localStorage = storage(options.local),
    sessionStorage = storage(options.session);
  let reloads = 0;
  const context = {
    exports: {},
    DOMException,
    Headers,
    FormData,
    Error,
    crypto: { randomUUID: () => "nonce" },
    localStorage,
    sessionStorage,
    window: {
      localStorage,
      sessionStorage,
      location: { reload: () => reloads++ },
    },
    fetch: options.fetch || (async () => new Response("{}")),
  };
  vm.runInNewContext(boundaryCode, context);
  const boundary = context.exports;
  const apiContext = { ...context, exports: {}, require: () => boundary };
  vm.runInNewContext(apiCode, apiContext);
  return {
    ...boundary,
    api: apiContext.exports.api,
    localStorage,
    sessionStorage,
    reloads: () => reloads,
  };
}

test("switching accounts erases drafts and player resource IDs while keeping neutral preferences", () => {
  const env = setup({
    local: {
      "yue2.player.v2": "private queue",
      "yue2.create": "private lyrics",
      "yue2.review.song": "private review",
      "yue2-assistant-draft": "private assistant",
      "yue2.theme": "light",
      "yue2.player.volume": "0.8",
      unrelated: "keep",
    },
    session: {
      "music.prompt": "private idea",
      "music.assistant": "private session",
      "music.revision.song": "private revision",
      "tingjian.home-draft": "private draft",
    },
  });
  let stopped = 0;
  env.registerAccountCleanup(() => stopped++);
  env.leaveAccount("next-user");
  assert.equal(stopped, 1);
  assert.equal(env.reloads(), 1);
  for (const key of [
    "yue2.player.v2",
    "yue2.create",
    "yue2.review.song",
    "yue2-assistant-draft",
  ])
    assert.equal(env.localStorage.getItem(key), null);
  for (const key of [
    "music.prompt",
    "music.assistant",
    "music.revision.song",
    "tingjian.home-draft",
  ])
    assert.equal(env.sessionStorage.getItem(key), null);
  assert.equal(env.localStorage.getItem("yue2.theme"), "light");
  assert.equal(env.localStorage.getItem("unrelated"), "keep");
  assert.equal(
    JSON.parse(env.localStorage.getItem(env.accountChangeKey)).user,
    "next-user",
  );
  env.leaveAccount(null);
  assert.equal(
    env.reloads(),
    1,
    "concurrent unauthorized responses cannot trigger reload loops",
  );
});

test("same-account reload preserves private drafts; a copied tab from another account does not", () => {
  const env = setup({
    local: { "amc.account.owner": "alice", "yue2.player.v2": "queue" },
    session: { "amc.account.session": "alice", "music.prompt": "draft" },
  });
  assert.equal(env.adoptAccount("alice"), false);
  assert.equal(env.sessionStorage.getItem("music.prompt"), "draft");
  assert.equal(env.adoptAccount("bob"), true);
  assert.equal(env.sessionStorage.getItem("music.prompt"), null);
  assert.equal(env.localStorage.getItem("yue2.player.v2"), null);
});

test("401 from private upload, assistant and audio requests leaves account; wrong credentials stay on the form", async () => {
  for (const path of [
    "/api/upload",
    "/api/assistant/image-mood",
    "/api/songs/song/audio.flac",
  ]) {
    const env = setup({
      fetch: async () => new Response("{}", { status: 401 }),
    });
    await assert.rejects(env.accountFetch(path), { name: "AbortError" });
    assert.equal(env.reloads(), 1);
  }
  const env = setup({
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: { code: "invalid_credentials", message: "邮箱或密码不正确" },
        }),
        { status: 401 },
      ),
  });
  await assert.rejects(env.api.post("/api/auth/login", {}), /邮箱或密码不正确/);
  assert.equal(env.reloads(), 0);
});

test("late JSON response from the previous account cannot rehydrate state", async () => {
  let resolve;
  const env = setup({
    fetch: async () => ({
      status: 200,
      ok: true,
      text: () =>
        new Promise((r) => {
          resolve = r;
        }),
    }),
  });
  const pending = env.api.get("/api/jobs");
  await new Promise((r) => setImmediate(r));
  env.leaveAccount("bob");
  resolve(JSON.stringify({ jobs: [{ id: "alice-private-job" }] }));
  await assert.rejects(pending, { name: "AbortError" });
});

test("private requests stay bound to the mounted account when another tab changes shared browser identity", async () => {
  const requests = [];
  const env = setup({
    fetch: async (path, init) => {
      requests.push({ path, init });
      return new Response("{}");
    },
  });
  env.adoptAccount("alice");
  env.localStorage.setItem("amc.account.owner", "bob");
  await env.api.post("/api/jobs", { lyrics: "alice's unfinished draft" });
  await env.accountFetch("/api/assistant/audio", {
    method: "POST",
    body: new FormData(),
  });
  await env.accountFetch("/api/assistant/sessions/session/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  await env.api.get("/api/auth/status");
  assert.deepEqual(
    requests.slice(0, 3).map(({ init }) => init.headers.get("X-Account-ID")),
    ["alice", "alice", "alice"],
  );
  assert.equal(
    requests[0].init.headers.get("Content-Type"),
    "application/json",
  );
  assert.equal(
    requests[1].init.headers.has("Content-Type"),
    false,
    "browser must choose multipart boundary",
  );
  assert.equal(
    requests[3].init.headers.has("X-Account-ID"),
    false,
    "status must discover the current cookie identity",
  );
});

test("account mismatch stops and reloads without surfacing another account's response; normal conflicts stay usable", async () => {
  const env = setup({
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: { code: "account_changed", message: "account changed" },
        }),
        { status: 409 },
      ),
  });
  env.adoptAccount("alice");
  await assert.rejects(env.api.post("/api/jobs", {}), { name: "AbortError" });
  assert.equal(env.reloads(), 1);
  const conflict = setup({
    fetch: async () =>
      new Response(
        JSON.stringify({ error: { code: "busy", message: "still running" } }),
        { status: 409 },
      ),
  });
  conflict.adoptAccount("alice");
  await assert.rejects(conflict.api.post("/api/jobs", {}), /still running/);
  assert.equal(conflict.reloads(), 0);
});
