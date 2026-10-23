import { useEffect, useState } from "react";
import { Popover, Slider, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  ListMusic,
  Maximize2,
  X,
} from "lucide-react";
import { usePlayer } from "../state/player";
import { usePlayerOverlay } from "../state/playerOverlay";
import { Artwork, IconButton } from "./ui";
import { duration, titleOf } from "../lib/utils";
import "../pages/Player.css";

export function PlayerBar() {
  const p = usePlayer(),
    expand = usePlayerOverlay((s) => s.open),
    fullscreenOpen = usePlayerOverlay((s) => s.opened),
    [queueOpen, setQueueOpen] = useState(false);
  const desktop = useMediaQuery("(min-width: 1024px)");
  useEffect(() => {
    if (!desktop || fullscreenOpen || !p.current) return;
    const key = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        document.querySelector('[role="dialog"], [aria-modal="true"]') ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, button, a, [role="button"], [role="slider"], [role="textbox"], [role="combobox"], [role="menu"], [role="listbox"], [contenteditable]:not([contenteditable="false"])',
          ))
      )
        return;
      event.preventDefault();
      p.toggle();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [desktop, fullscreenOpen, p.current?.id, p.toggle]);
  // Keep hooks unconditional when the playback queue is restored or cleared.
  if (!p.current && !p.queue.length) return null;
  function openPlayer() {
    setQueueOpen(false);
    expand();
  }
  return (
    <footer className="player-dock" aria-label="全局播放器">
      <div className="dock-track">
        <UnstyledButton
          className="dock-cover-trigger"
          onClick={openPlayer}
          disabled={!p.current}
          aria-label="展开全屏播放器"
        >
          <Artwork job={p.current} size={44} />
          <span className="dock-cover-expand">
            <Maximize2 size={17} />
          </span>
        </UnstyledButton>
        <div>
          <UnstyledButton
            onClick={openPlayer}
            disabled={!p.current}
            className="dock-title"
            aria-label={
              p.current ? `展开全屏播放器：${titleOf(p.current)}` : undefined
            }
          >
            {p.current ? titleOf(p.current) : "未选择歌曲"}
          </UnstyledButton>
        </div>
      </div>
      <div className="dock-main">
        <div className="dock-controls">
          <IconButton label="上一首" onClick={p.prev} disabled={!p.current}>
            <SkipBack size={16} />
          </IconButton>
          <IconButton
            className="dock-play"
            label={p.playing ? "暂停" : "播放"}
            title={
              desktop ? `${p.playing ? "暂停" : "播放"}（空格）` : undefined
            }
            aria-keyshortcuts={desktop ? "Space" : undefined}
            disabled={!p.current}
            onClick={p.toggle}
          >
            {p.playing ? (
              <Pause size={16} fill="currentColor" />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
          </IconButton>
          <IconButton
            label="下一首"
            onClick={p.next}
            disabled={!p.current || p.queue.length < 2}
          >
            <SkipForward size={16} />
          </IconButton>
        </div>
        <div className="dock-progress">
          <time>{duration(p.time)}</time>
          <Slider
            className="dock-seek-slider"
            thumbLabel="播放进度"
            min={0}
            max={p.duration || 1}
            step={0.1}
            value={Math.min(p.time, p.duration || 0)}
            onChange={p.seek}
            disabled={!p.current}
            label={duration}
            size={3}
            thumbSize={9}
          />
          <time>{duration(p.duration)}</time>
        </div>
      </div>
      <div className="dock-tools">
        <IconButton
          label={p.volume ? "静音" : "取消静音"}
          onClick={() => p.setVolume(p.volume ? 0 : 0.7)}
        >
          {p.volume ? <Volume2 size={17} /> : <VolumeX size={17} />}
        </IconButton>
        <Slider
          className="dock-volume-slider"
          thumbLabel="音量"
          min={0}
          max={1}
          step={0.01}
          value={p.volume}
          onChange={p.setVolume}
          label={(value) => `${Math.round(value * 100)}%`}
          size={3}
          thumbSize={9}
        />
        <Popover
          opened={queueOpen}
          onChange={setQueueOpen}
          position="top-end"
          withArrow
          shadow="lg"
          width={340}
          zIndex={200}
          trapFocus
          returnFocus
        >
          <Popover.Target>
            <IconButton
              label="播放队列"
              aria-expanded={queueOpen}
              className={queueOpen ? "active" : ""}
              onClick={() => setQueueOpen(!queueOpen)}
            >
              <ListMusic size={18} />
            </IconButton>
          </Popover.Target>
          <Popover.Dropdown className="dock-queue-popover">
            <div className="row between">
              <h3>
                播放队列 <small>{p.queue.length}</small>
              </h3>
              <IconButton
                label="关闭播放队列"
                onClick={() => setQueueOpen(false)}
              >
                <X size={16} />
              </IconButton>
            </div>
            {p.queue.length ? (
              p.queue.map((j, i) => (
                <UnstyledButton
                  key={`${j.id}-${i}`}
                  className={`queue-track ${i === p.index ? "active" : ""}`}
                  onClick={() => p.play(p.queue, i)}
                >
                  <span className="small muted">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{titleOf(j)}</span>
                  {i === p.index && p.playing ? (
                    <span className="playing-bars">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    <time>{duration(j.timing?.audio_seconds)}</time>
                  )}
                </UnstyledButton>
              ))
            ) : (
              <p className="muted">队列为空</p>
            )}
          </Popover.Dropdown>
        </Popover>
        <IconButton
          label="展开全屏播放器"
          className="dock-expand"
          onClick={openPlayer}
          disabled={!p.current}
        >
          <Maximize2 size={16} />
        </IconButton>
      </div>
    </footer>
  );
}
