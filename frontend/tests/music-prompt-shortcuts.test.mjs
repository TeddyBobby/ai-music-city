import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

async function compile(path) {
  return ts.transpileModule(
    await readFile(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
}

const promptContext = { exports: {} };
vm.runInNewContext(await compile("../src/lib/musicPrompt.ts"), promptContext);
const { MUSIC_PROMPT_LABELS, insertMusicPromptLabel, hasMusicPromptContent } =
  promptContext.exports;
const componentCode = await compile(
  "../src/components/MusicPromptShortcuts.tsx",
);
const plain = (value) => JSON.parse(JSON.stringify(value));

test("shortcuts append separate lines without replacing a freeform draft", () => {
  assert.deepEqual(plain(MUSIC_PROMPT_LABELS), [
    "音乐风格",
    "歌词/歌词风格",
    "避免的风格",
  ]);
  let value = "保留我写下的故事\n副歌要有起伏";
  for (const label of MUSIC_PROMPT_LABELS) {
    const next = insertMusicPromptLabel(value, label);
    assert.equal(next.value, `${value}\n${label}：`);
    assert.equal(next.cursor, next.value.length);
    value = next.value;
  }
  assert.equal(insertMusicPromptLabel("", "音乐风格").value, "音乐风格：");
  assert.equal(
    insertMusicPromptLabel("旧文字\n", "音乐风格").value,
    "旧文字\n音乐风格：",
  );
});

test("repeated full-width or ASCII labels return to their existing line", () => {
  for (const label of MUSIC_PROMPT_LABELS) {
    for (const colon of ["：", ":"]) {
      const line = `  ${label}${colon} 温暖、克制`;
      const value = `开头的要求\n${line}\n别覆盖后面的歌词`;
      const next = insertMusicPromptLabel(value, label);
      assert.equal(next.value, value);
      assert.equal(next.cursor, value.indexOf("\n别覆盖"));
      assert.equal(value.slice(next.cursor), "\n别覆盖后面的歌词");
    }
  }
});

test("an inline mention is not mistaken for a structured label", () => {
  const value = "我还没想好音乐风格：想先聊聊";
  assert.equal(
    insertMusicPromptLabel(value, "音乐风格").value,
    `${value}\n音乐风格：`,
  );
});

test("length limits never truncate the original draft or insert a partial label", () => {
  const value = "保留所有文字";
  const expected = `${value}\n避免的风格：`;
  assert.deepEqual(
    plain(insertMusicPromptLabel(value, "避免的风格", expected.length - 1)),
    { value, cursor: value.length },
  );
  assert.deepEqual(
    plain(insertMusicPromptLabel(value, "避免的风格", expected.length)),
    { value: expected, cursor: expected.length },
  );
  const full = "音乐风格：民谣\n原始段落";
  assert.deepEqual(plain(insertMusicPromptLabel(full, "音乐风格", 1)), {
    value: full,
    cursor: full.indexOf("\n"),
  });
});

test("blank templates are not content but any user requirement is", () => {
  for (const value of [
    "",
    "  \n\t",
    "音乐风格：",
    "音乐风格： \n歌词/歌词风格：\n避免的风格： ",
    " 音乐风格 : \n 歌词／歌词风格 : \n 避免的风格 : ",
  ]) {
    assert.equal(hasMusicPromptContent(value), false, JSON.stringify(value));
  }
  for (const value of [
    "写一首关于离乡的歌",
    "音乐风格：温暖民谣\n歌词/歌词风格：\n避免的风格：",
    "音乐风格：\n歌词/歌词风格：门前的灯还亮着\n避免的风格：",
    "音乐风格：\n歌词/歌词风格：\n避免的风格：不要电音",
  ]) {
    assert.equal(hasMusicPromptContent(value), true, value);
  }
});

function mount({ value = "", disabled = false, maxLength } = {}) {
  const changes = [],
    focused = [],
    selections = [],
    animationFrames = [];
  const context = {
    exports: {},
    requestAnimationFrame: (fn) => animationFrames.push(fn),
    require(name) {
      if (name === "react/jsx-runtime") {
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      }
      if (name === "@mantine/core") return { UnstyledButton: "UnstyledButton" };
      if (name === "../lib/musicPrompt") return promptContext.exports;
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(componentCode, context);
  const tree = context.exports.MusicPromptShortcuts({
    value,
    disabled,
    maxLength,
    onChange: (next) => changes.push(next),
    inputRef: {
      current: {
        focus: (options) => focused.push(options),
        setSelectionRange: (...range) => selections.push(range),
      },
    },
  });
  const buttons = tree.props.children;
  return { changes, focused, selections, animationFrames, buttons };
}

test("buttons only update the draft, focus the field, and place the cursor", () => {
  const h = mount({ value: "旧的输入" });
  assert.equal(h.buttons.length, 3);
  for (const button of h.buttons) {
    assert.equal(button.type, "UnstyledButton");
    assert.equal(button.props.type, "button");
    assert.equal(button.props.disabled, false);
  }
  h.buttons[1].props.onClick();
  assert.deepEqual(h.changes, ["旧的输入\n歌词/歌词风格："]);
  assert.deepEqual(plain(h.focused), [{ preventScroll: true }]);
  assert.equal(h.selections.length, 0);
  for (const callback of h.animationFrames) callback();
  const end = h.changes[0].length;
  assert.deepEqual(h.selections, [[end, end]]);
});

test("disabled or full composers cannot insert, while an existing label remains reachable", () => {
  for (const options of [
    { disabled: true },
    { value: "满".repeat(1000), maxLength: 1000 },
  ]) {
    const h = mount(options);
    for (const button of h.buttons) {
      assert.equal(button.props.disabled, true);
      button.props.onClick();
    }
    assert.equal(h.changes.length, 0);
    assert.equal(h.focused.length, 0);
  }
  const value = "音乐风格：温暖\n" + "原文".repeat(20);
  const h = mount({ value, maxLength: value.length });
  assert.equal(h.buttons[0].props.disabled, false);
  assert.equal(h.buttons[1].props.disabled, true);
  h.buttons[0].props.onClick();
  for (const callback of h.animationFrames) callback();
  assert.deepEqual(h.changes, [value]);
  assert.deepEqual(h.selections, [[value.indexOf("\n"), value.indexOf("\n")]]);
});
