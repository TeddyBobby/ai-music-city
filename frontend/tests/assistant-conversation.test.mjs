import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../src/lib/assistantConversation.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const plain = (value) => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const session = (id) => ({
  id,
  title: id,
  messages: [],
  created_at: "",
  updated_at: "",
  job_id: null,
});
const audioFile = () =>
  new File(["voice bytes"], "旋律.webm", { type: "audio/webm" });
const imageFile = () =>
  new File(["image bytes"], "海边.png", { type: "image/png" });
const imageAttachment = {
  id: "image-1",
  filename: "海边.png",
  url: "/api/assistant/images/image-1",
  mime_type: "image/jpeg",
  width: 800,
  height: 600,
};
const attachment = {
  id: "audio-1",
  filename: "旋律.webm",
  url: "/api/assistant/audio/audio-1",
  seconds: 4,
  transcript: "想写一首夏天的歌",
};

function setup(options = {}) {
  const calls = {
    models: 0,
    status: 0,
    lists: 0,
    sessions: [],
    reads: [],
    uploads: [],
    images: [],
    streams: [],
    stops: [],
  };
  const storage = new Map(
    options.saved ? [["music.assistant", JSON.stringify(options.saved)]] : [],
  );
  const timers = new Map();
  let timerId = 0;
  const context = {
    exports: {},
    crypto: { randomUUID },
    AbortController,
    Error,
    setTimeout(callback) {
      const id = ++timerId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    require(name) {
      if (name === "./utils")
        return { errorMessage: (error) => error.message || String(error) };
      if (name !== "./assistant") throw new Error(`Unexpected import: ${name}`);
      return {
        assistantApi: {
          models: async () => {
            calls.models++;
            return (
              options.models?.() || {
                models: [
                  { id: "model-a", name: "A" },
                  { id: "model-b", name: "B" },
                ],
                default_model: "model-a",
                audio: {
                  available: true,
                  method: "transcription",
                  message: "",
                },
              }
            );
          },
          status: async () => {
            calls.status++;
            return { chat: { available: true } };
          },
          sessions: async () => {
            calls.lists++;
            return { sessions: [] };
          },
          newSession: async (body, signal) => {
            calls.sessions.push({ body, signal });
            return options.newSession?.(body, signal) || session("session-1");
          },
          session: async (id, signal) => {
            calls.reads.push({ id, signal });
            return options.session?.(id, signal) || session(id);
          },
          uploadAudio: async (file, signal) => {
            calls.uploads.push({ file, signal });
            return options.upload?.(file, signal) || attachment;
          },
          uploadImage: async (file, signal) => {
            calls.images.push({ file, signal });
            return options.uploadImage?.(file, signal) || imageAttachment;
          },
          stop: async (id) => {
            calls.stops.push(id);
            options.stop?.(id);
          },
        },
        streamMessage: (id, body, config) => {
          const pending = deferred();
          const stream = {
            id,
            body,
            config,
            delta: (text) => config.onEvent({ type: "delta", text }),
            done: (
              message = {
                id: "reply",
                role: "assistant",
                content: "写好了",
                status: "complete",
                suggestion: {
                  title: "夏天",
                  lyrics: "[Verse]\n夏天的风",
                  description: "流行",
                },
              },
            ) => {
              config.onEvent({ type: "done", message });
              pending.resolve();
            },
            reject: pending.reject,
          };
          calls.streams.push(stream);
          config.signal.addEventListener(
            "abort",
            () => {
              const reason = new Error("Stopped");
              reason.name = "AbortError";
              pending.reject(reason);
            },
            { once: true },
          );
          return pending.promise;
        },
      };
    },
  };
  vm.runInNewContext(compiled, context);
  return {
    store: context.exports.createAssistantConversation(),
    calls,
    storage,
    async nextPoll() {
      const next = timers.entries().next().value;
      if (!next) throw new Error("No reply poll is scheduled");
      timers.delete(next[0]);
      next[1]();
      await flush();
    },
  };
}

test("a streaming reply keeps arriving while the assistant route has no subscribers", async () => {
  const { store, calls } = setup();
  await store.init();
  let renders = 0;
  const leaveRoute = store.subscribe(() => renders++);
  store.setMode("lyrics");
  store.setInput("写一首夏天的歌");
  const sending = store.send();
  await flush();
  calls.streams[0].delta('{"title":"夏');
  leaveRoute();
  const rendersBeforeLeaving = renders;
  calls.streams[0].delta('天"}');
  assert.equal(store.getSnapshot().busy, true);
  assert.equal(calls.streams[0].config.signal.aborted, false);
  assert.equal(store.getSnapshot().messages.at(-1).content, '{"title":"夏天"}');
  calls.streams[0].done();
  await sending;
  assert.equal(renders, rendersBeforeLeaving);
  assert.deepEqual(calls.stops, []);
  const returnToRoute = store.subscribe(() => renders++);
  await store.init();
  assert.equal(store.getSnapshot().busy, false);
  assert.equal(store.getSnapshot().messages.at(-1).suggestion.title, "夏天");
  assert.equal(calls.reads.length, 0);
  assert.equal(calls.models, 1);
  returnToRoute();
});

test("quick actions change only the draft; text, model and audio survive route remounts", async () => {
  const { store, calls } = setup();
  await store.init();
  const file = audioFile();
  store.setInput("把这个想法写成一首温柔的歌");
  store.setModel("model-b");
  store.setAudio(file);
  const leaveRoute = store.subscribe(() => {});
  leaveRoute();
  await store.init();
  const state = store.getSnapshot();
  assert.equal(state.input, "把这个想法写成一首温柔的歌");
  assert.equal(state.selectedModel, "model-b");
  assert.equal(state.audio, file);
  assert.equal(
    calls.uploads.length + calls.streams.length + calls.sessions.length,
    0,
  );
});

test("rapid sends create one request and capture the selected model before audio upload", async () => {
  const uploading = deferred();
  const { store, calls } = setup({ upload: () => uploading.promise });
  await store.init();
  store.setAudio(audioFile());
  store.setInput("改成轻快的民谣");
  const sending = store.send();
  void store.send();
  store.setModel("model-b");
  assert.equal(calls.uploads.length, 1);
  assert.equal(store.getSnapshot().phase, "uploading");
  assert.equal(store.newConversation(), false);
  assert.equal(await store.openSession("another"), false);
  uploading.resolve(attachment);
  await flush();
  assert.equal(calls.streams.length, 1);
  assert.equal(calls.sessions.length, 1);
  assert.equal(calls.streams[0].body.model, "model-a");
  assert.equal(calls.streams[0].body.audio_id, attachment.id);
  assert.equal(calls.streams[0].body.content, "改成轻快的民谣");
  assert.equal(store.getSnapshot().selectedModel, "model-b");
  assert.equal(
    store.getSnapshot().messages[0].audio.transcript,
    attachment.transcript,
  );
  calls.streams[0].done();
  await sending;
});

test("only explicit stop aborts the stream and keeps the server-filtered partial reply", async () => {
  const { store, calls } = setup();
  store.setMode("lyrics");
  store.setInput("夜晚的歌");
  const sending = store.send();
  await flush();
  calls.streams[0].delta('{"title":"夜');
  store.stop();
  await sending;
  const state = store.getSnapshot();
  assert.deepEqual(calls.stops, ["session-1"]);
  assert.equal(state.messages.at(-1).content, '{"title":"夜');
  assert.equal(state.messages.at(-1).status, "stopped");
  assert.equal(state.messages.at(-1).pendingStructured, false);
  assert.equal(state.input, "夜晚的歌");
  assert.equal(state.busy, false);
  assert.equal(state.phase, null);
  assert.equal(state.canRetry, true);
  assert.equal(state.error, "");
  calls.streams[0].done({
    id: "late",
    role: "assistant",
    content: "late response",
  });
  assert.equal(store.getSnapshot().messages.at(-1).status, "stopped");
});

test("failed audio conversations preserve the file and retry with the original model and uploaded audio", async () => {
  const { store, calls } = setup();
  await store.init();
  const file = audioFile();
  store.setModel("model-a");
  store.setAudio(file);
  store.setInput("这是我的旋律，想要温柔的吉他伴奏");
  const sending = store.send();
  await flush();
  calls.streams[0].delta('{"lyrics":"');
  calls.streams[0].reject(new Error("连接中断"));
  await sending;
  assert.equal(store.getSnapshot().audio, file);
  assert.equal(store.getSnapshot().uploadedAudio.id, attachment.id);
  assert.equal(store.getSnapshot().messages.at(-1).content, '{"lyrics":"');
  assert.equal(store.getSnapshot().canRetry, true);
  store.setModel("model-b");
  const retrying = store.retry();
  await flush();
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.sessions.length, 1);
  assert.equal(calls.streams[1].body.model, "model-a");
  assert.equal(calls.streams[1].body.audio_id, attachment.id);
  calls.streams[1].done();
  await retrying;
  assert.equal(store.getSnapshot().audio, null);
  assert.equal(store.getSnapshot().canRetry, false);
  assert.equal(store.getSnapshot().error, "");
});

test("upload failure preserves the complete draft and retries the upload without creating an empty conversation", async () => {
  let failed = false;
  const { store, calls } = setup({
    upload: () => {
      if (!failed) {
        failed = true;
        throw new Error("上传失败");
      }
      return attachment;
    },
  });
  const file = audioFile();
  store.setAudio(file);
  store.setInput("参考这段节奏");
  await store.send();
  assert.equal(calls.sessions.length, 0);
  assert.equal(store.getSnapshot().audio, file);
  assert.equal(store.getSnapshot().input, "参考这段节奏");
  const retrying = store.retry();
  await flush();
  assert.equal(calls.uploads.length, 2);
  calls.streams[0].done();
  await retrying;
});

test("voice-only messages can be sent without a fabricated text description", async () => {
  const { store, calls } = setup();
  store.setAudio(audioFile());
  const sending = store.send();
  await flush();
  assert.equal(calls.streams[0].body.content, "");
  assert.equal(calls.streams[0].body.audio_id, attachment.id);
  assert.equal(store.getSnapshot().messages[0].audio.url, attachment.url);
  calls.streams[0].done();
  await sending;
});

test("a newly written draft is not replaced by the failure or retry of an older request", async () => {
  const { store, calls } = setup();
  store.setInput("第一首歌");
  const sending = store.send();
  await flush();
  store.setInput("第二首歌的新想法");
  const newFile = audioFile();
  store.setAudio(newFile);
  calls.streams[0].reject(new Error("连接中断"));
  await sending;
  assert.equal(store.getSnapshot().input, "第二首歌的新想法");
  const retrying = store.retry();
  await flush();
  assert.equal(calls.streams[1].body.content, "第一首歌");
  assert.equal(store.getSnapshot().input, "第二首歌的新想法");
  assert.equal(store.getSnapshot().audio, newFile);
  calls.streams[1].done();
  await retrying;
  assert.equal(store.getSnapshot().input, "第二首歌的新想法");
});

test("late history responses cannot overwrite a newer session or a new conversation", async () => {
  const requests = new Map();
  const { store } = setup({
    session: (id) => {
      const pending = deferred();
      requests.set(id, pending);
      return pending.promise;
    },
  });
  const first = store.openSession("old");
  const second = store.openSession("recent");
  requests.get("recent").resolve(session("recent"));
  await second;
  requests.get("old").resolve(session("old"));
  await first;
  assert.equal(store.getSnapshot().current.id, "recent");
  const third = store.openSession("another");
  store.newConversation();
  store.setInput("新对话的草稿");
  requests.get("another").resolve(session("another"));
  await third;
  assert.equal(store.getSnapshot().current, null);
  assert.equal(store.getSnapshot().sessionLoading, false);
  assert.equal(store.getSnapshot().input, "新对话的草稿");
});

test("initialization restores only session, model and mode metadata, never audio or content into browser storage", async () => {
  const { store, calls, storage } = setup({
    saved: { session: "saved", model: "model-b", mode: "lyrics" },
  });
  await store.init();
  assert.equal(store.getSnapshot().current.id, "saved");
  assert.equal(store.getSnapshot().selectedModel, "model-b");
  store.setAudio(audioFile());
  store.setInput("私人草稿");
  await store.init();
  assert.equal(calls.reads.length, 1);
  assert.deepEqual(plain(JSON.parse(storage.get("music.assistant"))), {
    session: "saved",
    model: "model-b",
    mode: "lyrics",
  });
  assert.equal(store.getSnapshot().mode, "lyrics");
  store.newConversation();
  await store.init();
  assert.equal(store.getSnapshot().current, null);
  assert.equal(calls.reads.length, 1);
});

test("stopping while session creation is pending prevents a late stream from starting", async () => {
  const pending = deferred();
  const { store, calls } = setup({ newSession: () => pending.promise });
  store.setInput("稍后再写");
  const sending = store.send();
  store.stop();
  pending.resolve(session("late-session"));
  await sending;
  assert.equal(calls.streams.length, 0);
  assert.deepEqual(calls.stops, ["late-session"]);
  assert.equal(store.getSnapshot().busy, false);
  assert.equal(store.getSnapshot().input, "稍后再写");
});

test("reopening conversational history displays server-filtered replies and preserves legacy cards", async () => {
  const { store } = setup({
    session: (id) => ({
      ...session(id),
      active: false,
      messages: [
        {
          id: "failed",
          role: "assistant",
          mode: "lyrics",
          content: '```json\n{"lyrics":"',
          status: "error",
        },
        {
          id: "stopped",
          role: "assistant",
          content: "这首歌可以用吉他伴奏",
          status: "stopped",
        },
        {
          id: "stale",
          role: "assistant",
          content: "",
          status: "streaming",
          mode: "lyrics",
        },
        {
          id: "complete",
          role: "assistant",
          content: '{"title":"夏天"}',
          status: "complete",
          suggestion: { title: "夏天" },
        },
        {
          id: "fence",
          role: "assistant",
          mode: "lyrics",
          content: "```json\n",
          status: "error",
        },
      ],
    }),
  });
  await store.openSession("history");
  const messages = store.getSnapshot().messages;
  assert.equal(messages[0].pendingStructured, false);
  assert.equal(messages[0].content, '```json\n{"lyrics":"');
  assert.equal(messages[1].pendingStructured, false);
  assert.equal(messages[2].status, "interrupted");
  assert.equal(messages[2].pendingStructured, false);
  assert.equal(messages[3].suggestion.title, "夏天");
  assert.equal(messages[4].pendingStructured, false);
  assert.equal(store.getSnapshot().busy, false);
});

test("a restored active conversation polls checkpoints to completion without resending or requiring a mounted route", async () => {
  let complete = false;
  const { store, calls, nextPoll } = setup({
    saved: { session: "running" },
    session: (id) => ({
      ...session(id),
      active: !complete,
      messages: [
        {
          id: "answer",
          role: "assistant",
          content: complete ? "完成了" : '{"title":"',
          status: complete ? "complete" : "streaming",
          ...(complete ? { suggestion: { title: "恢复的音乐" } } : {}),
        },
      ],
    }),
  });
  const leaveRoute = store.subscribe(() => {});
  await store.init();
  await flush();
  assert.equal(store.getSnapshot().busy, true);
  assert.equal(store.newConversation(), false);
  assert.equal(await store.openSession("other"), false);
  store.setInput("等回复后修改的草稿");
  await store.send();
  assert.equal(calls.streams.length, 0);
  leaveRoute();
  complete = true;
  await nextPoll();
  assert.equal(store.getSnapshot().busy, false);
  assert.equal(store.getSnapshot().messages[0].suggestion.title, "恢复的音乐");
  assert.equal(store.getSnapshot().phase, null);
  assert.equal(store.getSnapshot().input, "等回复后修改的草稿");
  assert.deepEqual(calls.stops, []);
});

test("explicit stop also stops a restored backend reply and reads its final state", async () => {
  let stopped = false;
  const { store, calls } = setup({
    saved: { session: "running" },
    stop: () => {
      stopped = true;
    },
    session: (id) => ({
      ...session(id),
      active: !stopped,
      messages: [
        {
          id: "answer",
          role: "assistant",
          content: '{"title":"',
          mode: "lyrics",
          status: stopped ? "stopped" : "streaming",
        },
      ],
    }),
  });
  await store.init();
  await flush();
  store.stop();
  await flush();
  assert.deepEqual(calls.stops, ["running"]);
  assert.equal(store.getSnapshot().busy, false);
  assert.equal(store.getSnapshot().messages[0].status, "stopped");
  assert.equal(store.getSnapshot().phase, null);
  assert.equal(store.getSnapshot().messages[0].pendingStructured, false);
});

test("model discovery failure ends loading and supports an explicit successful retry", async () => {
  let failed = false;
  const { store, calls } = setup({
    models: () => {
      if (!failed) {
        failed = true;
        throw new Error("模型服务暂时不可用");
      }
      return {
        models: [{ id: "recovered", name: "已恢复模型" }],
        default_model: "recovered",
        audio: { available: true, method: "transcription", message: "" },
      };
    },
  });
  await store.init();
  assert.equal(store.getSnapshot().modelsLoading, false);
  assert.equal(store.getSnapshot().modelsError, "模型服务暂时不可用");
  await store.refreshModels();
  assert.equal(calls.models, 2);
  assert.equal(store.getSnapshot().modelsError, "");
  assert.equal(store.getSnapshot().modelsLoading, false);
  assert.equal(store.getSnapshot().selectedModel, "recovered");
});

test("model selection stays within the returned catalog even with a stale saved default", async () => {
  const { store } = setup({
    saved: { model: "removed-model" },
    models: () => ({
      models: [{ id: "available", name: "可用模型" }],
      default_model: "removed-model",
      audio: { available: false, method: "transcription", message: "" },
    }),
  });
  await store.init();
  assert.equal(store.getSnapshot().selectedModel, "available");
  store.setModel("removed-model");
  assert.equal(store.getSnapshot().selectedModel, "available");
});

test("empty and failed model refreshes remove stale selectable models", async () => {
  let catalog = {
    models: [{ id: "available", name: "可用模型" }],
    default_model: "available",
    audio: { available: false, method: "transcription", message: "" },
  };
  const { store } = setup({ models: () => catalog });
  await store.init();
  catalog = { ...catalog, models: [] };
  await store.refreshModels();
  assert.equal(store.getSnapshot().selectedModel, "");
  assert.equal(store.getSnapshot().models.length, 0);

  catalog = { ...catalog, models: [{ id: "available", name: "可用模型" }] };
  await store.refreshModels();
  assert.equal(store.getSnapshot().selectedModel, "available");
  catalog = Promise.reject(new Error("模型列表暂时无法获取"));
  await store.refreshModels();
  assert.equal(store.getSnapshot().selectedModel, "");
  assert.equal(store.getSnapshot().models.length, 0);
  assert.equal(store.getSnapshot().modelsError, "模型列表暂时无法获取");
});

test("a missing restored session releases busy state instead of polling forever", async () => {
  let reads = 0;
  const { store } = setup({
    saved: { session: "removed" },
    session: (id) => {
      if (++reads > 1)
        throw Object.assign(new Error("会话不存在"), { status: 404 });
      return { ...session(id), active: true, messages: [] };
    },
  });
  await store.init();
  await flush();
  assert.equal(store.getSnapshot().busy, false);
  assert.equal(store.getSnapshot().error, "会话不存在");
  assert.equal(store.getSnapshot().phase, null);
  assert.equal(store.newConversation(), true);
});

test("a disconnected delivery stream adopts the still-active backend reply and completes without resubmission", async () => {
  let complete = false;
  const { store, calls, nextPoll } = setup({
    session: (id) => ({
      ...session(id),
      active: !complete,
      messages: [
        {
          id: "user",
          role: "user",
          content: "写一首海边的歌",
          status: "complete",
        },
        {
          id: "server-reply",
          role: "assistant",
          content: complete ? "已完成" : '{"lyrics":"',
          status: complete ? "complete" : "streaming",
          ...(complete ? { suggestion: { title: "海风" } } : {}),
        },
      ],
    }),
  });
  store.setInput("写一首海边的歌");
  const sending = store.send();
  await flush();
  calls.streams[0].reject(new Error("stream disconnected"));
  await sending;
  await flush();
  assert.equal(store.getSnapshot().busy, true);
  assert.equal(store.getSnapshot().canRetry, false);
  assert.equal(store.getSnapshot().error, "");
  assert.equal(store.getSnapshot().input, "");
  assert.equal(store.getSnapshot().messages.at(-1).id, "server-reply");
  assert.equal(store.newConversation(), false);
  store.setInput("稍后想要修改的想法");
  await store.send();
  assert.equal(calls.streams.length, 1);
  complete = true;
  await nextPoll();
  assert.equal(store.getSnapshot().busy, false);
  assert.equal(store.getSnapshot().messages.at(-1).suggestion.title, "海风");
  assert.equal(store.getSnapshot().input, "稍后想要修改的想法");
  assert.equal(calls.sessions.length, 1);
  assert.deepEqual(calls.stops, []);
});

test("a recovered backend failure restores the original audio draft for an explicit retry", async () => {
  let failed = false;
  const { store, calls, nextPoll } = setup({
    session: (id) => ({
      ...session(id),
      active: !failed,
      messages: [
        {
          id: "server-reply",
          role: "assistant",
          content: '{"lyrics":"',
          status: failed ? "error" : "streaming",
        },
      ],
    }),
  });
  const file = audioFile();
  store.setAudio(file);
  store.setInput("用这段语音写歌");
  const sending = store.send();
  await flush();
  calls.streams[0].reject(new Error("stream disconnected"));
  await sending;
  await flush();
  failed = true;
  await nextPoll();
  assert.equal(store.getSnapshot().busy, false);
  assert.equal(store.getSnapshot().canRetry, true);
  assert.equal(store.getSnapshot().audio, file);
  assert.equal(store.getSnapshot().input, "用这段语音写歌");
  assert.equal(store.getSnapshot().uploadedAudio.id, attachment.id);
  const retrying = store.retry();
  await flush();
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.streams[1].body.audio_id, attachment.id);
  calls.streams[1].done();
  await retrying;
});

test("account disposal detaches the live reply, clears private state and never cancels backend work", async () => {
  const { store, calls } = setup();
  store.setInput("账号 A 的私人灵感");
  const sending = store.send();
  await flush();
  assert.equal(calls.streams.length, 1);
  store.dispose();
  assert.equal(calls.streams[0].config.signal.aborted, true);
  assert.deepEqual(calls.stops, []);
  assert.equal(store.getSnapshot().current, null);
  assert.equal(store.getSnapshot().input, "");
  assert.equal(store.getSnapshot().messages.length, 0);
  calls.streams[0].done();
  await sending;
  assert.equal(store.getSnapshot().messages.length, 0);
  store.setInput("late stale handler");
  await store.send();
  assert.equal(calls.streams.length, 1);
});

test("chat is the default and streams visible text before an optional explicit proposal", async () => {
  const { store, calls } = setup();
  assert.equal(store.getSnapshot().mode, "chat");
  store.setInput("hi");
  const sending = store.send();
  await flush();
  const stream = calls.streams[0];
  assert.equal(stream.body.mode, "chat");
  assert.equal(store.getSnapshot().messages[0].mode, "chat");
  stream.delta('{"title":"a JSON example');
  assert.equal(store.getSnapshot().messages.at(-1).pendingStructured, false);
  assert.equal(
    store.getSnapshot().messages.at(-1).content,
    '{"title":"a JSON example',
  );
  // Only the backend decides whether an explicit proposal is ready.
  stream.done({
    id: "reply",
    role: "assistant",
    content: "你好，想聊聊什么样的音乐？",
    mode: "chat",
    status: "complete",
  });
  await sending;
  assert.equal(store.getSnapshot().messages.at(-1).suggestion, undefined);
  assert.equal(store.getSnapshot().messages.at(-1).mode, "chat");
});

test("lyrics mode streams natural discussion and can present a proposal on completion", async () => {
  const { store, calls } = setup();
  store.setMode("lyrics");
  store.setInput("写一段歌词");
  const sending = store.send();
  await flush();
  const stream = calls.streams[0];
  assert.equal(stream.body.mode, "lyrics");
  stream.delta('{"lyrics":"');
  assert.equal(store.getSnapshot().messages.at(-1).pendingStructured, false);
  stream.done();
  await sending;
  assert.equal(store.getSnapshot().messages.at(-1).suggestion.title, "夏天");
  assert.equal(store.getSnapshot().messages.at(-1).pendingStructured, false);
  assert.equal(store.getSnapshot().messages.at(-1).mode, "lyrics");
});

test("the submitted mode is captured before upload and retained on retry after switching modes", async () => {
  const uploading = deferred();
  const { store, calls } = setup({ upload: () => uploading.promise });
  store.setMode("lyrics");
  store.setAudio(audioFile());
  store.setInput("给这段旋律写词");
  const sending = store.send();
  store.setMode("chat");
  uploading.resolve(attachment);
  await flush();
  assert.equal(calls.streams[0].body.mode, "lyrics");
  calls.streams[0].reject(new Error("连接中断"));
  await sending;
  const retrying = store.retry();
  await flush();
  assert.equal(calls.streams[1].body.mode, "lyrics");
  assert.equal(store.getSnapshot().mode, "chat");
  assert.equal(store.getSnapshot().messages.at(-1).pendingStructured, false);
  calls.streams[1].done();
  await retrying;
  assert.equal(store.getSnapshot().messages.at(-1).mode, "lyrics");
});

test("mode survives route remounts and only valid mode metadata enters session storage", async () => {
  const { store, calls, storage } = setup({ saved: { mode: "invalid" } });
  assert.equal(store.getSnapshot().mode, "chat");
  await store.init();
  store.setMode("lyrics");
  store.setInput("私人的创作内容");
  const leaveRoute = store.subscribe(() => {});
  leaveRoute();
  await store.init();
  assert.equal(store.getSnapshot().mode, "lyrics");
  assert.equal(calls.streams.length, 0);
  assert.deepEqual(JSON.parse(storage.get("music.assistant")), {
    model: "model-a",
    mode: "lyrics",
  });
  store.setMode("invalid");
  assert.equal(store.getSnapshot().mode, "lyrics");
});

test("restored chat and untyped legacy JSON stay readable while existing legacy song cards survive", async () => {
  const { store } = setup({
    session: (id) => ({
      ...session(id),
      active: false,
      messages: [
        {
          id: "chat",
          role: "assistant",
          mode: "chat",
          content: '{"lyrics":"example',
          status: "streaming",
          pendingStructured: true,
        },
        {
          id: "legacy",
          role: "assistant",
          content: '```json\n{"title":"example',
          status: "error",
        },
        {
          id: "legacy-song",
          role: "assistant",
          content: '{"title":"old song"}',
          status: "complete",
          suggestion: { title: "old song" },
        },
        {
          id: "chat-complete",
          role: "assistant",
          mode: "chat",
          content: '{"title":"explanation"}',
          status: "complete",
          suggestion: { title: "explanation" },
        },
      ],
    }),
  });
  await store.openSession("history");
  const messages = store.getSnapshot().messages;
  assert.equal(messages[0].status, "interrupted");
  assert.equal(messages[0].pendingStructured, false);
  assert.equal(messages[1].pendingStructured, false);
  assert.equal(messages[2].suggestion.title, "old song");
  assert.equal(messages[3].suggestion.title, "explanation");
});

test("both conversation modes accept a server proposal alongside readable discussion", async () => {
  for (const mode of ["chat", "lyrics"]) {
    const { store, calls } = setup();
    store.setMode(mode);
    store.setInput("可以发歌了");
    const sending = store.send();
    await flush();
    calls.streams[0].delta("我把方向整理好了。\n");
    assert.equal(store.getSnapshot().messages.at(-1).pendingStructured, false);
    calls.streams[0].done({
      id: "reply",
      role: "assistant",
      mode,
      status: "complete",
      content: "我把方向整理好了。",
      suggestion: {
        title: "海风",
        description: "轻柔吉他",
        lyrics: "",
        music_kind: "instrumental",
      },
    });
    await sending;
    assert.equal(
      store.getSnapshot().messages.at(-1).content,
      "我把方向整理好了。",
    );
    assert.equal(
      store.getSnapshot().messages.at(-1).suggestion.music_kind,
      "instrumental",
    );
  }
});

test("image and audio intent survive route changes and retry without duplicate uploads", async () => {
  const { store, calls, storage } = setup();
  const image = imageFile();
  const audio = audioFile();
  store.setImage(image);
  store.setAudio(audio);
  store.setInput("想要这种海边的感觉，轻柔一点");
  await store.init();
  assert.equal(store.getSnapshot().image, image);
  assert.equal(store.getSnapshot().audio, audio);
  const sending = store.send();
  await flush();
  assert.equal(calls.images.length, 1);
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.streams[0].body.image_id, imageAttachment.id);
  assert.equal(calls.streams[0].body.audio_id, attachment.id);
  assert.equal(store.getSnapshot().messages[0].image.url, imageAttachment.url);
  calls.streams[0].reject(new Error("连接中断"));
  await sending;
  assert.equal(store.getSnapshot().image, image);
  assert.equal(store.getSnapshot().uploadedImage.id, imageAttachment.id);
  const retrying = store.retry();
  await flush();
  assert.equal(calls.images.length, 1);
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.streams[1].body.image_id, imageAttachment.id);
  calls.streams[1].done();
  await retrying;
  assert.equal(store.getSnapshot().image, null);
  assert.equal(store.getSnapshot().uploadedImage, null);
  assert.equal(storage.get("music.assistant").includes("海边"), false);
});

test("image-only input is submitted and an upload failure preserves it before session creation", async () => {
  let fail = true;
  const { store, calls } = setup({
    uploadImage: () => {
      if (fail) throw new Error("图片上传失败");
      return imageAttachment;
    },
  });
  const image = imageFile();
  store.setImage(image);
  await store.send();
  assert.equal(calls.sessions.length, 0);
  assert.equal(store.getSnapshot().image, image);
  assert.equal(store.getSnapshot().canRetry, true);
  fail = false;
  const retrying = store.retry();
  await flush();
  assert.equal(calls.streams[0].body.content, "");
  assert.equal(calls.streams[0].body.image_id, imageAttachment.id);
  assert.equal(calls.sessions[0].body.title, "图片灵感");
  calls.streams[0].done();
  await retrying;
});

test("audio without transcribable speech remains a normal conversation attachment", async () => {
  const noSpeech = {
    ...attachment,
    transcript: "",
    transcription_status: "no_speech",
  };
  const { store, calls } = setup({ upload: () => noSpeech });
  store.setAudio(audioFile());
  const sending = store.send();
  await flush();
  assert.equal(calls.streams[0].body.audio_id, noSpeech.id);
  assert.equal(calls.streams[0].body.content, "");
  assert.equal(
    store.getSnapshot().messages[0].audio.transcription_status,
    "no_speech",
  );
  calls.streams[0].done({
    id: "reply",
    role: "assistant",
    content: "你想表达什么样的情绪？",
    status: "complete",
    mode: "chat",
  });
  await sending;
  assert.equal(store.getSnapshot().error, "");
  assert.equal(store.getSnapshot().canRetry, false);
  assert.equal(store.getSnapshot().messages.at(-1).suggestion, undefined);
});

test("done ends the replying phase before transport EOF without unlocking duplicate submission", async () => {
  const uploading = deferred();
  const { store, calls } = setup({ upload: () => uploading.promise });
  store.setAudio(audioFile());
  store.setInput("先聊一下这段灵感");
  const sending = store.send();
  assert.equal(store.getSnapshot().busy, true);
  assert.equal(store.getSnapshot().phase, "uploading");
  uploading.resolve(attachment);
  await flush();
  assert.equal(store.getSnapshot().phase, "replying");
  assert.equal(store.getSnapshot().messages.at(-1).status, "streaming");
  calls.streams[0].delta("我们先聊聊想表达的情绪。");
  assert.equal(store.getSnapshot().phase, "replying");
  calls.streams[0].config.onEvent({
    type: "done",
    message: {
      id: "reply",
      role: "assistant",
      content: "我们先聊聊想表达的情绪。",
      status: "complete",
      mode: "chat",
    },
  });
  assert.equal(store.getSnapshot().phase, null);
  assert.equal(store.getSnapshot().messages.at(-1).status, "complete");
  assert.equal(store.getSnapshot().busy, true);
  store.setInput("下一条消息");
  await store.send();
  assert.equal(calls.streams.length, 1);
  assert.equal(store.newConversation(), false);
  calls.streams[0].done();
  await sending;
  assert.equal(store.getSnapshot().busy, false);
  assert.equal(store.getSnapshot().phase, null);
  assert.equal(store.getSnapshot().input, "下一条消息");
});
