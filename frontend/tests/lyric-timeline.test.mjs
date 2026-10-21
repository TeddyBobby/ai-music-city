import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/lib/lyricTimeline.ts", import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const {
  buildLyricTimeline,
  activeLyricIndex,
  precedingLyricIndex,
  lyricSeekTime,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);

test("LRC timestamps sort stably and preserve repeated chorus cues", () => {
  const result = buildLyricTimeline(
    "[ti:测试]\n[Verse 1]\n[00:12.50]第二句\n[00:01.125]第一句\n[00:20][01:20.1]重复副歌",
    100,
  );
  assert.equal(result.source, "lrc");
  assert.deepEqual(
    result.lines.map(({ text, at }) => ({ text, at })),
    [
      { text: "第一句", at: 1.125 },
      { text: "第二句", at: 12.5 },
      { text: "重复副歌", at: 20 },
      { text: "重复副歌", at: 80.1 },
    ],
  );
  assert.equal(result.lines[1].section, "主歌 1");
});

test("LRC supports millisecond offsets, bilingual cues, and enhanced word markers", () => {
  const result = buildLyricTimeline(
    "[offset:-500]\n[00:00.10]开场\n[00:05.000]<00:05.00>你好<00:05.50>世界\n[00:05.000]Hello world\n[00:05.000]Hello world",
    20,
  );
  assert.deepEqual(result.lines, [
    { text: "开场", at: 0 },
    { text: "你好世界\nHello world", at: 4.5 },
  ]);
  assert.equal(
    buildLyricTimeline("[offset:+1000]\n[00:05]你好", 20).lines[0].at,
    6,
  );
});

test("plain lyrics keep translated section labels without inventing vocal timestamps", () => {
  const result = buildLyricTimeline(
    "[Verse 1]\n风吹过\n\n一段很长很长的歌词会有更多阅读时间\n[Chorus]\n一起唱\n到天亮",
    100,
  );
  assert.equal(result.source, "none");
  assert.equal(result.lines[0].section, "主歌 1");
  assert.equal(result.lines[2].section, "副歌");
  assert.equal(result.lines.length, 4);
  assert.deepEqual(
    result.lines.map((line) => line.at),
    [null, null, null, null],
  );
  assert.equal(activeLyricIndex(result.lines, 50), -1);
  assert.equal(precedingLyricIndex(result.lines, 50), -1);
  assert.equal(lyricSeekTime(result.lines[0], 100), null);
});

test("blank, metadata-only, and instrumental arrangements have no lyric timeline", () => {
  for (const lyrics of [
    "",
    " \n ",
    "[Intro]\n[Instrumental]\n[Outro]",
    "[主歌]\n[间奏]",
    "[ar:Artist]\n[ti:Song]\n[offset:0]",
    "[00:05]\n[00:10]",
  ]) {
    assert.deepEqual(buildLyricTimeline(lyrics, 30), {
      lines: [],
      source: "none",
    });
  }
});

test("invalid or unknown times cannot seek to an invented zero timestamp", () => {
  for (const duration of [0, -1, NaN, Infinity]) {
    const result = buildLyricTimeline("第一句\n第二句", duration);
    assert.deepEqual(
      result.lines.map((line) => line.at),
      [null, null],
    );
    assert.equal(lyricSeekTime({ at: 5, text: "歌词" }, duration), null);
  }
  assert.equal(lyricSeekTime({ at: 120, text: "歌词" }, 60), 60);
  assert.equal(lyricSeekTime({ at: -5, text: "歌词" }, 60), null);
  assert.equal(lyricSeekTime({ at: NaN, text: "歌词" }, 60), null);
  assert.equal(lyricSeekTime({ at: null, text: "歌词" }, 60), null);
  assert.equal(lyricSeekTime({ at: 0, text: "开场" }, 60), 0);
});

test("audio cue ends stop highlights during interludes while retaining the last reading position", () => {
  const result = buildLyricTimeline("第一句\n未匹配\n第二句", 60, {
    status: "ready",
    source: "audio",
    lines: [
      { text: "第一句", at: 8.3, end: 11.7, section: "主歌" },
      { text: "未匹配", at: null },
      { text: "第二句", at: 24.2, end: 27.9 },
    ],
  });
  assert.equal(result.source, "audio");
  assert.equal(activeLyricIndex(result.lines, 8.2), -1);
  assert.equal(activeLyricIndex(result.lines, 8.3), 0);
  assert.equal(activeLyricIndex(result.lines, 11.7), -1);
  assert.equal(activeLyricIndex(result.lines, 20), -1);
  assert.equal(precedingLyricIndex(result.lines, 20), 0);
  assert.equal(lyricSeekTime(result.lines[1], 60), null);
  assert.equal(activeLyricIndex(result.lines, 24.2), 2);
  assert.equal(activeLyricIndex(result.lines, 30), -1);
  assert.equal(precedingLyricIndex(result.lines, 30), 2);
  assert.equal(activeLyricIndex(result.lines, 10), 0);
});

test("audio alignment retains repeated lyric occurrences and leaves missing cues untimed", () => {
  const lines = [
    { text: "一起唱", at: 10, end: 12 },
    { text: "到天亮", at: null },
    { text: "一起唱", at: 30, end: 32 },
    { text: "到天亮", at: 34, end: 36 },
  ];
  const result = buildLyricTimeline("一起唱\n到天亮\n一起唱\n到天亮", 60, {
    status: "ready",
    source: "audio",
    lines,
  });
  assert.deepEqual(result.lines, lines);
  assert.equal(activeLyricIndex(result.lines, 11), 0);
  assert.equal(activeLyricIndex(result.lines, 31), 2);
  assert.equal(lyricSeekTime(result.lines[2], 60), 30);
});

test("unfinished, empty, and invalid alignment results never create plausible-looking timings", () => {
  for (const status of ["idle", "queued", "running", "failed", "unavailable"]) {
    const result = buildLyricTimeline("第一句\n第二句", 60, {
      status,
      source: "audio",
      lines: [{ text: "第一句", at: 10, end: 12 }],
    });
    assert.equal(result.source, "none");
    assert.deepEqual(
      result.lines.map((line) => line.at),
      [null, null],
    );
  }
  const empty = buildLyricTimeline("第一句", 60, {
    status: "ready",
    source: "audio",
    lines: [],
  });
  assert.equal(empty.lines[0].at, null);
  const invalid = buildLyricTimeline("歌词", 60, {
    status: "ready",
    source: "audio",
    lines: [
      { text: "negative", at: -1, end: 2 },
      { text: "not finite", at: Infinity },
      { text: "first", at: 10, end: 12 },
      { text: "out of order", at: 5, end: 8 },
      { text: "empty interval", at: 20, end: 20 },
      { text: "last", at: 30, end: 35 },
    ],
  });
  assert.deepEqual(
    invalid.lines.map((line) => line.at),
    [null, null, 10, null, null, 30],
  );
});

test("current lyric follows forward playback, backward seeks, and exact cue boundaries", () => {
  const lines = buildLyricTimeline(
    "[00:05]第一句\n[00:10]第二句\n[00:20]第三句",
    30,
  ).lines;
  assert.equal(activeLyricIndex(lines, 4.99), -1);
  assert.equal(activeLyricIndex(lines, 5), 0);
  assert.equal(activeLyricIndex(lines, 19.99), 1);
  assert.equal(activeLyricIndex(lines, 20), 2);
  assert.equal(activeLyricIndex(lines, 19.999999), 2);
  assert.equal(activeLyricIndex(lines, 300), 2);
  assert.equal(activeLyricIndex(lines, 7), 0);
  assert.equal(activeLyricIndex(lines, NaN), -1);
  assert.equal(activeLyricIndex([], 10), -1);
});
