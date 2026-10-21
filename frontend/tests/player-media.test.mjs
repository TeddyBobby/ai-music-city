import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/lib/playerMedia.ts", import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { lyricLines, swipeTarget } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);

test("instrumental markers and blank lines do not count as sung lyrics", () => {
  for (const text of [
    "",
    " \n\t",
    "[Intro]",
    "[intro]\r\n\r\n[instrumental]\r\n[Outro]",
    "[主歌]\n[Custom section]",
  ]) {
    assert.deepEqual(lyricLines(text), []);
  }
});

test("lyrics retain words, verse breaks, and numbered translated sections", () => {
  assert.deepEqual(
    lyricLines(
      "[Verse 1]\r\n  午后微风穿过窗台  \r\n\r\n[CHORUS]\r\n让一首小歌慢慢盛开",
    ),
    [
      { kind: "section", text: "主歌 1" },
      { kind: "line", text: "午后微风穿过窗台" },
      { kind: "space", text: "" },
      { kind: "section", text: "副歌" },
      { kind: "line", text: "让一首小歌慢慢盛开" },
    ],
  );
});

test("common section names are localized while unknown labels stay intact", () => {
  const sections = [
    "Intro",
    "Pre-Chorus",
    "post chorus",
    "Bridge",
    "Interlude",
    "Instrumental",
    "Solo",
    "Outro",
    "主歌",
    "Custom section",
  ];
  assert.deepEqual(
    lyricLines(sections.map((name) => `[${name}]`).join("\n") + "\n实际歌词")
      .filter((line) => line.kind === "section")
      .map((line) => line.text),
    [
      "前奏",
      "预副歌",
      "后副歌",
      "桥段",
      "间奏",
      "器乐段落",
      "独奏",
      "尾声",
      "主歌",
      "Custom section",
    ],
  );
});

test("bracketed text within a lyric is not stripped as a section marker", () => {
  assert.deepEqual(lyricLines("这一句 [轻声] 唱给你\n[Verse] words"), [
    { kind: "line", text: "这一句 [轻声] 唱给你" },
    { kind: "line", text: "[Verse] words" },
  ]);
});

test("left and right gestures switch cover and lyrics without wrapping", () => {
  assert.equal(swipeTarget("cover", -80, 10), "lyrics");
  assert.equal(swipeTarget("lyrics", 80, -10), "cover");
  assert.equal(swipeTarget("cover", 80, 0), null);
  assert.equal(swipeTarget("lyrics", -80, 0), null);
});

test("taps and vertical lyric scrolling never trigger a page change", () => {
  assert.equal(swipeTarget("cover", -47.99, 0), null);
  assert.equal(swipeTarget("lyrics", 0, 0), null);
  assert.equal(swipeTarget("cover", -80, 160), null);
  assert.equal(swipeTarget("lyrics", 80, -160), null);
  assert.equal(swipeTarget("cover", -69, 50), null);
  assert.equal(swipeTarget("lyrics", 69, -50), null);
});

test("a deliberate swipe accepts the 48px and 1.4 horizontal dominance boundaries", () => {
  assert.equal(swipeTarget("cover", -48, 0), "lyrics");
  assert.equal(swipeTarget("lyrics", 48, 0), "cover");
  assert.equal(swipeTarget("cover", -70, 50), "lyrics");
  assert.equal(swipeTarget("lyrics", 70, -50), "cover");
});

test("invalid gesture coordinates cannot switch views", () => {
  for (const [dx, dy] of [
    [NaN, 0],
    [-Infinity, 0],
    [80, NaN],
    [80, Infinity],
  ]) {
    assert.equal(swipeTarget("cover", dx, dy), null);
    assert.equal(swipeTarget("lyrics", dx, dy), null);
  }
});
