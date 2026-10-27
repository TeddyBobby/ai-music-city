import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  Clock3,
  Download,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Share2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import {
  draftFromJob,
  generationProgress,
  submitRevision,
  type GenerationDraft,
} from "../lib/generationDetail";
import { isGenerating, watchGeneration } from "../lib/generationWatch";
import { songDownload } from "../lib/shareSong";
import { duration, errorMessage, titleOf, when } from "../lib/utils";
import type { Job } from "../lib/types";
import { useApp } from "../state/app";
import { usePlayer } from "../state/player";
import { Artwork } from "../components/ui";
import { MusicKindToggle } from "../components/MusicKindToggle";
import { ShareSongDialog } from "../components/ShareSongDialog";
import { SunoAdvancedSettings } from "../components/SunoAdvancedSettings";
import "./Generation.css";

const draftKey = (id: string) => `music.revision.${id}`;
function initialDraft(job: Job): GenerationDraft {
  const fallback = draftFromJob(job);
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(draftKey(job.id)) || "null",
    );
    if (
      saved &&
      ["title", "style", "lyrics"].every(
        (key) => typeof saved[key] === "string",
      ) &&
      ["instrumental", "vocal"].includes(saved.musicKind)
    )
      return {
        ...fallback,
        ...saved,
        suno:
          saved.suno &&
          typeof saved.suno === "object" &&
          !Array.isArray(saved.suno)
            ? saved.suno
            : fallback.suno,
      };
  } catch {}
  return fallback;
}
function statusText(job: Job) {
  return (
    (
      {
        done: "已完成",
        failed: "未完成",
        cancelled: "已取消",
        queued: "排队中",
        running: "生成中",
      } as Record<string, string>
    )[job.status] || "准备中"
  );
}
function elapsed(job: Job, now: number) {
  if (!job.started_at) return "";
  const end = job.finished_at ? Date.parse(job.finished_at) : now;
  const seconds = Math.max(
    0,
    Math.round((end - Date.parse(job.started_at)) / 1000),
  );
  if (!Number.isFinite(seconds)) return "";
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function GenerationPage() {
  const { id } = useParams();

  return id ? <GenerationWorkspace key={id} id={id} /> : null;
}

function GenerationWorkspace({ id }: { id: string }) {
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const [draft, setDraft] = useState<GenerationDraft | null>(null);
  const [versions, setVersions] = useState<Job[]>([]);
  const [loadError, setLoadError] = useState("");
  const [versionError, setVersionError] = useState("");
  const [actionError, setActionError] = useState("");
  const [revisionPhase, setRevisionPhase] = useState("");
  const [canceling, setCanceling] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [editorOpen, setEditorOpen] = useState<boolean | null>(null);
  const [now, setNow] = useState(Date.now());
  const [reload, setReload] = useState(0);
  const watch = useRef<ReturnType<typeof watchGeneration> | null>(null);
  const request = useRef<AbortController | null>(null);
  const editor = useRef<HTMLFormElement | null>(null);
  const page = useRef<HTMLDivElement | null>(null);
  const player = usePlayer();
  const mp3 = Boolean(useApp((s) => s.status?.ffmpeg));
  const sunoEnabled = useApp((s) => s.status?.generation?.engine === "suno");

  useEffect(() => {
    watch.current = watchGeneration(id, {
      onJob(next) {
        setJob(next);
        setDraft((previous) => previous || initialDraft(next));
        setLoadError("");
      },
      onError(error) {
        setLoadError(errorMessage(error));
      },
    });
    return () => watch.current?.close();
  }, [id, reload]);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!editorOpen || !editor.current) return;
    editor.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (window.matchMedia("(min-width: 1180px)").matches)
      editor.current.querySelector("textarea")?.focus({ preventScroll: true });
  }, [editorOpen]);
  useEffect(() => {
    if (job?.id) page.current?.scrollIntoView({ block: "start" });
  }, [job?.id]);
  useEffect(() => {
    if (!job || !isGenerating(job)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job?.status]);
  useEffect(() => {
    if (!job) return;
    let live = true;
    api
      .get(`/api/jobs/${encodeURIComponent(id)}/versions`)
      .then((result) => {
        if (live) {
          setVersions(result.jobs);
          setVersionError("");
        }
      })
      .catch(() => {
        if (live) setVersionError("版本记录暂时未能加载");
      });
    return () => {
      live = false;
    };
  }, [id, job?.status, reload]);

  function edit(patch: Partial<GenerationDraft>) {
    setDraft((previous) => {
      if (!previous) return previous;
      const next = { ...previous, ...patch };
      try {
        sessionStorage.setItem(draftKey(id), JSON.stringify(next));
      } catch {}
      return next;
    });
    setActionError("");
  }
  async function revise(event: FormEvent) {
    event.preventDefault();
    if (!job || !draft || isGenerating(job) || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRevisionPhase("checking");
    setActionError("");
    try {
      const next = await submitRevision(job, draft, {
        signal: controller.signal,
        onPhase: (phase) => {
          if (!controller.signal.aborted) setRevisionPhase(phase);
        },
      });
      // The edits now belong to the new version. Returning to this version
      // should show its original settings, rather than the submitted draft.
      try {
        sessionStorage.removeItem(draftKey(id));
      } catch {}
      void useApp.getState().refresh();
      window.dispatchEvent(new Event("yue2:jobs-updated"));
      if (!controller.signal.aborted)
        navigate(`/generation/${encodeURIComponent(next.id)}`);
    } catch (error) {
      if (!controller.signal.aborted) setActionError(errorMessage(error));
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setRevisionPhase("");
      }
    }
  }
  async function cancel() {
    if (!job || canceling) return;
    setCanceling(true);
    setActionError("");
    try {
      const result = await api.cancel(job.id);
      if (result.status !== 202) setCanceling(false);
      void watch.current?.refresh();
      void useApp.getState().refresh();
    } catch (error) {
      setCanceling(false);
      setActionError(errorMessage(error));
      void watch.current?.refresh();
    }
  }

  if (!job || !draft)
    return (
      <div className="generation-empty">
        {loadError ? (
          <>
            <h1>暂时打不开这次创作</h1>
            <p role="alert">{loadError}</p>
            <button className="btn" onClick={() => setReload((n) => n + 1)}>
              重新加载
            </button>
            <Link to="/library">返回我的音乐</Link>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" size={28} />
            <p role="status">正在打开你的创作…</p>
          </>
        )}
      </div>
    );

  const active = isGenerating(job);
  const playable = job.status === "done" && !!job.artifacts?.audio;
  const progress = generationProgress(job);
  const playing = player.current?.id === id && player.playing;
  const selected = player.current?.id === id;
  const audioDuration =
    (selected ? player.duration : job.timing?.audio_seconds) ||
    job.timing?.audio_seconds ||
    0;
  const download = songDownload(job, mp3);
  const history = versions.length ? versions : [job];
  const versionNumber = Math.max(
    1,
    history.findIndex((version) => version.id === id) + 1,
  );
  const time = elapsed(job, now);
  const busy = !!revisionPhase;
  const original = draftFromJob(job);

  const showEditor = editorOpen ?? ["failed", "cancelled"].includes(job.status);
  const showLyrics =
    original.musicKind === "vocal" && !!original.lyrics.trim() && !showEditor;

  return (
    <div className="generation-page" ref={page}>
      <header className="generation-heading">
        <Link className="generation-back" to="/library">
          <ArrowLeft size={17} />
          我的音乐
        </Link>
      </header>
      {loadError && (
        <div className="generation-notice" role="alert">
          连接暂时中断，正在重新获取进度。
          <button onClick={() => void watch.current?.refresh()}>刷新</button>
        </div>
      )}
      <div
        className={`generation-layout ${showEditor || showLyrics ? "has-panel" : ""}`}
      >
        <div className="generation-main">
          <section
            className={`generation-result ${playable ? "is-ready" : ""}`}
            aria-label={playable ? "生成结果" : "生成状态"}
          >
            <div className="generation-result-art">
              <Artwork job={job} size={200} />
              {active && (
                <span className="generation-art-orbit" aria-hidden="true" />
              )}
            </div>
            <div className="generation-result-copy">
              <details className="generation-versions" aria-label="版本记录">
                <summary>
                  第 {versionNumber} 版
                  {history.length > 1 && <span> / {history.length}</span>}
                  <ChevronDown size={14} />
                </summary>
                <div className="generation-version-popover">
                  {versionError && (
                    <p className="generation-version-error">
                      {versionError}
                      <button onClick={() => setReload((n) => n + 1)}>
                        重试
                      </button>
                    </p>
                  )}
                  <div className="generation-version-list">
                    {history.map((version, index) => (
                      <Link
                        key={version.id}
                        to={`/generation/${encodeURIComponent(version.id)}`}
                        className={version.id === id ? "is-selected" : ""}
                        aria-current={version.id === id ? "page" : undefined}
                        onClick={(event) =>
                          event.currentTarget
                            .closest("details")
                            ?.removeAttribute("open")
                        }
                      >
                        <span className="generation-version-number">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <strong>{titleOf(version)}</strong>
                          <small>
                            {when(version.created_at)} · {statusText(version)}
                          </small>
                        </div>
                        {version.id === id ? (
                          <Check size={15} />
                        ) : (
                          <ArrowRight size={15} />
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              </details>
              <h1>{titleOf(job)}</h1>
              <div className="generation-audio-meta">
                <span>
                  {original.musicKind === "instrumental" ? "纯音乐" : "带歌词"}
                </span>
                {playable && (
                  <>
                    <span>·</span>
                    <span>{duration(audioDuration)}</span>
                  </>
                )}
              </div>
              {playable && time && (
                <span className="generation-elapsed">创作用时 {time}</span>
              )}
              {!playable && (
                <button
                  className="generation-edit-link"
                  onClick={() => setEditorOpen(!showEditor)}
                  aria-expanded={showEditor}
                  aria-controls="generation-editor"
                >
                  <SlidersHorizontal size={16} />
                  {showEditor
                    ? "收起微调"
                    : active
                      ? "调整下一版"
                      : "调整并重试"}
                </button>
              )}
            </div>
            {playable && (
              <div className="generation-player">
                <div className="generation-transport">
                  <button
                    className="generation-play"
                    aria-label={playing ? "暂停这一版" : "播放这一版"}
                    onClick={() =>
                      selected ? player.toggle() : player.play([job])
                    }
                  >
                    {playing ? (
                      <Pause size={22} fill="currentColor" />
                    ) : (
                      <Play size={22} fill="currentColor" />
                    )}
                  </button>
                  <div className="generation-seek">
                    <input
                      type="range"
                      aria-label="这一版播放进度"
                      min={0}
                      max={Math.max(audioDuration, 1)}
                      step={0.1}
                      value={
                        selected
                          ? Math.min(player.time, Math.max(audioDuration, 1))
                          : 0
                      }
                      onChange={(event) =>
                        player.seekTo(job, Number(event.target.value))
                      }
                    />
                    <div>
                      <span>{duration(selected ? player.time : 0)}</span>
                      <span>{duration(audioDuration)}</span>
                    </div>
                  </div>
                </div>
                <div className="generation-result-actions">
                  <button
                    className="generation-edit-action"
                    onClick={() => setEditorOpen(!showEditor)}
                    aria-expanded={showEditor}
                    aria-controls="generation-editor"
                  >
                    <SlidersHorizontal size={17} />
                    {showEditor ? "收起微调" : "微调"}
                  </button>
                  <a href={download.url} download={download.name}>
                    <Download size={17} />
                    下载
                  </a>
                  <button onClick={() => setSharing(true)}>
                    <Share2 size={17} />
                    分享
                  </button>
                </div>
              </div>
            )}
          </section>

          {!playable && (
            <section className="generation-process" aria-label="生成流程">
              <div className="generation-section-heading">
                <h2 role="status">{progress.title}</h2>
                {time && (
                  <span>
                    <Clock3 size={13} />
                    {time}
                  </span>
                )}
              </div>
              {!active && (
                <p className="generation-process-description">
                  {progress.description}
                </p>
              )}
              {active && (
                <ol className="generation-steps" aria-label="生成阶段">
                  {progress.steps.map((step, index) => (
                    <li
                      key={step.id}
                      className={`is-${step.state}`}
                      aria-current={
                        step.state === "current" ? "step" : undefined
                      }
                    >
                      <span className="generation-step-icon">
                        {step.state === "complete" ? (
                          <Check size={13} />
                        ) : step.state === "current" ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <strong>{step.label}</strong>
                    </li>
                  ))}
                </ol>
              )}
              {active && progress.stagePercent !== undefined && (
                <div className="generation-stage-progress">
                  <div>
                    <span>{progress.stageDetail}</span>
                    <strong>{progress.stagePercent}%</strong>
                  </div>
                  <progress
                    max={100}
                    value={progress.stagePercent}
                    aria-label="当前阶段进度"
                  />
                </div>
              )}
              {active && (
                <div className="generation-process-footer">
                  <span>
                    {job.status === "queued" && job.position
                      ? `前面还有 ${job.position} 个任务`
                      : "完成后自动保存"}
                  </span>
                  <button disabled={canceling} onClick={cancel}>
                    {canceling ? "正在停止…" : "停止生成"}
                  </button>
                </div>
              )}
              {job.error && (
                <details className="generation-error-detail">
                  <summary>查看错误详情</summary>
                  <pre>{job.error}</pre>
                </details>
              )}
              {actionError && !showEditor && (
                <p className="generation-action-error" role="alert">
                  {actionError}
                </p>
              )}
            </section>
          )}
          {original.style && (
            <details className="generation-original-style">
              <summary>
                创作设定
                <ChevronDown size={15} />
              </summary>
              <p>{original.style}</p>
            </details>
          )}
        </div>

        {showLyrics && (
          <section
            className="generation-original-lyrics"
            aria-label="当前版本歌词"
          >
            <div className="generation-section-heading">
              <h2>歌词</h2>
              <button onClick={() => setEditorOpen(true)}>
                <SlidersHorizontal size={15} />
                修改
              </button>
            </div>
            <div className="generation-original-lyrics-text">
              {original.lyrics}
            </div>
          </section>
        )}

        <form
          ref={editor}
          id="generation-editor"
          className="generation-editor"
          hidden={!showEditor}
          onSubmit={revise}
          aria-label="微调音乐"
        >
          <div className="generation-editor-heading">
            <SlidersHorizontal size={19} />
            <h2>微调</h2>
            <button
              type="button"
              aria-label="收起微调"
              onClick={() => setEditorOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="generation-editor-fields">
            <fieldset disabled={busy}>
              <label className="generation-field">
                作品名称
                <input
                  value={draft.title}
                  maxLength={sunoEnabled ? 80 : 160}
                  aria-label="作品名称"
                  onChange={(e) => edit({ title: e.target.value })}
                />
              </label>
              <div className="generation-kind">
                <span>音乐类型</span>
                <MusicKindToggle
                  value={draft.musicKind}
                  onChange={(musicKind) => edit({ musicKind })}
                  disabled={busy}
                />
              </div>
              <label className="generation-field">
                音乐风格
                <textarea
                  value={draft.style}
                  rows={4}
                  maxLength={sunoEnabled ? 1000 : 2000}
                  aria-label="音乐风格"
                  onChange={(e) => edit({ style: e.target.value })}
                  placeholder="调整情绪、节奏、乐器或人声…"
                />
              </label>
              <div className="generation-adjustments" aria-label="快捷微调">
                {["更轻快", "更舒缓", "更有氛围"].map((label) => (
                  <button
                    type="button"
                    key={label}
                    onClick={() =>
                      edit({
                        style:
                          `${draft.style.trim()}${draft.style.trim() ? "\n" : ""}${label}`.slice(
                            0,
                            sunoEnabled ? 1000 : 2000,
                          ),
                      })
                    }
                  >
                    ＋ {label}
                  </button>
                ))}
              </div>
              {draft.musicKind === "vocal" && (
                <label className="generation-field generation-lyrics">
                  歌词
                  <textarea
                    value={draft.lyrics}
                    rows={8}
                    maxLength={sunoEnabled ? 5000 : 10000}
                    aria-label="歌词"
                    onChange={(e) => edit({ lyrics: e.target.value })}
                    placeholder="留空则重新生成歌词"
                  />
                </label>
              )}
              {job.kind === "hum" && (
                <p className="generation-source-note">
                  <AudioLines size={15} />
                  沿用哼唱旋律
                </p>
              )}
              <SunoAdvancedSettings
                value={draft.suno || {}}
                onChange={(patch) =>
                  edit({ suno: { ...draft.suno, ...patch } })
                }
                enabled={sunoEnabled}
                disabled={busy}
                vocal={draft.musicKind === "vocal"}
                hasAudio={job.kind === "hum"}
              />
            </fieldset>
          </div>
          {actionError && (
            <p className="generation-action-error" role="alert">
              {actionError}
            </p>
          )}
          <button
            type="submit"
            className="generation-submit"
            disabled={active || busy || !draft.style.trim()}
          >
            {busy ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <RefreshCw size={18} />
            )}
            {revisionPhase === "writing"
              ? "正在准备新歌词…"
              : busy
                ? "正在提交新版本…"
                : active
                  ? "等待当前版本完成"
                  : job.status === "failed" || job.status === "cancelled"
                    ? "重新生成"
                    : "生成新版本"}
            <ArrowRight size={17} />
          </button>
        </form>
      </div>
      {sharing && (
        <ShareSongDialog job={job} onClose={() => setSharing(false)} />
      )}
    </div>
  );
}
