import { useEffect, useState } from "react";
import { Copy, Link2, Share2 } from "lucide-react";
import type { Job } from "../lib/types";
import { titleOf } from "../lib/utils";
import { songDownload } from "../lib/shareSong";
import { useApp } from "../state/app";
import { Artwork, Button, Dialog } from "./ui";
import "./ShareSongDialog.css";

export function ShareSongDialog({
  job,
  onClose,
}: {
  job: Job;
  onClose: () => void;
}) {
  const mp3 = Boolean(useApp((s) => s.status?.ffmpeg));
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const download = songDownload(job, mp3);
  // 分享链接：落地页 /s/{id} 带 OpenGraph 卡片（微信/QQ/Telegram 识别为卡片）
  const shareUrl = `${location.origin}/s/${job.id}`;

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${titleOf(job)} · AI乐之城`,
          text: titleOf(job),
          url: shareUrl,
        });
        onClose();
      } else {
        await copyLink();
      }
    } catch (cause: any) {
      if (cause?.name !== "AbortError") toast("分享未完成，可直接复制链接。", "error");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast("链接已复制，去微信粘贴发送吧。", "ok");
      onClose();
    } catch {
      toast("复制失败，请长按链接手动复制。", "error");
    }
  }

  return (
    <Dialog title="分享音乐" onClose={onClose}>
      <div className="song-share-summary">
        <Artwork job={job} size={64} />
        <strong>{titleOf(job)}</strong>
      </div>
      <p className="song-share-note">
        发送链接给朋友，微信/Telegram 里会显示成歌曲卡片。
      </p>
      <div className="song-share-link">
        <Link2 size={15} />
        <span>{shareUrl}</span>
        <button className="song-share-copy" onClick={() => void copyLink()} aria-label="复制链接">
          <Copy size={14} />
        </button>
      </div>
      <div className="song-share-actions">
        <Button variant="primary" disabled={busy} onClick={() => void share()}>
          <Share2 size={17} />
          {busy ? "正在分享…" : "分享"}
        </Button>
        <a
          className="btn"
          href={download.url}
          download={download.name}
        >
          下载音频
        </a>
      </div>
    </Dialog>
  );
}
