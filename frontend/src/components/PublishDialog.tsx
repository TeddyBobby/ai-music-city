import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar, Loader, Modal, Select, Textarea } from "@mantine/core";
import { Globe2, Send, UserRound } from "lucide-react";
import { api } from "../lib/api";
import type { Job } from "../lib/types";
import { notifyPlazaUpdated, plazaApi, type PlazaPost } from "../lib/plaza";
import {
  duration,
  errorMessage,
  readStore,
  removeStore,
  titleOf,
  writeStore,
} from "../lib/utils";
import { useApp } from "../state/app";
import { Artwork, Button, EmptyState } from "./ui";
import "./PublishDialog.css";

export function PublishDialog({
  job,
  onClose,
  onPublished,
}: {
  job?: Job;
  onClose: () => void;
  onPublished?: (post: PlazaPost) => void;
}) {
  const toast = useApp((s) => s.toast);
  const [jobs, setJobs] = useState<Job[]>(job ? [job] : []);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(job?.id || "");
  const [caption, setCaption] = useState("");
  const [existing, setExisting] = useState<PlazaPost | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(!job);
  const [loadingPost, setLoadingPost] = useState(Boolean(job));
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function loadJobs(offset = 0) {
    setLoadingJobs(true);
    setCatalogError("");
    try {
      const result = await api.jobs({ status: "done", offset, limit: 100 });
      if (!mounted.current) return;
      setJobs((previous) =>
        offset ? [...previous, ...result.jobs] : result.jobs,
      );
      setTotal(result.total);
    } catch (e) {
      if (mounted.current) setCatalogError(errorMessage(e));
    } finally {
      if (mounted.current) setLoadingJobs(false);
    }
  }
  useEffect(() => {
    if (!job) void loadJobs();
  }, [job?.id]);
  useEffect(() => {
    let live = true;
    setExisting(null);
    setCaption("");
    setError("");
    if (!selected) {
      setLoadingPost(false);
      return;
    }
    setLoadingPost(true);
    plazaApi
      .get(selected)
      .then(({ post }) => {
        if (!live) return;
        setExisting(post);
        setCaption(
          readStore<string | null>(`plaza.draft.${selected}`, null) ??
            post?.caption ??
            "",
        );
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      })
      .finally(() => {
        if (live) setLoadingPost(false);
      });
    return () => {
      live = false;
    };
  }, [selected, retry]);

  const chosen = jobs.find((item) => item.id === selected);
  const choices = jobs
    .filter((item) => item.artifacts.audio)
    .map((item) => ({ value: item.id, label: titleOf(item) }));
  async function publish() {
    if (!chosen || loadingPost || saving || error || caption.length > 600)
      return;
    setSaving(true);
    try {
      const { post } = await plazaApi.publish(chosen.id, caption.trim());
      removeStore(`plaza.draft.${chosen.id}`);
      notifyPlazaUpdated(chosen.id);
      toast(existing ? "发布内容已更新。" : "已发布到音乐广场。", "ok");
      if (mounted.current) {
        onPublished?.(post);
        onClose();
      }
    } catch (e) {
      if (mounted.current) toast(errorMessage(e), "err");
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <Modal
      opened
      onClose={() => {
        if (!saving) onClose();
      }}
      title={existing ? "编辑单曲发布" : "发布单曲"}
      size={490}
      centered
      zIndex={700}
      closeOnEscape={!saving}
      closeOnClickOutside={!saving}
      closeButtonProps={{ disabled: saving, "aria-label": "关闭发布窗口" }}
      className="publish-dialog"
    >
      <div className="publish-identity">
        <Avatar size={30} radius="xl" color="green">
          <UserRound size={16} />
        </Avatar>
        <span>
          <strong>创作者</strong>
          <small>登录后显示昵称</small>
        </span>
      </div>
      {!job && (
        <Select
          label="选择单曲"
          placeholder="选择一首已完成的作品"
          searchable
          nothingFoundMessage={
            loadingJobs ? "正在读取作品…" : "没有可发布的作品"
          }
          data={choices}
          value={selected || null}
          onChange={(value) => setSelected(value || "")}
          disabled={saving}
          rightSection={loadingJobs ? <Loader size={14} /> : undefined}
          comboboxProps={{ withinPortal: true, zIndex: 750 }}
        />
      )}
      {catalogError && (
        <div className="error-box" role="alert">
          {catalogError}
          <Button onClick={() => loadJobs(jobs.length)}>重试</Button>
        </div>
      )}
      {!job && jobs.length < total && (
        <Button
          variant="ghost"
          disabled={loadingJobs}
          onClick={() => loadJobs(jobs.length)}
        >
          加载更多作品 · {jobs.length} / {total}
        </Button>
      )}
      {!job && !loadingJobs && !catalogError && !choices.length && (
        <EmptyState
          title="还没有可发布的音乐"
          description="完成一首作品后，就可以发布到这里。"
        >
          <Link to="/create" className="btn" onClick={onClose}>
            开始创作
          </Link>
        </EmptyState>
      )}
      {chosen && (
        <div className="publish-song-preview">
          <Artwork job={chosen} size={62} />
          <div>
            <strong>{titleOf(chosen)}</strong>
            <span>
              {duration(chosen.timing?.audio_seconds)} · 使用当前作品封面
            </span>
          </div>
        </div>
      )}
      {loadingPost && (
        <div className="publish-loading" role="status">
          <Loader size={14} />
          正在读取发布信息…
        </div>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
          <Button onClick={() => setRetry((n) => n + 1)}>重试</Button>
        </div>
      )}
      <Textarea
        label="发布说明"
        description="聊聊灵感、想表达的心情，或留一句话。"
        placeholder="这首歌背后的故事…"
        minRows={4}
        maxRows={7}
        autosize
        maxLength={600}
        disabled={!chosen || saving || loadingPost || Boolean(error)}
        value={caption}
        onChange={(e) => {
          const value = e.currentTarget.value;
          setCaption(value);
          writeStore(`plaza.draft.${selected}`, value);
        }}
      />
      <div className="publish-character-count">{caption.length} / 600</div>
      <div className="publish-scope">
        <Globe2 size={15} />
        <span>
          <strong>广场预览</strong>发布后对访问者可见。
        </span>
      </div>
      <div className="dialog-actions">
        <Button disabled={saving} onClick={onClose}>
          取消
        </Button>
        <Button
          variant="primary"
          disabled={
            !chosen ||
            saving ||
            loadingPost ||
            Boolean(error) ||
            caption.length > 600
          }
          onClick={publish}
        >
          <Send size={14} />
          {saving ? "正在保存…" : existing ? "保存发布" : "确认发布"}
        </Button>
      </div>
    </Modal>
  );
}
