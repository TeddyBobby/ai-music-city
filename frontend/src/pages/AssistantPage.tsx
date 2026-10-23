import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Avatar,
  Drawer,
  Loader,
  Tabs,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  Image,
  Link2,
  MessageSquare,
  Music2,
  PenLine,
  Settings2,
  Check,
  ChevronDown,
  Copy,
  Maximize2,
  Plus,
  RotateCcw,
  Square,
  UserRound,
} from "lucide-react";
import { api } from "../lib/api";
import type { Job } from "../lib/types";
import { errorMessage, titleOf, when } from "../lib/utils";
import { assistantApi, streamMessage } from "../lib/assistant";
import type {
  AssistantCapability,
  AssistantConfig,
  AssistantConfigPatch,
  AssistantMessage,
  AssistantMode,
  AssistantSession,
  AssistantStatus,
  CoverCandidate,
  CoverList,
  Suggestion,
} from "../lib/assistant";
import { useApp } from "../state/app";
import {
  Artwork,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Checkbox,
  IconButton,
  Input,
  Select,
  Textarea,
} from "../components/ui";
import "./Assistant.css";

const connectionUrl = "/assistant?mode=settings";
const defaultChecks = { title: true, lyrics: true, description: true };
const contextFor = (job?: Job) =>
  job
    ? {
        title: titleOf(job),
        lyrics: job.params?.lyrics || "",
        description: job.params?.style || "",
      }
    : {};
const isAbort = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";
const capabilityLabel = (cap?: AssistantCapability) =>
  !cap
    ? "检测中"
    : cap.available
      ? cap.verified === false
        ? "待验证"
        : "已连接"
      : cap.configured
        ? "待连接"
        : "未配置";
const uid = () => crypto.randomUUID();

function ErrorNotice({
  error,
  onRetry,
}: {
  error: string;
  onRetry?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="as-error" role="alert">
      <span>{error}</span>
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}

function useAssistantData() {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.allSettled([
      assistantApi.status(controller.signal),
      api.jobs({ status: "done", limit: 500 }),
    ]).then(([connection, works]) => {
      if (cancelled) return;
      if (connection.status === "fulfilled") setStatus(connection.value);
      else if (!isAbort(connection.reason))
        setError(errorMessage(connection.reason));
      if (works.status === "fulfilled")
        setJobs((old) => [
          ...(works.value.jobs || []),
          ...old.filter(
            (item) =>
              !(works.value.jobs || []).some((work) => work.id === item.id),
          ),
        ]);
      else setError(errorMessage(works.reason));
      setLoading(false);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reload]);
  return {
    status,
    setStatus,
    jobs,
    setJobs,
    error,
    setError,
    loading,
    retry: () => setReload((n) => n + 1),
  };
}

function useActiveRequest() {
  const alive = useRef(true);
  const active = useRef<{
    controller: AbortController;
    session?: string;
  } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (active.current?.session)
        assistantApi.stop(active.current.session).catch(() => {});
      active.current?.controller.abort();
    };
  }, []);
  return { alive, active };
}

function DraftPreview({
  suggestion,
  onClose,
}: {
  suggestion: Suggestion;
  onClose: () => void;
}) {
  const navigate = useNavigate(),
    toast = useApp((state) => state.toast);
  const values = {
    title: suggestion.title || "",
    lyrics: suggestion.lyrics || "",
    style: suggestion.description || suggestion.style || "",
  };
  const labels = { title: "作品名称", lyrics: "歌词", style: "曲风描述" };
  const [selected, setSelected] = useState({
    title: Boolean(values.title),
    lyrics: Boolean(values.lyrics),
    style: Boolean(values.style),
  });
  const apply = () => {
    const fields = Object.fromEntries(
      Object.entries(values).filter(([key]) => selected[key]),
    );
    if (!Object.keys(fields).length) return;
    try {
      localStorage.setItem(
        "yue2-assistant-draft",
        JSON.stringify({
          ...fields,
          origin: "assistant",
          createdAt: new Date().toISOString(),
        }),
      );
    } catch {
      toast("无法保存草稿，请复制内容后手动填入。", "error");
      return;
    }
    onClose();
    navigate("/create?assistantDraft=1");
  };
  return (
    <Dialog title="预览创作建议" onClose={onClose}>
      <div className="as-draft-dialog">
        <p className="muted small">
          只填入勾选的字段。进入创作页后可继续编辑，也可撤销。
        </p>
        {Object.entries(values)
          .filter(([, value]) => value)
          .map(([key, value]) => (
            <section className="as-suggestion" key={key}>
              <label className="as-check">
                <Checkbox
                  checked={selected[key]}
                  onChange={(event) =>
                    setSelected((old) => ({
                      ...old,
                      [key]: event.target.checked,
                    }))
                  }
                />
                {labels[key]}
              </label>
              <pre>{value}</pre>
            </section>
          ))}
        <div className="row">
          <Button
            variant="primary"
            disabled={!Object.values(selected).some(Boolean)}
            onClick={apply}
          >
            确认填入创作
          </Button>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function SuggestionCard({
  suggestion,
  jobId,
  onPreview,
}: {
  suggestion: Suggestion;
  jobId: string;
  onPreview: (value: Suggestion) => void;
}) {
  const navigate = useNavigate(),
    toast = useApp((state) => state.toast);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        suggestion.lyrics ||
          suggestion.description ||
          suggestion.style ||
          suggestion.title ||
          "",
      );
      toast("已复制。", "success");
    } catch {
      toast("复制失败，请选中文字复制。", "error");
    }
  };
  const cover = () => {
    try {
      sessionStorage.setItem(
        "yue2-assistant-cover-prompt",
        suggestion.cover_prompt || "",
      );
    } catch {
      /* Optional continuity across routes. */
    }
    navigate(
      `/assistant?mode=cover${jobId ? `&song=${encodeURIComponent(jobId)}` : ""}`,
    );
  };
  return (
    <div className="as-suggestion">
      {(suggestion.lyrics ||
        suggestion.title ||
        suggestion.description ||
        suggestion.style) && (
        <>
          <div className="row between">
            <strong>{suggestion.lyrics ? "歌词草稿" : "创作建议"}</strong>
            <Badge>待确认</Badge>
          </div>
          {suggestion.title && <b>{suggestion.title}</b>}
          <pre>
            {suggestion.lyrics || suggestion.description || suggestion.style}
          </pre>
          <div className="row">
            <Button variant="primary" onClick={() => onPreview(suggestion)}>
              预览并填入创作
            </Button>
            <Button variant="ghost" onClick={copy}>
              <Copy size={14} />
              复制
            </Button>
          </div>
        </>
      )}
      {suggestion.cover_prompt && (
        <>
          <strong>封面方向</strong>
          <p>{suggestion.cover_prompt}</p>
          <Button onClick={cover}>去生成封面</Button>
        </>
      )}
    </div>
  );
}

function ChatPanel({
  initialJob,
  initialSession,
}: {
  initialJob: string;
  initialSession: string;
}) {
  const { status, jobs, setJobs, error, setError, loading, retry } =
    useAssistantData();
  const [sessions, setSessions] = useState<AssistantSession[]>([]);
  const [current, setCurrent] = useState<AssistantSession | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [jobId, setJobId] = useState(initialJob);
  const [checks, setChecks] = useState(defaultChecks);
  const [mode, setMode] = useState<AssistantMode>("chat");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false),
    [stopping, setStopping] = useState(false),
    [sessionLoading, setSessionLoading] = useState(false);
  const [preview, setPreview] = useState<Suggestion | null>(null),
    [switchJob, setSwitchJob] = useState<string | null>(null);
  const [compactHistory, setCompactHistory] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  const { alive, active } = useActiveRequest();
  const sessionRevision = useRef(0),
    historyController = useRef<AbortController | null>(null);
  const messageList = useRef<HTMLDivElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null),
    scrollAtBottom = useRef(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const toast = useApp((state) => state.toast);
  const job = jobs.find((item) => item.id === jobId);
  const disabled = busy || sessionLoading;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => setCompactHistory(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    assistantApi
      .sessions(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSessions(data.sessions);
      })
      .catch((err) => {
        if (!isAbort(err)) setError(errorMessage(err));
      });
    return () => {
      controller.abort();
      historyController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (initialSession) void openSession(initialSession);
  }, [initialSession]);
  useEffect(() => {
    if (scrollAtBottom.current && messageList.current)
      messageList.current.scrollTop = messageList.current.scrollHeight;
  }, [messages]);

  async function refreshSessions() {
    const data = await assistantApi.sessions();
    if (alive.current) setSessions(data.sessions);
  }
  async function openSession(id: string) {
    if (active.current) return;
    const revision = ++sessionRevision.current;
    historyController.current?.abort();
    const controller = new AbortController();
    historyController.current = controller;
    setSessionLoading(true);
    setError("");
    try {
      const session = await assistantApi.session(id, controller.signal);
      if (!alive.current || revision !== sessionRevision.current) return;
      if (session.job_id && !jobs.some((item) => item.id === session.job_id)) {
        try {
          const source = await api.job(session.job_id);
          if (alive.current && !controller.signal.aborted)
            setJobs((old) =>
              old.some((item) => item.id === source.id)
                ? old
                : [...old, source],
            );
        } catch {
          /* The original work may have been deleted. */
        }
      }
      if (!alive.current || controller.signal.aborted) return;
      setCurrent(session);
      setMode("chat");
      setMessages(session.messages || []);
      setInput("");
      setJobId(session.job_id || "");
      setChecks(defaultChecks);
      scrollAtBottom.current = true;
      setHistoryOpen(false);
    } catch (err) {
      if (!isAbort(err) && alive.current) setError(errorMessage(err));
    } finally {
      if (alive.current && revision === sessionRevision.current)
        setSessionLoading(false);
    }
  }
  function newConversation(nextJob = jobId) {
    if (active.current) return;
    historyController.current?.abort();
    ++sessionRevision.current;
    setCurrent(null);
    setMode("chat");
    setMessages([]);
    setInput("");
    setError("");
    setJobId(nextJob);
    setChecks(defaultChecks);
    setSessionLoading(false);
    textarea.current?.focus();
    setHistoryOpen(false);
  }
  async function send() {
    const content = input.trim();
    if (!content || active.current || sessionLoading || !status?.chat.available)
      return;
    const controller = new AbortController();
    active.current = { controller, session: current?.id };
    setBusy(true);
    setStopping(false);
    setError("");
    const replyId = uid();
    let appended = false;
    try {
      const session =
        current ||
        (await assistantApi.newSession(
          { title: content.slice(0, 40), job_id: jobId || null },
          controller.signal,
        ));
      if (!alive.current || controller.signal.aborted) return;
      active.current.session = session.id;
      setCurrent(session);
      const context = Object.fromEntries(
        Object.entries(contextFor(job)).filter(([key]) => checks[key]),
      );
      scrollAtBottom.current = true;
      appended = true;
      setInput("");
      setMessages((old) => [
        ...old,
        { id: uid(), role: "user", content },
        {
          id: replyId,
          role: "assistant",
          content: "",
          status: "streaming",
          pendingStructured: mode !== "chat",
        },
      ]);
      await streamMessage(
        session.id,
        { content, mode, context },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (!alive.current || controller.signal.aborted) return;
            if (event.type === "delta")
              setMessages((old) =>
                old.map((item) =>
                  item.id === replyId
                    ? { ...item, content: item.content + event.text }
                    : item,
                ),
              );
            if (event.type === "done")
              setMessages((old) =>
                old.map((item) =>
                  item.id === replyId
                    ? {
                        ...event.message,
                        id: replyId,
                        pendingStructured: false,
                      }
                    : item,
                ),
              );
          },
        },
      );
    } catch (err) {
      if (alive.current) {
        if (!isAbort(err)) setError(errorMessage(err));
        setMessages((old) =>
          old.map((item) =>
            item.id === replyId
              ? {
                  ...item,
                  pendingStructured: false,
                  status: isAbort(err) ? "stopped" : "error",
                }
              : item,
          ),
        );
        if (!appended) setInput(content);
      }
    } finally {
      if (active.current?.controller === controller) active.current = null;
      if (alive.current) {
        setBusy(false);
        setStopping(false);
        refreshSessions().catch((err) => setError(errorMessage(err)));
      }
    }
  }
  async function stop() {
    const running = active.current;
    if (!running || stopping) return;
    setStopping(true);
    try {
      if (running.session) await assistantApi.stop(running.session);
    } catch (err) {
      if (alive.current) setError(errorMessage(err));
    } finally {
      running.controller.abort();
    }
  }

  const sidebar = (
    <div className="as-history-content">
      <div className="as-history-heading">
        <span>你的对话</span>
        <Tooltip label="新建对话" position="right">
          <span>
            <IconButton
              label="新建对话"
              disabled={disabled}
              onClick={() => newConversation()}
            >
              <Plus size={16} />
            </IconButton>
          </span>
        </Tooltip>
      </div>
      <div className="as-session-list" aria-label="最近对话">
        {sessions.map((session) => (
          <UnstyledButton
            key={session.id}
            className="as-session"
            aria-current={current?.id === session.id ? "true" : undefined}
            disabled={disabled}
            onClick={() => void openSession(session.id)}
          >
            <MessageSquare size={14} className="as-session-icon" />
            <span className="as-session-meta">
              <span title={session.title}>{session.title || "新对话"}</span>
              <small>
                {when(session.updated_at)}
                {session.job_id ? " · 已关联" : ""}
              </small>
            </span>
          </UnstyledButton>
        ))}
        {!sessions.length && (
          <p className="as-no-history muted">每个灵感，都可以从新对话开始。</p>
        )}
      </div>
      <div className="as-context">
        <div className="as-context-heading">
          <Link2 size={13} />
          <span>关联作品</span>
        </div>
        <Select
          aria-label="关联作品"
          searchable
          value={jobId}
          disabled={disabled}
          onChange={(event) =>
            messages.length
              ? setSwitchJob(event.target.value)
              : newConversation(event.target.value)
          }
        >
          <option value="">不关联作品</option>
          {jobs.map((item) => (
            <option key={item.id} value={item.id}>
              {titleOf(item)}
            </option>
          ))}
        </Select>
        {job ? (
          <>
            <div className="as-linked-job">
              <Artwork job={job} size={30} />
              <span>{titleOf(job)}</span>
            </div>
            <div className="as-context-fields">
              {Object.entries({
                title: "标题",
                lyrics: "歌词",
                description: "曲风",
              }).map(([key, label]) => (
                <label className="as-check" key={key}>
                  <Checkbox
                    checked={checks[key]}
                    disabled={disabled}
                    onChange={(event) =>
                      setChecks((old) => ({
                        ...old,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="muted small">仅引用勾选内容，不发送音频。</p>
          </>
        ) : (
          <p className="muted small">带上歌词与曲风，让想法更具体。</p>
        )}
      </div>
      <Link className="as-connection-link" to={connectionUrl}>
        <Settings2 size={13} />
        Agent 连接设置
        <ArrowUpRight size={13} />
      </Link>
    </div>
  );
  return (
    <div className="as-chat-layout">
      {compactHistory ? (
        <>
          <Button
            className="as-mobile-history"
            onClick={() => setHistoryOpen(true)}
          >
            <MessageSquare size={14} />
            对话与关联作品
            <ChevronDown size={14} />
          </Button>
          <Drawer
            opened={historyOpen}
            onClose={() => setHistoryOpen(false)}
            title="对话与关联作品"
            closeButtonProps={{ "aria-label": "关闭对话列表" }}
            size={290}
            className="as-history-drawer"
          >
            {sidebar}
          </Drawer>
        </>
      ) : (
        <aside className="as-history">{sidebar}</aside>
      )}
      <section className="as-chat" aria-label="创作对话">
        <div className="as-chat-top">
          <Avatar className="as-avatar" size={30} radius={10}>
            <AudioLines size={16} />
          </Avatar>
          <div className="as-chat-identity">
            <strong>Agent</strong>
            <span className="muted as-model-name">
              {status?.chat.model || "连接检测中"}
            </span>
          </div>
          <span
            className={`as-connection-status ${status?.chat.available ? "connected" : ""}`}
          >
            <i />
            {capabilityLabel(status?.chat)}
          </span>
        </div>
        <ErrorNotice error={error} onRetry={retry} />
        <div
          className="as-messages"
          ref={messageList}
          role="log"
          aria-label="对话记录"
          aria-live="polite"
          aria-relevant="additions text"
          onScroll={(event) => {
            const el = event.currentTarget;
            scrollAtBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 72;
          }}
        >
          {sessionLoading ? (
            <div className="as-empty muted">
              <Loader size={20} />
              <span>正在读取对话…</span>
            </div>
          ) : !messages.length ? (
            <div className="as-empty">
              <div className="as-welcome-mark">
                <AudioLines size={28} strokeWidth={1.4} />
              </div>
              <strong>让灵感，有了回响。</strong>
              <p className="muted">
                从一句歌词、一种情绪，或一张封面的想象开始。
              </p>
              <div className="as-starters">
                {(
                  [
                    ["lyrics", "写一段歌词", "写一段有希望感的副歌", PenLine],
                    ["style", "找到一种曲风", "聊聊这首歌的曲风", Music2],
                    ["cover_prompt", "构思唱片封面", "构思一张唱片封面", Image],
                  ] as const
                ).map(([value, label, text, Icon]) => (
                  <UnstyledButton
                    className="as-starter"
                    key={value}
                    onClick={() => {
                      setMode(value);
                      setInput(text);
                      textarea.current?.focus();
                    }}
                  >
                    <Icon size={17} strokeWidth={1.5} />
                    <span>{label}</span>
                    <ArrowUpRight size={13} />
                  </UnstyledButton>
                ))}
              </div>
              {!loading && !status?.chat.available && (
                <p className="as-notice">
                  {status?.chat.message || "Agent 尚未连接。"}{" "}
                  <Link to={connectionUrl}>前往连接设置</Link>
                </p>
              )}
            </div>
          ) : (
            messages.map((message) => (
              <article
                className={`as-message ${message.role}`}
                key={message.id}
              >
                <Avatar
                  className={`as-avatar ${message.role === "user" ? "as-user-avatar" : ""}`}
                  size={28}
                  radius={message.role === "user" ? "xl" : 9}
                  aria-hidden="true"
                >
                  {message.role === "user" ? (
                    <UserRound size={16} strokeWidth={1.8} />
                  ) : (
                    <AudioLines size={15} />
                  )}
                </Avatar>
                <div className="as-message-body">
                  <div className="as-message-label">
                    {message.role === "user" ? "你" : "Agent"}
                    {message.status === "streaming" && <Loader size={10} />}
                  </div>
                  <div className="as-message-bubble">
                    <p className="as-message-text">
                      {message.pendingStructured
                        ? "正在整理创作建议…"
                        : message.suggestion
                          ? "建议已准备好，确认后再使用。"
                          : message.content ||
                            (message.status === "streaming" ? "正在思考…" : "")}
                    </p>
                    {message.suggestion && (
                      <SuggestionCard
                        suggestion={message.suggestion}
                        jobId={jobId}
                        onPreview={setPreview}
                      />
                    )}
                    {["stopped", "cancelled"].includes(
                      message.status || "",
                    ) && (
                      <p className="muted small">回复已停止，已有内容保留。</p>
                    )}
                    {message.status === "error" && (
                      <p className="muted small">这条回复未完成。</p>
                    )}
                  </div>
                  {message.role === "assistant" &&
                    message.content &&
                    message.status !== "streaming" &&
                    !message.suggestion && (
                      <Tooltip label="复制回复">
                        <span className="as-message-tools">
                          <IconButton
                            label="复制回复"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(
                                  message.content,
                                );
                                toast("已复制回复。", "success");
                              } catch {
                                toast("复制失败，请选中文字复制。", "error");
                              }
                            }}
                          >
                            <Copy size={13} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                </div>
              </article>
            ))
          )}
        </div>
        <div className="as-compose-wrap">
          <form
            className="as-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <Textarea
              ref={textarea}
              aria-label="输入消息"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={12000}
              rows={2}
              placeholder="说说你的想法…"
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="as-composer-bar">
              <Select
                aria-label="助手模式"
                value={mode}
                disabled={disabled}
                onChange={(event) =>
                  setMode(event.target.value as AssistantMode)
                }
              >
                <option value="chat">自由对话</option>
                <option value="lyrics">写歌词</option>
                <option value="style">聊曲风</option>
                <option value="cover_prompt">构思封面</option>
              </Select>
              <span
                className="as-compose-context muted"
                title={job ? titleOf(job) : ""}
              >
                {job && (
                  <>
                    <Link2 size={12} />
                    {titleOf(job)}
                  </>
                )}
              </span>
              <span className="as-key-hint muted">Enter 发送</span>
              {busy ? (
                <Button
                  className="as-stop"
                  type="button"
                  disabled={stopping}
                  onClick={() => void stop()}
                >
                  <Square size={11} />
                  {stopping ? "正在停止" : "停止"}
                </Button>
              ) : (
                <Tooltip label="发送消息">
                  <span>
                    <Button
                      className="as-send"
                      variant="primary"
                      type="submit"
                      aria-label="发送消息"
                      disabled={
                        !input.trim() ||
                        !status?.chat.available ||
                        sessionLoading
                      }
                    >
                      <ArrowUp size={17} />
                    </Button>
                  </span>
                </Tooltip>
              )}
            </div>
          </form>
          <div className="as-composer-footnote">
            一起打磨想法，创作由你决定。<span>Shift + Enter 换行</span>
          </div>
        </div>
      </section>
      {preview && (
        <DraftPreview suggestion={preview} onClose={() => setPreview(null)} />
      )}
      {switchJob !== null && (
        <Dialog title="切换关联作品" onClose={() => setSwitchJob(null)}>
          <p>将为所选作品新建对话，当前对话会保留。</p>
          <div className="row">
            <Button
              variant="primary"
              onClick={() => {
                newConversation(switchJob);
                setSwitchJob(null);
              }}
            >
              确认切换
            </Button>
            <Button variant="ghost" onClick={() => setSwitchJob(null)}>
              取消
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function CoverPanel({ initialJob }: { initialJob: string }) {
  const { status, jobs, error, setError, retry } = useAssistantData();
  const toast = useApp((state) => state.toast);
  const [jobId, setJobId] = useState(initialJob),
    [prompt, setPrompt] = useState(() => {
      try {
        return (
          sessionStorage.getItem("yue2-assistant-cover-prompt") || ""
        ).slice(0, 7900);
      } catch {
        return "";
      }
    });
  const [preferences, setPreferences] = useState(["无文字"]);
  const [list, setList] = useState<CoverList | null>(null),
    [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true),
    [generating, setGenerating] = useState(false),
    [applying, setApplying] = useState(false),
    [improving, setImproving] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null),
    [elapsed, setElapsed] = useState(0);
  const [enlarged, setEnlarged] = useState(false),
    [restoreConfirm, setRestoreConfirm] = useState(false),
    [descriptionPreview, setDescriptionPreview] = useState("");
  const [reload, setReload] = useState(0);
  const { alive, active } = useActiveRequest();
  const requestControllers = useRef(new Set<AbortController>()),
    listRevision = useRef(0);
  const job = jobs.find((item) => item.id === jobId),
    selected = list?.covers.find((item) => item.id === selectedId);
  const running = generating || Boolean(list?.generating),
    disabled = running || applying || improving;

  useEffect(() => {
    try {
      sessionStorage.removeItem("yue2-assistant-cover-prompt");
    } catch {
      /* Optional storage. */
    }
    return () =>
      requestControllers.current.forEach((controller) => controller.abort());
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const revision = ++listRevision.current;
    setLoading(true);
    setList(null);
    setSelectedId("");
    const load = async () => {
      try {
        const data = await assistantApi.covers(jobId, controller.signal);
        if (controller.signal.aborted || revision !== listRevision.current)
          return;
        setList(data);
        setLoading(false);
        setSelectedId((old) =>
          data.covers.some((item) => item.id === old)
            ? old
            : data.applied_id || data.covers[0]?.id || "",
        );
        const relevantTask =
          data.task && (!data.task.job_id || data.task.job_id === jobId)
            ? data.task
            : null;
        setPrompt((old) =>
          old.trim()
            ? old
            : (relevantTask?.prompt || data.covers[0]?.prompt || "").slice(
                0,
                7900,
              ),
        );
        if (
          relevantTask &&
          ["error", "interrupted"].includes(relevantTask.status)
        )
          setError(
            relevantTask.error || "上次封面生成已中断，描述已保留，可以重试。",
          );
        if (data.generating) {
          setStartedAt(
            data.task?.created_at
              ? Date.parse(data.task.created_at)
              : Date.now(),
          );
          timer = setTimeout(load, 3000);
        } else setStartedAt(null);
      } catch (err) {
        if (!isAbort(err)) {
          setError(errorMessage(err));
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [jobId, reload]);
  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    const tick = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  function changedArtwork() {
    window.dispatchEvent(
      new CustomEvent("yue2:cover-updated", { detail: { job_id: jobId } }),
    );
  }
  async function generate() {
    if (disabled || !prompt.trim() || !status?.image.available) return;
    const controller = new AbortController();
    requestControllers.current.add(controller);
    setGenerating(true);
    setStartedAt(Date.now());
    setError("");
    try {
      const candidate = await assistantApi.generateCover(
        {
          prompt: [prompt.trim(), ...preferences].join("\n"),
          job_id: jobId || null,
        },
        controller.signal,
      );
      if (!alive.current || controller.signal.aborted) return;
      setList((old) => ({
        covers: [
          candidate,
          ...(old?.covers || []).filter((item) => item.id !== candidate.id),
        ],
        applied_id: old?.applied_id || null,
        can_restore: old?.can_restore || false,
        generating: false,
      }));
      setSelectedId(candidate.id);
      toast("封面已生成，确认应用后才会更新作品。", "success");
    } catch (err) {
      if (alive.current && !isAbort(err)) {
        setError(errorMessage(err));
        setReload((value) => value + 1);
      }
    } finally {
      requestControllers.current.delete(controller);
      if (alive.current) {
        setGenerating(false);
        setStartedAt(null);
      }
    }
  }
  async function improve() {
    if (disabled || !job || !status?.chat.available) return;
    const controller = new AbortController();
    active.current = { controller };
    setImproving(true);
    setError("");
    try {
      const session = await assistantApi.newSession(
        { title: "封面画面描述", job_id: jobId },
        controller.signal,
      );
      if (!alive.current || controller.signal.aborted) return;
      active.current.session = session.id;
      let suggestion = "";
      await streamMessage(
        session.id,
        {
          content: `请根据这首歌完善方形封面的画面描述，不要文字。${prompt ? `已有想法：${prompt}` : ""}`,
          mode: "cover_prompt",
          context: contextFor(job),
        },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "done")
              suggestion = event.message.suggestion?.cover_prompt || "";
          },
        },
      );
      if (alive.current) {
        if (!suggestion)
          throw new Error("未得到可用的画面描述，请调整后重试。");
        setDescriptionPreview(suggestion);
      }
    } catch (err) {
      if (alive.current && !isAbort(err)) setError(errorMessage(err));
    } finally {
      if (active.current?.controller === controller) active.current = null;
      if (alive.current) setImproving(false);
    }
  }
  async function changeCover(restore: boolean) {
    if (disabled || !jobId || (!restore && !selected)) return;
    setRestoreConfirm(false);
    setApplying(true);
    setError("");
    const controller = new AbortController();
    requestControllers.current.add(controller);
    try {
      const applied = restore
        ? await assistantApi.restoreCover(jobId, controller.signal)
        : await assistantApi.applyCover(selected!.id, jobId, controller.signal);
      if (!alive.current) return;
      setList((old) =>
        old
          ? {
              ...old,
              applied_id: applied.cover_id,
              can_restore: applied.can_restore,
            }
          : old,
      );
      changedArtwork();
      toast(restore ? "已恢复原封面。" : "作品封面已更新。", "success");
    } catch (err) {
      if (alive.current && !isAbort(err)) setError(errorMessage(err));
    } finally {
      requestControllers.current.delete(controller);
      if (alive.current) setApplying(false);
    }
  }

  return (
    <div className="as-cover-page">
      <ErrorNotice
        error={error}
        onRetry={() => {
          retry();
          setReload((value) => value + 1);
        }}
      />
      <div className="as-cover-layout">
        <section className="as-cover-form card">
          <label className="field">
            关联作品
            <Select
              aria-label="封面关联作品"
              searchable
              value={jobId}
              disabled={disabled}
              onChange={(event) => {
                setJobId(event.target.value);
                setError("");
              }}
            >
              <option value="">暂不关联作品</option>
              {jobs.map((item) => (
                <option key={item.id} value={item.id}>
                  {titleOf(item)}
                </option>
              ))}
            </Select>
          </label>
          {job && (
            <div className="as-linked-job">
              <Artwork job={job} size={36} />
              <div>
                <strong>{titleOf(job)}</strong>
                <p className="muted small">封面单独保存</p>
              </div>
            </div>
          )}
          <label className="field">
            画面描述
            <Textarea
              aria-label="画面描述"
              rows={6}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={7900}
              placeholder="描述画面、色彩和情绪…"
            />
          </label>
          <Button
            disabled={disabled || !job || !status?.chat.available}
            onClick={() => void improve()}
          >
            {improving ? "正在构思…" : "根据歌词完善描述"}
          </Button>
          <div className="as-preferences">
            {["胶片感", "治愈", "无文字", "极简"].map((item) => (
              <UnstyledButton
                type="button"
                key={item}
                aria-pressed={preferences.includes(item)}
                onClick={() =>
                  setPreferences((old) =>
                    old.includes(item)
                      ? old.filter((value) => value !== item)
                      : [...old, item],
                  )
                }
              >
                {item}
              </UnstyledButton>
            ))}
          </div>
          <div className="row between">
            <span className="muted small">比例</span>
            <Badge>1:1 正方形</Badge>
          </div>
          <p className="muted small">
            {status?.image.model || "图片模型检测中"}
            {status?.image.available ? "" : " · 尚未连接"}
          </p>
          {!status?.image.available && (
            <Link to={connectionUrl}>配置图片服务</Link>
          )}
          {running && (
            <div className="as-generation-status" role="status">
              <div className="as-indeterminate" />
              <span>正在生成 · 已用 {elapsed} 秒</span>
              <small>可以切换页面，完成后自动保存候选。</small>
            </div>
          )}
          <Button
            variant="primary"
            disabled={disabled || !prompt.trim() || !status?.image.available}
            onClick={() => void generate()}
          >
            {running ? "正在生成…" : "生成封面"}
          </Button>
          <p className="muted small">候选不会自动替换作品封面。</p>
        </section>
        <div className="as-cover-results">
          <section className="as-cover-preview card">
            <div className="row between">
              <strong>候选封面</strong>
              <Button
                variant="ghost"
                disabled={!selected}
                onClick={() => setEnlarged(true)}
              >
                <Maximize2 size={14} />
                放大
              </Button>
            </div>
            <div className="as-cover-stage">
              {selected ? (
                <img
                  src={selected.url}
                  alt={`候选封面：${selected.prompt}`}
                  onError={() => setError("图片暂时无法加载，请刷新候选列表。")}
                />
              ) : (
                <EmptyState
                  title={
                    loading
                      ? "正在读取候选…"
                      : running
                        ? "正在生成封面"
                        : "还没有候选封面"
                  }
                  description={
                    running
                      ? "完成后自动显示在这里。"
                      : "写好画面描述，生成第一张封面。"
                  }
                />
              )}
            </div>
            <div className="row between">
              <span className="muted small">
                {selected
                  ? `${when(selected.created_at)}${selected.id === list?.applied_id ? " · 当前作品封面" : ""}`
                  : "确认应用后才会替换封面"}
              </span>
              {selected?.id === list?.applied_id && <Badge>已应用</Badge>}
            </div>
          </section>
          <div className="as-candidates" aria-label="封面候选">
            {list?.covers.map((candidate, index) => (
              <UnstyledButton
                key={candidate.id}
                className="as-candidate"
                aria-pressed={candidate.id === selectedId}
                onClick={() => setSelectedId(candidate.id)}
              >
                <img src={candidate.url} alt="" />
                <span>候选 {index + 1}</span>
                {candidate.id === list.applied_id && <Check size={14} />}
              </UnstyledButton>
            ))}
          </div>
          <div className="row between as-cover-actions">
            <Button
              disabled={disabled || !jobId || !list?.can_restore}
              onClick={() => setRestoreConfirm(true)}
            >
              <RotateCcw size={14} />
              恢复原封面
            </Button>
            <Button
              variant="primary"
              disabled={
                disabled ||
                !jobId ||
                !selected ||
                selected.id === list?.applied_id
              }
              onClick={() => void changeCover(false)}
            >
              {applying
                ? "正在更新…"
                : selected?.id === list?.applied_id
                  ? "已应用"
                  : "应用为作品封面"}
            </Button>
          </div>
        </div>
      </div>
      {enlarged && selected && (
        <Dialog title="候选封面" onClose={() => setEnlarged(false)}>
          <img className="as-enlarged" src={selected.url} alt="候选封面大图" />
        </Dialog>
      )}
      {descriptionPreview && (
        <Dialog title="预览画面描述" onClose={() => setDescriptionPreview("")}>
          <p className="as-message-text">{descriptionPreview}</p>
          <div className="row">
            <Button
              variant="primary"
              onClick={() => {
                setPrompt(descriptionPreview.slice(0, 7900));
                setDescriptionPreview("");
              }}
            >
              使用这段描述
            </Button>
            <Button variant="ghost" onClick={() => setDescriptionPreview("")}>
              取消
            </Button>
          </div>
        </Dialog>
      )}
      {restoreConfirm && (
        <Dialog title="恢复原封面" onClose={() => setRestoreConfirm(false)}>
          <p>恢复应用候选前的封面；生成的候选仍保留。</p>
          <div className="row">
            <Button variant="primary" onClick={() => void changeCover(true)}>
              确认恢复
            </Button>
            <Button variant="ghost" onClick={() => setRestoreConfirm(false)}>
              取消
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

const emptyConfig: AssistantConfigPatch = {
  Agent_base_url: "",
  Agent_model: "",
  image_provider: "disabled",
  image_base_url: "",
  image_model: "",
};
function ConnectionsPanel() {
  const toast = useApp((state) => state.toast),
    refresh = useApp((state) => state.refresh);
  const [config, setConfig] = useState<AssistantConfig | null>(null),
    [values, setValues] = useState<AssistantConfigPatch>(emptyConfig);
  const [status, setStatus] = useState<AssistantStatus | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("正在读取配置…");
  const alive = useRef(true),
    active = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    active.current = controller;
    Promise.allSettled([
      assistantApi.config(controller.signal),
      assistantApi.status(controller.signal),
    ]).then(([saved, capabilities]) => {
      if (controller.signal.aborted) return;
      if (saved.status === "fulfilled") {
        setConfig(saved.value);
        setValues({
          Agent_base_url: saved.value.Agent_base_url,
          Agent_model: saved.value.Agent_model,
          image_provider: saved.value.image_provider,
          image_base_url: saved.value.image_base_url,
          image_model: saved.value.image_model,
        });
        setNotice("凭证不回显，留空保持现有凭证。");
      } else {
        setError(errorMessage(saved.reason));
        setNotice("配置未加载。");
      }
      if (capabilities.status === "fulfilled") setStatus(capabilities.value);
      else if (!isAbort(capabilities.reason))
        setError(errorMessage(capabilities.reason));
    });
    return () => {
      alive.current = false;
      active.current?.abort();
    };
  }, []);
  function update<K extends keyof AssistantConfigPatch>(
    key: K,
    value: AssistantConfigPatch[K],
  ) {
    setValues((old) => ({ ...old, [key]: value }));
  }
  async function check(save: boolean) {
    if (busy || !config) return;
    if (save && !values.Agent_base_url.trim()) {
      setError("请填写 Agent 服务地址。");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    setNotice(save ? "正在保存并检测…" : "正在分别检测对话与图片能力…");
    try {
      if (save) {
        const patch: AssistantConfigPatch = {
          ...values,
          Agent_model: values.Agent_model.trim() || "Agent-agent",
        };
        if (!patch.hermes_api_key?.trim()) delete patch.hermes_api_key;
        if (!patch.image_api_key?.trim()) delete patch.image_api_key;
        const saved = await assistantApi.saveConfig(patch, controller.signal);
        if (!alive.current) return;
        setConfig(saved);
        setValues((old) => ({ ...old, hermes_api_key: "", image_api_key: "" }));
      }
      const result = await assistantApi.check(controller.signal);
      if (alive.current) {
        setStatus(result);
        setNotice(save ? "配置已保存，检测完成。" : "检测完成。");
        if (save) {
          toast("连接配置已保存。", "success");
          void refresh();
        }
      }
    } catch (err) {
      if (alive.current && !isAbort(err)) {
        setError(errorMessage(err));
        setNotice("请检查连接信息后重试。");
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="as-connections">
      <ErrorNotice error={error} />
      <div className="as-connections-layout">
        <form
          className="as-connection-form card"
          onSubmit={(event) => {
            event.preventDefault();
            void check(true);
          }}
        >
          <div className="row between">
            <strong>Agent 连接</strong>
            <Badge>{capabilityLabel(status?.chat)}</Badge>
          </div>
          <label className="field">
            服务地址
            <Input
              type="url"
              aria-label="Agent 服务地址"
              value={values.Agent_base_url}
              placeholder="http://127.0.0.1:8642"
              disabled={busy}
              onChange={(event) =>
                update("Agent_base_url", event.target.value)
              }
            />
          </label>
          <label className="field">
            对话模型
            <Input
              aria-label="对话模型"
              value={values.Agent_model}
              placeholder="留空沿用 Agent 当前模型"
              disabled={busy}
              onChange={(event) => update("Agent_model", event.target.value)}
            />
          </label>
          <label className="field">
            访问凭证
            <Input
              type="password"
              autoComplete="new-password"
              aria-label="Agent 访问凭证"
              value={values.hermes_api_key || ""}
              placeholder={
                config?.has_hermes_api_key
                  ? "已保存 · 留空不修改"
                  : "留空沿用本机凭证"
              }
              disabled={busy}
              onChange={(event) => update("hermes_api_key", event.target.value)}
            />
          </label>
          <hr />
          <strong>封面生成</strong>
          <label className="field">
            图片服务
            <Select
              aria-label="图片服务"
              value={values.image_provider}
              disabled={busy}
              onChange={(event) =>
                setValues((old) => ({
                  ...old,
                  image_provider: event.target
                    .value as AssistantConfigPatch["image_provider"],
                  image_model:
                    event.target.value === "hermes-codex" &&
                    !old.image_model.startsWith("gpt-image-2-")
                      ? "gpt-image-2-low"
                      : old.image_model,
                }))
              }
            >
              <option value="hermes-codex">Agent · ChatGPT 图片能力</option>
              <option value="openai-compatible">自定义图片服务</option>
              <option value="disabled">暂不启用</option>
            </Select>
          </label>
          {values.image_provider === "hermes-codex" && (
            <>
              <label className="field">
                图片模型
                <Select
                  aria-label="图片模型"
                  value={values.image_model}
                  disabled={busy}
                  onChange={(event) =>
                    update("image_model", event.target.value)
                  }
                >
                  <option value="gpt-image-2-low">GPT Image 2 · 快速</option>
                  <option value="gpt-image-2-medium">GPT Image 2 · 标准</option>
                  <option value="gpt-image-2-high">GPT Image 2 · 高质量</option>
                </Select>
              </label>
              <p className="muted small">
                复用本机 Agent 的 ChatGPT 登录，无需另填密钥。
              </p>
            </>
          )}
          {values.image_provider === "openai-compatible" && (
            <>
              <label className="field">
                服务地址
                <Input
                  type="url"
                  aria-label="图片服务地址"
                  value={values.image_base_url}
                  disabled={busy}
                  onChange={(event) =>
                    update("image_base_url", event.target.value)
                  }
                />
              </label>
              <label className="field">
                图片模型
                <Input
                  aria-label="自定义图片模型"
                  value={values.image_model}
                  disabled={busy}
                  onChange={(event) =>
                    update("image_model", event.target.value)
                  }
                />
              </label>
              <label className="field">
                访问凭证
                <Input
                  type="password"
                  autoComplete="new-password"
                  aria-label="图片访问凭证"
                  value={values.image_api_key || ""}
                  placeholder={
                    config?.has_image_api_key
                      ? "已保存 · 留空不修改"
                      : "填写图片服务凭证"
                  }
                  disabled={busy}
                  onChange={(event) =>
                    update("image_api_key", event.target.value)
                  }
                />
              </label>
            </>
          )}
          <div className="row">
            <Button variant="primary" type="submit" disabled={busy || !config}>
              {busy ? "正在检测…" : "保存并检测"}
            </Button>
            <Button
              type="button"
              disabled={busy || !config}
              onClick={() => void check(false)}
            >
              重新检测
            </Button>
          </div>
          <p className="muted small" role="status">
            {notice}
          </p>
        </form>
        <aside className="as-capabilities card">
          <strong>能力状态</strong>
          {(
            [
              ["对话与创作建议", status?.chat],
              ["封面生成", status?.image],
            ] as [string, AssistantCapability | undefined][]
          ).map(([label, capability]) => (
            <section className="as-capability" key={label}>
              <div className="row between">
                <b>{label}</b>
                <Badge>{capabilityLabel(capability)}</Badge>
              </div>
              <span>{capability?.model || "等待检测"}</span>
              <p className="muted small">
                {capability?.message || "配置后分别检测两种能力。"}
              </p>
            </section>
          ))}
          <p className="muted small">
            Agent
            在本机运行。模型是否联网，取决于所选服务。凭证仅由本机服务保存，不写入对话与作品。
          </p>
          <p className="muted small">
            工作台会话独立保存，不导入其他 Agent 对话。
          </p>
        </aside>
      </div>
    </div>
  );
}

export function AssistantPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const mode =
    search.get("mode") === "cover"
      ? "cover"
      : search.get("mode") === "settings"
        ? "settings"
        : "chat";
  const job = search.get("song") || "",
    session = search.get("session") || "";
  return (
    <div className={`assistant-page as-mode-${mode}`}>
      <Tabs
        value={mode}
        variant="pills"
        className="as-tabs"
        onChange={(value) =>
          navigate(
            value === "chat"
              ? `/assistant${job ? `?song=${encodeURIComponent(job)}` : ""}`
              : `/assistant?mode=${value}${job ? `&song=${encodeURIComponent(job)}` : ""}`,
          )
        }
      >
        <Tabs.List aria-label="助手功能">
          <Tabs.Tab value="chat" leftSection={<MessageSquare size={14} />}>
            对话
          </Tabs.Tab>
          <Tabs.Tab value="cover" leftSection={<Image size={14} />}>
            封面
          </Tabs.Tab>
          <Tabs.Tab value="settings" leftSection={<Settings2 size={14} />}>
            连接设置
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>
      {mode === "chat" ? (
        <ChatPanel
          key={`chat-${job}`}
          initialJob={job}
          initialSession={session}
        />
      ) : mode === "cover" ? (
        <CoverPanel key={`cover-${job}`} initialJob={job} />
      ) : (
        <ConnectionsPanel />
      )}
    </div>
  );
}
