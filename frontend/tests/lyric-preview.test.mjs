import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import ts from "typescript";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider, UnstyledButton } from "@mantine/core";

const timelineBundle = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/lib/lyricTimeline.ts", import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const timeline = await import(
  "data:text/javascript;base64," +
    Buffer.from(timelineBundle.outputFiles[0].text).toString("base64")
);
const source = await readFile(
  new URL("../src/components/LyricPreview.tsx", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const module = { exports: {} };
const dependencies = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "@mantine/core": { UnstyledButton },
  "../lib/lyricTimeline": timeline,
};
vm.runInNewContext(code, {
  module,
  exports: module.exports,
  require(name) {
    assert.ok(Object.hasOwn(dependencies, name), `Expected import: ${name}`);
    return dependencies[name];
  },
});

function render(props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      {},
      React.createElement(module.exports.LyricPreview, {
        lyrics: "[00:05]第一句\n[00:10]第二句\n[00:20]第三句",
        time: 0,
        duration: 30,
        onExpand: () => {},
        ...props,
      }),
    ),
  );
}

function preview(props) {
  return [
    ...render(props).matchAll(
      /<span class="player-lyric-preview-line"([^>]*)>(.*?)<\/span>/gs,
    ),
  ].map(([, attributes, text]) => ({
    text,
    current: attributes.includes('data-current="true"'),
  }));
}

test("cover preview follows playback and backward seeks through real lyric cues", () => {
  assert.deepEqual(preview({ time: 5 }), [
    { text: "第一句", current: true },
    { text: "第二句", current: false },
  ]);
  assert.deepEqual(preview({ time: 10 }), [
    { text: "第二句", current: true },
    { text: "第三句", current: false },
  ]);
  assert.deepEqual(preview({ time: 20 }), [
    { text: "第二句", current: false },
    { text: "第三句", current: true },
  ]);
  assert.equal(preview({ time: 7 })[0].current, true);
});

test("opening, unknown duration, and untimed lyrics never invent active vocals", () => {
  for (const props of [
    { time: 4 },
    { time: NaN },
    { time: 20, duration: 0 },
    { time: 20, duration: Infinity },
    { lyrics: "第一句\n第二句\n第三句", time: 20 },
  ]) {
    assert.deepEqual(preview(props), [
      { text: "第一句", current: false },
      { text: "第二句", current: false },
    ]);
  }
});

test("interludes retain the neighbouring lyrics without an active highlight", () => {
  const alignment = {
    status: "ready",
    source: "audio",
    lines: [
      { text: "第一句", at: 5, end: 8 },
      { text: "第二句", at: 15, end: 18 },
      { text: "第三句", at: 23, end: 25 },
    ],
  };
  assert.deepEqual(
    preview({ lyrics: "第一句\n第二句\n第三句", alignment, time: 19 }),
    [
      { text: "第二句", current: false },
      { text: "第三句", current: false },
    ],
  );
});

test("single-line lyrics show once and lyric content expands through a named button", () => {
  assert.deepEqual(preview({ lyrics: "[00:01]只有一句", time: 2 }), [
    { text: "只有一句", current: true },
  ]);
  assert.match(render(), /<button[^>]*aria-label="查看完整歌词"/);
});

test("empty and instrumental timelines do not create a lyric preview or expand control", () => {
  for (const lyrics of ["", "[Instrumental]\n[Outro]", "[ti:测试]"]) {
    const html = render({ lyrics });
    assert.doesNotMatch(html, /player-lyric-preview/);
    assert.doesNotMatch(html, /<button/);
  }
});
