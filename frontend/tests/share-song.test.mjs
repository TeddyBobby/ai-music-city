import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/lib/shareSong.ts", import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { songDownload, prepareSongShare, canShareSong } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const song = { id: "song-123", title: "雨天/给你:一首歌", params: {} };

test("sharing prepares the real audio file with a portable filename and MIME type", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/songs/song-123/audio.mp3");
    assert.equal(options.signal, controller.signal);
    return new Response(new Uint8Array([73, 68, 51, 1, 2, 3]));
  };
  try {
    const file = await prepareSongShare(song, true, controller.signal);
    assert.equal(file.name, "雨天_给你_一首歌.mp3");
    assert.equal(file.type, "audio/mpeg");
    assert.equal(file.size, 6);
    assert.deepEqual(songDownload(song, false), {
      url: "/api/songs/song-123/audio.flac",
      name: "雨天_给你_一首歌.flac",
      type: "audio/flac",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed or empty audio is never offered as a shareable file", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("missing", { status: 404 });
    await assert.rejects(prepareSongShare(song, true), /音频暂时无法读取/);
    globalThis.fetch = async () => new Response(new Blob([]));
    await assert.rejects(prepareSongShare(song, false), /音频暂时无法读取/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("native sharing is enabled only when file sharing is supported", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const file = new File(["audio"], "song.mp3", { type: "audio/mpeg" });
  const setNavigator = (value) =>
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value,
    });
  try {
    setNavigator({});
    assert.equal(canShareSong(file), false);
    setNavigator({ share() {}, canShare: () => false });
    assert.equal(canShareSong(file), false);
    setNavigator({
      share() {},
      canShare: ({ files }) => files.length === 1 && files[0] === file,
    });
    assert.equal(canShareSong(file), true);
    setNavigator({
      share() {},
      canShare() {
        throw new Error("policy blocked");
      },
    });
    assert.equal(canShareSong(file), false);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  }
});
