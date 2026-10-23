import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  await readFile(
    new URL("../src/pages/AssistantPage.tsx", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;

function setup({
  desktop = true,
  busy = false,
  models = [],
  selectedModel = "",
  modelsLoading = false,
  modelsError = "",
  messages = [],
  current = null,
  isAdmin = false,
  signedIn = true,
  mode = "chat",
  image = null,
  audio = null,
  input = "写一首温暖的歌",
} = {}) {
  const sends = [],
    drafts = [],
    selectedModels = [],
    selectedModes = [],
    effects = [];
  const state = {
    sessions: [],
    current,
    messages,
    input,
    mode,
    image,
    audio,
    models,
    selectedModel,
    modelsLoading,
    modelsError,
    busy,
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    window: { matchMedia: () => ({ matches: desktop }) },
    require(name) {
      if (name === "react")
        return {
          useEffect(effect) {
            effects.push(effect);
          },
          useRef: (current) => ({ current }),
          useState: (value) => [
            typeof value === "function" ? value() : value,
            () => {},
          ],
          useSyncExternalStore: (_, get) => get(),
        };
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      if (name === "react-router-dom")
        return {
          Link: "Link",
          useNavigate: () => () => {},
          useSearchParams: () => [new URLSearchParams()],
        };
      if (name === "lucide-react")
        return new Proxy({}, { get: (_, key) => key });
      if (name === "@mantine/core")
        return {
          Drawer: "Drawer",
          Loader: "Loader",
          Select: "Select",
          SegmentedControl: "SegmentedControl",
          UnstyledButton: "UnstyledButton",
        };
      if (name === "../state/auth")
        return {
          useAuth: (select) =>
            select({ user: signedIn ? { is_admin: isAdmin } : null }),
        };
      if (name === "../lib/assistantConversation")
        return {
          assistantConversation: {
            getSnapshot: () => state,
            init() {},
            subscribe() {},
            send: () => sends.push(state.input),
            setInput: (value) => drafts.push(value),
            setModel: (value) => selectedModels.push(value),
            setMode: (value) => selectedModes.push(value),
          },
        };
      if (name === "../components/ui")
        return { Button: "Button", IconButton: "IconButton" };
      if (name === "../components/AssistantAudioInput")
        return { AssistantAudioInput: "AssistantAudioInput" };
      if (name === "../components/AssistantImageInput")
        return { AssistantImageInput: "AssistantImageInput" };
      if (name === "../components/AssistantCopyButton")
        return { AssistantCopyButton: "AssistantCopyButton" };
      if (name === "../components/AssistantMarkdown")
        return { AssistantMarkdown: "AssistantMarkdown" };
      if (name === "../components/MusicKindToggle")
        return { MusicKindToggle: "MusicKindToggle" };
      if (name === "../lib/musicCreation")
        return { isInstrumentalPrompt: () => false };
      return {};
    },
  });
  const tree = module.exports.AssistantPage();
  const all = (node) =>
    !node || typeof node !== "object"
      ? []
      : Array.isArray(node)
        ? node.flatMap(all)
        : [node, ...all(node.props?.children)];
  const find = (predicate) => all(tree).find(predicate);
  return {
    sends,
    drafts,
    selectedModels,
    selectedModes,
    find,
    within: (node, predicate) => all(node).filter(predicate),
    runEffects() {
      const scroll = { scrollHeight: 500, scrollTop: 200 };
      find(
        (node) => node.props?.className === "as-messages",
      ).props.ref.current = scroll;
      for (const effect of effects) effect();
      return scroll;
    },
    key(overrides = {}) {
      let prevented = false;
      find((node) => node.type === "textarea").props.onKeyDown({
        key: "Enter",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        nativeEvent: { isComposing: false },
        preventDefault: () => {
          prevented = true;
        },
        ...overrides,
      });
      return prevented;
    },
  };
}

test("desktop multiline input only sends with Ctrl or Command Enter", () => {
  const h = setup();
  assert.equal(h.key(), false);
  assert.equal(h.key({ shiftKey: true }), false);
  assert.deepEqual(h.sends, []);
  assert.equal(h.key({ ctrlKey: true }), true);
  assert.equal(h.key({ metaKey: true }), true);
  assert.equal(h.sends.length, 2);
});

test("composition, mobile input and an active reply never send from a desktop shortcut", () => {
  for (const options of [
    { desktop: false },
    { busy: true },
    { composing: true },
  ]) {
    const h = setup(options);
    h.key({
      ctrlKey: true,
      nativeEvent: { isComposing: options.composing || false },
    });
    assert.deepEqual(h.sends, []);
  }
});

test("desktop quick inspiration fills the draft without sending", () => {
  const h = setup();
  const quickActions = h.find(
    (node) => node.props?.["aria-label"] === "快捷灵感",
  );
  quickActions.props.children[0].props.onClick();
  assert.equal(h.drafts.length, 1);
  assert.match(h.drafts[0], /海边日落/);
  assert.deepEqual(h.sends, []);
});

test("model picker groups and searches known models without accepting free text", () => {
  const models = [
    { id: "first", name: "First chat", provider: "Provider A" },
    { id: "second", name: "Second chat", provider: "Provider B" },
  ];
  const h = setup({ models, selectedModel: "first" });
  const picker = h.find((node) => node.type === "Select").props;
  assert.equal(picker.searchable, true);
  assert.equal(picker.allowDeselect, false);
  assert.equal(picker.clearable, false);
  assert.equal(picker.value, "first");
  assert.deepEqual(JSON.parse(JSON.stringify(picker.data)), [
    { group: "Provider A", items: [{ value: "first", label: "First chat" }] },
    { group: "Provider B", items: [{ value: "second", label: "Second chat" }] },
  ]);
  picker.onChange("typed-model-name");
  picker.onChange(null);
  assert.deepEqual(h.selectedModels, []);
  picker.onChange("second");
  assert.deepEqual(h.selectedModels, ["second"]);
  assert.deepEqual(h.sends, []);
});

test("model selection is unavailable during loading, errors and active replies", () => {
  const models = [{ id: "chat", name: "Chat", provider: "Provider" }];
  for (const state of [
    { modelsLoading: true },
    { modelsError: "模型请求失败" },
    { busy: true },
  ]) {
    const h = setup({ models, ...state });
    const picker = h.find((node) => node.type === "Select").props;
    assert.equal(picker.disabled, true);
    picker.onChange("chat");
    assert.deepEqual(h.selectedModels, []);
  }
  const empty = setup().find((node) => node.type === "Select").props;
  assert.equal(empty.disabled, true);
  assert.equal(empty.value, null);
  assert.equal(empty.placeholder, "暂无可用模型");
});

test("the model control lives in the composer and Enter cannot submit a message", () => {
  const h = setup();
  const picker = h.find((node) => node.type === "Select");
  const form = h.find((node) => node.type === "form");
  const header = h.find((node) => node.type === "header");
  assert.equal(h.within(form, (node) => node === picker).length, 1);
  assert.equal(h.within(header, (node) => node === picker).length, 0);
  let prevented = false;
  picker.props.onKeyDown({
    key: "Enter",
    nativeEvent: { isComposing: false },
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(h.sends, []);
});

test("the empty composer has two quick actions, and a conversation hides the welcome title", () => {
  const empty = setup();
  assert.equal(
    empty.find((node) => node.type === "h1").props.children,
    "聊聊你的音乐灵感",
  );
  assert.equal(
    empty.find((node) => node.props?.["aria-label"] === "快捷灵感").props
      .children.length,
    2,
  );
  assert.equal(empty.runEffects().scrollTop, 0);
  const chat = setup({
    messages: [{ id: "user-1", role: "user", content: "写一首歌" }],
  });
  assert.equal(
    chat.find((node) => node.type === "h1"),
    undefined,
  );
  assert.equal(
    chat.find((node) => node.props?.["aria-label"] === "快捷灵感"),
    undefined,
  );
  assert.equal(chat.runEffects().scrollTop, 500);
});

test("history uses a drawer and every signed-in user can configure their own assistant", () => {
  const h = setup();
  assert.equal(
    h.find((node) => node.type === "aside"),
    undefined,
  );
  const header = h.find((node) => node.type === "header");
  assert.equal(
    h.within(header, (node) => node.props?.label === "新对话").length,
    1,
  );
  assert.equal(
    h.within(header, (node) => node.props?.label === "聊天历史").length,
    1,
  );
  for (const isAdmin of [false, true]) {
    const account = setup({ isAdmin });
    const drawer = account.find((node) => node.type === "Drawer");
    assert.equal(
      account.within(
        drawer,
        (node) => node.props?.className === "as-history-settings",
      ).length,
      1,
    );
  }
  assert.equal(
    setup({ signedIn: false }).find(
      (node) => node.props?.className === "as-history-settings",
    ),
    undefined,
  );
});

test("chat and lyrics modes update their prompts without automatically sending", () => {
  const h = setup();
  const mode = h.find((node) => node.type === "SegmentedControl").props;
  assert.equal(mode.value, "chat");
  mode.onChange("lyrics");
  mode.onChange("unsupported");
  assert.deepEqual(h.selectedModes, ["lyrics"]);
  assert.deepEqual(h.sends, []);
  const lyrics = setup({ mode: "lyrics" });
  assert.equal(
    lyrics.find((node) => node.type === "h1").props.children,
    "把想法，写成歌词",
  );
  assert.match(
    lyrics.find((node) => node.type === "textarea").props.placeholder,
    /歌词/,
  );
  const quick = h.find((node) => node.props?.["aria-label"] === "快捷灵感");
  quick.props.children[1].props.onClick();
  assert.equal(h.selectedModes.at(-1), "lyrics");
  assert.match(h.drafts.at(-1), /写一首/);
  assert.deepEqual(h.sends, []);
  const running = setup({ busy: true });
  const busyMode = running.find(
    (node) => node.type === "SegmentedControl",
  ).props;
  assert.equal(busyMode.disabled, true);
  busyMode.onChange("lyrics");
  assert.deepEqual(running.selectedModes, []);
});

test("an image can be sent without text while retaining its attachment and a compact composer", () => {
  const file = { name: "森林.jpg" };
  const h = setup({ input: "", image: file });
  assert.equal(
    h.find((node) => node.type === "AssistantImageInput").props.file,
    file,
  );
  assert.equal(
    h.find((node) => node.type === "h1"),
    undefined,
  );
  assert.equal(
    h.find((node) => node.props?.["aria-label"] === "快捷灵感"),
    undefined,
  );
  assert.equal(
    h.find((node) => node.props?.["aria-label"] === "发送消息").props.disabled,
    false,
  );
});

test("a natural reply and its creation proposal are both readable", () => {
  const suggestion = {
    title: "海边日落",
    lyrics: "[Verse]\n海风轻轻吹",
    style: "温暖吉他",
  };
  const h = setup({
    messages: [
      {
        id: "reply",
        role: "assistant",
        content: "这是我整理的创作方案。\n\n听起来会很温暖。",
        suggestion,
        status: "complete",
      },
    ],
  });
  const natural = h.find((node) => node.props?.className === "as-message-text");
  assert.equal(
    h.within(natural, (node) => node.type === "AssistantMarkdown")[0].props
      .children,
    "这是我整理的创作方案。\n\n听起来会很温暖。",
  );
  const proposal = h.find(
    (node) => typeof node.type === "function" && node.type.name === "SongDraft",
  );
  const card = proposal.type(proposal.props);
  assert.equal(
    h.within(card, (node) => node.props?.className === "as-draft-style")[0]
      .props.children,
    "温暖吉他",
  );
  assert.equal(
    h.within(
      card,
      (node) => node.props?.className === "as-draft-lyrics-block",
    )[0].props.open,
    undefined,
  );
  assert.equal(h.within(card, (node) => node.type === "Button").length, 1);
  const copy = h.find((node) => node.type === "AssistantCopyButton").props;
  assert.equal(copy.label, "复制回复");
  assert.match(copy.value, /这是我整理的创作方案。/);
  assert.match(copy.value, /海边日落/);
  assert.match(copy.value, /海风轻轻吹/);
  assert.doesNotMatch(copy.value, /music_proposal|"lyrics"/);
  assert.equal(
    h.within(card, (node) => node.type === "AssistantCopyButton")[0].props
      .label,
    "复制歌词",
  );
});

test("both participants have avatars and answering stays visible after text starts streaming", () => {
  const messages = [
    { id: "user", role: "user", content: "想写一首歌", status: "complete" },
    {
      id: "assistant",
      role: "assistant",
      content: "可以，我们先聊",
      status: "streaming",
    },
  ];
  const h = setup({ messages, busy: true });
  assert.ok(h.find((node) => node.props?.["aria-label"] === "你的头像"));
  assert.ok(h.find((node) => node.props?.["aria-label"] === "AI 助手头像"));
  assert.equal(
    h.find((node) => node.props?.className === "as-answering").props.role,
    "status",
  );
  assert.equal(
    h.find(
      (node) => node.props?.className === "as-message as-message-assistant",
    ).props["aria-busy"],
    true,
  );
  assert.equal(
    h.find(
      (node) =>
        node.type === "AssistantCopyButton" && node.props.label === "复制回复",
    ),
    undefined,
  );
  const completed = setup({
    messages: [{ ...messages[1], status: "complete" }],
  });
  assert.equal(
    completed.find((node) => node.props?.className === "as-answering"),
    undefined,
  );
  assert.equal(
    completed.find((node) => node.type === "AssistantCopyButton").props.value,
    "可以，我们先聊",
  );
});

test("audio without speech stays playable with an honest optional-description hint", () => {
  for (const status of ["no_speech", "transcribed", undefined]) {
    const h = setup({
      messages: [
        {
          id: "audio-message",
          role: "user",
          content: "",
          audio: {
            id: "audio-1",
            filename: "灵感.webm",
            url: "/api/audio/audio-1",
            seconds: 8,
            transcript: status === "transcribed" ? "想写一首温暖的歌" : "",
            transcription_status: status,
          },
        },
      ],
    });
    assert.equal(
      h.find((node) => node.type === "audio").props.src,
      "/api/audio/audio-1",
    );
    const hint = h.find((node) => node.props?.className === "as-audio-note");
    if (status === "no_speech") {
      assert.equal(hint.props.children, "音频灵感 · 补充描述更容易理解");
    } else {
      assert.equal(hint, undefined);
    }
    assert.equal(
      Boolean(
        h.find(
          (node) =>
            node.type === "summary" && node.props.children === "语音文字",
        ),
      ),
      status === "transcribed",
    );
  }
});

test("proposal music kind takes precedence over inferred lyrics defaults", () => {
  const suggestion = {
    title: "森林",
    description: "舒缓钢琴",
    music_kind: "instrumental",
    lyrics: "",
  };
  const h = setup({
    messages: [
      {
        id: "instrumental",
        role: "assistant",
        content: "",
        suggestion,
        status: "complete",
      },
    ],
  });
  const proposal = h.find(
    (node) => typeof node.type === "function" && node.type.name === "SongDraft",
  );
  const card = proposal.type(proposal.props);
  assert.equal(
    h.within(card, (node) => node.type === "MusicKindToggle")[0].props.value,
    "instrumental",
  );
  assert.equal(
    h.within(card, (node) => node.props?.className === "as-draft-lyrics-block")
      .length,
    0,
  );
});
