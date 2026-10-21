import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Drawer, Menu, Slider, Tabs, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Repeat1,
  Shuffle,
  Download,
  MoreHorizontal,
  Volume2,
  VolumeX,
  SlidersHorizontal,
  FolderPlus,
  Pencil,
  Trash2,
  Send,
  MessageSquare,
  ListMusic,
  Info,
} from "lucide-react";
import { api, songUrl } from "../lib/api";
import type { Job } from "../lib/types";
import { duration, titleOf, presetLabel, errorMessage } from "../lib/utils";
import { useApp } from "../state/app";
import { usePlayer } from "../state/player";
import { usePlayerOverlay } from "../state/playerOverlay";
import {
  Artwork,
  Button,
  IconButton,
  Dialog,
  EmptyState,
  Input,
  Textarea,
  Select,
} from "../components/ui";
import { ThemeToggle } from "../components/ThemeToggle";
import { ProjectPicker } from "../components/ProjectPicker";
import { PlayerMedia } from "../components/PlayerMedia";
import { SyncedLyrics } from "../components/SyncedLyrics";
import { SongReviews } from "../components/SongReviews";
import { PublishDialog } from "../components/PublishDialog";
import { useLyricsAlignment } from "../hooks/useLyricsAlignment";
import "./Player.css";
export function PlayerPage({
  jobId,
  initialView = "cover",
  entered = true,
  onClose,
  onDialogChange,
}: {
  jobId: string;
  initialView?: "cover" | "reviews";
  entered?: boolean;
  onClose: () => void;
  onDialogChange?: (opened: boolean) => void;
}) {
  const navigate = useNavigate(),
    toast = useApp((s) => s.toast),
    status = useApp((s) => s.status),
    p = usePlayer();
  const [job, setJob] = useState<Job | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState<string>("reviews"),
    [detailsOpen, setDetailsOpen] = useState(false),
    [modal, setModal] = useState(""),
    [name, setName] = useState(""),
    [target, setTarget] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const mobile = useMediaQuery("(max-width: 760px)");
  const detailsTrigger = useRef<HTMLButtonElement | null>(null);
  const { alignment, requestAlignment } = useLyricsAlignment(job);
  useEffect(() => {
    setTab("reviews");
    setDetailsOpen(initialView === "reviews" && entered);
  }, [jobId, initialView, entered]);
  useEffect(() => {
    let live = true;
    setJob(null);
    setError("");
    api
      .job(jobId)
      .then((d) => {
        if (live) {
          setJob(d.job);
          setName(d.job.title || "");
        }
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [jobId]);
  useEffect(() => {
    onDialogChange?.(Boolean(modal) || detailsOpen);
    return () => onDialogChange?.(false);
  }, [modal, detailsOpen, onDialogChange]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest(
          "input,textarea,select,button,a,[role=slider],[role=tab],[contenteditable=true]",
        )
      )
        return;
      if (
        e.code === "Space" &&
        job?.artifacts.audio &&
        !modal &&
        !detailsOpen
      ) {
        e.preventDefault();
        if (p.current?.id === job.id) p.toggle();
        else p.play([job]);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [job, p.current, modal, detailsOpen]);
  if (error)
    return (
      <EmptyState title="作品暂时无法读取" description={error}>
        <Button onClick={onClose}>收起播放器</Button>
      </EmptyState>
    );
  if (!job)
    return (
      <div className="player-loading">
        <IconButton label="收起全屏播放器" onClick={onClose}>
          <ChevronDown size={20} />
        </IconButton>
        <div className="empty-state">正在读取作品…</div>
      </div>
    );
  const current = p.current?.id === job.id,
    playing = current && p.playing,
    time = current ? p.time : 0,
    length = (current ? p.duration : 0) || job.timing?.audio_seconds || 0,
    canPlay = job.status === "done" && job.artifacts.audio;
  const seekTo = (seconds: number) => p.seekTo(job, seconds);
  function showDetails(value: string, trigger: HTMLButtonElement) {
    detailsTrigger.current = trigger;
    setTab(value);
    setDetailsOpen(true);
  }
  async function action(fn: () => Promise<any>) {
    setBusy(true);
    try {
      await fn();
      setModal("");
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  }
  async function attach() {
    if (!target) return;
    await action(async () => {
      try {
        await api.attachTakes(target.id, [job.id]);
      } catch (e: any) {
        if (
          e.status !== 409 ||
          !window.confirm(
            "该作品已收录到其他曲目。移动到当前曲目并保留评价吗？",
          )
        )
          throw e;
        await api.attachTakes(target.id, [job.id], true);
      }
      const d = await api.job(job.id);
      setJob(d.job);
      toast("作品已收录。", "ok");
    });
  }
  return (
    <div className="listening-page">
      <header className="listening-top">
        <UnstyledButton
          className="player-collapse"
          onClick={onClose}
          aria-label="收起全屏播放器"
          data-autofocus
        >
          <ChevronDown size={20} />
          <span>收起</span>
        </UnstyledButton>
        <span className="listening-caption">
          <img src="/static/assets/music-city-mark.svg" alt="" />
          AI乐之城 <span>·</span> 正在聆听
        </span>
        <ThemeToggle />
      </header>
      {job.error && (
        <div className="error-box listening-notice" role="alert">
          {errorMessage(job.error)}{" "}
          <Link to={`/create?from=${job.id}`} onClick={onClose}>
            重新创作 →
          </Link>
        </div>
      )}
      {["queued", "running"].includes(job.status) && (
        <div className="error-box listening-notice" role="status">
          作品仍在生成。
          <Link to="/queue" onClick={onClose}>
            查看任务进度 →
          </Link>
        </div>
      )}
      <div className="listening-layout">
        <section className="listening-record">
          <PlayerMedia
            alignment={alignment}
            onAlign={requestAlignment}
            key={job.id}
            job={job}
            playing={playing}
            onClose={onClose}
            time={time}
            duration={length}
            seekable={canPlay}
            onSeek={seekTo}
            active={entered && !detailsOpen && !modal}
          />
          <div className="record-info">
            <div className="row between">
              <span className="section-label">
                {job.take?.project_name || "AI乐之城 · 原创作品"}
              </span>
              <div className="row">
                <IconButton
                  label="收录到项目"
                  onClick={() => setModal("attach")}
                >
                  <FolderPlus size={16} />
                </IconButton>
                <Menu position="bottom-end" withinPortal zIndex={600}>
                  <Menu.Target>
                    <IconButton label="更多作品操作">
                      <MoreHorizontal size={18} />
                    </IconButton>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {canPlay && (
                      <Menu.Item
                        component="a"
                        href={songUrl(
                          job.id,
                          status?.ffmpeg ? "audio.mp3" : "audio.flac",
                        )}
                        download
                        leftSection={<Download size={14} />}
                      >
                        下载 {status?.ffmpeg ? "MP3" : "FLAC"}
                      </Menu.Item>
                    )}
                    <Menu.Item
                      leftSection={<Send size={14} />}
                      disabled={!canPlay}
                      onClick={() => setModal("publish")}
                    >
                      发布到音乐广场
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<Pencil size={14} />}
                      onClick={() => {
                        setName(job.title || "");
                        setModal("rename");
                      }}
                    >
                      重命名
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<SlidersHorizontal size={14} />}
                      onClick={() => {
                        onClose();
                        navigate(`/create?from=${job.id}`);
                      }}
                    >
                      修改参数后创作
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<SlidersHorizontal size={14} />}
                      onClick={() => setModal("advanced")}
                    >
                      乐谱与高级操作
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                      color="red"
                      leftSection={<Trash2 size={14} />}
                      onClick={() => setModal("delete")}
                    >
                      删除作品
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </div>
            </div>
            <h1>{titleOf(job)}</h1>
          </div>
          <div className="record-progress">
            <Slider
              min={0}
              max={length || 1}
              step={0.1}
              value={Math.min(time, length || 0)}
              disabled={!canPlay}
              label={duration}
              thumbLabel="歌曲播放进度"
              onChange={seekTo}
              size={3}
              thumbSize={10}
            />
            <div>
              <time>{duration(time)}</time>
              <time>{duration(length)}</time>
            </div>
          </div>
          <div className="record-controls">
            <IconButton
              label={p.shuffle ? "关闭随机播放" : "开启随机播放"}
              className={p.shuffle ? "active" : ""}
              onClick={p.setShuffle}
            >
              <Shuffle size={17} />
            </IconButton>
            <IconButton label="上一首" onClick={p.prev} disabled={!current}>
              <SkipBack size={21} fill="currentColor" />
            </IconButton>
            <IconButton
              className="record-play"
              label={playing ? "暂停歌曲" : "播放歌曲"}
              disabled={!canPlay}
              onClick={() => (current ? p.toggle() : p.play([job]))}
            >
              {playing ? (
                <Pause size={22} fill="currentColor" />
              ) : (
                <Play size={22} fill="currentColor" />
              )}
            </IconButton>
            <IconButton
              label="下一首"
              onClick={p.next}
              disabled={!current || p.queue.length < 2}
            >
              <SkipForward size={21} fill="currentColor" />
            </IconButton>
            <IconButton
              label={`循环模式：${{ off: "不循环", all: "列表循环", one: "单曲循环" }[p.repeat]}`}
              className={p.repeat !== "off" ? "active" : ""}
              onClick={p.setRepeat}
            >
              {p.repeat === "one" ? (
                <Repeat1 size={18} />
              ) : (
                <Repeat size={18} />
              )}
            </IconButton>
          </div>
          <div className="record-volume">
            <IconButton
              label={p.volume ? "静音" : "取消静音"}
              onClick={() => p.setVolume(p.volume ? 0 : 0.7)}
            >
              {p.volume ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </IconButton>
            <Slider
              thumbLabel="播放器音量"
              min={0}
              max={1}
              step={0.01}
              value={p.volume}
              onChange={p.setVolume}
              label={(value) => `${Math.round(value * 100)}%`}
              size={3}
              thumbSize={9}
            />
          </div>
          <div className="record-secondary-actions" aria-label="更多聆听功能">
            <UnstyledButton
              onClick={(event) => showDetails("reviews", event.currentTarget)}
            >
              <MessageSquare size={15} />
              乐评
            </UnstyledButton>
            <UnstyledButton
              onClick={(event) => showDetails("queue", event.currentTarget)}
            >
              <ListMusic size={16} />
              队列{p.queue.length ? ` · ${p.queue.length}` : ""}
            </UnstyledButton>
            <UnstyledButton
              onClick={(event) => showDetails("info", event.currentTarget)}
            >
              <Info size={15} />
              信息
            </UnstyledButton>
          </div>
        </section>
        {!mobile && (
          <section className="listening-lyrics" aria-label="歌曲歌词">
            <SyncedLyrics
              alignment={alignment}
              onAlign={requestAlignment}
              key={job.id}
              lyrics={job.params?.lyrics || ""}
              time={time}
              duration={length}
              seekable={canPlay}
              onSeek={seekTo}
              active={entered && !detailsOpen && !modal}
            />
          </section>
        )}
      </div>
      <Drawer
        opened={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={titleOf(job)}
        position="right"
        size={mobile ? "100%" : 620}
        zIndex={400}
        trapFocus={!modal}
        closeOnEscape={!modal}
        onExitTransitionEnd={() => {
          if (!detailsOpen && !modal && detailsTrigger.current?.isConnected)
            detailsTrigger.current.focus({ preventScroll: true });
        }}
        closeButtonProps={{ "aria-label": "返回封面与歌词" }}
        overlayProps={{ backgroundOpacity: 0.22, blur: 3 }}
        classNames={{
          content: "listening-drawer",
          header: "listening-drawer-header",
          body: "listening-drawer-body",
        }}
      >
        <section className="listening-content">
          <Tabs
            value={tab}
            onChange={(value) => setTab(value || "reviews")}
            variant="default"
            className="listening-tabs-root"
          >
            <div className="listening-tabs-wrap">
              <Tabs.List>
                <Tabs.Tab value="reviews">评分与乐评</Tabs.Tab>
                <Tabs.Tab value="queue">
                  播放队列{p.queue.length > 0 ? ` · ${p.queue.length}` : ""}
                </Tabs.Tab>
                <Tabs.Tab value="info">作品信息</Tabs.Tab>
              </Tabs.List>
            </div>
            <Tabs.Panel value="reviews" className="listening-reviews">
              <SongReviews key={job.id} job={job} />
            </Tabs.Panel>
            <Tabs.Panel
              value="queue"
              className="listening-queue"
              aria-label="当前播放队列"
            >
              {p.queue.length ? (
                p.queue.map((track, index) => (
                  <UnstyledButton
                    key={track.id}
                    className={`listening-queue-track ${track.id === p.current?.id ? "active" : ""}`}
                    onClick={() => {
                      p.play(p.queue, index);
                      setDetailsOpen(false);
                      usePlayerOverlay.getState().open(track.id);
                    }}
                  >
                    <span className="queue-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <Artwork job={track} size={42} />
                    <span className="listening-queue-name">
                      <span
                        className="listening-queue-title"
                        title={titleOf(track)}
                      >
                        {titleOf(track)}
                      </span>
                      <small>
                        {track.take?.project_name || "AI乐之城 · 我的作品"}
                      </small>
                    </span>
                    {track.id === p.current?.id && p.playing ? (
                      <span className="playing-bars">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : (
                      <time>{duration(track.timing?.audio_seconds)}</time>
                    )}
                  </UnstyledButton>
                ))
              ) : (
                <EmptyState
                  title="还没有播放中的歌曲"
                  description="播放这首作品，即可加入播放队列。"
                />
              )}
            </Tabs.Panel>
            <Tabs.Panel value="info" className="record-details">
              <div>
                <span className="section-label">音乐风格</span>
                <p>{job.params?.style || "未设置"}</p>
              </div>
              <dl>
                <dt>生成模型</dt>
                <dd>YuE2 · {job.precision}</dd>
                <dt>生成方式</dt>
                <dd>
                  {presetLabel(job.preset)} · {job.ode_steps} 步
                </dd>
                <dt>生成耗时</dt>
                <dd>
                  {job.timing?.e2e ? `${job.timing.e2e.toFixed(1)} 秒` : "—"}
                </dd>
                <dt>随机种子</dt>
                <dd>{job.seed}</dd>
                <dt>所属项目</dt>
                <dd>
                  {job.take ? (
                    <Link
                      to={`/project/${job.take.project_id}`}
                      onClick={onClose}
                    >
                      {job.take.project_name} / {job.take.track_name}
                    </Link>
                  ) : (
                    "未收录"
                  )}
                </dd>
              </dl>
              <div className="row">
                <Button onClick={() => setModal("advanced")}>
                  <SlidersHorizontal size={14} />
                  乐谱与参数
                </Button>
                <Link
                  className="btn ghost"
                  to={`/assistant?song=${job.id}`}
                  onClick={onClose}
                >
                  和助手聊聊这首歌
                </Link>
              </div>
              {canPlay && (
                <div className="record-downloads">
                  <a href={songUrl(job.id, "audio.flac")} download>
                    无损 FLAC ↗
                  </a>
                  <a href={songUrl(job.id, "artifacts.zip")} download>
                    全部生成素材 ↗
                  </a>
                </div>
              )}
            </Tabs.Panel>
          </Tabs>
        </section>
      </Drawer>
      {modal === "publish" && (
        <PublishDialog
          job={job}
          onClose={() => setModal("")}
          onPublished={() => {
            setModal("");
            onClose();
            navigate("/plaza");
          }}
        />
      )}
      {modal === "attach" && (
        <Dialog title="收录到项目" onClose={() => setModal("")}>
          <ProjectPicker onPick={setTarget} initialTrack={job.take?.track_id} />
          <div className="dialog-actions">
            <Button onClick={() => setModal("")}>取消</Button>
            <Button
              variant="primary"
              onClick={attach}
              disabled={!target || busy}
            >
              确认收录
            </Button>
          </div>
        </Dialog>
      )}
      {modal === "rename" && (
        <Dialog title="重命名作品" onClose={() => setModal("")}>
          <label className="field">
            作品名称
            <Input
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <Button onClick={() => setModal("")}>取消</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  const d = await api.patchJob(job.id, {
                    title: name.trim() || null,
                  });
                  setJob(d.job);
                  usePlayer.setState((s) => ({
                    queue: s.queue.map((j) => (j.id === job.id ? d.job : j)),
                    current: s.current?.id === job.id ? d.job : s.current,
                  }));
                  toast("作品名称已更新。", "ok");
                })
              }
            >
              保存
            </Button>
          </div>
        </Dialog>
      )}
      {modal === "delete" && (
        <Dialog title="删除作品" onClose={() => setModal("")}>
          <p>删除《{titleOf(job)}》及其音频和生成文件？此操作无法撤销。</p>
          <div className="dialog-actions">
            <Button onClick={() => setModal("")}>保留</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await api.remove(job.id);
                  p.remove(job.id);
                  onClose();
                  window.dispatchEvent(new CustomEvent("yue2:jobs-updated"));
                })
              }
            >
              删除作品
            </Button>
          </div>
        </Dialog>
      )}
      {modal === "advanced" && (
        <Advanced
          job={job}
          onClose={() => setModal("")}
          onNavigate={() => {
            setModal("");
            onClose();
          }}
        />
      )}
    </div>
  );
}
function Advanced({
  job,
  onClose,
  onNavigate,
}: {
  job: Job;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const [abc, setAbc] = useState(""),
    [style, setStyle] = useState(job.params?.style || ""),
    [preset, setPreset] = useState(job.preset),
    [precision, setPrecision] = useState(job.precision),
    [steps, setSteps] = useState(job.ode_steps),
    [seed, setSeed] = useState(String(job.seed)),
    [count, setCount] = useState(3),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [previewError, setPreviewError] = useState(""),
    [previewReady, setPreviewReady] = useState(false),
    [midi, setMidi] = useState<any>(null),
    [adapters, setAdapters] = useState<any[]>(job.loras || []);
  const ref = useRef<HTMLDivElement>(null),
    visual = useRef<any>(null),
    synth = useRef<any>(null),
    previewToken = useRef(0),
    toast = useApp((s) => s.toast),
    status = useApp((s) => s.status),
    navigate = useNavigate();
  useEffect(() => {
    let live = true;
    if (job.artifacts.score)
      api
        .text(songUrl(job.id, "score.abc"))
        .then((t) => {
          if (live) setAbc(t);
        })
        .catch((e) => toast(errorMessage(e), "err"))
        .finally(() => {
          if (live) setLoading(false);
        });
    else setLoading(false);
    return () => {
      live = false;
      previewToken.current++;
      synth.current?.stop();
    };
  }, [job.id]);
  useEffect(() => {
    let live = true;
    setPreviewReady(false);
    previewToken.current++;
    synth.current?.stop();
    setMidi(null);
    visual.current = null;
    const timer = setTimeout(async () => {
      if (!abc.trim() || !ref.current) {
        if (ref.current) ref.current.replaceChildren();
        return;
      }
      try {
        const abcjs = await import("abcjs");
        if (!live) return;
        visual.current = abcjs.renderAbc(ref.current, abc, {
          responsive: "resize",
          staffwidth: 490,
        })[0];
        setPreviewReady(Boolean(visual.current));
        setPreviewError("");
      } catch {
        setPreviewReady(false);
        setPreviewError("乐谱暂时无法预览，请检查 ABC 格式。");
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [abc]);
  async function preview() {
    const token = ++previewToken.current;
    try {
      if (midi) {
        synth.current?.stop();
        setMidi(null);
        return;
      }
      setMidi("loading");
      const abcjs = await import("abcjs");
      if (token !== previewToken.current) return;
      const player = new abcjs.synth.CreateSynth();
      synth.current = player;
      usePlayer.getState().pause();
      await player.init({ visualObj: visual.current });
      if (token !== previewToken.current) return;
      await player.prime();
      if (token !== previewToken.current) return;
      player.start();
      setMidi(true);
    } catch {
      if (token !== previewToken.current) return;
      setMidi(null);
      toast("乐谱试听暂时不可用，仍可编辑和下载 ABC。", "err");
    }
  }
  async function submit(variations = false) {
    setBusy(true);
    try {
      const common = {
        preset,
        precision,
        ode_steps: steps,
        loras: adapters,
        track_id: job.take?.track_id || null,
      };
      if (variations) {
        await api.submit({
          kind: "variations",
          ...common,
          params: {
            count,
            random_seeds: true,
            base: {
              style,
              lyrics: job.params.lyrics,
              cot: job.params.cot || "full",
              seed: seed === "" ? job.seed : Number(seed),
              cfg_scale: job.params.cfg_scale ?? null,
              abc: abc || null,
              title: job.title || null,
            },
          },
        });
      } else {
        await api.submit({
          kind: "regenerate",
          ...common,
          params: {
            parent_id: job.id,
            abc,
            style: style || null,
            lyrics: null,
            seed: seed === "" ? null : Number(seed),
            title: null,
          },
        });
      }
      toast("已加入生成队列。", "ok");
      synth.current?.stop();
      onNavigate();
      navigate("/queue");
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="乐谱与高级操作" onClose={onClose}>
      <div className="stack">
        {loading ? (
          <p className="muted">读取乐谱中…</p>
        ) : (
          <>
            <div ref={ref} className="abc-preview" />
            {previewError && <p className="muted small">{previewError}</p>}
            <label className="field">
              ABC 乐谱
              <Textarea
                rows={7}
                value={abc}
                onChange={(e) => setAbc(e.target.value)}
                className="mono"
                placeholder="此作品没有乐谱，可填写 ABC 再生成。"
              />
            </label>
            <Button
              disabled={!abc || !previewReady || midi === "loading"}
              onClick={preview}
            >
              {midi === "loading"
                ? "加载试听…"
                : midi
                  ? "停止乐谱试听"
                  : "试听乐谱"}
            </Button>
          </>
        )}
        <label className="field">
          音乐风格
          <Textarea
            rows={2}
            value={style}
            onChange={(e) => setStyle(e.target.value)}
          />
        </label>
        <div className="grid2">
          <label className="field">
            生成方式
            <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="fast">快速 · 8bit</option>
              <option value="quality">高质量 · 未本机验收</option>
              <option value="custom">自定义</option>
            </Select>
          </label>
          <label className="field">
            随机种子
            <Input
              type="number"
              min="0"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
          </label>
        </div>
        {preset === "custom" && (
          <div className="grid2">
            <label className="field">
              精度
              <Select
                value={precision}
                onChange={(e) => setPrecision(e.target.value)}
              >
                <option>4bit</option>
                <option>8bit</option>
                <option>bf16</option>
              </Select>
            </label>
            <label className="field">
              合成步数
              <Input
                type="number"
                min="1"
                max="100"
                value={steps}
                onChange={(e) => setSteps(+e.target.value)}
              />
            </label>
          </div>
        )}
        {status?.loras?.adapters?.filter((a) => a.valid).length > 0 && (
          <label className="field">
            风格适配器
            <Select
              multiple
              value={adapters.map((a) => a.name || a)}
              onChange={(e) =>
                setAdapters(
                  [...e.target.selectedOptions].map((o) => ({
                    name: o.value,
                    scale: 1,
                  })),
                )
              }
            >
              {status.loras.adapters
                .filter((a) => a.valid)
                .map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </label>
        )}
        <Button
          variant="primary"
          disabled={busy || !abc.trim()}
          onClick={() => submit(false)}
        >
          使用此乐谱再生成
        </Button>
        <div className="row">
          <label className="field" style={{ flex: 1 }}>
            候选版本数
            <Input
              type="number"
              min="2"
              max="16"
              value={count}
              onChange={(e) => setCount(+e.target.value)}
            />
          </label>
          <Button
            disabled={busy || count < 2 || count > 16}
            onClick={() => submit(true)}
          >
            生成多个版本
          </Button>
        </div>
        <p className="small muted">生成会创建新作品，保留当前音频与参数。</p>
      </div>
    </Dialog>
  );
}
