import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Avatar,
  Loader,
  Modal,
  MultiSelect,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  ArrowDown,
  ArrowUp,
  Disc3,
  Globe2,
  Send,
  UserRound,
  X,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { Job } from "../lib/types";
import { notifyPlazaUpdated, plazaApi, type PlazaAlbum } from "../lib/plaza";
import {
  duration,
  errorMessage,
  readStore,
  removeStore,
  titleOf,
  writeStore,
} from "../lib/utils";
import { useApp } from "../state/app";
import { Artwork, Button, EmptyState, IconButton } from "./ui";
import "./AlbumPublishDialog.css";

type AlbumDraft = { title: string; caption: string; job_ids: string[] };
const playable = (job?: Job): job is Job =>
  Boolean(job?.status === "done" && job.artifacts?.audio);
function initialDraft(album?: PlazaAlbum): AlbumDraft {
  const saved = readStore<Partial<AlbumDraft> | null>(
    `plaza.album.draft.${album?.id || "new"}`,
    null,
  );
  return {
    title: typeof saved?.title === "string" ? saved.title : album?.title || "",
    caption:
      typeof saved?.caption === "string" ? saved.caption : album?.caption || "",
    job_ids:
      Array.isArray(saved?.job_ids) &&
      saved.job_ids.every((id) => typeof id === "string")
        ? [...new Set(saved.job_ids)].slice(0, 50)
        : [...(album?.job_ids || [])],
  };
}

export function AlbumPublishDialog({
  album,
  onClose,
  onPublished,
}: {
  album?: PlazaAlbum;
  onClose: () => void;
  onPublished?: (album: PlazaAlbum) => void;
}) {
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState<AlbumDraft>(() => initialDraft(album));
  const draftRef = useRef(draft);
  const [jobs, setJobs] = useState<Job[]>(album?.tracks || []);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [resolutionError, setResolutionError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const loadingRef = useRef(false);
  const savingRef = useRef(false);
  const draftKey = `plaza.album.draft.${album?.id || "new"}`;
  const identity = album?.id || "new";
  const identityRef = useRef(identity);
  identityRef.current = identity;

  function changeDraft(patch: Partial<AlbumDraft>) {
    if (savingRef.current) return;
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    writeStore(draftKey, next);
    setSaveError("");
  }

  async function loadJobs(nextOffset = 0, resolveSelection = false) {
    if (loadingRef.current) return;
    const requestEpoch = epoch.current;
    loadingRef.current = true;
    setLoading(true);
    setCatalogError("");
    if (resolveSelection) {
      setResolving(true);
      setResolutionError("");
    }
    const current = () => mounted.current && requestEpoch === epoch.current;
    try {
      const result: { jobs: Job[]; total: number } = await api.jobs({
        status: "done",
        offset: nextOffset,
        limit: 100,
      });
      if (!current()) return;
      setJobs((previous) => [
        ...new Map(
          [...previous, ...result.jobs].map((job) => [job.id, job]),
        ).values(),
      ]);
      setTotal(result.total);
      setOffset(nextOffset + result.jobs.length);
      if (resolveSelection) {
        // Saved drafts can reference tracks outside the first catalog page.
        const loaded = new Set(result.jobs.map((job) => job.id));
        const ids = draftRef.current.job_ids.filter((id) => !loaded.has(id));
        const results = await Promise.allSettled(
          ids.map((id) => api.job(encodeURIComponent(id))),
        );
        if (!current()) return;
        const resolved: Job[] = [];
        const unavailable = new Set<string>();
        let failure = "";
        results.forEach((result, index) => {
          if (result.status === "fulfilled") resolved.push(result.value.job);
          else if (
            result.reason instanceof ApiError &&
            result.reason.status === 404
          )
            unavailable.add(ids[index]);
          else failure ||= errorMessage(result.reason);
        });
        setJobs((previous) => [
          ...new Map(
            [
              ...previous.filter((job) => !unavailable.has(job.id)),
              ...resolved,
            ].map((job) => [job.id, job]),
          ).values(),
        ]);
        setResolutionError(failure);
      }
    } catch (error) {
      if (current()) setCatalogError(errorMessage(error));
    } finally {
      if (current()) {
        loadingRef.current = false;
        setLoading(false);
        if (resolveSelection) setResolving(false);
      }
    }
  }

  useEffect(() => {
    mounted.current = true;
    epoch.current += 1;
    loadingRef.current = false;
    savingRef.current = false;
    const next = initialDraft(album);
    draftRef.current = next;
    setDraft(next);
    setJobs(album?.tracks || []);
    setOffset(0);
    setTotal(0);
    setSaving(false);
    setSaveError("");
    void loadJobs(0, true);
    return () => {
      mounted.current = false;
      epoch.current += 1;
    };
    // Refreshes of this album must not overwrite edits in progress.
  }, [identity]);

  const byId = new Map(jobs.map((job) => [job.id, job]));
  const available = jobs.filter(playable);
  const missingIds = draft.job_ids.filter((id) => !playable(byId.get(id)));
  const validCount = draft.job_ids.length - missingIds.length;
  const choices = [
    ...available.map((job) => ({ value: job.id, label: titleOf(job) })),
    ...missingIds.map((id) => ({
      value: id,
      label: resolving ? "正在读取曲目…" : "曲目不可用，请移除或替换",
      disabled: true,
    })),
  ];
  const canSave =
    !saving &&
    !resolving &&
    !catalogError &&
    !resolutionError &&
    Boolean(draft.title.trim()) &&
    draft.title.trim().length <= 80 &&
    draft.caption.length <= 600 &&
    validCount >= 2 &&
    draft.job_ids.length <= 50 &&
    !missingIds.length;
  const seconds = draft.job_ids.reduce(
    (sum, id) => sum + Number(byId.get(id)?.timing?.audio_seconds || 0),
    0,
  );

  function moveTrack(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= draft.job_ids.length) return;
    const ordered = [...draft.job_ids];
    [ordered[index], ordered[to]] = [ordered[to], ordered[index]];
    changeDraft({ job_ids: ordered });
  }

  async function publish() {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    const saveEpoch = epoch.current;
    const saveIdentity = identity;
    const body = {
      title: draft.title.trim(),
      caption: draft.caption.trim(),
      job_ids: [...draft.job_ids],
    };
    try {
      const { album: published } = album
        ? await plazaApi.updateAlbum(album.id, body)
        : await plazaApi.createAlbum(body);
      // A newer dialog may have saved another draft while this request finished.
      const stored = readStore<AlbumDraft | null>(draftKey, null);
      if (
        stored?.title === draft.title &&
        stored?.caption === draft.caption &&
        JSON.stringify(stored?.job_ids) === JSON.stringify(draft.job_ids)
      )
        removeStore(draftKey);
      notifyPlazaUpdated(published.id);
      toast(album ? "专辑发布已更新。" : "专辑已发布到本机广场。", "ok");
      if (
        mounted.current &&
        epoch.current === saveEpoch &&
        identityRef.current === saveIdentity
      ) {
        onPublished?.(published);
        onClose();
      }
    } catch (error) {
      if (mounted.current && epoch.current === saveEpoch)
        setSaveError(errorMessage(error));
    } finally {
      if (mounted.current && epoch.current === saveEpoch) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }

  return (
    <Modal
      opened
      onClose={() => {
        if (!savingRef.current) onClose();
      }}
      title={album ? "编辑专辑" : "发布专辑"}
      size={570}
      centered
      zIndex={700}
      closeOnEscape={!saving}
      closeOnClickOutside={!saving}
      closeButtonProps={{ disabled: saving, "aria-label": "关闭专辑发布窗口" }}
      className="album-publish-dialog"
    >
      <div className="album-publish-identity">
        <Avatar size={30} radius="xl" color="green">
          <UserRound size={16} />
        </Avatar>
        <span>
          <strong>本机创作者</strong>
          <small>本机身份 · 尚未连接在线账号</small>
        </span>
      </div>
      <TextInput
        label="专辑名称"
        placeholder="为这张专辑起个名字"
        required
        maxLength={80}
        value={draft.title}
        disabled={saving}
        onChange={(event) => changeDraft({ title: event.currentTarget.value })}
      />
      <div>
        <MultiSelect
          label="专辑曲目"
          description="选择 2–50 首作品，第一首的封面将作为专辑封面。"
          placeholder="搜索并选择已完成的作品"
          searchable
          clearable
          data={choices}
          value={draft.job_ids}
          maxValues={50}
          disabled={saving}
          onChange={(job_ids) => changeDraft({ job_ids })}
          nothingFoundMessage={loading ? "正在读取作品…" : "没有更多可用作品"}
          rightSection={loading ? <Loader size={14} /> : undefined}
          comboboxProps={{ withinPortal: true, zIndex: 750 }}
        />
        {loading && (
          <div className="album-publish-loading" role="status">
            <Loader size={12} />
            正在读取作品…
          </div>
        )}
        {(catalogError || resolutionError) && (
          <div className="error-box" role="alert">
            <span>{catalogError || resolutionError}</span>
            <Button
              disabled={loading || saving}
              onClick={() => loadJobs(0, true)}
            >
              重试
            </Button>
          </div>
        )}
        {offset < total && (
          <Button
            variant="ghost"
            disabled={loading || saving}
            onClick={() => loadJobs(offset)}
          >
            加载更多作品 · {offset} / {total}
          </Button>
        )}
        {!loading && !catalogError && !available.length && (
          <EmptyState
            title="还没有可加入专辑的作品"
            description="先完成至少两首作品，再一起发布。"
          >
            <Link to="/create" className="btn" onClick={onClose}>
              开始创作
            </Link>
          </EmptyState>
        )}
      </div>
      {draft.job_ids.length > 0 && (
        <div className="album-publish-tracks">
          <div className="album-publish-track-heading">
            <strong>曲目顺序</strong>
            <span>
              {validCount} 首 · {duration(seconds)}
            </span>
          </div>
          {!resolving && missingIds.length > 0 && (
            <p className="album-publish-unavailable" role="status">
              {missingIds.length}{" "}
              首曲目已删除或暂时无法播放，请移除或替换后发布。
            </p>
          )}
          <ol aria-label="专辑曲目顺序">
            {draft.job_ids.map((id, index) => {
              const track = byId.get(id);
              const name = playable(track)
                ? titleOf(track)
                : resolving
                  ? "正在读取曲目…"
                  : "不可用的曲目";
              return (
                <li
                  key={id}
                  className={playable(track) ? "" : "is-unavailable"}
                >
                  <span className="album-publish-track-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {playable(track) ? (
                    <Artwork job={track} size={38} />
                  ) : (
                    <span className="album-publish-track-placeholder">
                      <Disc3 size={18} />
                    </span>
                  )}
                  <div className="album-publish-track-title">
                    <strong title={name}>{name}</strong>
                    <span>
                      {playable(track)
                        ? `${duration(track.timing?.audio_seconds)}${index === 0 ? " · 专辑封面" : ""}`
                        : "选择其他作品替换"}
                    </span>
                  </div>
                  <div className="album-publish-track-actions">
                    <IconButton
                      label={`上移第 ${index + 1} 首曲目`}
                      disabled={saving || index === 0}
                      onClick={() => moveTrack(index, -1)}
                    >
                      <ArrowUp size={14} />
                    </IconButton>
                    <IconButton
                      label={`下移第 ${index + 1} 首曲目`}
                      disabled={saving || index === draft.job_ids.length - 1}
                      onClick={() => moveTrack(index, 1)}
                    >
                      <ArrowDown size={14} />
                    </IconButton>
                    <IconButton
                      label={`移除第 ${index + 1} 首曲目`}
                      disabled={saving}
                      onClick={() =>
                        changeDraft({
                          job_ids: draft.job_ids.filter((item) => item !== id),
                        })
                      }
                    >
                      <X size={14} />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ol>
          {validCount < 2 && (
            <p className="album-publish-selection-hint">
              再选择 {2 - validCount} 首可播放的作品，即可组成专辑。
            </p>
          )}
        </div>
      )}
      <div>
        <Textarea
          label="专辑说明"
          placeholder="关于这张专辑的故事…"
          minRows={3}
          maxRows={6}
          autosize
          maxLength={600}
          value={draft.caption}
          disabled={saving}
          onChange={(event) =>
            changeDraft({ caption: event.currentTarget.value })
          }
        />
        <div className="album-publish-character-count">
          {draft.caption.length} / 600
        </div>
      </div>
      <div className="album-publish-scope">
        <Globe2 size={15} />
        <span>
          <strong>本机广场预览</strong>当前仅保存在这台电脑，不会上传到互联网。
        </span>
      </div>
      {saveError && (
        <div className="error-box" role="alert">
          {saveError}
        </div>
      )}
      <div className="dialog-actions">
        <Button disabled={saving} onClick={onClose}>
          取消
        </Button>
        <Button variant="primary" disabled={!canSave} onClick={publish}>
          {saving ? (
            <Loader size={14} color="currentColor" />
          ) : (
            <Send size={14} />
          )}
          {saving ? "正在保存…" : album ? "保存专辑" : "发布专辑"}
        </Button>
      </div>
    </Modal>
  );
}
