import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Slider, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  ChevronDown,
  Disc3,
  Download,
  ListMusic,
  Pause,
  Play,
  Share2,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { api } from "../lib/api";
import { songDownload } from "../lib/shareSong";
import type { Job } from "../lib/types";
import { duration, titleOf, errorMessage } from "../lib/utils";
import { useApp } from "../state/app";
import { usePlayer } from "../state/player";
import { Artwork, Button, EmptyState, IconButton } from "../components/ui";
import { SyncedLyrics } from "../components/SyncedLyrics";
import { LyricPreview } from "../components/LyricPreview";
import { ShareSongDialog } from "../components/ShareSongDialog";
import { useLyricsAlignment } from "../hooks/useLyricsAlignment";
import "./Player.css";
import "./SimplePlayer.css";

export function PlayerPage({
  jobId,
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
  const p = usePlayer();
  const mp3 = Boolean(useApp((s) => s.status?.ffmpeg));
  const mobile = useMediaQuery("(max-width: 760px)");
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const { alignment, requestAlignment } = useLyricsAlignment(job);

  useEffect(() => {
    let live = true;
    setJob(null);
    setError("");
    setShowLyrics(false);
    api
      .job(jobId)
      .then((data) => {
        if (live) setJob(data.job);
      })
      .catch((cause) => {
        if (live) setError(errorMessage(cause));
      });
    return () => {
      live = false;
    };
  }, [jobId]);
  useEffect(() => {
    onDialogChange?.(sharing);
    return () => onDialogChange?.(false);
  }, [sharing, onDialogChange]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            'input,textarea,select,button,a,[role=slider],[role=textbox],[role=combobox],[contenteditable]:not([contenteditable="false"])',
          ))
      )
        return;
      if (
        event.code === "Space" &&
        job?.status === "done" &&
        job.artifacts?.audio &&
        !sharing
      ) {
        event.preventDefault();
        if (p.current?.id === job.id) p.toggle();
        else p.play([job]);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [job, p.current?.id, p.toggle, p.play, sharing]);

  if (error)
    return (
      <EmptyState title="暂时无法读取音乐" description={error}>
        <Button onClick={onClose}>返回</Button>
      </EmptyState>
    );
  if (!job)
    return (
      <div className="player-loading">
        <IconButton label="收起播放器" onClick={onClose}>
          <ChevronDown size={20} />
        </IconButton>
        <div className="empty-state">正在加载…</div>
      </div>
    );

  const current = p.current?.id === job.id;
  const playing = current && p.playing;
  const time = current ? p.time : 0;
  const length = (current ? p.duration : 0) || job.timing?.audio_seconds || 0;
  const canPlay = job.status === "done" && Boolean(job.artifacts?.audio);
  const download = songDownload(job, mp3);
  const seek = (seconds: number) => p.seekTo(job, seconds);
  const lyrics = (
    <SyncedLyrics
      alignment={alignment}
      onAlign={requestAlignment}
      key={job.id}
      lyrics={job.params?.lyrics || ""}
      time={time}
      duration={length}
      seekable={canPlay}
      onSeek={seek}
      active={entered && !sharing}
    />
  );

  return (
    <div
      className="listening-page simple-listening"
      data-view={mobile && showLyrics ? "lyrics" : "cover"}
    >
      <header className="listening-top">
        <UnstyledButton
          className="player-collapse"
          onClick={onClose}
          aria-label="收起播放器"
          title={desktop ? "收起（Esc）" : undefined}
          aria-keyshortcuts={desktop ? "Escape" : undefined}
          data-autofocus
        >
          <ChevronDown size={22} />
          <span>收起</span>
        </UnstyledButton>
        {mobile ? (
          <IconButton
            className="player-view-toggle"
            label={showLyrics ? "返回封面" : "切换到歌词"}
            onClick={() => setShowLyrics((value) => !value)}
          >
            {showLyrics ? <Disc3 size={20} /> : <ListMusic size={20} />}
          </IconButton>
        ) : (
          <span className="simple-listening-top-spacer" aria-hidden="true" />
        )}
      </header>
      {!canPlay && (
        <div className="listening-notice" role="status">
          {job.status === "failed"
            ? "生成未完成"
            : job.status === "cancelled"
              ? "生成已取消"
              : "音乐正在生成…"}
          <Link to={`/library?job=${job.id}`} onClick={onClose}>
            查看进度
          </Link>
        </div>
      )}
      <div className="listening-layout">
        <section className="listening-record">
          <div className="simple-listening-media">
            {mobile && showLyrics ? (
              lyrics
            ) : (
              <Artwork job={job} className="simple-listening-cover" />
            )}
          </div>
          <div className="record-transport">
            {(!mobile || !showLyrics) && (
              <div className="record-info">
                <h1>{titleOf(job)}</h1>
              </div>
            )}
            {mobile && !showLyrics && (
              <LyricPreview
                lyrics={job.params?.lyrics || ""}
                alignment={alignment}
                time={time}
                duration={length}
                onExpand={() => setShowLyrics(true)}
              />
            )}
            <div className="record-progress">
              <Slider
                min={0}
                max={length || 1}
                step={0.1}
                value={Math.min(time, length || 0)}
                disabled={!canPlay}
                label={duration}
                thumbLabel="歌曲播放进度"
                onChange={seek}
                size={4}
                thumbSize={12}
              />
              <div>
                <time>{duration(time)}</time>
                <time>{duration(length)}</time>
              </div>
            </div>
            <div className="record-controls">
              <IconButton label="上一首" onClick={p.prev} disabled={!current}>
                <SkipBack size={23} fill="currentColor" />
              </IconButton>
              <IconButton
                className="record-play"
                label={playing ? "暂停歌曲" : "播放歌曲"}
                title={
                  desktop ? `${playing ? "暂停" : "播放"}（空格）` : undefined
                }
                aria-keyshortcuts={desktop ? "Space" : undefined}
                disabled={!canPlay}
                onClick={() => (current ? p.toggle() : p.play([job]))}
              >
                {playing ? (
                  <Pause size={25} fill="currentColor" />
                ) : (
                  <Play size={25} fill="currentColor" />
                )}
              </IconButton>
              <IconButton
                label="下一首"
                onClick={p.next}
                disabled={!current || p.queue.length < 2}
              >
                <SkipForward size={23} fill="currentColor" />
              </IconButton>
            </div>
            <div className="record-volume">
              <IconButton
                label={p.volume ? "静音" : "取消静音"}
                onClick={() => p.setVolume(p.volume ? 0 : 0.7)}
              >
                {p.volume ? <Volume2 size={17} /> : <VolumeX size={17} />}
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
                thumbSize={10}
              />
            </div>
            {canPlay && (
              <div className="simple-listening-actions">
                <a href={download.url} download={download.name}>
                  <Download size={18} />
                  下载
                </a>
                <button onClick={() => setSharing(true)}>
                  <Share2 size={18} />
                  分享
                </button>
              </div>
            )}
          </div>
        </section>
        {!mobile && (
          <section className="listening-lyrics" aria-label="歌曲歌词">
            {lyrics}
          </section>
        )}
      </div>
      {sharing && (
        <ShareSongDialog job={job} onClose={() => setSharing(false)} />
      )}
    </div>
  );
}
