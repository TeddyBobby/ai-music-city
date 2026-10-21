import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../src/lib/homeDraft.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const mediaCompiled = ts.transpileModule(
  await readFile(new URL("../src/lib/playerMedia.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;

function setup() {
  const values = new Map();
  const sessionStorage = {
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
  };
  const media = { exports: {} };
  vm.runInNewContext(mediaCompiled, media);
  const context = {
    exports: {},
    sessionStorage,
    require: (name) => {
      assert.equal(name, "./playerMedia");
      return media.exports;
    },
  };
  vm.runInNewContext(compiled, context);
  return { ...context.exports, sessionStorage };
}

const draft = {
  title: "未完成的歌",
  style: "原曲风",
  lyrics: "原歌词",
  cot: "melody",
  abc: "X:1\nK:C\nCDEF",
  loras: [{ name: "custom", scale: 0.8 }],
  precision: "4bit",
  seed: 71,
  count: 2,
};
const adapters = [
  { name: "ar_lora_inst_v3abc.bf16", valid: true },
  { name: "nar_lora_joint_v4.bf16", valid: true },
];
const plain = (value) => JSON.parse(JSON.stringify(value));

test("cancelled initialization can reread the handoff; completion consumes it", () => {
  const api = setup();
  assert.equal(
    api.saveHomeDraft({ prompt: "  雨夜爵士  ", instrumental: true }),
    true,
  );
  assert.deepEqual(plain(api.readHomeDraft()), {
    prompt: "雨夜爵士",
    instrumental: true,
  });
  assert.equal(api.readHomeDraft().prompt, "雨夜爵士");
  api.clearHomeDraft();
  assert.equal(api.readHomeDraft(), null);
});

test("song inspiration preserves existing lyrics, title and generation settings", () => {
  const { applyHomeDraft } = setup();
  const next = applyHomeDraft(
    draft,
    { prompt: "雨夜爵士", instrumental: false },
    [],
  );
  assert.deepEqual(plain(next), { ...draft, style: "雨夜爵士" });
  assert.equal(draft.style, "原曲风");
});

test("instrumental handoff requires both installed adapters and keeps original draft intact for undo", () => {
  const { applyHomeDraft } = setup();
  assert.throws(
    () =>
      applyHomeDraft(
        draft,
        { prompt: "钢琴", instrumental: true },
        adapters.slice(0, 1),
      ),
    /纯音乐适配器尚未就绪/,
  );
  const backup = structuredClone(draft);
  const next = applyHomeDraft(
    draft,
    { prompt: "钢琴", instrumental: true },
    adapters,
  );
  assert.equal(next.lyrics, "[Intro]");
  assert.equal(next.cot, "full");
  assert.equal(next.abc, "");
  assert.deepEqual(
    plain(next.loras),
    adapters.map(({ name }) => ({ name, scale: 1 })),
  );
  assert.equal(next.seed, draft.seed);
  assert.deepEqual(draft, backup);
});

test("blocked storage and invalid stored data never report a successful handoff", () => {
  const api = setup();
  assert.equal(api.saveHomeDraft({ prompt: " ", instrumental: false }), false);
  api.sessionStorage.setItem("tingjian.home-draft", "{broken");
  assert.equal(api.readHomeDraft(), null);
  api.sessionStorage.setItem = () => {
    throw new Error("Blocked");
  };
  assert.equal(
    api.saveHomeDraft({ prompt: "爵士", instrumental: false }),
    false,
  );
});

test("turning instrumental off removes its AR model and requires lyrics without losing real lyrics or shared NAR", () => {
  const { applyHomeDraft } = setup();
  const instrumental = applyHomeDraft(
    draft,
    { prompt: "钢琴", instrumental: true },
    adapters,
  );
  const beforeSwitch = structuredClone(plain(instrumental));
  const song = applyHomeDraft(
    instrumental,
    { prompt: "温暖女声", instrumental: false },
    [],
  );
  assert.equal(song.style, "温暖女声");
  assert.equal(song.lyrics, "");
  assert.deepEqual(plain(song.loras), [
    { name: "nar_lora_joint_v4.bf16", scale: 1 },
  ]);
  assert.deepEqual(plain(instrumental), beforeSwitch);

  const withLyrics = {
    ...instrumental,
    lyrics: "[Verse]\n风吹过窗边\n[Chorus]\n我们再见",
    loras: [...instrumental.loras, { name: "custom-vocal", scale: 0.7 }],
  };
  const vocal = applyHomeDraft(
    withLyrics,
    { prompt: "温暖女声", instrumental: false },
    [],
  );
  assert.equal(vocal.lyrics, withLyrics.lyrics);
  assert.deepEqual(plain(vocal.loras), [
    { name: "nar_lora_joint_v4.bf16", scale: 1 },
    { name: "custom-vocal", scale: 0.7 },
  ]);
});
