import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

const source = await readFile(
  new URL("../src/components/AssistantMarkdown.tsx", import.meta.url),
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
  "react/jsx-runtime": jsxRuntime,
  "react-markdown": { default: Markdown },
  "remark-gfm": { default: remarkGfm },
  "remark-breaks": { default: remarkBreaks },
};
vm.runInNewContext(code, {
  module,
  exports: module.exports,
  require(name) {
    assert.ok(Object.hasOwn(dependencies, name), `Expected import: ${name}`);
    return dependencies[name];
  },
});
const render = (children) =>
  renderToStaticMarkup(
    React.createElement(module.exports.AssistantMarkdown, { children }),
  );

test("assistant prose renders emphasis and real list structure", () => {
  const html = render(`回南天这个主题太适合做纯音乐了。

我脑子里已经冒出几种声音方向：

- **朦胧钢琴 / 新古典**：慢速钢琴泡在长混响里
- **氛围 Lo-fi**：黑胶沙沙声、雨滴、远处闷闷的雷
- **民乐气质**：箫或埙的低回长音

你心里的回南天，是偏**闷、发霉、有点压抑**，还是偏**温柔、慵懒**？`);
  assert.match(html, /^<div class="as-markdown">/);
  assert.match(html, /<p>回南天这个主题太适合做纯音乐了。<\/p>/);
  assert.match(html, /<ul>\s*<li><strong>朦胧钢琴 \/ 新古典<\/strong>/);
  assert.equal((html.match(/<li>/g) || []).length, 3);
  assert.match(html, /偏<strong>闷、发霉、有点压抑<\/strong>/);
  assert.doesNotMatch(html, /\*\*/);
});

test("headings, quotations, numbered lists and lyric line breaks stay readable", () => {
  const html = render(`## 一段副歌

> 温柔一点，留白多一点。

雨落在窗沿
风停在昨天

1. 第一段
2. 第二段`);
  assert.match(html, /<h2>一段副歌<\/h2>/);
  assert.match(html, /<blockquote>\s*<p>温柔一点，留白多一点。<\/p>/);
  assert.match(html, /<p>雨落在窗沿<br\/>\n风停在昨天<\/p>/);
  assert.match(html, /<ol>\s*<li>第一段<\/li>\s*<li>第二段<\/li>/);
});

test("GFM tables have a labelled keyboard-focusable scroll container", () => {
  const html = render(`| 方向 | 氛围 |
| --- | --- |
| 钢琴 | 温柔 |
| Lo-fi | 慵懒 |`);
  assert.match(
    html,
    /<div class="as-markdown-table" role="region" aria-label="表格" tabindex="0"><table>/,
  );
  assert.match(html, /<thead><tr><th>方向<\/th><th>氛围<\/th><\/tr><\/thead>/);
  assert.match(html, /<tbody><tr><td>钢琴<\/td><td>温柔<\/td>/);
});

test("code remains literal instead of turning into formatting or markup", () => {
  const html = render(
    "使用 `**保留原样**`\n\n```text\n<script>literal</script>\n  两个空格\n```",
  );
  assert.match(html, /<code>\*\*保留原样\*\*<\/code>/);
  assert.match(
    html,
    /<pre><code class="language-text">&lt;script&gt;literal&lt;\/script&gt;\n  两个空格\n<\/code><\/pre>/,
  );
  assert.doesNotMatch(html, /<script>/);
});

test("incomplete streamed Markdown remains renderable until delimiters arrive", () => {
  for (const partial of [
    "",
    "正在整理**温柔",
    "- **钢琴**：\n- ",
    "[参考](https://exam",
    "```text\n一句歌词",
    "| 方向 |\n| ---",
  ]) {
    assert.doesNotThrow(() => render(partial));
  }
  assert.match(render("正在整理**温柔**"), /<strong>温柔<\/strong>/);
});

test("raw HTML is ignored and dangerous link schemes cannot navigate", () => {
  const html = render(`<script>alert('unsafe')</script>

<img src="https://tracker.example/pixel" onerror="alert(1)" />

[危险](javascript:alert%281%29) [数据](data:text/html;base64,PHNjcmlwdD4=)

[安全](https://example.com/music)`);
  assert.doesNotMatch(
    html,
    /<script|<img|onerror=|javascript:|data:text\/html/,
  );
  assert.match(html, /<span>危险<\/span>/);
  assert.match(html, /<span>数据<\/span>/);
  assert.match(
    html,
    /<a href="https:\/\/example.com\/music" target="_blank" rel="noopener noreferrer">安全<\/a>/,
  );
});

test("Markdown images render only their alt text and never an external request", () => {
  const html = render(
    "![雨中的窗](https://tracker.example/pixel)\n\n![](https://tracker.example/empty)",
  );
  assert.match(html, /<span class="as-markdown-image-alt">雨中的窗<\/span>/);
  assert.match(html, /<span class="as-markdown-image-alt">图片<\/span>/);
  assert.doesNotMatch(html, /<img|<link|src=|tracker\.example/);
});
