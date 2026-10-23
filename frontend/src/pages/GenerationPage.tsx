import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
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
      return saved;
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
  const [now, setNow] = useState(Date.now());
  const [reload, setReload] = useState(0);
  const watch = useRef<ReturnType<typeof watchGeneration> | null>(null);
  const request = useRef<AbortController | null>(null);
  const editor = useRef<HTMLFormElement | null>(null);
  const page = useRef<HTMLDivElement | null>(null);
  const player = usePlayer();
  const mp3 = Boolean(useApp((s) => s.status?.ffmpeg));

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

  return (
    <div className="generation-page" ref={page}>
      <header className="generation-heading">
        <Link className="generation-back" to="/library">
          <ArrowLeft size={17} />
          我的音乐
        </Link>
        <div className="generation-heading-main">
          <div>
            <span className="generation-eyebrow">第 {versionNumber} 版</span>
            <h1>{titleOf(job)}</h1>
          </div>
          <span className={`generation-status is-${job.status}`}>
            {active && <span />}
            {statusText(job)}
          </span>
        </div>
      </header>
      {loadError && (
        <div className="generation-notice" role="alert">
          连接暂时中断，正在重新获取进度。
          <button onClick={() => void watch.current?.refresh()}>刷新</button>
        </div>
      )}
      <div className="generation-layout">
        <div className="generation-main">
          <section
            className={`generation-result ${playable ? "is-ready" : ""}`}
            aria-label={playable ? "生成结果" : "生成状态"}
          >
            <div className="generation-result-art">
              <Artwork job={job} size={128} />
              {active && (
                <span className="generation-art-orbit" aria-hidden="true" />
              )}
            </div>
            <div className="generation-result-copy">
              <h2 role="status">{progress.title}</h2>
              {job.status === "failed" && <p>{progress.description}</p>}
              {active && (
                <div className="generation-live-meta">
                  <Clock3 size={14} />
                  {job.status === "queued"
                    ? job.position
                      ? `前面还有 ${job.position} 个任务`
                      : "等待开始"
                    : time
                      ? `已进行 ${time}`
                      : "准备开始"}
                </div>
              )}
              {playable && (
                <div className="generation-audio-meta">
                  <AudioLines size={15} />
                  {draftFromJob(job).musicKind === "instrumental"
                    ? "纯音乐"
                    : "带歌词"}
                  <span>·</span>
                  {duration(audioDuration)}
                </div>
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
                  <a href={download.url} download={download.name}>
                    <Download size={17} />
                    下载
                  </a>
                  <button onClick={() => setSharing(true)}>
                    <Share2 size={17} />
                    分享
                  </button>
                  <button
                    onClick={() => {
                      const desktop = window.matchMedia(
                        "(min-width: 1024px)",
                      ).matches;
                      editor.current?.scrollIntoView({
                        behavior: "smooth",
                        block: desktop ? "nearest" : "start",
                      });
                      if (desktop)
                        editor.current
                          ?.querySelector("textarea")
                          ?.focus({ preventScroll: true });
                    }}
                  >
                    <SlidersHorizontal size={17} />
                    微调
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="generation-process" aria-label="生成流程">
            <div className="generation-section-heading">
              <h2>生成流程</h2>
              {time && (
                <span>
                  {active ? "已用时" : "用时"} {time}
                </span>
              )}
            </div>
            <ol className="generation-steps">
              {progress.steps.map((step, index) => (
                <li
                  key={step.id}
                  className={`is-${step.state}`}
                  aria-current={step.state === "current" ? "step" : undefined}
                >
                  <span className="generation-step-icon">
                    {step.state === "complete" ? (
                      <Check size={15} />
                    ) : step.state === "current" ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : step.state === "failed" ||
                      step.state === "cancelled" ? (
                      <X size={15} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <div>
                    <strong>{step.label}</strong>
                    {step.state === "current" && progress.stageDetail && (
                      <span>{progress.stageDetail}</span>
                    )}
                    {step.state === "current" &&
                      step.id === "write" &&
                      !progress.stageDetail && (
                        <span className="generation-writing-hint">
                          AI 正在构思歌名、曲风与歌词，约需 20 秒…
                        </span>
                      )}
                    {step.state === "failed" && <span>生成失败</span>}
                  </div>
                </li>
              ))}
            </ol>
            {active && progress.stagePercent !== undefined && (
              <div className="generation-stage-progress">
                <div>
                  <span>当前步骤</span>
                  <strong>{progress.stagePercent}%</strong>
                </div>
                <progress
                  max={100}
                  value={progress.stagePercent}
                  aria-label="当前步骤进度"
                />
              </div>
            )}
            {active && (
              <div className="generation-process-footer">
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
          </section>

          {original.musicKind === "vocal" && original.lyrics.trim() && (
            <section
              className="generation-original-lyrics"
              aria-label="当前版本歌词"
            >
              <div className="generation-section-heading">
                <h2>歌词</h2>
              </div>
              <div className="generation-original-lyrics-text">
                {original.lyrics}
              </div>
            </section>
          )}

          <section className="generation-versions" aria-label="版本记录">
            <div className="generation-section-heading">
              <h2>版本记录</h2>
              <span>{history.length} 个版本</span>
            </div>
            {versionError && (
              <p className="generation-version-error">
                {versionError}
                <button onClick={() => setReload((n) => n + 1)}>重试</button>
              </p>
            )}
            <div className="generation-version-list">
              {history.map((version, index) => (
                <Link
                  key={version.id}
                  to={`/generation/${encodeURIComponent(version.id)}`}
                  className={version.id === id ? "is-selected" : ""}
                  aria-current={version.id === id ? "page" : undefined}
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
                    <span className="generation-version-current">当前</span>
                  ) : (
                    <ArrowRight size={15} />
                  )}
                </Link>
              ))}
            </div>
          </section>
        </div>

        <form
          ref={editor}
          className="generation-editor"
          onSubmit={revise}
          aria-label="微调音乐"
        >
          <div className="generation-editor-heading">
            <span>
              <SlidersHorizontal size={18} />
            </span>
            <h2>微调</h2>
          </div>
          <div className="generation-editor-fields">
            <fieldset disabled={busy}>
              <label className="generation-field">
                作品名称
                <input
                  value={draft.title}
                  maxLength={160}
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
                音乐描述
                <textarea
                  value={draft.style}
                  rows={5}
                  maxLength={2000}
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
                            2000,
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
                    maxLength={10000}
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
