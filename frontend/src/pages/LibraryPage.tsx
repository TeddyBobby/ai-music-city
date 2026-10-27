import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Checkbox as MantineCheckbox, Menu, SegmentedControl, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  CheckCheck,
  ListChecks,
  Download,
  LoaderCircle,
  Maximize2,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Share2,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { songDownload } from "../lib/shareSong";
import { draftFromJob } from "../lib/generationDetail";
import type { MusicKind } from "../lib/musicCreation";
import type { Job } from "../lib/types";
import { duration, errorMessage, titleOf, when } from "../lib/utils";
import { useApp } from "../state/app";
import { usePlayer } from "../state/player";
import { usePlayerOverlay } from "../state/playerOverlay";
import { Artwork, Button, Dialog, EmptyState, IconButton } from "../components/ui";
import { ShareSongDialog } from "../components/ShareSongDialog";
import "./SimpleLibrary.css";

const STAGE_LABELS: Record<string, string> = {
  load: "准备中",
  transcribe: "识别旋律",
  hum: "识别旋律",
  plan: "编曲中",
  semantic: "生成音乐",
  synthesize: "合成音频",
  decode: "完成最后处理",
  save: "正在保存",
};

function UnfinishedSong({
  job,
  highlighted = false,
}: {
  job: Job;
  highlighted?: boolean;
}) {
  const cause = String(job.error || "");
  const reason =
    job.status === "cancelled"
      ? "已取消"
      : /hum transcription has no notes|only rests/i.test(cause)
        ? "没听清旋律，请靠近麦克风重新哼唱"
        : /MemoryError|memory pressure|out of memory|failed to allocate|内存不足/i.test(
              cause,
            )
          ? "内存不足，请关闭闲置应用后重试"
          : /models?.*(missing|not found|unavailable|not installed|not ready)|missing.*models?|weights?.*(missing|not found)|模型.*(缺失|未安装|不可用|未就绪)|未找到.*模型|engine_unavailable/i.test(
                cause,
              )
            ? "音乐服务暂未就绪"
            : "生成未完成，请重试";
  return (
    <article
      id={`song-${job.id}`}
      className={`simple-failed-row ${highlighted ? "is-highlighted" : ""}`}
    >
      <Music2 size={18} />
      <div>
        <strong>{titleOf(job)}</strong>
        <span>{reason}</span>
      </div>
      <Link to={`/generation/${encodeURIComponent(job.id)}`}>调整重试</Link>
    </article>
  );
}

export function LibraryPage() {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("job") || "";
  const player = usePlayer();
  const openPlayer = usePlayerOverlay((s) => s.open);
  const mp3 = Boolean(useApp((s) => s.status?.ffmpeg));
  const toast = useApp((s) => s.toast);
  const [songs, setSongs] = useState<Job[]>([]);
  const [pending, setPending] = useState<Job[]>([]);
  const [failed, setFailed] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [audioSeconds, setAudioSeconds] = useState(0);
  const [musicKind, setMusicKind] = useState<MusicKind | "all">("all");
  const [limit, setLimit] = useState(40);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [canceling, setCanceling] = useState("");
  const [sharing, setSharing] = useState<Job | null>(null);
  // 批量管理：selecting 模式开关，selectedIds 勾选集合
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 删除确认（单首/批量共用一个 Dialog）：pending 为 null 时关闭
  const [confirmDelete, setConfirmDelete] = useState<
    { ids: string[]; label: string } | null
  >(null);
  const [removing, setRemoving] = useState(false);
  const focused = useRef("");
  const selectedFailure = failed.find((job) => job.id === selectedId);
  const previousFailures = failed.filter((job) => job.id !== selectedId);

  useEffect(() => {
    let live = true;
    let inFlight = false;
    setLoading(true);
    async function loadSongs() {
      const query = {
        status: "done",
        music_kind: musicKind === "all" ? undefined : musicKind,
      };
      const first = await api.jobs({
        ...query,
        summary: true,
        limit: Math.min(limit, 500),
      });
      const loaded: Job[] = [...first.jobs];
      let offset = loaded.length;
      while (live && offset < Math.min(limit, first.total)) {
        const next = await api.jobs({
          ...query,
          limit: Math.min(limit - offset, 500),
          offset,
        });
        if (!next.jobs.length) break;
        loaded.push(...next.jobs);
        offset += next.jobs.length;
      }
      return {
        ...first,
        jobs: [...new Map(loaded.map((job) => [job.id, job])).values()],
      };
    }
    async function load() {
      if (inFlight) return;
      inFlight = true;
      try {
        const [done, active, unsuccessful] = await Promise.all([
          loadSongs(),
          api.jobs({
            status: "queued,running",
            music_kind: musicKind === "all" ? undefined : musicKind,
            limit: 100,
          }),
          api.jobs({
            status: "failed,cancelled",
            music_kind: musicKind === "all" ? undefined : musicKind,
            limit: 100,
          }),
        ]);
        const all = [...done.jobs, ...active.jobs, ...unsuccessful.jobs];
        let selected: Job | undefined;
        if (selectedId && !all.some((job: Job) => job.id === selectedId)) {
          try {
            selected = (await api.job(selectedId)).job;
            if (
              selected &&
              musicKind !== "all" &&
              draftFromJob(selected).musicKind !== musicKind
            )
              selected = undefined;
          } catch {
            /* A stale link must not hide the library. */
          }
        }
        if (!live) return;
        setSongs(
          selected?.status === "done" ? [selected, ...done.jobs] : done.jobs,
        );
        setPending(
          selected && ["running", "queued"].includes(selected.status)
            ? [selected, ...active.jobs]
            : active.jobs,
        );
        setFailed(
          selected && ["failed", "cancelled"].includes(selected.status)
            ? [selected, ...unsuccessful.jobs]
            : unsuccessful.jobs,
        );
        setTotal(done.total);
        setAudioSeconds(done.summary?.audio_seconds || 0);
        setError("");
      } catch (cause) {
        if (live) setError(errorMessage(cause));
      } finally {
        inFlight = false;
        if (live) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(load, 5000);
    const updated = () => void load();
    window.addEventListener("yue2:jobs-updated", updated);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener("yue2:jobs-updated", updated);
    };
  }, [selectedId, limit, reload, musicKind]);

  useEffect(() => {
    if (!selectedId || focused.current === selectedId || loading) return;
    const element = document.getElementById(`song-${selectedId}`);
    if (element) {
      focused.current = selectedId;
      element.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedId, loading, songs, pending, failed]);

  async function cancel(job: Job) {
    setCanceling(job.id);
    try {
      const result = await api.cancel(job.id);
      if (result.status === 202) toast("正在停止生成…");
      setReload((value) => value + 1);
    } catch (cause) {
      toast(errorMessage(cause), "err");
    } finally {
      setCanceling("");
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function exitSelecting() {
    setSelecting(false);
    setSelectedIds([]);
  }

  /** 打开删除确认对话框（单首/批量共用） */
  function askDelete(ids: string[], label: string) {
    if (removing || !ids.length) return;
    setConfirmDelete({ ids, label });
  }

  async function removeOne(job: Job) {
    askDelete([job.id], `《${titleOf(job)}》`);
  }

  async function removeSelected() {
    askDelete(selectedIds, `选中的 ${selectedIds.length} 首歌曲`);
  }

  /** Dialog 确认后真正执行删除 */
  async function doDelete() {
    if (!confirmDelete || removing) return;
    setRemoving(true);
    try {
      const ids = confirmDelete.ids;
      const result =
        ids.length === 1
          ? (await api.remove(ids[0]), { deleted: ids, skipped: [] })
          : await api.batchRemoveSongs(ids);
      const done = (result?.deleted || []).length;
      const skipped = (result?.skipped || []).length;
      toast(
        skipped
          ? `已删除 ${done} 首，${skipped} 首生成中已跳过`
          : `已删除 ${done} 首`,
      );
      setConfirmDelete(null);
      exitSelecting();
      setReload((value) => value + 1);
    } catch (cause) {
      toast(errorMessage(cause), "err");
    } finally {
      setRemoving(false);
    }
  }

  function filterSongs(value: string) {
    if (value !== "all" && value !== "instrumental" && value !== "vocal")
      return;
    if (value === musicKind) return;
    setMusicKind(value);
    setLimit(40);
    setSongs([]);
    setPending([]);
    setFailed([]);
    setTotal(0);
    setAudioSeconds(0);
    setLoading(true);
    if (selectedId) {
      const next = new URLSearchParams(params);
      next.delete("job");
      setParams(next, { replace: true });
    }
  }

  return (
    <div className="simple-library">
      <header className="simple-library-toolbar">
        <SegmentedControl
          aria-label="筛选音乐类型"
          className="simple-library-filter"
          classNames={{
            label: "simple-library-filter-label",
            indicator: "simple-library-filter-indicator",
          }}
          value={musicKind}
          onChange={filterSongs}
          data={[
            { value: "all", label: "全部" },
            { value: "instrumental", label: "纯音乐" },
            { value: "vocal", label: "带歌词" },
          ]}
          withItemsBorders={false}
          radius="xl"
        />
        <div
          className="simple-library-summary"
          role="status"
          aria-live="polite"
        >
          {loading && !songs.length ? (
            <span>正在加载…</span>
          ) : error && !songs.length ? (
            <span>暂时无法获取汇总</span>
          ) : (
            <>
              <span>
                共 <strong>{total}</strong> 首
              </span>
              <span className="simple-library-summary-dot" aria-hidden="true">
                ·
              </span>
              <span>
                总时长 <strong>{duration(audioSeconds)}</strong>
              </span>
            </>
          )}
        </div>
        {songs.length > 0 && !selecting && (
          <Button
            className="simple-library-manage"
            variant="default"
            leftSection={<ListChecks size={16} />}
            onClick={() => setSelecting(true)}
          >
            管理
          </Button>
        )}
        {selecting && (
          <div className="simple-library-batch">
            <Button
              variant="default"
              leftSection={
                selectedIds.length === songs.length ? (
                  <Square size={16} />
                ) : (
                  <CheckCheck size={16} />
                )
              }
              onClick={() =>
                setSelectedIds((prev) =>
                  prev.length === songs.length
                    ? []
                    : songs.map((job) => job.id),
                )
              }
            >
              {selectedIds.length === songs.length ? "取消全选" : "全选"}
            </Button>
            <Button
              variant="danger"
              color="red"
              disabled={!selectedIds.length || removing}
              leftSection={<Trash2 size={16} />}
              loading={removing}
              onClick={() => void removeSelected()}
            >
              删除{selectedIds.length ? ` (${selectedIds.length})` : ""}
            </Button>
            <Button variant="ghost" onClick={exitSelecting}>
              完成
            </Button>
          </div>
        )}
      </header>
      {error && (
        <div className="simple-library-error" role="alert">
          {error}
          <Button onClick={() => setReload((value) => value + 1)}>重试</Button>
        </div>
      )}
      {pending.length > 0 && (
        <section className="simple-pending" aria-label="正在生成">
          {pending.map((job) => {
            const stage =
              job.status === "queued"
                ? "排队中"
                : STAGE_LABELS[job.progress?.stage] || "正在生成";
            const progress = job.progress?.total
              ? Math.min(
                  100,
                  Math.round(
                    ((job.progress.completed || 0) / job.progress.total) * 100,
                  ),
                )
              : undefined;
            return (
              <article
                id={`song-${job.id}`}
                key={job.id}
                className={`simple-job ${job.id === selectedId ? "is-highlighted" : ""}`}
              >
                <span className="simple-job-symbol">
                  <LoaderCircle size={22} className="spin" />
                </span>
                <div className="simple-job-copy">
                  <strong>{titleOf(job)}</strong>
                  <span role="status">
                    {stage}
                    {progress === undefined ? "…" : ` · ${progress}%`}
                  </span>
                  <progress aria-label={stage} max={100} value={progress} />
                </div>
                <Link
                  className="simple-job-detail"
                  to={`/generation/${encodeURIComponent(job.id)}`}
                  aria-label={`查看 ${titleOf(job)} 的生成进度`}
                >
                  查看进度
                </Link>
                <IconButton
                  label="取消生成"
                  disabled={canceling === job.id}
                  onClick={() => cancel(job)}
                >
                  <X size={18} />
                </IconButton>
              </article>
            );
          })}
        </section>
      )}
      {selectedFailure && (
        <section className="simple-failed" aria-label="本次生成未完成">
          <UnfinishedSong job={selectedFailure} highlighted />
        </section>
      )}
      {loading && !songs.length && !pending.length ? (
        <div className="simple-library-loading" role="status">
          <LoaderCircle size={23} className="spin" />
          正在加载…
        </div>
      ) : songs.length === 0 && !error ? (
        pending.length ? null : musicKind === "all" ? (
          <EmptyState title="暂无音乐">
            <Link className="btn primary" to="/home">
              创作音乐
            </Link>
          </EmptyState>
        ) : (
          <EmptyState
            title={`暂无${musicKind === "instrumental" ? "纯音乐" : "带歌词"}作品`}
          />
        )
      ) : (
        <div className="simple-song-list">
          <div className="simple-song-columns" aria-hidden="true">
            <span>#</span>
            <span className="simple-song-column-track">作品</span>
            <span>类型</span>
            <span>时长</span>
            <span>创建时间</span>
            <span className="simple-song-column-actions">操作</span>
          </div>
          {songs.map((job, index) => {
            const playing = player.current?.id === job.id && player.playing;
            const download = songDownload(job, mp3);
            const togglePlayback = () =>
              playing ? player.toggle() : player.play(songs, index);
            return (
              <article
                id={`song-${job.id}`}
                key={job.id}
                className={`simple-song ${job.id === selectedId ? "is-highlighted" : ""} ${playing ? "is-playing" : ""} ${selecting ? "is-selecting" : ""} ${selecting && selectedIds.includes(job.id) ? "is-checked" : ""}`}
                onClick={
                  selecting
                    ? () => toggleSelected(job.id)
                    : undefined
                }
              >
                {selecting ? (
                  <MantineCheckbox
                    className="simple-song-check"
                    aria-label={`选择 ${titleOf(job)}`}
                    checked={selectedIds.includes(job.id)}
                    onChange={() => toggleSelected(job.id)}
                    size="lg"
                  />
                ) : (
                  <span className="simple-song-number" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                )}
                <UnstyledButton
                  className="simple-song-cover"
                  aria-label={`${playing ? "暂停" : "播放"} ${titleOf(job)}`}
                  onClick={togglePlayback}
                >
                  <Artwork job={job} size={62} />
                  <span>
                    {playing ? (
                      <Pause size={22} fill="currentColor" />
                    ) : (
                      <Play size={22} fill="currentColor" />
                    )}
                  </span>
                </UnstyledButton>
                <UnstyledButton
                  className="simple-song-title"
                  onClick={() =>
                    desktop ? togglePlayback() : openPlayer(job.id)
                  }
                  aria-label={`${desktop ? (playing ? "暂停" : "播放") : "打开"} ${titleOf(job)}`}
                >
                  <strong>{titleOf(job)}</strong>
                  <small>
                    {duration(job.timing?.audio_seconds)}
                    <i>·</i>
                    {when(job.created_at)}
                  </small>
                </UnstyledButton>
                <span className="simple-song-kind simple-song-desktop-meta">
                  {draftFromJob(job).musicKind === "instrumental"
                    ? "纯音乐"
                    : "带歌词"}
                </span>
                <span className="simple-song-duration simple-song-desktop-meta">
                  {duration(job.timing?.audio_seconds)}
                </span>
                <time
                  className="simple-song-date simple-song-desktop-meta"
                  dateTime={job.created_at}
                >
                  {when(job.created_at)}
                </time>
                <div className="simple-song-actions">
                  {desktop && (
                    <Link
                      className="simple-song-action simple-song-edit"
                      to={`/generation/${encodeURIComponent(job.id)}`}
                      aria-label={`微调 ${titleOf(job)}`}
                      title="微调"
                    >
                      <SlidersHorizontal size={18} />
                      <span>微调</span>
                    </Link>
                  )}
                  <Menu
                    position="bottom-end"
                    width={180}
                    withinPortal
                    returnFocus
                    zIndex={600}
                  >
                    <Menu.Target>
                      <IconButton
                        className="simple-song-more"
                        label={`更多操作 ${titleOf(job)}`}
                        style={{ width: 44, height: 44 }}
                      >
                        <MoreHorizontal size={21} />
                      </IconButton>
                    </Menu.Target>
                    <Menu.Dropdown className="simple-song-menu">
                      <Menu.Item
                        leftSection={<Maximize2 size={17} />}
                        onClick={() => openPlayer(job.id)}
                      >
                        打开播放页
                      </Menu.Item>
                      <Menu.Item
                        component={Link}
                        to={`/generation/${encodeURIComponent(job.id)}`}
                        leftSection={<SlidersHorizontal size={18} />}
                      >
                        微调
                      </Menu.Item>
                      <Menu.Item
                        component="a"
                        href={download.url}
                        download={download.name}
                        leftSection={<Download size={18} />}
                      >
                        下载
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<Share2 size={18} />}
                        onClick={() => setSharing(job)}
                      >
                        分享
                      </Menu.Item>
                      <Menu.Item
                        color="red"
                        leftSection={<Trash2 size={18} />}
                        onClick={() => void removeOne(job)}
                      >
                        删除
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {songs.length < total && (
        <div className="simple-library-more">
          <Button
            disabled={loading}
            onClick={() => setLimit((value) => value + 40)}
          >
            {loading ? "加载中…" : "查看更多"}
          </Button>
        </div>
      )}
      {previousFailures.length > 0 && (
        <details className="simple-failed-history">
          <summary>未完成（{previousFailures.length}）</summary>
          <div className="simple-failed">
            {previousFailures.map((job) => (
              <UnfinishedSong key={job.id} job={job} />
            ))}
          </div>
        </details>
      )}
      {sharing && (
        <ShareSongDialog job={sharing} onClose={() => setSharing(null)} />
      )}
      {confirmDelete && (
        <Dialog
          title="删除歌曲"
          onClose={() => setConfirmDelete(null)}
        >
          <p className="simple-delete-confirm">
            确定删除{confirmDelete.label}吗？删除后歌曲与音频将无法恢复。
          </p>
          <div className="simple-delete-actions">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              color="red"
              leftSection={<Trash2 size={16} />}
              loading={removing}
              onClick={() => void doDelete()}
            >
              确认删除
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
