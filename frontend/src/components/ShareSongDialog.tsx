import { useEffect, useState } from "react";
import { Download, Share2 } from "lucide-react";
import type { Job } from "../lib/types";
import { titleOf } from "../lib/utils";
import { canShareSong, prepareSongShare, songDownload } from "../lib/shareSong";
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
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(
    Boolean(navigator.share && navigator.canShare),
  );
  const download = songDownload(job, mp3);
  useEffect(() => {
    const controller = new AbortController();
    setFile(null);
    setError("");
    if (!navigator.share || !navigator.canShare) {
      setPreparing(false);
      return () => controller.abort();
    }
    setPreparing(true);
    prepareSongShare(job, mp3, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setFile(next);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("暂时无法打开系统分享，可以下载后发送。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreparing(false);
      });
    return () => controller.abort();
  }, [job.id, mp3]);

  async function share() {
    if (!file || !canShareSong(file)) return;
    setBusy(true);
    setError("");
    try {
      // The file is prepared before this click so Safari retains user activation.
      await navigator.share({ files: [file], title: titleOf(job) });
      onClose();
    } catch (cause: any) {
      if (cause?.name !== "AbortError")
        setError("分享未完成，可以下载后发送。");
    } finally {
      setBusy(false);
    }
  }

  const systemShare = file && canShareSong(file);
  return (
    <Dialog title="分享音乐" onClose={onClose}>
      <div className="song-share-summary">
        <Artwork job={job} size={64} />
        <strong>{titleOf(job)}</strong>
      </div>
      {(preparing || (!systemShare && !error)) && (
        <p className="song-share-note" role="status">
          {preparing
            ? "正在准备音频…"
            : "当前浏览器不支持直接分享，请下载音频。"}
        </p>
      )}
      {error && (
        <p className="song-share-error" role="alert">
          {error}
        </p>
      )}
      <div className="song-share-actions">
        {systemShare && (
          <Button variant="primary" disabled={busy} onClick={share}>
            <Share2 size={17} />
            {busy ? "正在分享…" : "选择分享方式"}
          </Button>
        )}
        <a
          className={`btn ${systemShare ? "" : "primary"}`}
          href={download.url}
          download={download.name}
        >
          <Download size={17} />
          下载音频
        </a>
      </div>
    </Dialog>
  );
}
