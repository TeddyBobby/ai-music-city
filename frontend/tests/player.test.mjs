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
async function setup(saved) {
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
      this.duration = 42;
      this.paused = true;
      this.ended = false;
      this.volume = 0.8;
    }
    set src(v) {
      this.url = v;
      this.currentTime = 0;
      this.ended = false;
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
