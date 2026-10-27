import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Drawer,
  Loader,
  SegmentedControl,
  Select,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowUp,
  AudioLines,
  History,
  Music2,
  Sparkles,
  Mic,
  PenLine,
  ChevronDown,
  MessageCircle,
  Plus,
  Settings2,
  Square,
} from "lucide-react";
import type { AssistantMessage, Suggestion } from "../lib/assistant";
import {
  generateFromSuggestion,
  isInstrumentalPrompt,
} from "../lib/musicCreation";
import { errorMessage } from "../lib/utils";
import { Button, Dialog, IconButton } from "../components/ui";
import { AssistantConnectionSettings } from "../components/AssistantConnectionSettings";
import { AssistantAudioInput } from "../components/AssistantAudioInput";
import { AssistantImageInput } from "../components/AssistantImageInput";
import { AssistantCopyButton } from "../components/AssistantCopyButton";
import { AssistantMarkdown } from "../components/AssistantMarkdown";
import { MusicKindToggle, type MusicKind } from "../components/MusicKindToggle";
import { assistantConversation } from "../lib/assistantConversation";
import { useAuth } from "../state/auth";
import "./Assistant.css";
import "./AssistantMessage.css";
import "../components/AssistantMarkdown.css";

function messageText(message: AssistantMessage) {
  if (message.suggestion) {
    // Older saved proposals contain their JSON in content as well as suggestion.
    return /^\s*(?:\{|```(?:json)?(?:\s|$))/i.test(message.content)
      ? ""
      : message.content;
  }
  if (message.pendingStructured)
    return message.status === "stopped"
      ? "已停止回复"
      : "回复未完成，可以重试。";
  return (
    message.content ||
    (message.status === "stopped"
      ? "已停止回复"
      : message.status === "error"
        ? "回复未完成，请重试。"
        : "")
  );
}

function messageCopyText(message: AssistantMessage) {
  const text = message.content ? messageText(message) : "";
  const proposal = message.suggestion;
  return [
    text,
    proposal?.title,
    proposal?.description || proposal?.style,
    proposal?.music_kind === "instrumental"
      ? "纯音乐"
      : proposal?.music_kind === "vocal"
        ? "带歌词"
        : "",
    proposal?.lyrics,
    message.audio?.transcript,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function SongDraft({ suggestion }: { suggestion: Suggestion }) {
  const [musicKind, setMusicKind] = useState<MusicKind>(
    () =>
      suggestion.music_kind ??
      (isInstrumentalPrompt(
        [suggestion.description, suggestion.style].filter(Boolean).join(" "),
      )
        ? "instrumental"
        : "vocal"),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState("");
  const alive = useRef(true),
    submitting = useRef(false);
  const navigate = useNavigate();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const generate = async () => {
    if (submitting.current || jobId) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const job = await generateFromSuggestion(suggestion, { musicKind });
      if (alive.current) {
        setJobId(job.id);
        navigate(`/generation/${encodeURIComponent(job.id)}`);
      }
    } catch (reason) {
      if (alive.current) setError(errorMessage(reason));
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section className="as-song-draft" aria-label="音乐草稿">
      <div className="as-draft-heading">
        <Music2 size={20} />
        <strong>{suggestion.title || "你的新歌"}</strong>
        {musicKind === "vocal" && suggestion.lyrics && (
          <AssistantCopyButton value={suggestion.lyrics} label="复制歌词" />
        )}
      </div>
      {(suggestion.description || suggestion.style) && (
        <p className="as-draft-style">
          {suggestion.description || suggestion.style}
        </p>
      )}
      {musicKind === "vocal" && suggestion.lyrics && (
        <details className="as-draft-lyrics-block">
          <summary>
            歌词
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <div className="as-draft-lyrics">{suggestion.lyrics}</div>
        </details>
      )}
      <div className="as-draft-actions">
        <MusicKindToggle
          value={musicKind}
          onChange={(value) => {
            setMusicKind(value);
            setError("");
          }}
          disabled={busy || Boolean(jobId)}
        />
        <Button
          variant="primary"
          onClick={() =>
            jobId
              ? navigate(`/generation/${encodeURIComponent(jobId)}`)
              : void generate()
          }
          disabled={busy}
        >
          {busy ? "正在提交…" : jobId ? "查看音乐" : "生成音乐"}
        </Button>
      </div>
      {error && (
        <p className="as-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

const starters = {
  chat: [
    {
      title: "聊聊灵感",
      prompt: "我想做一首适合海边日落时听的歌，帮我聊聊可以怎样表达这种感觉。",
      mode: "chat" as const,
      icon: MessageCircle,
    },
    {
      title: "写一首歌",
      prompt: "帮我写一首适合海边日落时听的歌，温暖、松弛，有轻柔的吉他。",
      mode: "lyrics" as const,
      icon: PenLine,
    },
  ],
  lyrics: [
    {
      title: "从灵感开始",
      prompt: "帮我写一首关于海边日落的歌词，温暖、松弛，有轻柔的吉他。",
      mode: "lyrics" as const,
      icon: Sparkles,
    },
    {
      title: "改写歌词",
      prompt:
        "帮我润色下面这段歌词，保留原来的情绪，让表达更自然、更适合演唱：\n",
      mode: "lyrics" as const,
      icon: PenLine,
    },
  ],
};

export function AssistantPage() {
  const canConfigure = useAuth((s) => !!s.user);
  const userInitial = useAuth((s) =>
    Array.from(s.user?.email?.split("@")[0] || "我")[0].toUpperCase(),
  );
  const [search] = useSearchParams();
  const state = useSyncExternalStore(
    assistantConversation.subscribe,
    assistantConversation.getSnapshot,
  );
  const {
    sessions,
    current,
    messages,
    input,
    mode,
    audio,
    image,
    models,
    modelsLoading,
    modelsError,
    selectedModel,
    connected,
    busy,
    phase,
    sessionLoading,
    error,
    canRetry,
  } = state;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(
    search.get("mode") === "settings",
  );
  const [recording, setRecording] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const disabled = busy || sessionLoading || recording;
  const empty = !messages.length && !sessionLoading;
  const lyricsMode = mode === "lyrics";
  const initialSession = search.get("session") || undefined;

  useEffect(() => {
    void assistantConversation.init(initialSession);
  }, [initialSession]);
  useEffect(() => {
    if (list.current && follow.current)
      list.current.scrollTop = messages.length ? list.current.scrollHeight : 0;
  }, [messages, current?.id]);
  useEffect(() => {
    const textarea = field.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      resize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [input]);

  const fillPrompt = (value: string, nextMode: "chat" | "lyrics") => {
    assistantConversation.setMode(nextMode);
    assistantConversation.setInput(value);
    field.current?.focus({ preventScroll: true });
  };
  const newConversation = () => {
    assistantConversation.newConversation();
    setHistoryOpen(false);
    follow.current = true;
    field.current?.focus({ preventScroll: true });
  };
  const openSession = async (id: string) => {
    follow.current = true;
    await assistantConversation.openSession(id);
    setHistoryOpen(false);
  };
  const send = () => {
    if (disabled) return;
    follow.current = true;
    void assistantConversation.send();
  };
  const providers = [...new Set(models.map((model) => model.provider))];
  const modelPlaceholder = modelsLoading
    ? "加载模型…"
    : modelsError
      ? "模型加载失败"
      : models.length
        ? "选择模型"
        : "暂无可用模型";
  const modelLabel =
    models.find((model) => model.id === selectedModel)?.name ||
    modelPlaceholder;

  return (
    <div className="assistant-page">
      <header className="as-chat-top">
        <strong
          className="as-conversation-title"
          title={current?.title || "AI 助手"}
        >
          {current?.title || "AI 助手"}
        </strong>
        <div className="as-header-actions">
          <IconButton label="聊天历史" onClick={() => setHistoryOpen(true)}>
            <History size={19} />
          </IconButton>
          <IconButton
            label="新对话"
            onClick={newConversation}
            disabled={disabled}
          >
            <Plus size={21} />
          </IconButton>
        </div>
      </header>

      <div className={`as-workspace${empty ? " is-empty" : ""}`}>
        <div
          className="as-messages"
          ref={list}
          onScroll={() => {
            const element = list.current;
            if (element)
              follow.current =
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                90;
          }}
        >
          <div className="as-thread">
            {sessionLoading ? (
              <div className="as-loading">
                <Loader size="sm" />
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`as-message as-message-${message.role}`}
                    aria-busy={
                      message.role === "assistant" &&
                      message.status === "streaming"
                    }
                  >
                    <span
                      className={`as-message-avatar as-avatar-${message.role}`}
                      role="img"
                      aria-label={
                        message.role === "assistant"
                          ? "AI 助手头像"
                          : "你的头像"
                      }
                    >
                      {message.role === "assistant" ? (
                        <AudioLines size={19} aria-hidden="true" />
                      ) : (
                        userInitial
                      )}
                    </span>
                    <div className="as-message-body">
                      {message.role === "assistant" &&
                        message.status === "streaming" && (
                          <div className="as-message-meta">
                            <span className="as-answering" role="status">
                              <Loader size={11} />
                              正在回答…
                            </span>
                          </div>
                        )}
                      <div className="as-message-content">
                        {message.image && (
                          <img
                            className="as-message-image"
                            src={message.image.url}
                            alt={message.image.filename || "参考图片"}
                            loading="lazy"
                          />
                        )}
                        {message.audio && (
                          <div className="as-message-audio">
                            <div>
                              <Mic size={15} />
                              <span>
                                {message.audio.filename || "语音消息"}
                              </span>
                            </div>
                            <audio
                              controls
                              preload="metadata"
                              src={message.audio.url}
                              aria-label="播放语音消息"
                            />
                            {message.audio.transcript && (
                              <details>
                                <summary>语音文字</summary>
                                <p>{message.audio.transcript}</p>
                              </details>
                            )}
                            {message.audio.transcription_status ===
                              "no_speech" && (
                              <p className="as-audio-note">
                                音频灵感 · 补充描述更容易理解
                              </p>
                            )}
                          </div>
                        )}
                        {message.pendingStructured &&
                        message.status === "streaming" ? null : (
                          <>
                            {messageText(message) && (
                              <div className="as-message-text">
                                {message.role === "assistant" ? (
                                  <AssistantMarkdown>
                                    {messageText(message)}
                                  </AssistantMarkdown>
                                ) : (
                                  messageText(message)
                                    .split(/\n{2,}/)
                                    .map((paragraph, index) => (
                                      <p key={index}>{paragraph}</p>
                                    ))
                                )}
                              </div>
                            )}
                            {message.suggestion && (
                              <SongDraft suggestion={message.suggestion} />
                            )}
                          </>
                        )}
                      </div>
                      {message.status !== "streaming" &&
                        messageCopyText(message) && (
                          <div className="as-message-tools">
                            <AssistantCopyButton
                              value={messageCopyText(message)}
                              label={
                                message.role === "assistant"
                                  ? "复制回复"
                                  : "复制文字"
                              }
                            />
                          </div>
                        )}
                    </div>
                  </article>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="as-compose-wrap">
          {empty && !audio && !image && (
            <div className="as-welcome">
              <div className="as-welcome-wave" aria-hidden="true">
                {[8, 14, 23, 32, 20, 38, 28, 18, 30, 21, 12, 6].map(
                  (height, index) => (
                    <span
                      key={index}
                      style={{ height, animationDelay: `${index * -0.13}s` }}
                    />
                  ),
                )}
              </div>
              <h1 className="as-welcome-title">
                {lyricsMode ? "把想法，写成歌词" : "聊聊你的音乐灵感"}
              </h1>
            </div>
          )}
          {empty && !audio && !image && (
            <div className="as-quick-choices" aria-label="快捷灵感">
              {starters[lyricsMode ? "lyrics" : "chat"].map(
                ({ title, prompt, mode: nextMode, icon: Icon }) => (
                  <button
                    key={title}
                    type="button"
                    onClick={() => fillPrompt(prompt, nextMode)}
                    disabled={disabled}
                  >
                    <Icon size={15} aria-hidden="true" />
                    {title}
                  </button>
                ),
              )}
            </div>
          )}
          {modelsError && (
            <div className="as-error" role="alert">
              <span>{modelsError}</span>
              <Button
                variant="ghost"
                disabled={modelsLoading}
                onClick={() => void assistantConversation.refreshModels()}
              >
                重试
              </Button>
            </div>
          )}
          {error && (
            <div className="as-error" role="alert">
              <span>{error}</span>
              {canRetry && (
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => void assistantConversation.retry()}
                >
                  重试
                </Button>
              )}
            </div>
          )}
          {connected === false &&
            !modelsError &&
            !error &&
            (canConfigure ? (
              <button
                className="as-connect-notice"
                onClick={() => setSettingsOpen(true)}
              >
                连接助手
              </button>
            ) : (
              <p className="as-connect-notice">助手暂未连接，请联系管理员。</p>
            ))}
          <form
            className="as-composer"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <textarea
              ref={field}
              rows={2}
              value={input}
              placeholder={
                image
                  ? "描述图片的氛围…"
                  : audio
                    ? lyricsMode
                      ? "补充歌词主题…"
                      : "补充音频描述…"
                    : lyricsMode
                      ? "歌词主题或原稿…"
                      : "聊聊你的想法…"
              }
              aria-label="给 AI 助手发消息"
              disabled={sessionLoading}
              onChange={(event) =>
                assistantConversation.setInput(event.target.value)
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (event.ctrlKey || event.metaKey) &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  window.matchMedia("(min-width: 1024px)").matches
                ) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <div
              className="as-compose-controls"
              data-recording={recording || undefined}
            >
              <div className="as-compose-settings">
                <SegmentedControl
                  aria-label="助手模式"
                  className="as-mode-switch"
                  classNames={{
                    label: "as-mode-label",
                    indicator: "as-mode-indicator",
                  }}
                  data={[
                    { label: "聊天", value: "chat" },
                    { label: "写歌词", value: "lyrics" },
                  ]}
                  value={mode}
                  onChange={(value) => {
                    if (!disabled && (value === "chat" || value === "lyrics"))
                      assistantConversation.setMode(value);
                  }}
                  disabled={disabled}
                  size="xs"
                  radius="md"
                  withItemsBorders={false}
                />
                <div className="as-model-control">
                  <span className="as-model-measure" aria-hidden="true">
                    {modelLabel}
                  </span>
                  <Select
                    className="as-model-picker"
                    classNames={{
                      input: "as-model-input",
                      dropdown: "as-model-dropdown",
                      option: "as-model-option",
                      groupLabel: "as-model-group",
                    }}
                    aria-label="选择助手模型"
                    title={modelLabel}
                    aria-busy={modelsLoading}
                    variant="unstyled"
                    value={selectedModel || null}
                    data={providers.map((provider) => ({
                      group: provider || "其他模型",
                      items: models
                        .filter((model) => model.provider === provider)
                        .map((model) => ({
                          value: model.id,
                          label: model.name,
                        })),
                    }))}
                    onChange={(value) => {
                      if (
                        !busy &&
                        !modelsLoading &&
                        !modelsError &&
                        value &&
                        models.some((model) => model.id === value)
                      )
                        assistantConversation.setModel(value);
                    }}
                    onKeyDown={(event) => {
                      // Selecting or searching a model must not submit the message form.
                      if (
                        event.key === "Enter" &&
                        !event.nativeEvent.isComposing
                      )
                        event.preventDefault();
                    }}
                    disabled={
                      busy || modelsLoading || !!modelsError || !models.length
                    }
                    searchable
                    clearable={false}
                    allowDeselect={false}
                    placeholder={modelPlaceholder}
                    nothingFoundMessage={
                      modelsLoading
                        ? "正在加载模型…"
                        : modelsError
                          ? "模型加载失败，请重试"
                          : models.length
                            ? "没有匹配的模型"
                            : "暂无可用模型"
                    }
                    rightSection={
                      modelsLoading ? (
                        <Loader size={13} />
                      ) : (
                        <ChevronDown size={14} aria-hidden="true" />
                      )
                    }
                    rightSectionWidth={28}
                    comboboxProps={{
                      position: "top-start",
                      withinPortal: true,
                      width: 240,
                      offset: 8,
                    }}
                    maxDropdownHeight={260}
                  />
                </div>
              </div>
              <AssistantImageInput
                compact
                file={image}
                onChange={assistantConversation.setImage}
                disabled={busy || sessionLoading}
              />
              <AssistantAudioInput
                compact
                file={audio}
                onChange={assistantConversation.setAudio}
                disabled={busy || sessionLoading}
                onRecordingChange={setRecording}
              />
              {busy ? (
                <button
                  className="as-send"
                  type="button"
                  aria-label="停止回复"
                  title="停止回复"
                  onClick={assistantConversation.stop}
                >
                  <Square size={16} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="as-send"
                  type="submit"
                  aria-label="发送消息"
                  title="发送消息（⌘ / Ctrl + Enter）"
                  disabled={(!input.trim() && !audio && !image) || disabled}
                >
                  <ArrowUp size={21} />
                </button>
              )}
            </div>
          </form>
          {phase === "uploading" && (
            <p className="as-uploading" role="status">
              上传中…
            </p>
          )}
        </div>
      </div>

      <Drawer
        opened={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="聊天历史"
        size={300}
        classNames={{ body: "as-history-drawer-body" }}
      >
        <div className="as-session-list">
          {sessions.map((session) => (
            <UnstyledButton
              className={`as-session ${session.id === current?.id ? "active" : ""}`}
              key={session.id}
              disabled={disabled}
              onClick={() => void openSession(session.id)}
            >
              <MessageCircle size={16} />
              <span>{session.title || "新对话"}</span>
            </UnstyledButton>
          ))}
          {!sessions.length && <p className="as-history-empty">还没有对话</p>}
        </div>
        {canConfigure && (
          <button
            className="as-history-settings"
            onClick={() => {
              setHistoryOpen(false);
              setSettingsOpen(true);
            }}
          >
            <Settings2 size={17} />
            助手设置
          </button>
        )}
      </Drawer>
      {canConfigure && settingsOpen && (
        <Dialog title="助手设置" onClose={() => setSettingsOpen(false)}>
          <AssistantConnectionSettings />
        </Dialog>
      )}
    </div>
  );
}
