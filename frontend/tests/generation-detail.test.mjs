import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compile = async (name) =>
  ts.transpileModule(
    await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
const compiled = {
  musicCreation: await compile("musicCreation"),
  generationDetail: await compile("generationDetail"),
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const lyrics = "[Verse]\n晚风轻轻吹过街角\n你的笑容留在心上";
const instrumental = ["ar_lora_inst_v3abc.bf16", "nar_lora_joint_v4.bf16"].map(
  (name) => ({ name, scale: 1 }),
);
const original = (overrides = {}) => ({
  id: "original-song",
  kind: "create",
  status: "done",
  params: { title: "旧歌", style: "木吉他流行", lyrics, seed: 42 },
  loras: [],
  ...overrides,
});
const edited = (overrides = {}) => ({
  title: " 新的晚风 ",
  style: " 温暖的钢琴流行 ",
  lyrics,
  musicKind: "vocal",
  ...overrides,
});

function setup({ runtime = {}, onStatus, onStream, submitError, result } = {}) {
  const calls = {
    status: 0,
    submissions: [],
    sessions: [],
    messages: [],
    stops: [],
  };
  const modules = {};
  const api = {
    status: async () => {
      calls.status += 1;
      onStatus?.();
      return {
        models: { present: true, precisions: ["4bit"] },
        memory: { machine_ram_gib: 16 },
        hum: { available: true },
        loras: {
          adapters: instrumental.map((item) => ({ ...item, valid: true })),
        },
        ...runtime,
      };
    },
    submit: async (body) => {
      calls.submissions.push(body);
      if (submitError) throw submitError;
      return result === undefined
        ? {
            job: {
              id: "new-song",
              parent_id: body.parent_id,
              status: "queued",
            },
          }
        : result;
    },
  };
  const require = (name) => {
    if (name === "./api") return { api };
    if (name === "./assistant")
      return {
        assistantApi: {
          newSession: async (body) => {
            calls.sessions.push(body);
            return { id: "lyrics-session" };
          },
          stop: async (id) => calls.stops.push(id),
        },
        streamMessage: async (session, body, options) => {
          calls.messages.push({ session, body });
          onStream?.();
          options.onEvent({
            type: "done",
            message: {
              suggestion: {
                title: "助手给的标题",
                description: "助手给的曲风",
                lyrics,
              },
            },
          });
        },
      };
    const key = name.slice(2);
    if (modules[key]) return modules[key];
    if (!compiled[key]) throw new Error(`Unexpected import: ${name}`);
    const context = { exports: {}, require, DOMException };
    vm.runInNewContext(compiled[key], context);
    modules[key] = context.exports;
    return modules[key];
  };
  return { ...require("./generationDetail"), calls };
}

test("drafts restore actual type and editable text without exposing score-only section markers as lyrics", () => {
  const { draftFromJob } = setup();
  assert.deepEqual(
    plain(
      draftFromJob(
        original({
          loras: instrumental,
          params: { title: "山林", style: "钢琴", lyrics: "[Intro]" },
        }),
      ),
    ),
    { title: "山林", style: "钢琴", lyrics: "", musicKind: "instrumental" },
  );
  assert.equal(
    draftFromJob(original({ params: { style: "piano instrumental", lyrics } }))
      .musicKind,
    "vocal",
  );
  assert.equal(
    draftFromJob(
      original({ params: { style: "piano instrumental", lyrics: "[Intro]" } }),
    ).musicKind,
    "instrumental",
  );
  assert.equal(draftFromJob(original({ title: "展示标题" })).title, "展示标题");
});

test("the timeline reflects measured stages and only exposes current-stage percentages", () => {
  const { generationProgress } = setup();
  const state = generationProgress(
    original({
      status: "running",
      kind: "hum",
      progress: { stage: "semantic", completed: 20, total: 80 },
    }),
  );
  assert.equal(state.title, "正在生成音乐");
  assert.equal(state.stagePercent, 25);
  assert.equal(state.stageDetail, "当前阶段 20 / 80");
  assert.deepEqual(plain(state.steps.map((step) => [step.id, step.state])), [
    ["prepare", "complete"],
    ["melody", "complete"],
    ["compose", "complete"],
    ["generate", "current"],
    ["finish", "pending"],
  ]);
  const hum = generationProgress(
    original({ status: "running", kind: "hum", progress: { stage: "hum" } }),
  );
  assert.equal(hum.steps.find((step) => step.id === "melody").state, "current");
  assert.equal(hum.stagePercent, undefined);
});

test("unknown, incomplete and invalid counts never produce an estimated percentage or finished steps", () => {
  const { generationProgress } = setup();
  for (const progress of [
    { stage: "plan", total: 100 },
    { stage: "plan", completed: 20 },
    { stage: "plan", completed: 0, total: 0 },
    { stage: "plan", completed: 120, total: 100 },
    { stage: "plan", completed: -1, total: 100 },
    { stage: "plan", completed: NaN, total: 100 },
    { stage: "future-stage", completed: 20, total: 100 },
  ]) {
    assert.equal(
      generationProgress(original({ status: "running", progress }))
        .stagePercent,
      undefined,
    );
  }
  const unknown = generationProgress(
    original({
      status: "running",
      progress: { stage: "future-stage" },
      started_at: "2000-01-01",
    }),
  );
  assert.ok(unknown.steps.every((step) => step.state === "pending"));
  const queue = generationProgress(
    original({
      status: "queued",
      position: 2,
      progress: { stage: "save", completed: 1, total: 1 },
    }),
  );
  assert.match(queue.description, /2 个排队任务/);
  assert.ok(queue.steps.every((step) => step.state === "pending"));
  assert.equal(queue.stagePercent, undefined);
});

test("terminal states override stale progress and show actionable friendly failure messages", () => {
  const { generationProgress } = setup();
  const progress = { stage: "semantic", completed: 1, total: 2 };
  const done = generationProgress(original({ progress }));
  assert.ok(done.steps.every((step) => step.state === "complete"));
  assert.equal(done.stagePercent, undefined);
  for (const [error, expected] of [
    ["MemoryError: system memory pressure above warn", /可用内存不足/],
    ["hum transcription has no notes", /没有识别到清晰旋律/],
    ["upload 'abc' is missing", /原始音频已不可用/],
    ["models not installed", /音乐模型暂未就绪/],
    ["Raw stack trace and implementation details", /本次生成没有完成/],
  ]) {
    const failed = generationProgress(
      original({ status: "failed", error, progress }),
    );
    assert.match(failed.description, expected);
    assert.equal(failed.stagePercent, undefined);
    assert.equal(
      failed.steps.find((step) => step.id === "generate").state,
      "failed",
    );
  }
  assert.equal(
    generationProgress(original({ status: "cancelled", progress })).title,
    "已停止生成",
  );
});

test("editing valid lyrics creates one new linked version, preserving the original and bypassing AI rewriting", async () => {
  const helper = setup();
  const source = original({
    params: {
      title: "原作",
      style: "吉他",
      lyrics,
      abc: "old score",
      cfg_scale: 3,
      seed: 42,
    },
  });
  const before = plain(source);
  const draft = edited({
    lyrics: "[Verse]\n新的街角吹着晚风\n新的旋律陪你远行",
  });
  const phases = [];
  const job = await helper.submitRevision(source, draft, {
    onPhase: (phase) => phases.push(phase),
  });
  assert.equal(job.parent_id, source.id);
  assert.deepEqual(source, before);
  assert.equal(helper.calls.sessions.length, 0);
  assert.deepEqual(phases, ["submitting"]);
  assert.equal(helper.calls.submissions.length, 1);
  const body = helper.calls.submissions[0];
  assert.equal(body.kind, "create");
  assert.equal(body.parent_id, source.id);
  assert.equal(body.params.title, draft.title.trim());
  assert.equal(body.params.lyrics, draft.lyrics);
  assert.equal(body.params.cfg_scale, 3);
  assert.equal(body.params.abc, null);
  assert.equal(body.params.seed, null);
  assert.equal(body.params.cot, "full");
  assert.equal(body.precision, "4bit");
});

test("a hum revision keeps its original audio and continuation settings, including zero values", async () => {
  const helper = setup();
  await helper.submitRevision(
    original({
      kind: "hum",
      status: "failed",
      params: {
        title: "哼唱",
        style: "流行",
        lyrics,
        upload_id: "original-hum",
        melody: "continue",
        adapter: "hum-adapter.safetensors",
        hum_influence: 0,
        offset_s: 0,
        cfg_scale: 0,
      },
    }),
    edited(),
  );
  const body = helper.calls.submissions[0];
  assert.equal(body.kind, "hum");
  assert.equal(body.params.upload_id, "original-hum");
  assert.equal(body.params.melody, "continue");
  assert.equal(body.params.adapter, "hum-adapter.safetensors");
  assert.equal(body.params.hum_influence, 0);
  assert.equal(body.params.offset_s, 0);
  assert.equal(body.params.cfg_scale, 0);
  assert.equal(body.params.abc, undefined);
});

test("switching to instrumental installs both required adapters and never writes lyrics", async () => {
  const helper = setup();
  await helper.submitRevision(
    original(),
    edited({ musicKind: "instrumental" }),
  );
  const body = helper.calls.submissions[0];
  assert.deepEqual(plain(body.loras), instrumental);
  assert.equal(body.params.lyrics, "[Intro]");
  assert.equal(helper.calls.sessions.length, 0);
});

test("switching to vocal with no lyric text writes lyrics once and keeps the user's edited title and style", async () => {
  for (const empty of ["", "[Intro]\n[Outro]"]) {
    const helper = setup();
    const phases = [];
    await helper.submitRevision(
      original({ loras: instrumental }),
      edited({ lyrics: empty }),
      { onPhase: (phase) => phases.push(phase) },
    );
    const body = helper.calls.submissions[0];
    assert.equal(helper.calls.messages.length, 1);
    assert.match(helper.calls.messages[0].body.content, /温暖的钢琴流行/);
    assert.equal(body.params.title, "新的晚风");
    assert.match(body.params.style, /温暖的钢琴流行/);
    assert.doesNotMatch(body.params.style, /助手给的曲风/);
    assert.equal(body.params.lyrics, lyrics);
    assert.deepEqual(plain(body.loras), []);
    assert.deepEqual(phases, ["writing", "submitting"]);
  }
});

test("invalid edited lyrics are not silently replaced; active jobs and missing hum sources cannot submit", async () => {
  const helper = setup();
  await assert.rejects(
    helper.submitRevision(original(), edited({ lyrics: "不完整歌词" })),
    /歌词尚未完成/,
  );
  assert.equal(helper.calls.messages.length, 0);
  for (const status of ["queued", "running"])
    await assert.rejects(
      helper.submitRevision(original({ status }), edited()),
      /等待本次生成结束/,
    );
  await assert.rejects(
    helper.submitRevision(original({ kind: "hum" }), edited()),
    /原始哼唱已不可用/,
  );
  assert.equal(helper.calls.submissions.length, 0);
});

test("readiness errors do not create lyrics sessions or jobs", async () => {
  for (const [runtime, job, draft, error] of [
    [
      { models: { present: false } },
      original(),
      edited({ lyrics: "" }),
      /音乐模型尚未就绪/,
    ],
    [
      { hum: { available: false } },
      original({ kind: "hum", params: { upload_id: "hum" } }),
      edited(),
      /哼唱生成暂未启用/,
    ],
    [
      { loras: { adapters: [] } },
      original(),
      edited({ musicKind: "instrumental" }),
      /纯音乐模型尚未就绪/,
    ],
  ]) {
    const helper = setup({ runtime });
    await assert.rejects(helper.submitRevision(job, draft), error);
    assert.equal(helper.calls.sessions.length, 0);
    assert.equal(helper.calls.submissions.length, 0);
  }
});

test("cancellation before or during lyric preparation cannot create a late revision", async () => {
  const before = new AbortController();
  before.abort();
  const helper = setup();
  await assert.rejects(
    helper.submitRevision(original(), edited(), { signal: before.signal }),
    { name: "AbortError" },
  );
  assert.equal(helper.calls.status, 0);

  const during = new AbortController();
  const streaming = setup({ onStream: () => during.abort() });
  await assert.rejects(
    streaming.submitRevision(original(), edited({ lyrics: "" }), {
      signal: during.signal,
    }),
    { name: "AbortError" },
  );
  assert.equal(streaming.calls.submissions.length, 0);
  assert.deepEqual(streaming.calls.stops, ["lyrics-session"]);

  const submitting = new AbortController();
  await assert.rejects(
    helper.submitRevision(original(), edited(), {
      signal: submitting.signal,
      onPhase: () => submitting.abort(),
    }),
    { name: "AbortError" },
  );
  assert.equal(helper.calls.submissions.length, 0);
});

test("a revision snapshots source and edited values before waiting for model status", async () => {
  const source = original({
    kind: "hum",
    params: { upload_id: "old-hum", melody: "continue", hum_influence: 0.7 },
  });
  const draft = edited();
  const helper = setup({
    onStatus: () => {
      source.params.upload_id = "new-hum";
      draft.title = "later edit";
      draft.musicKind = "instrumental";
    },
  });
  await helper.submitRevision(source, draft);
  const body = helper.calls.submissions[0];
  assert.equal(body.params.upload_id, "old-hum");
  assert.equal(body.params.title, "新的晚风");
  assert.equal(body.params.lyrics, lyrics);
});

test("failed and ambiguous submissions are attempted once without automatic retry", async () => {
  const rejected = setup({ submitError: new Error("network failed") });
  await assert.rejects(
    rejected.submitRevision(original(), edited()),
    /network failed/,
  );
  assert.equal(rejected.calls.submissions.length, 1);
  const ambiguous = setup({ result: {} });
  await assert.rejects(
    ambiguous.submitRevision(original(), edited()),
    /我的音乐.*避免重复生成/,
  );
  assert.equal(ambiguous.calls.submissions.length, 1);
});
