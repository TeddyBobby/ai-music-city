import { useEffect, useRef, useState } from "react";
import {
  Accordion,
  Loader,
  NumberInput,
  Progress,
  Slider,
  Textarea,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowUpRight,
  ArrowUp,
  Check,
  Feather,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import type { Job } from "../lib/types";
import { ApiError } from "../lib/api";
import { errorMessage, readStore, removeStore, writeStore } from "../lib/utils";
import {
  notifyReviewUpdated,
  reviewsApi,
  type AiReviewResult,
  type SongReview,
} from "../lib/reviews";
import { Button } from "./ui";
import "./SongReviews.css";

const BASIS_NOTE = "基于音频指标、乐谱与创作信息，未直接听音。";
type ReviewDraft = { score: number | null; comment: string };
const draftKey = (jobId: string) => `review.draft.${jobId}`;

function readDraft(jobId: string): ReviewDraft | null {
  const cached = readStore<unknown>(draftKey(jobId), null);
  if (!cached || typeof cached !== "object") return null;
  const { score, comment } = cached as ReviewDraft;
  if (
    typeof comment !== "string" ||
    comment.length > 4000 ||
    (score !== null &&
      (typeof score !== "number" ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > 10))
  )
    return null;
  return { score, comment };
}

function AudioEvidence({ evidence }: { evidence: Record<string, unknown> }) {
  const audio = evidence.audio;
  if (!audio || typeof audio !== "object") return null;
  const metrics = audio as Record<string, unknown>;
  const finite = (key: string): number | null =>
    typeof metrics[key] === "number" && Number.isFinite(metrics[key])
      ? (metrics[key] as number)
      : null;
  const duration = finite("duration_seconds"),
    analysed = finite("analysed_seconds"),
    rms = finite("rms_dbfs"),
    peak = finite("peak_dbfs"),
    clipped = finite("clipped_sample_ratio");
  const entries = [
    ["音频时长", duration === null ? null : `${duration.toFixed(1)} 秒`],
    ["平均电平", rms === null ? null : `${rms.toFixed(1)} dBFS`],
    ["峰值电平", peak === null ? null : `${peak.toFixed(1)} dBFS`],
    [
      "削波样本占比",
      clipped === null
        ? null
        : `${(clipped * 100).toLocaleString("zh-CN", { maximumFractionDigits: 4 })}%`,
    ],
  ].filter((entry) => entry[1] !== null);
  if (!entries.length) return null;
  return (
    <div className="song-review-audio-evidence">
      <span>音频测量</span>
      <dl>
        {entries.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p>
        {metrics.sampled === true
          ? `长音频抽样分析${analysed === null ? "" : `，共测量 ${analysed.toFixed(1)} 秒`}，不代表完整音频。`
          : "以上为音频信号测量，不代表直接听音评价。"}
      </p>
    </div>
  );
}

function reviewDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}

function ScoreBadge({
  value,
  kind,
  onClick,
}: {
  value: number | null;
  kind: "ai" | "manual";
  onClick?: () => void;
}) {
  const label = kind === "ai" ? "AI 参考分" : "我的评分";
  const score = value === null ? "—" : value === 10 ? "10" : value.toFixed(1);
  const content = (
    <>
      {kind === "ai" && (
        <svg
          className="song-score-crown"
          viewBox="0 0 48 26"
          aria-hidden="true"
        >
          <path
            d="M16 9 24 1 32 9H27V25H21V9ZM2 25 10 17 18 25ZM30 25 38 17 46 25Z"
            fill="currentColor"
          />
        </svg>
      )}
      <span className="song-score-ring">
        <strong>{score}</strong>
      </span>
      <span className="song-score-caption">
        <ArrowUp size={15} strokeWidth={1.7} aria-hidden />
        {label}
      </span>
    </>
  );
  const className = `song-score-badge song-score-${kind}${value === null ? " is-empty" : ""}`;
  const accessibleLabel = `${label}${value === null ? "，尚未评分" : ` ${score}，满分 10 分`}${onClick ? "，点击编辑" : ""}`;
  return onClick ? (
    <UnstyledButton
      className={className}
      onClick={onClick}
      aria-label={accessibleLabel}
      title="点击填写或修改我的评分"
    >
      {content}
    </UnstyledButton>
  ) : (
    <div className={className} aria-label={accessibleLabel}>
      {content}
    </div>
  );
}

function ReviewArticle({ result }: { result: AiReviewResult }) {
  return (
    <>
      <div className="song-review-deck">
        <span className="song-review-kicker">AI 乐评</span>
        <h3>{result.headline}</h3>
        <p>{result.summary}</p>
      </div>
      <p className="song-review-basis">{BASIS_NOTE}</p>
      <div className="song-review-byline">
        <span title={result.model}>{result.model}</span>
        <time dateTime={result.created_at}>
          {reviewDate(result.created_at)}
        </time>
      </div>
      {result.body && (
        <div className="song-review-prose">
          {result.body
            .split(/\n+/)
            .filter(Boolean)
            .map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
        </div>
      )}
      {(result.strengths.length > 0 || result.suggestions.length > 0) && (
        <div className="song-review-notes">
          {result.strengths.length > 0 && (
            <section>
              <h4>
                <Check size={13} aria-hidden />
                值得保留
              </h4>
              <ul>
                {result.strengths.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          )}
          {result.suggestions.length > 0 && (
            <section>
              <h4>
                <ArrowUpRight size={13} aria-hidden />
                下次可以试试
              </h4>
              <ul>
                {result.suggestions.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {(result.dimensions.length > 0 ||
        result.basis.length > 0 ||
        result.evidence.audio) && (
        <Accordion variant="default" className="song-review-details">
          <Accordion.Item value="basis">
            <Accordion.Control>查看评分维度与依据</Accordion.Control>
            <Accordion.Panel>
              <div className="song-review-dimensions">
                {result.dimensions.map((dimension, index) => (
                  <div key={index}>
                    <div className="song-review-dimension-title">
                      <span>{dimension.name}</span>
                      <strong>{dimension.score.toFixed(1)}</strong>
                    </div>
                    <Progress
                      value={dimension.score * 10}
                      size={3}
                      aria-label={`${dimension.name} ${dimension.score.toFixed(1)} 分`}
                    />
                    <p>{dimension.reason}</p>
                  </div>
                ))}
              </div>
              <AudioEvidence evidence={result.evidence} />
              {result.basis.length > 0 && (
                <div className="song-review-sources">
                  <span>本次参考</span>
                  <ul>
                    {result.basis.map((basis, index) => (
                      <li key={index}>{basis}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
    </>
  );
}

export function SongReviews({ job }: { job: Job }) {
  return <SongReviewsContent key={job.id} job={job} />;
}

function SongReviewsContent({ job }: { job: Job }) {
  const [review, setReview] = useState<SongReview | null>(null);
  const [score, setScore] = useState<number | string>("");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [aiError, setAiError] = useState("");
  const [manualError, setManualError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const mounted = useRef(false);
  const manualSection = useRef<HTMLElement>(null);
  const eligible = job.status === "done" && Boolean(job.artifacts.audio);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!eligible) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    reviewsApi
      .get(job.id)
      .then((data) => {
        if (cancelled) return;
        const cached = readDraft(job.id);
        setReview(data);
        setScore(cached ? (cached.score ?? "") : (data.manual?.score ?? ""));
        setComment(cached ? cached.comment : (data.manual?.comment ?? ""));
        setDraftRestored(Boolean(cached));
        setDraftHydrated(true);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [job.id, eligible, loadAttempt]);

  useEffect(() => {
    if (review?.ai.status !== "running") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let delay = 1800;
      try {
        const data = await reviewsApi.get(job.id);
        if (cancelled) return;
        setAiError("");
        // Poll only the AI result: a concurrent save must never reset the draft.
        setReview((previous) =>
          previous ? { ...previous, ai: data.ai } : data,
        );
        if (data.ai.status !== "running") {
          notifyReviewUpdated(job.id);
          return;
        }
      } catch (error) {
        if (cancelled) return;
        setAiError(`${errorMessage(error)} 正在尝试重新连接。`);
        delay = 5000;
      }
      if (!cancelled) timer = setTimeout(poll, delay);
    }
    timer = setTimeout(poll, 1800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [job.id, review?.ai.status]);

  async function generate() {
    if (starting || review?.ai.status === "running") return;
    setStarting(true);
    setAiError("");
    try {
      let data: SongReview;
      try {
        data = await reviewsApi.generate(job.id);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        const existing = await reviewsApi.get(job.id);
        if (existing.ai.status !== "running") throw error;
        data = existing;
      }
      notifyReviewUpdated(job.id);
      if (!mounted.current) return;
      setReview((previous) => (previous ? { ...previous, ai: data.ai } : data));
    } catch (error) {
      if (mounted.current) setAiError(errorMessage(error));
    } finally {
      if (mounted.current) setStarting(false);
    }
  }

  const numericScore = score === "" ? null : Number(score);
  const invalidScore =
    numericScore !== null &&
    (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 10);
  const draft = { score: numericScore, comment: comment.trim() };
  const dirty =
    review !== null &&
    (draft.score !== (review.manual?.score ?? null) ||
      draft.comment !== (review.manual?.comment ?? ""));
  const emptyDraft = numericScore === null && !draft.comment;

  useEffect(() => {
    if (!draftHydrated || !review || invalidScore) return;
    if (dirty) {
      // Only unsaved edits are cached; saved reviews remain authoritative on the server.
      writeStore(draftKey(job.id), { score: numericScore, comment });
    } else removeStore(draftKey(job.id));
  }, [
    job.id,
    numericScore,
    comment,
    dirty,
    invalidScore,
    draftHydrated,
    review?.manual,
  ]);

  function editScore(value: number | string) {
    setScore(value);
    setNotice("");
    setManualError("");
    setDraftRestored(false);
  }

  async function saveManual(remove = false) {
    if (saving || (!remove && (invalidScore || emptyDraft))) return;
    setSaving(true);
    setManualError("");
    setNotice("");
    try {
      const data = remove
        ? await reviewsApi.deleteManual(job.id)
        : await reviewsApi.saveManual(job.id, draft);
      const cached = readDraft(job.id);
      // An earlier request must not erase a newer draft opened for this song.
      if (cached?.score === numericScore && cached?.comment === comment) {
        removeStore(draftKey(job.id));
      }
      notifyReviewUpdated(job.id);
      if (!mounted.current) return;
      setReview((previous) =>
        previous ? { ...previous, manual: data.manual } : data,
      );
      setScore(data.manual?.score ?? "");
      setComment(data.manual?.comment ?? "");
      setNotice(remove ? "已清除我的评分与评论" : "评分与评论已保存");
      setDraftRestored(false);
    } catch (error) {
      if (mounted.current) setManualError(errorMessage(error));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  if (!eligible) {
    return (
      <div className="song-reviews song-review-unavailable">
        <Feather size={22} aria-hidden />
        <p>音乐生成完成后，就可以评分和写乐评。</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="song-reviews song-review-loading" role="status">
        <Loader size={16} />
        <span>正在读取乐评…</span>
      </div>
    );
  }
  if (loadError || !review) {
    return (
      <div className="song-reviews song-review-load-error">
        <p role="alert">{loadError || "乐评暂时无法读取。"}</p>
        <Button onClick={() => setLoadAttempt((value) => value + 1)}>
          <RefreshCw size={13} />
          重新加载
        </Button>
      </div>
    );
  }

  const result = review.ai.result;
  const running = starting || review.ai.status === "running";
  return (
    <div className="song-reviews">
      <div className="song-review-scores" aria-label="十分制评分">
        <ScoreBadge kind="ai" value={result?.score ?? null} />
        <ScoreBadge
          kind="manual"
          value={review.manual?.score ?? null}
          onClick={() => {
            manualSection.current?.scrollIntoView({
              block: "start",
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? "instant"
                : "smooth",
            });
            manualSection.current
              ?.querySelector<HTMLInputElement>("input")
              ?.focus({ preventScroll: true });
          }}
        />
      </div>
      <section className="song-review-editorial" aria-label="AI 乐评">
        {result ? (
          <ReviewArticle result={result} />
        ) : (
          <>
            <div className="song-review-deck">
              <span className="song-review-kicker">AI 乐评</span>
              <h3>这首作品还没有 AI 乐评</h3>
              <p>获得参考评分、作品简评和可改进的方向。</p>
            </div>
            <p className="song-review-basis">{BASIS_NOTE}</p>
          </>
        )}
        {(aiError || (!running && review.ai.status === "failed")) && (
          <p role="alert" className="song-review-error">
            {aiError || review.ai.error || "AI 乐评生成失败，请重试。"}
          </p>
        )}
        <div className="song-review-ai-action">
          <Button
            variant={result ? "ghost" : "primary"}
            onClick={generate}
            disabled={running}
          >
            {running ? (
              <Loader size={13} color="currentColor" />
            ) : result ? (
              <RotateCcw size={13} />
            ) : (
              <Feather size={13} />
            )}
            {running
              ? "正在撰写乐评…"
              : review.ai.status === "failed"
                ? "重新尝试"
                : result
                  ? "重新生成"
                  : "生成 AI 乐评"}
          </Button>
          <span role="status">
            {running
              ? result
                ? "完成后更新当前乐评，可先离开此页"
                : "正在分析作品信息，可先离开此页"
              : "独立参考，不影响你的评分"}
          </span>
        </div>
      </section>

      <section
        ref={manualSection}
        className="song-review-manual"
        aria-labelledby={`manual-review-${job.id}`}
      >
        <div className="song-review-manual-heading">
          <h3 id={`manual-review-${job.id}`}>我的评分</h3>
          <span>
            {review.manual
              ? `更新于 ${reviewDate(review.manual.updated_at)}`
              : "按自己的喜好打分"}
          </span>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveManual();
          }}
        >
          <div className="song-review-rating-control">
            <NumberInput
              className="song-review-score-input"
              value={score}
              onChange={editScore}
              min={0}
              max={10}
              step={0.1}
              decimalScale={1}
              fixedDecimalScale
              clampBehavior="strict"
              allowNegative={false}
              placeholder="—"
              aria-label="我的评分，0 到 10 分，支持一位小数"
              suffix=" / 10"
              disabled={saving}
            />
            <div className="song-review-slider-wrap">
              <Slider
                min={0}
                max={10}
                step={0.1}
                value={
                  Number.isFinite(numericScore) && numericScore !== null
                    ? numericScore
                    : 0
                }
                onChange={editScore}
                label={(value) => value.toFixed(1)}
                thumbLabel="调整我的评分，满分 10 分"
                disabled={saving}
                marks={[
                  { value: 0, label: "0" },
                  { value: 5, label: "5" },
                  { value: 10, label: "10" },
                ]}
                className={numericScore === null ? "is-unrated" : ""}
              />
            </div>
          </div>
          <div className="song-review-rating-caption">
            <span>
              {numericScore === null
                ? "尚未评分，也可以只写评论"
                : "支持 0.1 分精度，分数仅代表你的个人感受"}
            </span>
            {numericScore !== null && (
              <Button
                variant="ghost"
                type="button"
                onClick={() => editScore("")}
                disabled={saving}
              >
                取消评分
              </Button>
            )}
          </div>
          <Textarea
            className="song-review-comment"
            label="我的评论"
            placeholder="最喜欢哪一段？还有哪些地方值得再打磨？"
            value={comment}
            onChange={(event) => {
              setComment(event.currentTarget.value);
              setNotice("");
              setManualError("");
              setDraftRestored(false);
            }}
            maxLength={4000}
            autosize
            minRows={3}
            maxRows={8}
            disabled={saving}
          />
          <div className="song-review-comment-meta">
            <span>仅保存在本机</span>
            <span>{comment.length} / 4000</span>
          </div>
          {manualError && (
            <p className="song-review-error" role="alert">
              {manualError}
            </p>
          )}
          <div className="song-review-form-footer">
            <span className="song-review-saved" role="status">
              {notice ? (
                <>
                  <Check size={13} />
                  {notice}
                </>
              ) : dirty ? (
                draftRestored ? (
                  "已恢复未保存的修改"
                ) : (
                  "有未保存的修改"
                )
              ) : (
                ""
              )}
            </span>
            <div className="song-review-form-actions">
              {review.manual && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => saveManual(true)}
                  disabled={saving}
                >
                  清除评价
                </Button>
              )}
              <Button
                variant="primary"
                type="submit"
                disabled={saving || !dirty || emptyDraft || invalidScore}
              >
                {saving && <Loader size={12} color="currentColor" />}
                {saving ? "保存中…" : review.manual ? "保存修改" : "保存评价"}
              </Button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
