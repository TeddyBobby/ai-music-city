import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../src/lib/musicCreation.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const song = {
  title: " 晚风 ",
  description: " 温暖的木吉他流行，清澈人声 ",
  lyrics:
    " [Verse]\n晚风轻轻吹过街角\n你的笑容留在心上\n[Chorus]\n陪你走过每个日落 ",
};
const plain = (value) => JSON.parse(JSON.stringify(value));

function setup({
  suggestion = song,
  streamError,
  submitError,
  onStream,
  onStatus,
  runtime = {},
  adapters = ["ar_lora_inst_v3abc.bf16", "nar_lora_joint_v4.bf16"].map(
    (name) => ({ name, valid: true }),
  ),
  result = { job: { id: "song-1", status: "queued" } },
} = {}) {
  const calls = {
    sessions: [],
    messages: [],
    submissions: [],
    stops: [],
    status: 0,
  };
  const context = {
    exports: {},
    DOMException,
    require: (name) => {
      if (name === "./api")
        return {
          api: {
            status: async () => {
              calls.status += 1;
              onStatus?.();
              return { ...runtime, loras: { adapters } };
            },
            submit: async (body) => {
              calls.submissions.push(body);
              if (submitError) throw submitError;
              return result;
            },
          },
        };
      if (name === "./assistant")
        return {
          assistantApi: {
            newSession: async (body) => {
              calls.sessions.push(body);
              return { id: "session-1" };
            },
            stop: async (id) => {
              calls.stops.push(id);
            },
          },
          streamMessage: async (session, body, options) => {
            calls.messages.push({ session, body });
            onStream?.(options);
            if (streamError) throw streamError;
            options.onEvent({ type: "done", message: { suggestion } });
          },
        };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  return { ...context.exports, calls };
}

test("one prompt writes a real structured draft before submitting one default music job", async () => {
  const api = setup(),
    phases = [];
  const result = await api.generateFromPrompt(" 海边日落 ", {
    onPhase: (phase) => phases.push(phase),
  });
  assert.equal(result.id, "song-1");
  assert.match(api.calls.messages[0].body.content, /^海边日落\n\n/);
  assert.match(
    api.calls.messages[0].body.content,
    /用户已确认开始生成.*无需再追问/,
  );
  assert.equal(api.calls.messages[0].body.mode, "lyrics");
  assert.deepEqual(phases, ["writing", "submitting"]);
  assert.deepEqual(plain(api.calls.submissions), [
    {
      kind: "create",
      preset: "fast",
      loras: [],
      params: {
        title: "晚风",
        style: `${song.description.trim()}，人声演唱，带歌词`,
        lyrics: song.lyrics.trim(),
        cot: "full",
        seed: null,
        cfg_scale: null,
        abc: null,
      },
    },
  ]);
});

test("missing structured output, missing style and placeholder lyrics never reach the engine", async () => {
  for (const suggestion of [
    null,
    { lyrics: song.lyrics },
    { description: "流行", lyrics: "[Verse]\n[Chorus]" },
    { description: "流行", lyrics: "用户的一句话提示" },
  ]) {
    const api = setup({ suggestion });
    await assert.rejects(api.generateFromPrompt("海边日落"), /曲风|歌词/);
    assert.equal(api.calls.submissions.length, 0);
  }
});

test("empty input and pre-cancelled requests do not create sessions", async () => {
  const api = setup();
  await assert.rejects(api.generateFromPrompt("  "), /写下/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    api.generateFromPrompt("日落", { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(api.calls.sessions.length, 0);
});

test("cancelling the draft stops the assistant and cannot submit a late final event", async () => {
  const controller = new AbortController();
  const api = setup({ onStream: () => controller.abort() });
  await assert.rejects(
    api.generateFromPrompt("日落", { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.deepEqual(api.calls.stops, ["session-1"]);
  assert.equal(api.calls.submissions.length, 0);
});

test("cancelling at the submission phase prevents a music job", async () => {
  const controller = new AbortController(),
    api = setup();
  await assert.rejects(
    api.generateFromPrompt("日落", {
      signal: controller.signal,
      onPhase: (phase) => {
        if (phase === "submitting") controller.abort();
      },
    }),
    { name: "AbortError" },
  );
  assert.equal(api.calls.submissions.length, 0);
});

test("stream and submission failures do not automatically retry", async () => {
  const disconnected = setup({ streamError: new Error("stream disconnected") });
  await assert.rejects(
    disconnected.generateFromPrompt("日落"),
    /stream disconnected/,
  );
  assert.equal(disconnected.calls.messages.length, 1);
  assert.equal(disconnected.calls.submissions.length, 0);
  const rejected = setup({ submitError: new Error("engine rejected") });
  await assert.rejects(
    rejected.generateFromSuggestion(song),
    /engine rejected/,
  );
  assert.equal(rejected.calls.submissions.length, 1);
});

test("an ambiguous engine response directs the user to the library without resubmission", async () => {
  const api = setup({ result: {} });
  await assert.rejects(api.generateFromSuggestion(song), /我的音乐.*避免重复/);
  assert.equal(api.calls.submissions.length, 1);
});

test("humming can prepare a validated draft without submitting a create job", async () => {
  const api = setup();
  const draft = await api.prepareMusicDraft("轻快哼唱");
  assert.equal(draft.description, song.description.trim());
  assert.equal(draft.lyrics, song.lyrics.trim());
  assert.equal(api.calls.submissions.length, 0);
});

test("an explicit instrumental prompt uses the two installed adapters without asking AI for lyrics", async () => {
  const api = setup();
  await api.generateFromPrompt("适合读书的钢琴纯音乐");
  assert.equal(api.calls.sessions.length, 0);
  assert.equal(api.calls.submissions.length, 1);
  const body = api.calls.submissions[0];
  assert.equal(body.params.lyrics, "[Intro]");
  assert.equal(body.params.cot, "full");
  assert.match(body.params.style, /纯音乐，无人声/);
  assert.deepEqual(plain(body.loras), [
    { name: "ar_lora_inst_v3abc.bf16", scale: 1 },
    { name: "nar_lora_joint_v4.bf16", scale: 1 },
  ]);
});

test("instrumental generation checks actual installed adapters and can be cancelled before submission", async () => {
  const missing = setup({
    adapters: [{ name: "ar_lora_inst_v3abc.bf16", valid: true }],
  });
  await assert.rejects(
    missing.generateFromPrompt("piano instrumental"),
    /纯音乐模型尚未就绪/,
  );
  assert.equal(missing.calls.submissions.length, 0);
  const controller = new AbortController();
  const cancelled = setup({ onStatus: () => controller.abort() });
  await assert.rejects(
    cancelled.generateFromPrompt("无人声钢琴", { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(cancelled.calls.submissions.length, 0);
});

test("negated instrumental requests keep the regular song path", async () => {
  const api = setup();
  for (const prompt of [
    "不是纯音乐，要有清澈女声",
    "不要纯音乐",
    "not an instrumental",
    "non-instrumental song",
  ]) {
    assert.equal(api.isInstrumentalPrompt(prompt), false);
  }
  await api.generateFromPrompt("不是纯音乐，要有清澈女声");
  assert.equal(api.calls.messages.length, 1);
  assert.equal(api.calls.submissions[0].params.lyrics, song.lyrics.trim());
});

test("an instrumental assistant draft can generate without fake sung lyrics", async () => {
  const api = setup();
  await api.generateFromSuggestion({
    title: "月光",
    description: "柔和的钢琴纯音乐",
    lyrics: "[Intro]",
  });
  assert.equal(api.calls.submissions[0].params.lyrics, "[Intro]");
  assert.equal(api.calls.submissions[0].loras.length, 2);
});

test("proposal music kind is preserved even when the description does not repeat it", async () => {
  const suggestion = {
    title: "晚风",
    description: "木吉他与钢琴，舒缓温暖",
    lyrics: "",
    music_kind: "instrumental",
  };
  const api = setup({ suggestion });
  const draft = await api.prepareMusicDraft("用木吉他表达晚风");
  assert.equal(draft.music_kind, "instrumental");
  await api.generateFromSuggestion(suggestion);
  assert.equal(api.calls.submissions[0].params.lyrics, "[Intro]");
  assert.equal(api.calls.submissions[0].loras.length, 2);
});

test("cancellation stays attached when AI returns an instrumental arrangement", async () => {
  const controller = new AbortController();
  const api = setup({
    suggestion: { ...song, description: "钢琴纯音乐" },
    onStatus: () => controller.abort(),
  });
  await assert.rejects(
    api.generateFromPrompt("帮我写一段钢琴音乐", { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(api.calls.submissions.length, 0);
});

test("small Macs use installed 4-bit weights while other machines preserve fast defaults", () => {
  const api = setup();
  const smallMac = {
    memory: { machine_ram_gib: 16 },
    models: { precisions: ["8bit", "4bit"] },
  };
  assert.deepEqual(plain(api.defaultMusicOptions(smallMac)), {
    preset: "custom",
    precision: "4bit",
    ode_steps: 8,
  });
  for (const status of [
    { ...smallMac, memory: { machine_ram_gib: 32 } },
    { ...smallMac, models: { precisions: ["8bit"] } },
    { models: { precisions: ["4bit", "8bit"] } },
    { ...smallMac, memory: { machine_ram_gib: 0 } },
  ])
    assert.deepEqual(plain(api.defaultMusicOptions(status)), {
      preset: "fast",
    });
});

test("one status snapshot supplies readiness and memory options for both songs and instrumentals", async () => {
  for (const prompt of ["夏日流行歌", "温柔钢琴纯音乐"]) {
    const api = setup({
      runtime: {
        memory: { machine_ram_gib: 16 },
        models: { present: true, precisions: ["4bit", "8bit"] },
      },
    });
    await api.generateFromPrompt(prompt);
    assert.equal(api.calls.status, 1);
    assert.equal(api.calls.submissions[0].preset, "custom");
    assert.equal(api.calls.submissions[0].precision, "4bit");
    assert.equal(api.calls.submissions[0].ode_steps, 8);
  }
});

test("missing music models fail before an AI request or engine submission", async () => {
  const api = setup({
    runtime: { models: { present: false, precisions: [] } },
  });
  await assert.rejects(api.generateFromPrompt("写一首歌"), /音乐模型尚未就绪/);
  assert.equal(api.calls.status, 1);
  assert.equal(api.calls.messages.length, 0);
  assert.equal(api.calls.submissions.length, 0);
});

for (const [source, prompt] of [
  ["sentence", "给傍晚的散步写一首温柔的歌"],
  [
    "image mood",
    "图片氛围：雨后的森林，薄雾、绿意、安静的光线；配器建议：木吉他与钢琴纯音乐",
  ],
]) {
  for (const musicKind of ["instrumental", "vocal"]) {
    test(`${source} explicitly generates ${musicKind} regardless of prompt or assistant wording`, async () => {
      const api = setup({
        suggestion: { ...song, description: "温暖木吉他与钢琴纯音乐，无人声" },
      });
      await api.generateFromPrompt(prompt, { musicKind });
      const sent = api.calls.submissions[0];
      assert.equal(api.calls.submissions.length, 1);
      assert.equal(sent.kind, "create");
      if (musicKind === "instrumental") {
        assert.equal(api.calls.messages.length, 0);
        assert.equal(sent.params.lyrics, "[Intro]");
        assert.deepEqual(plain(sent.loras), [
          { name: "ar_lora_inst_v3abc.bf16", scale: 1 },
          { name: "nar_lora_joint_v4.bf16", scale: 1 },
        ]);
      } else {
        assert.equal(api.calls.messages.length, 1);
        assert.match(
          api.calls.messages[0].body.content,
          /必须创作完整可演唱歌词/,
        );
        assert.equal(sent.params.lyrics, song.lyrics.trim());
        assert.equal(sent.loras.length, 0);
        assert.match(sent.params.style, /人声演唱，带歌词/);
        assert.doesNotMatch(sent.params.style, /纯音乐|无人声/);
      }
    });
  }
}

test("explicit instrumental selection never falls back to vocals when adapters are missing", async () => {
  const api = setup({ adapters: [] });
  await assert.rejects(
    api.generateFromPrompt("温柔的女声情歌", { musicKind: "instrumental" }),
    /纯音乐模型尚未就绪/,
  );
  assert.equal(api.calls.messages.length, 0);
  assert.equal(api.calls.submissions.length, 0);
});

test("an explicit vocal selection rejects an instrumental-only assistant draft", async () => {
  const api = setup({
    suggestion: { description: "钢琴纯音乐", lyrics: "[Intro]" },
  });
  await assert.rejects(
    api.generateFromPrompt("钢琴纯音乐", { musicKind: "vocal" }),
    /歌词尚未完成/,
  );
  await assert.rejects(
    api.generateFromSuggestion(
      { description: "钢琴纯音乐", lyrics: "[Intro]" },
      { musicKind: "vocal" },
    ),
    /歌词尚未完成/,
  );
  assert.equal(api.calls.messages.length, 1);
  assert.equal(api.calls.submissions.length, 0);
});

test("style-only instrumental preparation does not require fake lyrics or a lyric-writing session", async () => {
  const api = setup();
  const draft = await api.prepareMusicDraft("雨后森林的氛围", {
    musicKind: "instrumental",
  });
  assert.equal(draft.description, "雨后森林的氛围");
  assert.equal(draft.lyrics, "[Intro]");
  assert.equal(api.calls.messages.length, 0);
  assert.equal(api.calls.submissions.length, 0);
});
