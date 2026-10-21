import { usePlayerOverlay } from "../state/playerOverlay";
import { UnstyledButton, SegmentedControl } from "@mantine/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Download,
  ListMusic,
  LoaderCircle,
  Play,
  RefreshCw,
} from "lucide-react";
import { api, songUrl, subscribe } from "../lib/api";
import type { Job } from "../lib/types";
import {
  duration,
  errorMessage,
  presetLabel,
  statusLabel,
  titleOf,
  when,
} from "../lib/utils";
import { useApp } from "../state/app";
import { usePlayer } from "../state/player";
import {
  Artwork,
  Badge,
  Button,
  EmptyState,
} from "../components/ui";
import "./Music.css";

const STAGES = [
  "load",
  "transcribe",
  "hum",
  "plan",
  "semantic",
  "synthesize",
  "decode",
  "save",
];
const STAGE_NAMES: Record<string, string> = {
  load: "准备模型",
  transcribe: "识别旋律",
  hum: "分析哼唱",
  plan: "编写乐谱",
  semantic: "生成音乐",
  synthesize: "合成音频",
  decode: "处理音频",
  save: "保存作品",
};
const WEIGHTS: Record<string, number> = {
  load: 0.04,
  transcribe: 0.06,
  hum: 0.03,
  plan: 0.18,
  semantic: 0.42,
  synthesize: 0.26,
  decode: 0.03,
  save: 0.01,
};
const TERMINAL = new Set(["done", "failed", "cancelled"]);

export function stagesFor(job: Job) {
  return STAGES.filter((stage) => {
    if (stage === "transcribe")
      return (
        job.kind === "cover" ||
        (job.kind === "hum" && job.params?.melody !== "ignore")
      );
    if (stage === "hum") return job.kind === "hum" && !!job.params?.adapter;
    return true;
  });
}

/** Only stage counters are measured. The weighted overall percentage and ETA are estimates. */
export function estimateProgress(event: any, elapsed: number, job: Job) {
  const stages = stagesFor(job),
    index = stages.indexOf(event?.stage);
  if (index < 0) return { fraction: 0, eta: null as number | null };
  const totalWeight = stages.reduce((sum, stage) => sum + WEIGHTS[stage], 0);
  const done = stages
    .slice(0, index)
    .reduce((sum, stage) => sum + WEIGHTS[stage], 0);
  const within = event.total
    ? Math.min(1, (event.completed || 0) / event.total)
    : event.status === "complete"
      ? 1
      : 0.3;
  const fraction = Math.min(
    0.99,
    (done + WEIGHTS[event.stage] * within) / totalWeight,
  );
  let eta: number | null =
    elapsed > 3 && fraction > 0.05
      ? (elapsed * (1 - fraction)) / fraction
      : null;
  if (event.tps && event.total && event.unit === "tokens") {
    const remaining = (event.total - (event.completed || 0)) / event.tps;
    const laterWeight = stages
      .slice(index + 1)
      .reduce((sum, stage) => sum + WEIGHTS[stage], 0);
    const perWeight =
      elapsed > 2 && fraction > 0.05
        ? elapsed / fraction / totalWeight
        : (event.seconds || 1) / Math.max(within, 0.05) / WEIGHTS[event.stage];
    eta = Math.max(0, remaining + laterWeight * perWeight);
  }
  return { fraction, eta };
}

function elapsedLabel(seconds: number) {
  if (!Number.isFinite(seconds)) return "—";
  seconds = Math.max(0, Math.round(seconds));
  return seconds >= 60
    ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
    : `${seconds} 秒`;
}

export function useMusicJobs(historyLimit = 20) {
  const [data, setData] = useState<{
    active: Job[];
    history: Job[];
    doneTotal: number;
    failedTotal: number;
  }>({ active: [], history: [], doneTotal: 0, failedTotal: 0 });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const live = useRef(false),
    inFlight = useRef(false),
    limitRef = useRef(historyLimit);
  limitRef.current = historyLimit;
  const reload = useCallback(async () => {
    if (inFlight.current || !live.current) return;
    inFlight.current = true;
    try {
      const [active, done, failed] = await Promise.all([
        api.jobs({ status: "queued,running", limit: 100 }),
        api.jobs({ status: "done", limit: limitRef.current }),
        api.jobs({ status: "failed,cancelled", limit: limitRef.current }),
      ]);
      if (!live.current) return;
      setData({
        active: active.jobs
          .slice()
          .sort((a: Job, b: Job) =>
            a.status === b.status
              ? (a.seq || 0) - (b.seq || 0)
              : a.status === "running"
                ? -1
                : 1,
          ),
        history: [...done.jobs, ...failed.jobs].sort((a: Job, b: Job) =>
          (b.finished_at || b.created_at).localeCompare(
            a.finished_at || a.created_at,
          ),
        ),
        doneTotal: done.total,
        failedTotal: failed.total,
      });
      setError("");
    } catch (err) {
      if (live.current) setError(errorMessage(err));
    } finally {
      inFlight.current = false;
      if (live.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    live.current = true;
    reload();
    const timer = window.setInterval(reload, 5000);
    return () => {
      live.current = false;
      clearInterval(timer);
    };
  }, [reload]);
  useEffect(() => {
    reload();
  }, [historyLimit, reload]);
  return { ...data, loading, error, reload };
}

export function MusicError({ error }: { error: any }) {
  if (!error) return null;
  const raw = typeof error === "string" ? error : JSON.stringify(error);
  const memory =
    /MemoryError|memory pressure|out of memory|failed to allocate|内存/i.test(
      raw,
    );
  return (
    <div className="music-error" role="status">
      <strong>
        {memory ? "可用内存不足，生成已停止" : "这次生成未能完成"}
      </strong>
      <p>
        {memory
          ? "关闭占内存较多的应用，等待内存压力降低后重试。原歌词和参数已保留。"
          : "可以使用原参数重新创作，详细原因见下方。"}
      </p>
      <details>
        <summary>技术详情</summary>
        <pre>{raw}</pre>
      </details>
    </div>
  );
}

function LiveScorePreview({ score }: { score: string }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null),
    latest = useRef(score);
  latest.current = score;
  useEffect(() => {
    if (!open) return;
    let live = true,
      timer: number | undefined,
      last = "";
    import("abcjs")
      .then((abcjs) => {
        if (!live) return;
        const draw = () => {
          if (!container.current || latest.current === last) return;
          try {
            abcjs.renderAbc(container.current, latest.current, {
              responsive: "resize",
              staffwidth: 600,
            });
            last = latest.current;
          } catch {
            /* Incomplete streamed notation will be redrawn at the next update. */
          }
        };
        draw();
        timer = window.setInterval(draw, 700);
      })
      .catch(() => {});
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [open]);
  return (
    <details
      className="music-live-score"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>查看乐谱</summary>
      {open && (
        <>
          <div
            ref={container}
            className="music-notation"
            aria-label="正在编写的乐谱预览"
          />
          <details>
            <summary>ABC 源文本</summary>
            <pre className="music-score">{score}</pre>
          </details>
        </>
      )}
    </details>
  );
}

export function LiveJobCard({
  job,
  compact = false,
  onFinish,
}: {
  job: Job;
  compact?: boolean;
  onFinish?: (job: Job) => void;
}) {
  const { toast, refresh } = useApp();
  const [current, setCurrent] = useState(job),
    [event, setEvent] = useState<any>(
      job.progress?.stage ? job.progress : null,
    );
  const [startedAt, setStartedAt] = useState<number | null>(
    job.started_at ? Date.parse(job.started_at) : null,
  );
  const [now, setNow] = useState(Date.now()),
    [cancelling, setCancelling] = useState(false),
    [score, setScore] = useState("");
  const callbacks = useRef({ onFinish, toast, refresh });
  callbacks.current = { onFinish, toast, refresh };
  const ended = useRef(false);
  const finish = useCallback((finished: Job) => {
    if (ended.current) return;
    ended.current = true;
    setCurrent(finished);
    if (finished.status === "done")
      callbacks.current.toast(`已完成：${titleOf(finished)}`, "ok");
    else if (finished.status === "failed")
      callbacks.current.toast(`生成失败：${titleOf(finished)}`, "err");
    else callbacks.current.toast("任务已取消");
    callbacks.current.onFinish?.(finished);
    callbacks.current.refresh();
  }, []);
  useEffect(() => {
    setCurrent(job);
    if (job.started_at) setStartedAt(Date.parse(job.started_at));
    if (job.progress?.stage) setEvent(job.progress);
    if (TERMINAL.has(job.status)) finish(job);
  }, [job, finish]);
  useEffect(() => {
    ended.current = false;
    const stop = subscribe(job.id, {
      onProgress: (next: any) => {
        if (next.type === "status" && next.status === "running") {
          setCurrent((value: Job) => ({ ...value, status: "running" }));
          setStartedAt((value) => value || Date.now());
        }
        if (next.type === "stage") setEvent(next);
        else if (next.type === "token")
          setEvent((previous: any) => ({
            ...(previous || {}),
            tps: next.tps ?? previous?.tps,
            completed: next.tokens ?? previous?.completed,
          }));
        if (next.type === "abc" && typeof next.text === "string")
          setScore(next.text);
      },
      onDone: finish,
      onError: () => {
        /* The jobs poll remains the fallback if SSE is interrupted. */
      },
    });
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop();
      clearInterval(tick);
    };
  }, [job.id, finish]);
  const running = current.status === "running" || !!event?.stage;
  const elapsed = startedAt ? Math.max(0, (now - startedAt) / 1000) : 0;
  const estimated = estimateProgress(event, elapsed, current);
  const known = !!event?.total,
    percent = Math.round(estimated.fraction * 100);
  const stages = stagesFor(current),
    stageIndex = stages.indexOf(event?.stage);
  async function cancel() {
    setCancelling(true);
    try {
      const result = await api.cancel(current.id);
      if (result.status === 202)
        callbacks.current.toast("已提交取消请求，将在当前步骤结束后停止。");
      else finish(result.data.job);
    } catch (err: any) {
      setCancelling(false);
      if (err.status === 409) {
        callbacks.current.onFinish?.(current);
        callbacks.current.refresh();
      } else toast(errorMessage(err), "err");
    }
  }
  if (TERMINAL.has(current.status)) return <JobResultRow job={current} />;
  return (
    <section
      className={`music-live card ${compact ? "music-live-compact" : ""} ${running ? "" : "music-waiting"}`}
      aria-label={`生成任务：${titleOf(current)}`}
    >
      <div className="music-live-head">
        <div className="music-job-identity">
          <span className="music-status-dot" />
          <strong>{titleOf(current)}</strong>
        </div>
        <Badge tone={running ? "warning" : "neutral"}>
          {cancelling ? "正在取消" : running ? "生成中" : "等待中"}
        </Badge>
        <Button variant="ghost" disabled={cancelling} onClick={cancel}>
          {cancelling ? "正在取消…" : running ? "取消生成" : "移出队列"}
        </Button>
      </div>
      {!running ? (
        <p className="muted small">
          {Number.isInteger(current.position)
            ? `排队第 ${current.position + 1} 位`
            : "按提交顺序生成"}
        </p>
      ) : (
        <>
          <div className="music-phase-row">
            <div>
              <h3>
                {STAGE_NAMES[event?.stage]
                  ? `正在${STAGE_NAMES[event.stage]}`
                  : "正在准备生成"}
              </h3>
              <p className="muted small">
                {known
                  ? `${event.completed ?? 0} / ${event.total} ${{ steps: "步", chunks: "段", tokens: "标记", files: "个文件" }[event.unit] || event.unit || ""}`
                  : "当前阶段持续更新"}
              </p>
            </div>
            <div className="music-percentage">
              <b>{known ? `${percent}%` : "处理中"}</b>
              <span>整体进度 · 估算</span>
            </div>
          </div>
          <div
            className={`music-progress ${known ? "" : "music-progress-indeterminate"}`}
            role="progressbar"
            aria-label="整体生成进度，估算值"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={known ? percent : undefined}
          >
            <span style={{ width: known ? `${percent}%` : undefined }} />
          </div>
          <div className="music-progress-meta">
            <span>
              <Clock3 size={13} />
              已用 {elapsedLabel(elapsed)}
            </span>
            <span>
              预计剩余{" "}
              {known && estimated.eta !== null
                ? `约 ${elapsedLabel(estimated.eta)}`
                : "正在估算"}
            </span>
          </div>
          {cancelling && (
            <p className="music-cancel-note">
              正在等待当前步骤结束，停止后将更新任务状态。
            </p>
          )}
          <details className="music-progress-details">
            <summary>
              进度详情
              <ChevronDown size={14} />
            </summary>
            <ol className="music-stage-list">
              {stages.map((stage, index) => (
                <li
                  key={stage}
                  className={
                    index < stageIndex ||
                    (index === stageIndex && event?.status === "complete")
                      ? "is-done"
                      : index === stageIndex
                        ? "is-active"
                        : ""
                  }
                >
                  <span>
                    {index < stageIndex ? <Check size={12} /> : index + 1}
                  </span>
                  {STAGE_NAMES[stage]}
                </li>
              ))}
            </ol>
            <p className="muted small">
              {presetLabel(current.preset)} · {current.precision} ·{" "}
              {current.ode_steps} 步 · 种子 {current.seed}
            </p>
            {score && <LiveScorePreview score={score} />}
          </details>
          <p className="music-live-note">
            切换页面不影响生成，完成后自动保存。
          </p>
        </>
      )}
    </section>
  );
}

export function JobResultRow({
  job,
  compact = false,
}: {
  job: Job;
  compact?: boolean;
}) {
  const { play, current, playing, toggle } = usePlayer();
  const done = job.status === "done",
    playable = done && !!job.artifacts?.audio;
  return (
    <article
      className={`music-result ${compact ? "music-result-compact" : ""}`}
    >
      <div className="music-result-main">
        <UnstyledButton
          className="music-result-cover"
          aria-label={`全屏播放 ${titleOf(job)}`}
          onClick={() => usePlayerOverlay.getState().open(job.id)}
        >
          <Artwork
            job={job}
            size={compact ? 48 : 44}
            className="music-result-art"
          />
        </UnstyledButton>
        <div className="music-result-copy">
          <UnstyledButton
            className="music-result-title"
            onClick={() => usePlayerOverlay.getState().open(job.id)}
          >
            {titleOf(job)}
          </UnstyledButton>
          <p>
            {done
              ? `${duration(job.timing?.audio_seconds)} · ${when(job.finished_at || job.created_at)}`
              : `${statusLabel(job.status)} · ${when(job.finished_at || job.created_at)}`}
          </p>
        </div>
        <Badge
          tone={
            done ? "success" : job.status === "failed" ? "error" : "neutral"
          }
        >
          {statusLabel(job.status)}
        </Badge>
        <div className="music-result-actions">
          {playable ? (
            <Button
              variant="ghost"
              aria-label={`试听${titleOf(job)}`}
              onClick={() => (current?.id === job.id ? toggle() : play([job]))}
            >
              <Play size={14} fill="currentColor" />
              {current?.id === job.id && playing ? "暂停" : "试听"}
            </Button>
          ) : (
            <Link className="btn ghost" to={`/create?from=${job.id}`}>
              重新创作
            </Link>
          )}
          <UnstyledButton
            className="music-text-link"
            onClick={() => usePlayerOverlay.getState().open(job.id)}
          >
            {done ? "全屏" : "详情"}
            <ArrowRight size={13} />
          </UnstyledButton>
          {playable && !compact && (
            <a
              className="music-download"
              href={songUrl(job.id, "audio.mp3")}
              download
              aria-label={`下载${titleOf(job)}的 MP3`}
              title="下载 MP3"
            >
              <Download size={15} />
            </a>
          )}
        </div>
      </div>
      {job.error && <MusicError error={job.error} />}
    </article>
  );
}

export function QueuePage() {
  const [historyLimit, setHistoryLimit] = useState(20),
    [filter, setFilter] = useState("all");
  const jobs = useMusicJobs(historyLimit);
  const running = jobs.active.filter((job) => job.status === "running"),
    waiting = jobs.active.filter((job) => job.status === "queued");
  const history = jobs.history.filter(
    (job) =>
      filter === "all" ||
      (filter === "done" ? job.status === "done" : job.status !== "done"),
  );
  return (
    <div className="queue-page music-page">
      <div className="queue-summary">
        <span>
          <i className="music-status-dot" />
          <strong>{running.length}</strong> 正在生成
        </span>
        <span>
          <Clock3 size={14} />
          <strong>{waiting.length}</strong> 排队等待
        </span>
        <span>
          <Check size={14} />
          <strong>{jobs.doneTotal}</strong> 已完成
        </span>
        <Button
          variant="ghost"
          className="queue-refresh"
          onClick={jobs.reload}
        >
          <RefreshCw size={14} />
          刷新
        </Button>
      </div>
      {jobs.error && (
        <div className="music-fetch-error" role="alert">
          {jobs.error}
          <Button variant="ghost" onClick={jobs.reload}>
            重试
          </Button>
        </div>
      )}
      {jobs.loading ? (
        <div className="music-loading">
          <LoaderCircle size={18} className="music-spin" />
          正在读取任务…
        </div>
      ) : (
        <>
          <div className="queue-active">
            {running.map((job) => (
              <LiveJobCard key={job.id} job={job} onFinish={jobs.reload} />
            ))}
          </div>
          {!!waiting.length && (
            <section className="card queue-waiting-section">
              <div className="music-section-head">
                <h2>排队等待</h2>
                <span className="muted small">按提交顺序生成</span>
              </div>
              {waiting.map((job) => (
                <LiveJobCard
                  key={job.id}
                  job={job}
                  compact
                  onFinish={jobs.reload}
                />
              ))}
            </section>
          )}
          {!jobs.active.length && (
            <EmptyState
              title="当前没有生成任务"
              description="新任务会显示在这里，作品完成后自动保存。"
            >
              <Link className="btn primary" to="/create">
                <ListMusic size={14} />
                开始创作
              </Link>
            </EmptyState>
          )}
        </>
      )}
      <section className="card queue-history-section">
        <div className="music-section-head">
          <h2>
            历史任务{" "}
            <span className="music-count">
              {jobs.doneTotal + jobs.failedTotal}
            </span>
          </h2>
          <SegmentedControl
            size="xs"
            aria-label="筛选历史任务"
            value={filter}
            onChange={(value) => setFilter(String(value))}
            data={[
              { value: "all", label: "全部" },
              { value: "done", label: "已完成" },
              { value: "failed", label: "未完成" },
            ]}
          />
        </div>
        {history.length ? (
          history.map((job) => <JobResultRow key={job.id} job={job} />)
        ) : (
          <p className="music-empty-inline">没有符合条件的历史记录。</p>
        )}
        {(jobs.doneTotal > historyLimit || jobs.failedTotal > historyLimit) && (
          <Button
            variant="ghost"
            onClick={() => setHistoryLimit((limit) => limit + 20)}
          >
            加载更早的任务
            <ChevronDown size={14} />
          </Button>
        )}
      </section>
    </div>
  );
}
