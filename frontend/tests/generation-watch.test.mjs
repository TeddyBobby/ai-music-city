import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  await readFile(
    new URL("../src/lib/generationWatch.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;
const flush = () => new Promise(setImmediate);
const plain = (value) => JSON.parse(JSON.stringify(value));
const job = (status = "running", extra = {}) => ({
  id: "music-1",
  title: "山间清晨",
  status,
  kind: "create",
  params: { style: "warm piano", lyrics: "[Intro]" },
  progress: { type: "stage", stage: "load", completed: 0, total: 1 },
  ...extra,
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Replace only HTTP, event transport and the clock. Lifecycle/race decisions
// execute in the real observer; no music job or engine is started by these tests.
function setup() {
  const requests = [],
    streams = [],
    jobs = [],
    errors = [],
    canceled = [];
  const intervals = new Map();
  let timerId = 0;
  const context = {
    exports: {},
    setInterval(callback, delay) {
      const id = ++timerId;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    require(name) {
      assert.equal(name, "./api");
      return {
        api: {
          job(id) {
            const request = { id, ...deferred() };
            requests.push(request);
            return request.promise;
          },
          cancel(id) {
            canceled.push(id);
          },
        },
        subscribe(id, handlers) {
          const stream = { id, handlers, closes: 0 };
          streams.push(stream);
          return () => stream.closes++;
        },
      };
    },
  };
  vm.runInNewContext(compiled, context);
  const watcher = context.exports.watchGeneration("music-1", {
    onJob: (value) => jobs.push(plain(value)),
    onError: (error) => errors.push(error),
  });
  return {
    watcher,
    requests,
    streams,
    jobs,
    errors,
    canceled,
    intervals,
    async resolve(index, value) {
      requests[index].resolve({ job: value });
      await flush();
    },
    async reject(index, error) {
      requests[index].reject(error);
      await flush();
    },
    async tick() {
      for (const { callback } of [...intervals.values()]) callback();
      await flush();
    },
  };
}

test("opening or refreshing a running generation reads its persisted task before observing new events", async (t) => {
  const h = setup();
  t.after(() => h.watcher.close());
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].id, "music-1");
  assert.equal(h.streams.length, 0);
  assert.deepEqual(
    [...h.intervals.values()].map(({ delay }) => delay),
    [2500],
  );
  const restored = job("running", {
    progress: { stage: "semantic", completed: 12, total: 32 },
  });
  await h.resolve(0, restored);
  assert.deepEqual(h.jobs, [restored]);
  assert.equal(h.streams.length, 1);
  assert.equal(h.streams[0].id, "music-1");
  assert.deepEqual(h.canceled, []);
});

test("a completed task loaded by its direct link needs no stream or polling", async (t) => {
  const h = setup();
  t.after(() => h.watcher.close());
  const finished = job("done", { outputs: { audio: "song.flac" } });
  await h.resolve(0, finished);
  assert.deepEqual(h.jobs, [finished]);
  assert.equal(h.streams.length, 0);
  assert.equal(h.intervals.size, 0);
  await h.tick();
  assert.equal(h.requests.length, 1);
});

test("SSE advances queued tasks through running stages and stops observation at every terminal state", async (t) => {
  for (const status of ["done", "failed", "cancelled"]) {
    await t.test(status, async (child) => {
      const h = setup();
      child.after(() => h.watcher.close());
      await h.resolve(0, job("queued"));
      const { handlers } = h.streams[0];
      handlers.onProgress({ type: "status", status: "running" });
      assert.equal(h.jobs.at(-1).status, "running");
      const stage = {
        type: "stage",
        stage: "synthesize",
        completed: 4,
        total: 8,
      };
      handlers.onProgress(stage);
      assert.deepEqual(h.jobs.at(-1).progress, stage);
      const finished = job(
        status,
        status === "failed" ? { error: "out of memory" } : {},
      );
      handlers.onDone(finished);
      assert.deepEqual(h.jobs.at(-1), finished);
      assert.equal(h.intervals.size, 0);
      assert.equal(h.streams[0].closes, 1);
      const rendered = h.jobs.length;
      handlers.onProgress({ type: "stage", stage: "load" });
      assert.equal(h.jobs.length, rendered);
      await h.tick();
      assert.equal(h.requests.length, 1);
    });
  }
});

test("polling recovers an SSE disconnect and obtains the completed result without resubmission", async (t) => {
  const h = setup();
  t.after(() => h.watcher.close());
  await h.resolve(0, job());
  h.streams[0].handlers.onError(new Error("connection closed"));
  assert.equal(h.intervals.size, 1);
  await h.tick();
  assert.equal(h.requests.length, 2);
  const finished = job("done", { timing: { audio_seconds: 24 } });
  await h.resolve(1, finished);
  assert.deepEqual(h.jobs.at(-1), finished);
  assert.equal(h.intervals.size, 0);
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.canceled, []);
});

test("temporary initial HTTP failure can recover on the next poll", async (t) => {
  const h = setup();
  t.after(() => h.watcher.close());
  const offline = new Error("temporarily offline");
  await h.reject(0, offline);
  assert.deepEqual(h.errors, [offline]);
  assert.equal(h.jobs.length, 0);
  assert.equal(h.streams.length, 0);
  await h.tick();
  await h.resolve(1, job());
  assert.equal(h.jobs.at(-1).status, "running");
  assert.equal(h.streams.length, 1);
});

test("leaving before the first fetch completes ignores its late result and never cancels the server task", async () => {
  const h = setup();
  h.watcher.close();
  await h.resolve(0, job());
  assert.equal(h.intervals.size, 0);
  assert.equal(h.jobs.length, 0);
  assert.equal(h.streams.length, 0);
  assert.deepEqual(h.canceled, []);
  await h.watcher.refresh();
  assert.equal(h.requests.length, 1);
});

test("leaving during observation releases listeners and ignores pending HTTP and SSE deliveries", async () => {
  const h = setup();
  await h.resolve(0, job());
  await h.tick();
  const rendered = h.jobs.length;
  h.watcher.close();
  h.streams[0].handlers.onProgress({ type: "stage", stage: "decode" });
  h.streams[0].handlers.onDone(job("done"));
  await h.reject(1, new Error("late transport error"));
  assert.equal(h.jobs.length, rendered);
  assert.equal(h.errors.length, 0);
  assert.equal(h.streams[0].closes, 1);
  assert.equal(h.intervals.size, 0);
  assert.deepEqual(h.canceled, []);
});

test("a slow poll cannot regress a newer SSE stage or return a running task to the queue", async (t) => {
  const h = setup();
  t.after(() => h.watcher.close());
  await h.resolve(0, job("queued"));
  await h.tick();
  const stage = { type: "stage", stage: "semantic", completed: 12, total: 32 };
  h.streams[0].handlers.onProgress(stage);
  await h.resolve(1, job("queued"));
  assert.equal(h.jobs.at(-1).status, "running");
  assert.deepEqual(h.jobs.at(-1).progress, stage);
});

test("a slow poll cannot reverse a queued-to-running SSE status transition", async (t) => {
  const h = setup();
  t.after(() => h.watcher.close());
  await h.resolve(0, job("queued"));
  await h.tick();
  h.streams[0].handlers.onProgress({ type: "status", status: "running" });
  await h.resolve(1, job("queued"));
  assert.equal(h.jobs.at(-1).status, "running");
});

test("a slow running poll cannot replace an SSE terminal result or restart its stream", async (t) => {
  const h = setup();
  t.after(() => h.watcher.close());
  await h.resolve(0, job());
  await h.tick();
  const finished = job("done", {
    timing: { audio_seconds: 31 },
    outputs: { audio: "final.flac" },
  });
  h.streams[0].handlers.onDone(finished);
  const rendered = h.jobs.length;
  await h.resolve(1, job("running"));
  assert.deepEqual(h.jobs.at(-1), finished);
  assert.equal(h.jobs.length, rendered);
  assert.equal(h.streams.length, 1);
  assert.equal(h.intervals.size, 0);
});

test("polling and manual refresh never overlap an unfinished request", async (t) => {
  const h = setup();
  t.after(() => h.watcher.close());
  await h.tick();
  await h.watcher.refresh();
  assert.equal(h.requests.length, 1);
  await h.resolve(0, job());
  await h.tick();
  await h.tick();
  await h.watcher.refresh();
  assert.equal(h.requests.length, 2);
  await h.resolve(1, job("done"));
});
