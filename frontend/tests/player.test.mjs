import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = await build({
  stdin: {
    contents:
      'export * from "./state/player"; export * from "./state/playerOverlay";',
    resolveDir: fileURLToPath(new URL("../src", import.meta.url)),
    sourcefile: "player-test-entry.ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  define: { "process.env.NODE_ENV": '"test"' },
});
let serial = 0;
const job = (id, status = "done") => ({
  id,
  status,
  artifacts: { audio: status === "done" },
  timing: { audio_seconds: 42 },
  params: {},
  title: id,
});
async function setup(saved, { deferMetadata = false } = {}) {
  const data = new Map(
    saved ? [["yue2.player.v2", JSON.stringify(saved)]] : [],
  );
  globalThis.localStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {},
  });
  globalThis.window = { setTimeout: () => 0 };
  let audio;
  globalThis.Audio = class extends EventTarget {
    constructor() {
      super();
      audio = this;
      this.currentTime = 0;
      this.duration = NaN;
      this.readyState = 0;
      this.currentSrc = "";
      this.paused = true;
      this.ended = false;
      this.volume = 0.8;
    }
    set src(v) {
      this.url = v;
      this.currentTime = 0;
      this.ended = false;
      this.readyState = deferMetadata ? 0 : 1;
      this.duration = deferMetadata ? NaN : 42;
      this.currentSrc = deferMetadata ? "" : v;
    }
    metadata(duration = 42, source = this.src) {
      this.currentSrc = source;
      this.duration = duration;
      this.readyState = 1;
      this.dispatchEvent(new Event("loadedmetadata"));
    }
    get src() {
      return this.url;
    }
    play() {
      this.paused = false;
      this.ended = false;
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
      this.dispatchEvent(new Event("pause"));
    }
    removeAttribute() {
      this.url = "";
      this.currentSrc = "";
      this.readyState = 0;
      this.duration = NaN;
    }
    load() {}
    finish() {
      this.currentTime = 42;
      this.paused = true;
      this.ended = true;
      this.dispatchEvent(new Event("ended"));
    }
  };
  const module = await import(
    "data:text/javascript;base64," +
      Buffer.from(bundle.outputFiles[0].text).toString("base64") +
      "#" +
      ++serial
  );
  return { ...module, audio, data };
}

test("selected playable track keeps identity after invalid entries are filtered", async () => {
  const { usePlayer, audio } = await setup();
  usePlayer
    .getState()
    .play([job("invalid", "failed"), job("chosen"), job("next")], 1);
  assert.equal(usePlayer.getState().current.id, "chosen");
  assert.equal(audio.src, "/api/songs/chosen/audio.flac");
});
test("playing the current song resumes without losing position; seek is bounded", async () => {
  const { usePlayer, audio } = await setup();
  usePlayer.getState().play([job("a")]);
  usePlayer.getState().seek(20);
  usePlayer.getState().pause();
  usePlayer.getState().play([job("a")]);
  assert.equal(audio.currentTime, 20);
  usePlayer.getState().seek(100);
  assert.equal(audio.currentTime, 42);
  usePlayer.getState().seek(-1);
  assert.equal(audio.currentTime, 0);
});
test("finished songs advance; single repeat restarts; final song stops", async () => {
  const { usePlayer, audio } = await setup();
  usePlayer.getState().play([job("a"), job("b")]);
  audio.finish();
  assert.equal(usePlayer.getState().current.id, "b");
  audio.finish();
  assert.equal(usePlayer.getState().playing, false);
  usePlayer.getState().setRepeat();
  usePlayer.getState().setRepeat();
  audio.finish();
  assert.equal(usePlayer.getState().current.id, "b");
  assert.equal(audio.currentTime, 0);
  assert.equal(usePlayer.getState().playing, true);
});
test("restoring a queue tolerates removed songs and keeps intended selection without autoplay", async () => {
  const { usePlayer, restorePlayer, audio } = await setup({
    ids: ["missing", "a", "b"],
    index: 1,
    time: 18,
  });
  globalThis.fetch = async (path) =>
    String(path).endsWith("missing")
      ? new Response("{}", { status: 404 })
      : Response.json({ job: job(String(path).split("/").at(-1)) });
  await restorePlayer();
  audio.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(usePlayer.getState().current.id, "a");
  assert.equal(audio.currentTime, 18);
  assert.equal(audio.paused, true);
});
test("late restore metadata cannot seek a newly selected song", async () => {
  const { usePlayer, restorePlayer, audio } = await setup({
    ids: ["a"],
    index: 0,
    time: 30,
  });
  globalThis.fetch = async () => Response.json({ job: job("a") });
  await restorePlayer();
  usePlayer.getState().play([job("b")]);
  audio.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(audio.currentTime, 0);
  assert.equal(usePlayer.getState().current.id, "b");
});
test("removing another queued song preserves playback; deleting current stops and clears it", async () => {
  const { usePlayer, audio, data } = await setup();
  usePlayer.getState().play([job("a"), job("b")], 1);
  usePlayer.getState().remove("a");
  assert.equal(usePlayer.getState().current.id, "b");
  assert.equal(usePlayer.getState().index, 0);
  assert.equal(audio.paused, false);
  usePlayer.getState().remove("b");
  assert.equal(audio.paused, true);
  assert.equal(usePlayer.getState().current, null);
  assert.deepEqual(JSON.parse(data.get("yue2.player.v2")).ids, []);
});

test("opening and closing the fullscreen layer preserves playback and selection", async () => {
  const { usePlayer, usePlayerOverlay, audio } = await setup();
  usePlayer.getState().play([job("a"), job("b")]);
  usePlayer.getState().seek(12);
  usePlayerOverlay.getState().open();
  assert.equal(usePlayerOverlay.getState().opened, true);
  assert.equal(usePlayerOverlay.getState().jobId, "a");
  usePlayerOverlay.getState().close();
  assert.equal(usePlayerOverlay.getState().opened, false);
  assert.equal(usePlayerOverlay.getState().jobId, "a");
  assert.equal(audio.currentTime, 12);
  assert.equal(audio.paused, false);
  assert.deepEqual(
    usePlayer.getState().queue.map((j) => j.id),
    ["a", "b"],
  );
});

test("viewing another song in fullscreen does not replace the playing queue", async () => {
  const { usePlayer, usePlayerOverlay, audio } = await setup();
  usePlayerOverlay.getState().open();
  assert.equal(usePlayerOverlay.getState().opened, false);
  usePlayer.getState().play([job("a")]);
  usePlayerOverlay.getState().open("b");
  assert.equal(usePlayerOverlay.getState().jobId, "b");
  assert.equal(usePlayer.getState().current.id, "a");
  assert.equal(audio.paused, false);
});

test("lyric seeking the current track preserves both pause and play states", async () => {
  const { usePlayer, audio } = await setup();
  usePlayer.getState().play([job("a")]);
  usePlayer.getState().seekTo(job("a"), 12);
  assert.equal(audio.currentTime, 12);
  assert.equal(audio.paused, false);
  usePlayer.getState().pause();
  usePlayer.getState().seekTo(job("a"), 24);
  assert.equal(audio.currentTime, 24);
  assert.equal(audio.paused, true);
  assert.equal(usePlayer.getState().playing, false);
});

test("lyric seeking another track reuses the queue and applies after its metadata", async () => {
  const { usePlayer, audio } = await setup(undefined, { deferMetadata: true });
  usePlayer.getState().play([job("a"), job("b"), job("c")]);
  audio.metadata();
  usePlayer.getState().seekTo(job("b"), 27);
  assert.equal(usePlayer.getState().current.id, "b");
  assert.equal(usePlayer.getState().index, 1);
  assert.deepEqual(
    usePlayer.getState().queue.map((j) => j.id),
    ["a", "b", "c"],
  );
  assert.equal(audio.paused, false);
  assert.equal(audio.currentTime, 0);
  assert.equal(usePlayer.getState().time, 27);
  audio.metadata(60);
  assert.equal(audio.currentTime, 27);
  assert.equal(usePlayer.getState().duration, 60);
});

test("seeking outside the queue selects only that track and clamps to loaded duration", async () => {
  const { usePlayer, audio } = await setup(undefined, { deferMetadata: true });
  usePlayer.getState().play([job("a"), job("b")]);
  usePlayer.getState().seekTo(job("c"), 100);
  assert.deepEqual(
    usePlayer.getState().queue.map((j) => j.id),
    ["c"],
  );
  audio.metadata(35);
  assert.equal(audio.currentTime, 35);
  assert.equal(usePlayer.getState().time, 35);
  usePlayer.getState().seekTo(job("c"), -2);
  assert.equal(audio.currentTime, 0);
});

test("current track seeks before metadata retain only the latest position without resuming", async () => {
  const { usePlayer, audio, data } = await setup(undefined, {
    deferMetadata: true,
  });
  usePlayer.getState().play([job("a")]);
  usePlayer.getState().pause();
  usePlayer.getState().seek(10);
  usePlayer.getState().seekTo(job("a"), 18);
  audio.dispatchEvent(new Event("timeupdate"));
  assert.equal(usePlayer.getState().time, 18);
  assert.equal(JSON.parse(data.get("yue2.player.v2")).time, 18);
  audio.metadata();
  assert.equal(audio.currentTime, 18);
  assert.equal(audio.paused, true);
  assert.equal(usePlayer.getState().playing, false);
});

test("non-finite positions and unplayable songs cannot change playback or pending seek", async () => {
  const { usePlayer, audio } = await setup(undefined, { deferMetadata: true });
  usePlayer.getState().seekTo(job("a"), 13);
  for (const position of [NaN, Infinity, -Infinity]) {
    usePlayer.getState().seekTo(job("b"), position);
    usePlayer.getState().seek(position);
  }
  usePlayer.getState().seekTo(job("invalid", "failed"), 20);
  assert.equal(usePlayer.getState().current.id, "a");
  audio.metadata();
  assert.equal(audio.currentTime, 13);
});

test("old metadata cannot apply an outdated or current seek to the wrong source", async () => {
  const { usePlayer, audio } = await setup(undefined, { deferMetadata: true });
  usePlayer.getState().seekTo(job("a"), 30);
  const oldSource = audio.src;
  usePlayer.getState().seekTo(job("b"), 14);
  audio.metadata(90, oldSource);
  assert.equal(audio.currentTime, 0);
  assert.equal(usePlayer.getState().time, 14);
  audio.metadata(50);
  assert.equal(audio.currentTime, 14);
  assert.equal(usePlayer.getState().current.id, "b");
});

test("explicit play cancels an older pending seek even when reselecting the same song", async () => {
  const { usePlayer, audio } = await setup(undefined, { deferMetadata: true });
  usePlayer.getState().seekTo(job("a"), 30);
  usePlayer.getState().play([job("a")]);
  audio.metadata();
  assert.equal(audio.currentTime, 0);
  assert.equal(usePlayer.getState().time, 0);
  usePlayer.getState().seekTo(job("b"), 25);
  usePlayer.getState().play([job("a")]);
  audio.metadata();
  assert.equal(audio.currentTime, 0);
});

test("removing the current song cancels pending positioning and late metadata", async () => {
  const { usePlayer, audio } = await setup(undefined, { deferMetadata: true });
  usePlayer.getState().seekTo(job("a"), 25);
  const oldSource = audio.src;
  usePlayer.getState().remove("a");
  audio.metadata(42, oldSource);
  assert.equal(usePlayer.getState().current, null);
  assert.equal(usePlayer.getState().time, 0);
  assert.equal(usePlayer.getState().duration, 0);
  usePlayer.getState().play([job("b")]);
  audio.metadata();
  assert.equal(audio.currentTime, 0);
});

test("restored position cannot override a newer lyric seek on the same song", async () => {
  const { usePlayer, restorePlayer, audio } = await setup(
    { ids: ["a"], index: 0, time: 30 },
    { deferMetadata: true },
  );
  globalThis.fetch = async () => Response.json({ job: job("a") });
  await restorePlayer();
  usePlayer.getState().seekTo(job("a"), 9);
  audio.metadata();
  assert.equal(audio.currentTime, 9);
  assert.equal(audio.paused, true);
});

test("in-flight restore cannot resurrect a queue after a new song was selected and removed", async () => {
  const { usePlayer, restorePlayer } = await setup({
    ids: ["a"],
    index: 0,
    time: 30,
  });
  let resolveFetch;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      resolveFetch = resolve;
    });
  const restoring = restorePlayer();
  usePlayer.getState().seekTo(job("b"), 12);
  usePlayer.getState().remove("b");
  resolveFetch(Response.json({ job: job("a") }));
  await restoring;
  assert.equal(usePlayer.getState().current, null);
  assert.deepEqual(usePlayer.getState().queue, []);
});
