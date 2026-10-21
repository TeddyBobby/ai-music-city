import { usePlayerOverlay } from "../state/playerOverlay";
import { UnstyledButton } from "@mantine/core";
import { Input, Select } from "../components/ui";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Search,
  Plus,
  LayoutGrid,
  List,
  Play,
  Pause,
  Check,
  ArrowUpRight,
  FolderPlus,
  Trash2,
  Download,
  RefreshCw,
  MessageSquareText,
  Send,
} from "lucide-react";
import { useReviewSummaries } from "../hooks/useReviewSummaries";
import { api, songUrl } from "../lib/api";
import type { Job } from "../lib/types";
import {
  titleOf,
  duration,
  when,
  errorMessage,
  presetLabel,
} from "../lib/utils";
import { useApp } from "../state/app";
import { usePlayer } from "../state/player";
import {
  Artwork,
  Button,
  IconButton,
  EmptyState,
  Dialog,
  Badge,
} from "../components/ui";
import { ProjectPicker } from "../components/ProjectPicker";
import { UploadsPanel } from "../components/UploadsPanel";
import { PublishDialog } from "../components/PublishDialog";
import "./Library.css";
export function LibraryPage() {
  const [params] = useSearchParams(),
    navigate = useNavigate(),
    toast = useApp((s) => s.toast),
    p = usePlayer();
  const [jobs, setJobs] = useState<Job[]>([]),
    [failed, setFailed] = useState<Job[]>([]),
    [total, setTotal] = useState(0),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState(""),
    [preset, setPreset] = useState(""),
    [layout, setLayout] = useState("grid"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [selecting, setSelecting] = useState(!!params.get("attach")),
    [attach, setAttach] = useState(false),
    [moveConfirm, setMoveConfirm] = useState(false),
    [target, setTarget] = useState<any>(null),
    [remove, setRemove] = useState<Job | null>(null),
    [batchRemove, setBatchRemove] = useState(false);
  const [publishJob, setPublishJob] = useState<Job | "choose" | null>(null);
  const project = params.get("project") || "",
    group = params.get("group") || "";
  const reviews = useReviewSummaries(jobs.map((job) => job.id));
  const load = useCallback(
    async (append = false) => {
      setBusy(true);
      setError("");
      try {
        const d = await api.jobs({
          status: "done",
          kind,
          project,
          group,
          offset: append ? jobs.length : 0,
          limit: 60,
        });
        setJobs((j) => (append ? [...j, ...d.jobs] : d.jobs));
        setTotal(d.total);
        if (!append) {
          const bad = await api.jobs({
            status: "failed,cancelled",
            project,
            limit: 100,
          });
          setFailed(bad.jobs);
        }
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [kind, project, group, jobs.length],
  );
  useEffect(() => {
    load();
  }, [kind, project, group]);

  useEffect(() => {
    const updated = () => void load();
    window.addEventListener("yue2:jobs-updated", updated);
    return () => window.removeEventListener("yue2:jobs-updated", updated);
  }, [load]);

  const shown = jobs.filter(
    (j) =>
      (!preset || j.preset === preset) &&
      [titleOf(j), j.params?.lyrics, j.params?.style]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function toggle(id: string) {
    setSelected((s) =>
      s.includes(id) ? s.filter((i) => i !== id) : [...s, id],
    );
  }
  async function attachSelected(force = false) {
    if (!target || !selected.length) return;
    setBusy(true);
    try {
      try {
        await api.attachTakes(target.id, selected, force);
      } catch (e: any) {
        if (e.status === 409 && !force) {
          setMoveConfirm(true);
          return;
        }
        throw e;
      }
      setMoveConfirm(false);
      toast("作品已收录到项目。", "ok");
      setAttach(false);
      setSelected([]);
      setSelecting(false);
      navigate("/project/" + target.project_id);
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  }
  async function deleteSelected() {
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        selected.map((id) => api.remove(id)),
      );
      const removed = selected.filter(
        (_, i) => results[i].status === "fulfilled",
      );
      removed.forEach((id) => p.remove(id));
      setSelected((ids) => ids.filter((id) => !removed.includes(id)));
      setBatchRemove(false);
      toast(
        `已删除 ${removed.length} 首作品${removed.length < selected.length ? "，部分删除失败，请重试" : ""}。`,
        removed.length === selected.length ? "ok" : "err",
      );
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function deleteJob() {
    if (!remove) return;
    setBusy(true);
    try {
      await api.remove(remove.id);
      p.remove(remove.id);
      setRemove(null);
      toast("已删除作品。", "ok");
      load();
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="library-toolbar">
        <label className="search-field">
          <Search size={16} />
          <Input
            type="search"
            aria-label="搜索作品"
            placeholder="搜索名称、歌词或风格"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <Select
          aria-label="作品类型"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">全部类型</option>
          <option value="create">歌词创作</option>
          <option value="regenerate">乐谱再创作</option>
          <option value="cover">音频改编</option>
          <option value="hum">哼唱成歌</option>
        </Select>
        <Select
          aria-label="生成模式"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
        >
          <option value="">全部模式</option>
          <option value="fast">快速模式</option>
          <option value="quality">高质量</option>
          <option value="custom">自定义</option>
        </Select>
        <div className="layout-switch">
          <IconButton
            label="网格视图"
            className={layout === "grid" ? "active" : ""}
            onClick={() => setLayout("grid")}
          >
            <LayoutGrid size={16} />
          </IconButton>
          <IconButton
            label="列表视图"
            className={layout === "list" ? "active" : ""}
            onClick={() => setLayout("list")}
          >
            <List size={16} />
          </IconButton>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            setSelecting(!selecting);
            setSelected([]);
          }}
        >
          {selecting ? "取消选择" : "选择作品"}
        </Button>
        <Button onClick={() => setPublishJob("choose")}>
          <Send size={14} />
          发布作品
        </Button>
        <Link className="btn primary" to="/create">
          <Plus size={15} />
          新建作品
        </Link>
      </div>
      {(group || project) && (
        <div className="row library-filter-note">
          <Badge>已按{project ? "项目" : "版本组"}筛选</Badge>
          <Link to="/library" className="muted small">
            查看全部
          </Link>
        </div>
      )}
      {selecting && (
        <div className="library-selection">
          <span>已选 {selected.length} 首</span>
          <Button
            variant="ghost"
            onClick={() => setSelected(shown.map((j) => j.id))}
          >
            全选当前作品
          </Button>
          <Button variant="ghost" onClick={() => setSelected([])}>
            取消选择
          </Button>
          <Button
            variant="danger"
            disabled={!selected.length || busy}
            onClick={() => setBatchRemove(true)}
          >
            <Trash2 size={14} />
            删除所选
          </Button>
          <Button
            variant="primary"
            disabled={!selected.length}
            onClick={() => setAttach(true)}
          >
            <FolderPlus size={14} />
            收录到项目
          </Button>
        </div>
      )}
      {error && (
        <div className="error-box row between">
          {error}
          <Button onClick={() => load()}>重试</Button>
        </div>
      )}
      {busy && !jobs.length ? (
        <div className="empty-state">正在读取作品…</div>
      ) : !shown.length ? (
        <EmptyState
          title="这里还没有作品"
          description={
            query
              ? "试试其他关键词。"
              : "输入歌词和曲风，让第一首歌在这里诞生。"
          }
        >
          <Link className="btn" to="/create">
            开始创作
          </Link>
        </EmptyState>
      ) : (
        <div className={layout === "grid" ? "library-grid" : "library-list"}>
          {shown.map((j, i) => {
            const playing = p.current?.id === j.id && p.playing;
            const review = reviews[j.id];
            return (
              <article
                key={j.id}
                className={`music-card ${selected.includes(j.id) ? "selected" : ""}`}
              >
                <div className="music-card-art">
                  <UnstyledButton
                    className="music-cover-open"
                    onClick={() => usePlayerOverlay.getState().open(j.id)}
                    aria-label={`全屏播放 ${titleOf(j)}`}
                  >
                    <Artwork job={j} />
                  </UnstyledButton>
                  {!selecting && (
                    <UnstyledButton
                      className="music-publish"
                      aria-label={`发布到广场 ${titleOf(j)}`}
                      onClick={() => setPublishJob(j)}
                    >
                      <Send size={12} />
                      发布
                    </UnstyledButton>
                  )}
                  {selecting ? (
                    <UnstyledButton
                      className="select-track"
                      aria-label={`选择 ${titleOf(j)}`}
                      aria-pressed={selected.includes(j.id)}
                      onClick={() => toggle(j.id)}
                    >
                      {selected.includes(j.id) && <Check size={15} />}
                    </UnstyledButton>
                  ) : (
                    <UnstyledButton
                      className="art-play"
                      aria-label={`${playing ? "暂停" : "播放"} ${titleOf(j)}`}
                      onClick={() => (playing ? p.toggle() : p.play(shown, i))}
                    >
                      {playing ? (
                        <Pause size={20} fill="currentColor" />
                      ) : (
                        <Play size={20} fill="currentColor" />
                      )}
                    </UnstyledButton>
                  )}
                </div>
                <div className="music-card-info">
                  <UnstyledButton
                    className="music-card-title"
                    onClick={() => usePlayerOverlay.getState().open(j.id)}
                  >
                    {titleOf(j)}
                  </UnstyledButton>
                  <p>{j.params?.style || "原创音乐"}</p>
                  <div className="music-card-meta">
                    <time>{duration(j.timing?.audio_seconds)}</time>
                    <span>{when(j.created_at)}</span>
                  </div>
                </div>
                <div className="music-card-footer">
                  <UnstyledButton
                    className="music-review-entry"
                    onClick={() =>
                      usePlayerOverlay.getState().open(j.id, "reviews")
                    }
                    aria-label={`评分与乐评 ${titleOf(j)}`}
                  >
                    <MessageSquareText size={12} />
                    {review?.manual_score != null ||
                    review?.ai_score != null ? (
                      <>
                        {review.manual_score != null && (
                          <span>
                            我 <b>{review.manual_score.toFixed(1)}</b>
                          </span>
                        )}
                        {review.ai_score != null && (
                          <span>
                            AI <b>{review.ai_score.toFixed(1)}</b>
                          </span>
                        )}
                      </>
                    ) : (
                      <span>
                        {review?.ai_status === "running"
                          ? "AI 正在评析…"
                          : review?.has_comment
                            ? "查看我的评论"
                            : "评分与乐评"}
                      </span>
                    )}
                  </UnstyledButton>
                  <div className="music-card-actions">
                    <IconButton
                      label={`全屏播放 ${titleOf(j)}`}
                      onClick={() => usePlayerOverlay.getState().open(j.id)}
                    >
                      <ArrowUpRight size={15} />
                    </IconButton>
                    <a
                      href={songUrl(j.id, "audio.mp3")}
                      download
                      className="icon-btn"
                      title="下载 MP3"
                      aria-label={`下载 ${titleOf(j)}`}
                    >
                      <Download size={14} />
                    </a>
                    <IconButton
                      label={`删除 ${titleOf(j)}`}
                      onClick={() => setRemove(j)}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {publishJob && (
        <PublishDialog
          job={publishJob === "choose" ? undefined : publishJob}
          onClose={() => setPublishJob(null)}
          onPublished={() => navigate("/plaza")}
        />
      )}
      {jobs.length < total && (
        <div className="library-more">
          <Button disabled={busy} onClick={() => load(true)}>
            加载更多 · {jobs.length} / {total}
          </Button>
        </div>
      )}
      <details
        className="library-history"
        open={params.get("history") === "1" || undefined}
      >
        <summary>
          未完成记录 <span>{failed.length}</span>
        </summary>
        <div className="stack">
          {failed.length ? (
            failed.map((j) => (
              <div className="history-row" key={j.id}>
                <div>
                  <strong>{titleOf(j)}</strong>
                  <p>{errorMessage(j.error || "任务已取消")}</p>
                </div>
                <Badge tone={j.status === "failed" ? "err" : "neutral"}>
                  {j.status === "failed" ? "失败" : "已取消"}
                </Badge>
                <Link className="btn ghost" to={`/create?from=${j.id}`}>
                  <RefreshCw size={13} />
                  重试创作
                </Link>
                <IconButton
                  label={`删除记录 ${titleOf(j)}`}
                  onClick={() => setRemove(j)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))
          ) : (
            <p className="muted">没有未完成记录。</p>
          )}
        </div>
      </details>
      <UploadsPanel />
      {attach && (
        <Dialog
          title={`收录 ${selected.length} 首作品`}
          onClose={() => {
            if (!busy) {
              setAttach(false);
              setMoveConfirm(false);
            }
          }}
        >
          <ProjectPicker
            onPick={(next) => {
              setTarget(next);
              setMoveConfirm(false);
            }}
            initialTrack={params.get("attach") || undefined}
          />
          {moveConfirm && (
            <p className="library-move-notice" role="alert">
              部分作品已属于其他曲目。继续会将它们移动到当前曲目，保留已有评价。
            </p>
          )}
          <div className="dialog-actions">
            <Button
              disabled={busy}
              onClick={() => {
                setAttach(false);
                setMoveConfirm(false);
              }}
            >
              取消
            </Button>
            <Button
              variant="primary"
              disabled={!target || busy}
              onClick={() => attachSelected(moveConfirm)}
            >
              {moveConfirm ? "移动并收录" : "确认收录"}
            </Button>
          </div>
        </Dialog>
      )}
      {batchRemove && (
        <Dialog
          title="删除所选作品"
          onClose={() => {
            if (!busy) setBatchRemove(false);
          }}
        >
          <p>
            删除所选的 {selected.length} 首作品及其生成文件？此操作无法撤销。
          </p>
          <div className="dialog-actions">
            <Button disabled={busy} onClick={() => setBatchRemove(false)}>
              保留
            </Button>
            <Button variant="danger" disabled={busy} onClick={deleteSelected}>
              {busy ? "正在删除…" : "删除所选"}
            </Button>
          </div>
        </Dialog>
      )}
      {remove && (
        <Dialog title="删除作品" onClose={() => setRemove(null)}>
          <p>删除《{titleOf(remove)}》及其生成文件？此操作无法撤销。</p>
          <div className="dialog-actions">
            <Button onClick={() => setRemove(null)}>保留</Button>
            <Button variant="danger" disabled={busy} onClick={deleteJob}>
              删除作品
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
