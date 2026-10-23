import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const code = ts.transpileModule(
  await readFile(new URL("../src/lib/imageMusic.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;
const mood = {
  title: "山间薄雾",
  summary: "晨雾中的山林，阳光穿过树冠。",
  mood: "宁静、朦胧、温暖",
  style: "Ambient piano, soft strings, spacious reverb, gentle pacing",
};
const file = () =>
  new File(["image-bytes"], "forest.jpg", { type: "image/jpeg" });
function setup({ result = mood, ok = true, fetchError } = {}) {
  const calls = { requests: [], prompts: [], suggestions: [] },
    exports = {};
  vm.runInNewContext(code, {
    exports,
    Error,
    DOMException,
    FormData,
    fetch: async (url, options) => {
      calls.requests.push({ url, options });
      if (fetchError) throw fetchError;
      return { ok, json: async () => result };
    },
    require: (name) =>
      name === "./accountBoundary"
        ? {
            accountFetch: async (url, options) => {
              calls.requests.push({ url, options });
              if (fetchError) throw fetchError;
              return { ok, json: async () => result };
            },
          }
        : {
            generateFromPrompt: async (...args) => {
              calls.prompts.push(args);
              return { id: "vocal-job" };
            },
            generateFromSuggestion: async (...args) => {
              calls.suggestions.push(args);
              return { id: "instrumental-job" };
            },
          },
  });
  return { ...exports, calls };
}
test("image and description are analyzed before instrumental generation without lyric writing", async () => {
  const api = setup(),
    phases = [],
    analyses = [];
  const job = await api.generateFromImage(file(), "木吉他、慢一点", {
    musicKind: "instrumental",
    onPhase: (p) => phases.push(p),
    onAnalysis: (a) => analyses.push(a),
  });
  assert.equal(job.id, "instrumental-job");
  assert.equal(api.calls.requests[0].url, "/api/assistant/image-mood");
  assert.equal(
    api.calls.requests[0].options.body.get("file").name,
    "forest.jpg",
  );
  assert.equal(
    api.calls.requests[0].options.body.get("description"),
    "木吉他、慢一点",
  );
  assert.deepEqual(phases, ["analyzing"]);
  assert.equal(analyses[0].summary, mood.summary);
  assert.equal(api.calls.prompts.length, 0);
  assert.equal(api.calls.suggestions[0][0].description, mood.style);
  assert.equal(api.calls.suggestions[0][0].lyrics, undefined);
  assert.equal(api.calls.suggestions[0][1].musicKind, "instrumental");
});
test("vocal music uses the visual mood and extra description as songwriting context", async () => {
  const api = setup();
  await api.generateFromImage(file(), "送给朋友", { musicKind: "vocal" });
  const [prompt, options] = api.calls.prompts[0];
  assert.match(prompt, /晨雾中的山林/);
  assert.match(prompt, /宁静、朦胧/);
  assert.match(prompt, /送给朋友/);
  assert.equal(options.musicKind, "vocal");
  assert.equal(api.calls.suggestions.length, 0);
});
test("empty, oversized, and unsupported files do not reach image recognition", async () => {
  for (const f of [
    new File([], "empty.jpg", { type: "image/jpeg" }),
    new File(["bad"], "bad.svg", { type: "image/svg+xml" }),
    new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    }),
  ]) {
    const api = setup();
    await assert.rejects(
      api.generateFromImage(f, "", { musicKind: "instrumental" }),
    );
    assert.equal(api.calls.requests.length, 0);
  }
});
test("provider failures or incomplete analysis cannot generate unrelated music", async () => {
  for (const options of [
    { ok: false, result: { error: { message: "图片识别服务暂不可用" } } },
    { result: { ...mood, style: "" } },
    { fetchError: new Error("offline") },
  ]) {
    const api = setup(options);
    await assert.rejects(
      api.generateFromImage(file(), "", { musicKind: "vocal" }),
    );
    assert.equal(api.calls.prompts.length, 0);
    assert.equal(api.calls.suggestions.length, 0);
  }
});
test("cancelling before or immediately after recognition never submits music", async () => {
  const api = setup(),
    abort = new AbortController();
  abort.abort();
  await assert.rejects(
    api.generateFromImage(file(), "", {
      musicKind: "vocal",
      signal: abort.signal,
    }),
    { name: "AbortError" },
  );
  assert.equal(api.calls.requests.length, 0);
  const api2 = setup(),
    abort2 = new AbortController();
  await assert.rejects(
    api2.generateFromImage(file(), "", {
      musicKind: "instrumental",
      signal: abort2.signal,
      onAnalysis: () => abort2.abort(),
    }),
    { name: "AbortError" },
  );
  assert.equal(api2.calls.suggestions.length, 0);
});
