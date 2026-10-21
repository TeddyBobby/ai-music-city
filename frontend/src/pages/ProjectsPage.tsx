import { usePlayerOverlay } from "../state/playerOverlay";
import { UnstyledButton, Rating, SegmentedControl } from "@mantine/core";
import { Input, Textarea, Select } from "../components/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { albumUrl, api } from "../lib/api";
import type { Job } from "../lib/types";
import {
  duration,
  errorMessage,
  presetLabel,
  readStore,
  statusLabel,
  titleOf,
  when,
  writeStore,
} from "../lib/utils";
import { useApp } from "../state/app";
import { usePlayer } from "../state/player";
import {
  Artwork,
  Badge,
  Button,
  Dialog,
  EmptyState,
  IconButton,
} from "../components/ui";
import "./Workspace.css";

type Confirmation = {
  title: string;
  description: string;
  action: () => Promise<void>;
};
const canPlay = (job: any) => job?.status === "done" && !!job?.artifacts?.audio;

function Confirm({
  value,
  busy,
  onClose,
  onConfirm,
}: {
  value: Confirmation;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      title={value.title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="muted">{value.description}</p>
      <div className="row wk-dialog-actions">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {busy
            ? "处理中…"
            : value.title.includes("删除")
              ? "确认删除"
              : "确认移除"}
        </Button>
      </div>
    </Dialog>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { toast } = useApp();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const alive = useRef(true);
  async function load() {
    setError("");
    try {
      const result = await api.projects();
      if (alive.current) setProjects(result.projects || []);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, []);
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const result = await api.createProject({ name: name.trim() });
      toast("项目已创建", "ok");
      navigate(`/project/${result.project.id}`);
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function confirmAction() {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.action();
      setConfirm(null);
      toast("项目已删除", "ok");
      await load();
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wk-page">
      <form className="card wk-project-create" onSubmit={create}>
        <label className="field">
          <span>项目名称</span>
          <Input
            aria-label="新项目名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：城市夜行"
            maxLength={200}
            required
          />
        </label>
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          {busy && !confirm ? "创建中…" : "新建项目"}
        </Button>
      </form>
      {loading ? (
        <p className="muted" role="status">
          正在读取项目…
        </p>
      ) : error ? (
        <div className="card wk-error" role="alert">
          <span>{error}</span>
          <Button onClick={load}>重新加载</Button>
        </div>
      ) : projects.length ? (
        <div className="wk-project-grid">
          {projects.map((project) => (
            <article className="card wk-project-card" key={project.id}>
              <div className="row between">
                <span className="wk-project-symbol" aria-hidden="true">
                  ▤
                </span>
                <Button
                  variant="ghost"
                  className="wk-danger-text"
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      title: `删除「${project.name}」`,
                      description:
                        "项目与曲目关联会移除，音乐文件仍保留在作品库。",
                      action: () => api.removeProject(project.id),
                    })
                  }
                >
                  删除
                </Button>
              </div>
              <Link className="wk-project-name" to={`/project/${project.id}`}>
                {project.name}
              </Link>
              {project.description && (
                <p className="muted wk-description">{project.description}</p>
              )}
              <div className="row wk-project-counts">
                <span>{project.track_count || 0} 首曲目</span>
                <span>{project.chosen_count || 0} 首定稿</span>
              </div>
              <div className="wk-project-updated muted small">
                更新于 {when(project.updated_at)}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="还没有项目"
          description="新建项目后，添加曲目并从作品库加入版本。"
        />
      )}
      {confirm && (
        <Confirm
          value={confirm}
          busy={busy}
          onClose={() => setConfirm(null)}
          onConfirm={confirmAction}
        />
      )}
    </div>
  );
}

function TakeRow({
  job,
  track,
  busy,
  onChoose,
  onRemove,
  onChanged,
}: {
  job: Job;
  track: any;
  busy: boolean;
  onChoose: () => void;
  onRemove: () => void;
  onChanged: (job: Job) => void;
}) {
  const { toast } = useApp();
  const player = usePlayer();
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(job.take?.note || "");
  useEffect(() => {
    setNote(job.take?.note || "");
  }, [job.id, job.take?.note]);
  const selected = track.chosen_job_id === job.id;
  const playable = canPlay(job);
  const isCurrent = player.current?.id === job.id;
  async function save(patch: any) {
    if (saving || busy) return;
    setSaving(true);
    try {
      const result = await api.patchTake(job.id, patch);
      onChanged(result.job);
      toast("版本评价已保存", "ok");
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setSaving(false);
    }
  }
  return (
    <article className={`wk-take ${selected ? "is-chosen" : ""}`}>
      <div className="wk-take-main">
        <UnstyledButton
          className="wk-take-cover"
          aria-label={`全屏播放 ${titleOf(job)}`}
          onClick={() => usePlayerOverlay.getState().open(job.id)}
        >
          <Artwork job={job} size={44} />
        </UnstyledButton>
        <div className="wk-take-title">
          <UnstyledButton
            className="wk-take-title-button"
            onClick={() => usePlayerOverlay.getState().open(job.id)}
          >
            {titleOf(job)}
          </UnstyledButton>
          <div className="row small muted">
            <span>{statusLabel(job.status)}</span>
            <span>{duration(job.timing?.audio_seconds)}</span>
            <span>{presetLabel(job.preset)}</span>
          </div>
        </div>
        {selected && <Badge tone="ok">已定稿</Badge>}
        <div className="row wk-take-actions">
          <IconButton
            label={isCurrent && player.playing ? "暂停试听" : "试听版本"}
            disabled={!playable}
            onClick={() => (isCurrent ? player.toggle() : player.play([job]))}
          >
            {isCurrent && player.playing ? "Ⅱ" : "▶"}
          </IconButton>
          <Button
            disabled={busy || (!playable && !selected)}
            variant={selected ? "ghost" : "primary"}
            onClick={onChoose}
          >
            {selected ? "取消定稿" : "选为定稿"}
          </Button>
          <Button disabled={busy || saving} variant="ghost" onClick={onRemove}>
            移除
          </Button>
        </div>
      </div>
      <div className="wk-take-feedback">
        <div className="row wk-votes" aria-label="版本喜好">
          <UnstyledButton
            type="button"
            disabled={saving || busy}
            aria-pressed={job.take?.thumb === 1}
            onClick={() => save({ thumb: job.take?.thumb === 1 ? 0 : 1 })}
          >
            喜欢
          </UnstyledButton>
          <UnstyledButton
            type="button"
            disabled={saving || busy}
            aria-pressed={job.take?.thumb === -1}
            onClick={() => save({ thumb: job.take?.thumb === -1 ? 0 : -1 })}
          >
            不喜欢
          </UnstyledButton>
        </div>
        <Rating
          aria-label="版本星级"
          readOnly={saving || busy}
          value={job.take?.stars || 0}
          allowClear
          color="var(--accent)"
          getSymbolLabel={(value) => `${value} 星`}
          onChange={(stars) => save({ stars: stars || null })}
        />
        <span className="muted small wk-take-time">
          添加于 {when(job.take?.added_at || job.created_at)}
        </span>
      </div>
      <form
        className="wk-note-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ note });
        }}
      >
        <Input
          aria-label={`${titleOf(job)}版本备注`}
          disabled={busy || saving}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={4000}
          placeholder="添加版本备注，例如：副歌更自然"
        />
        <Button
          type="submit"
          disabled={busy || saving || note === (job.take?.note || "")}
        >
          {saving ? "保存中…" : "保存备注"}
        </Button>
      </form>
      {job.error && <p className="wk-inline-error small">{job.error}</p>}
    </article>
  );
}

export function ProjectPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { status, toast } = useApp();
  const player = usePlayer();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [newTrack, setNewTrack] = useState("");
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [edit, setEdit] = useState<{
    kind: "project" | "track";
    name: string;
    description: string;
    trackId?: string;
  } | null>(null);
  const [preferences, setPreferences] = useState(() => ({
    sort: "added",
    filter: "all",
    ...readStore<any>("project.takes", {}),
  }));
  const epoch = useRef(0);
  const alive = useRef(true);
  const busyRef = useRef(false);
  busyRef.current = busy;
  async function load(quiet = false) {
    const token = ++epoch.current;
    try {
      const result = await api.project(id);
      if (!alive.current || token !== epoch.current) return;
      setProject(result.project);
      setError("");
      setSelected((current) =>
        result.project.tracks.some((t: any) => t.id === current)
          ? current
          : result.project.tracks[0]?.id || "",
      );
    } catch (e) {
      if (alive.current && token === epoch.current && !quiet)
        setError(errorMessage(e));
    } finally {
      if (alive.current && token === epoch.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    setLoading(true);
    setProject(null);
    setSelected("");
    void load();
    return () => {
      alive.current = false;
      ++epoch.current;
    };
  }, [id]);
  const hasLiveTakes = !!project?.tracks.some((t: any) =>
    t.takes.some((j: any) => ["queued", "running"].includes(j.status)),
  );
  useEffect(() => {
    if (!hasLiveTakes) return;
    const timer = window.setInterval(() => {
      if (
        !busyRef.current &&
        !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName || "")
      )
        void load(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [id, hasLiveTakes]);
  useEffect(() => {
    writeStore("project.takes", preferences);
  }, [preferences]);
  async function action(fn: () => Promise<any>, message?: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
      if (message) toast(message, "ok");
      await load();
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!edit?.name.trim()) return;
    await action(async () => {
      if (edit.kind === "project")
        await api.patchProject(id, {
          name: edit.name.trim(),
          description: edit.description.trim(),
        });
      else await api.patchTrack(edit.trackId!, { name: edit.name.trim() });
      setEdit(null);
    }, "修改已保存");
  }
  async function addTrack(event: FormEvent) {
    event.preventDefault();
    if (!newTrack.trim()) return;
    await action(async () => {
      const result = await api.addTrack(id, newTrack.trim());
      setNewTrack("");
      setSelected(result.track.id);
    }, "曲目已添加");
  }
  async function executeConfirm() {
    if (!confirm) return;
    await action(async () => {
      await confirm.action();
      setConfirm(null);
    }, "已移除，音乐文件仍保留");
  }
  function changedJob(job: Job) {
    setProject((old: any) =>
      old
        ? {
            ...old,
            tracks: old.tracks.map((t: any) => ({
              ...t,
              takes: t.takes.map((j: Job) => (j.id === job.id ? job : j)),
              chosen: t.chosen?.id === job.id ? job : t.chosen,
            })),
          }
        : old,
    );
  }
  if (loading)
    return (
      <div className="wk-page">
        <p className="muted" role="status">
          正在读取项目…
        </p>
      </div>
    );
  if (!project)
    return (
      <div className="wk-page">
        <EmptyState
          title="无法打开项目"
          description={error || "项目不存在或已删除。"}
        >
          <Button onClick={() => load()}>重新加载</Button>
          <Link className="btn ghost" to="/projects">
            返回项目
          </Link>
        </EmptyState>
      </div>
    );
  const tracks = project.tracks || [];
  const track = tracks.find((t: any) => t.id === selected);
  const trackIndex = tracks.findIndex((t: any) => t.id === selected);
  const playableTracks = tracks.filter((t: any) => canPlay(t.chosen));
  const albumJobs: Job[] = playableTracks.map((t: any) => ({
    ...t.chosen,
    title: t.name,
  }));
  const inAlbum =
    albumJobs.length > 0 &&
    player.queue.length === albumJobs.length &&
    player.queue.every((job: Job, n: number) => job.id === albumJobs[n].id);
  const currentTrack = tracks.find(
    (t: any) => t.chosen?.id === player.current?.id,
  );
  let shownTakes: Job[] = [...(track?.takes || [])];
  if (preferences.filter === "up")
    shownTakes = shownTakes.filter((j) => j.take?.thumb === 1);
  if (preferences.filter === "unrated")
    shownTakes = shownTakes.filter((j) => !j.take?.thumb && !j.take?.stars);
  shownTakes.sort((a, b) => {
    const compare =
      preferences.sort === "stars"
        ? (b.take?.stars || 0) - (a.take?.stars || 0)
        : preferences.sort === "thumbs"
          ? (b.take?.thumb || 0) - (a.take?.thumb || 0)
          : 0;
    return (
      compare || (a.take?.added_at || "").localeCompare(b.take?.added_at || "")
    );
  });
  return (
    <div className="wk-page">
      {error && (
        <div className="wk-error" role="alert">
          <span>{error}</span>
          <Button onClick={() => load()}>重试</Button>
        </div>
      )}
      <section className="card wk-project-overview">
        <div className="wk-overview-copy">
          <div className="row wk-overview-title">
            <h2>{project.name}</h2>
            <span className="muted small">
              {tracks.length} 首曲目 ·{" "}
              {tracks.filter((t: any) => t.chosen_job_id).length} 首定稿
            </span>
          </div>
          <p className={project.description ? "" : "muted"}>
            {project.description || "尚未添加项目简介"}
          </p>
          <div className="row wk-overview-links">
            <Button
              variant="ghost"
              onClick={() =>
                setEdit({
                  kind: "project",
                  name: project.name,
                  description: project.description || "",
                })
              }
            >
              编辑名称与简介
            </Button>
            <Link className="btn ghost" to="/projects">
              所有项目
            </Link>
          </div>
        </div>
        <div className="wk-album-actions">
          <div className="row">
            <Button
              variant="primary"
              disabled={!albumJobs.length}
              onClick={() =>
                inAlbum && player.current
                  ? player.toggle()
                  : player.play(albumJobs)
              }
            >
              {inAlbum && player.playing
                ? "暂停专辑"
                : inAlbum
                  ? "继续播放"
                  : "播放专辑"}
            </Button>
            <a
              className={`btn ${!albumJobs.length ? "is-disabled" : ""}`}
              aria-disabled={!albumJobs.length}
              href={albumJobs.length ? albumUrl(id, "flac") : undefined}
              download
            >
              导出 FLAC ZIP
            </a>
            {status?.ffmpeg && (
              <a
                className={`btn ${!albumJobs.length ? "is-disabled" : ""}`}
                aria-disabled={!albumJobs.length}
                href={albumJobs.length ? albumUrl(id, "mp3") : undefined}
                download
              >
                导出 MP3 ZIP
              </a>
            )}
          </div>
          <span className="small muted">
            {inAlbum && currentTrack
              ? `正在试听：${currentTrack.name}`
              : albumJobs.length
                ? "按曲目顺序播放已选定的版本"
                : "为曲目选定版本后可播放、导出专辑"}
          </span>
        </div>
      </section>
      <div className="wk-project-editor">
        <aside className="card wk-track-sidebar">
          <h2>曲目列表</h2>
          <ol className="wk-track-nav">
            {tracks.map((t: any, i: number) => (
              <li key={t.id}>
                <UnstyledButton
                  className={selected === t.id ? "is-selected" : ""}
                  onClick={() => setSelected(t.id)}
                  aria-current={selected === t.id ? "true" : undefined}
                >
                  <span className="wk-track-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="wk-track-label">
                    {t.name}
                    <small>
                      {t.takes.length} 个版本 ·{" "}
                      {t.chosen_job_id ? "已定稿" : "待选择"}
                    </small>
                  </span>
                  {player.playing && t.chosen?.id === player.current?.id && (
                    <span className="wk-playing" aria-label="播放中">
                      ▥
                    </span>
                  )}
                </UnstyledButton>
              </li>
            ))}
          </ol>
          {!tracks.length && <p className="small muted">添加第一首曲目</p>}
          <form className="wk-new-track" onSubmit={addTrack}>
            <Input
              aria-label="新曲目名称"
              placeholder="新曲目名称"
              value={newTrack}
              onChange={(e) => setNewTrack(e.target.value)}
              maxLength={200}
              required
            />
            <Button type="submit" disabled={busy || !newTrack.trim()}>
              添加曲目
            </Button>
          </form>
        </aside>
        <section className="card wk-track-detail">
          {track ? (
            <>
              <div className="row between wk-track-heading">
                <div>
                  <div className="small muted">
                    曲目 {String(trackIndex + 1).padStart(2, "0")}
                  </div>
                  <h2>{track.name}</h2>
                </div>
                <div className="row">
                  <IconButton
                    label="上移曲目"
                    disabled={busy || trackIndex === 0}
                    onClick={() =>
                      action(
                        () =>
                          api.patchTrack(track.id, {
                            position: trackIndex - 1,
                          }),
                        "曲目顺序已保存",
                      )
                    }
                  >
                    ↑
                  </IconButton>
                  <IconButton
                    label="下移曲目"
                    disabled={busy || trackIndex === tracks.length - 1}
                    onClick={() =>
                      action(
                        () =>
                          api.patchTrack(track.id, {
                            position: trackIndex + 1,
                          }),
                        "曲目顺序已保存",
                      )
                    }
                  >
                    ↓
                  </IconButton>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      setEdit({
                        kind: "track",
                        trackId: track.id,
                        name: track.name,
                        description: "",
                      })
                    }
                  >
                    重命名
                  </Button>
                  <Button
                    variant="ghost"
                    className="wk-danger-text"
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        title: `删除曲目「${track.name}」`,
                        description: `移除 ${track.takes.length} 个版本的关联，音乐文件仍保留在作品库。`,
                        action: () => api.removeTrack(track.id),
                      })
                    }
                  >
                    删除曲目
                  </Button>
                </div>
              </div>
              <div
                className={`wk-chosen-summary ${track.chosen ? "has-chosen" : ""}`}
              >
                {track.chosen ? (
                  <>
                    <Badge tone="ok">专辑定稿</Badge>
                    <UnstyledButton
                      className="wk-chosen-title"
                      onClick={() =>
                        usePlayerOverlay.getState().open(track.chosen.id)
                      }
                    >
                      {titleOf(track.chosen)}
                    </UnstyledButton>
                    <span className="small muted">
                      {duration(track.chosen.timing?.audio_seconds)}
                    </span>
                    {canPlay(track.chosen) ? (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          player.play(
                            albumJobs,
                            playableTracks.findIndex(
                              (t: any) => t.id === track.id,
                            ),
                          )
                        }
                      >
                        从这首开始播放
                      </Button>
                    ) : (
                      <span className="wk-inline-error small">
                        音频文件缺失
                      </span>
                    )}
                  </>
                ) : (
                  <span className="muted">
                    {track.takes.length
                      ? "在下方选择一个版本作为专辑定稿。"
                      : "从作品库添加版本，或创作一个新版本。"}
                  </span>
                )}
              </div>
              <div className="row between wk-takes-toolbar">
                <h3>
                  作品版本 <span className="muted">{track.takes.length}</span>
                </h3>
                <div className="row">
                  <Link
                    className="btn ghost"
                    to={`/library?attach=${encodeURIComponent(track.id)}`}
                  >
                    从作品库添加
                  </Link>
                  <Link
                    className="btn primary"
                    to={`/create?track=${encodeURIComponent(track.id)}`}
                  >
                    创作新版本
                  </Link>
                </div>
              </div>
              {!!track.takes.length && (
                <div className="row between wk-takes-filters">
                  <SegmentedControl
                    size="xs"
                    aria-label="筛选版本"
                    value={preferences.filter}
                    data={[
                      { value: "all", label: "全部" },
                      { value: "up", label: "喜欢" },
                      { value: "unrated", label: "未评价" },
                    ]}
                    onChange={(filter) =>
                      setPreferences({ ...preferences, filter })
                    }
                  />
                  <Select
                    aria-label="版本排序"
                    value={preferences.sort}
                    onChange={(e) =>
                      setPreferences({ ...preferences, sort: e.target.value })
                    }
                  >
                    <option value="added">按添加时间</option>
                    <option value="stars">按星级排序</option>
                    <option value="thumbs">按喜好排序</option>
                  </Select>
                </div>
              )}
              <div className="wk-takes-list">
                {shownTakes.length ? (
                  shownTakes.map((job) => (
                    <TakeRow
                      key={job.id}
                      job={job}
                      track={track}
                      busy={busy}
                      onChanged={changedJob}
                      onChoose={() =>
                        action(
                          () =>
                            api.patchTrack(track.id, {
                              chosen_job_id:
                                track.chosen_job_id === job.id ? null : job.id,
                            }),
                          track.chosen_job_id === job.id
                            ? "已取消定稿"
                            : "已选为定稿",
                        )
                      }
                      onRemove={() =>
                        setConfirm({
                          title: "从曲目移除版本",
                          description: `移除「${titleOf(job)}」的关联与此曲目中的评价，音乐文件仍保留。`,
                          action: () => api.detachTake(job.id),
                        })
                      }
                    />
                  ))
                ) : (
                  <EmptyState
                    title={
                      track.takes.length
                        ? "没有符合条件的版本"
                        : "还没有作品版本"
                    }
                    description={
                      track.takes.length
                        ? "切换筛选条件查看其他版本。"
                        : "添加已有作品后，可以试听、评分并选定稿。"
                    }
                  />
                )}
              </div>
            </>
          ) : (
            <EmptyState
              title="先添加一首曲目"
              description="每首曲目可以关联多个作品版本。"
            />
          )}
        </section>
      </div>
      <div className="row between wk-project-footer">
        <span className="small muted">更新于 {when(project.updated_at)}</span>
        <Button
          variant="ghost"
          className="wk-danger-text"
          disabled={busy}
          onClick={() =>
            setConfirm({
              title: `删除项目「${project.name}」`,
              description: "项目与曲目关联会移除，音乐文件仍保留。",
              action: async () => {
                await api.removeProject(id);
                navigate("/projects");
              },
            })
          }
        >
          删除项目
        </Button>
      </div>
      {edit && (
        <Dialog
          title={edit.kind === "project" ? "编辑项目" : "重命名曲目"}
          onClose={() => {
            if (!busy) setEdit(null);
          }}
        >
          <form className="stack" onSubmit={saveEdit}>
            <label className="field">
              <span>名称</span>
              <Input
                autoFocus
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                maxLength={200}
                required
              />
            </label>
            {edit.kind === "project" && (
              <label className="field">
                <span>项目简介</span>
                <Textarea
                  value={edit.description}
                  onChange={(e) =>
                    setEdit({ ...edit, description: e.target.value })
                  }
                  maxLength={2000}
                  rows={4}
                />
              </label>
            )}
            <div className="row wk-dialog-actions">
              <Button
                variant="ghost"
                type="button"
                disabled={busy}
                onClick={() => setEdit(null)}
              >
                取消
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={busy || !edit.name.trim()}
              >
                {busy ? "保存中…" : "保存修改"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {confirm && (
        <Confirm
          value={confirm}
          busy={busy}
          onClose={() => setConfirm(null)}
          onConfirm={executeConfirm}
        />
      )}
    </div>
  );
}
