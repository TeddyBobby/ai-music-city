import { useRef, useState, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { UnstyledButton } from "@mantine/core";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ImagePlus,
  Music2,
} from "lucide-react";
import type { Job } from "../lib/types";
import { lyricLines, swipeTarget } from "../lib/playerMedia";
import { useApp } from "../state/app";
import { Artwork, IconButton } from "./ui";
import "./PlayerMedia.css";

type MediaView = "cover" | "lyrics";
type Gesture = {
  id: number;
  x: number;
  y: number;
  horizontal: boolean;
};

export function PlayerMedia({
  job,
  playing,
  onClose,
}: {
  job: Job;
  playing: boolean;
  onClose: () => void;
}) {
  const [view, setView] = useState<MediaView>("cover");
  const [drag, setDrag] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const toast = useApp((s) => s.toast);
  const lines = lyricLines(job.params?.lyrics || "");

  function show(next: MediaView) {
    if (next === view) return;
    // Moving the focused slide offscreen must not leave focus inside inert content.
    const focused = document.activeElement;
    if (
      focused &&
      viewport.current?.parentElement?.contains(focused) &&
      (focused.closest("[data-media-slide]") ||
        focused.matches(".player-media-navigation > .icon-btn"))
    ) {
      viewport.current.focus({ preventScroll: true });
    }
    setView(next);
  }

  function start(e: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    if (
      !e.isPrimary ||
      e.button !== 0 ||
      (e.pointerType === "mouse" && view === "lyrics") ||
      (e.target instanceof Element &&
        e.target.closest(
          "a,button:not(.player-media-cover-button),input,textarea,select,[role=slider]",
        ))
    )
      return;
    gesture.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      horizontal: false,
    };
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    if (!g.horizontal) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      // Once a vertical scroll begins, it cannot turn into a page swipe.
      if (Math.abs(dy) >= Math.abs(dx)) {
        gesture.current = null;
        suppressClick.current = true;
        return;
      }
      if (Math.abs(dx) < Math.abs(dy) * 1.4) return;
      g.horizontal = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
    suppressClick.current = true;
    const outward =
      (view === "cover" && dx > 0) || (view === "lyrics" && dx < 0);
    const limit = e.currentTarget.clientWidth * 0.7;
    setDrag(Math.max(-limit, Math.min(limit, dx)) * (outward ? 0.15 : 1));
  }

  function finish(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    gesture.current = null;
    setDrag(0);
    if (!g || g.id !== e.pointerId) return;
    const next = swipeTarget(view, e.clientX - g.x, e.clientY - g.y);
    if (g.horizontal && next) show(next);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return (
    <div className="player-media" data-media-view={view}>
      <div
        ref={viewport}
        className={`player-media-viewport ${playing ? "is-playing" : ""}`}
        role="region"
        aria-roledescription="轮播"
        aria-label="封面与歌词，使用左右方向键切换"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            e.stopPropagation();
            show(e.key === "ArrowLeft" ? "cover" : "lyrics");
          }
        }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={() => {
          gesture.current = null;
          suppressClick.current = false;
          setDrag(0);
        }}
        onLostPointerCapture={() => {
          gesture.current = null;
          setDrag(0);
        }}
        onDragStart={(e) => e.preventDefault()}
        onClickCapture={(e) => {
          if (suppressClick.current && e.detail > 0) {
            e.preventDefault();
            e.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        <div
          className="player-media-track"
          data-dragging={drag !== 0 || undefined}
          style={{
            transform: `translateX(calc(${view === "lyrics" ? "-50%" : "0%"} + ${drag}px))`,
          }}
        >
          <div
            className="player-media-slide player-media-cover"
            data-media-slide
            role="group"
            aria-label="封面，1 / 2"
            aria-hidden={view !== "cover"}
            inert={view !== "cover"}
          >
            <UnstyledButton
              className="player-media-cover-button"
              aria-label="查看歌词"
              onClick={() => show("lyrics")}
            >
              <Artwork job={job} />
            </UnstyledButton>
            <Link
              to={`/assistant?mode=cover&song=${job.id}`}
              onClick={onClose}
              className="record-cover-edit"
              aria-label="生成或更换封面"
            >
              <ImagePlus size={15} />
              更换封面
            </Link>
          </div>
          <div
            className="player-media-slide player-media-lyrics"
            data-media-slide
            role="group"
            aria-label="歌词，2 / 2"
            aria-hidden={view !== "lyrics"}
            inert={view !== "lyrics"}
          >
            <header className="player-lyrics-header">
              <span>歌词</span>
              {lines.length > 0 && (
                <IconButton
                  label="复制歌词"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        job.params?.lyrics || "",
                      );
                      toast("歌词已复制。", "ok");
                    } catch {
                      toast("复制失败，可手动选择歌词。", "err");
                    }
                  }}
                >
                  <Copy size={14} />
                </IconButton>
              )}
            </header>
            <div
              className="player-lyrics-scroll"
              tabIndex={lines.length ? 0 : undefined}
              role="region"
              aria-label="歌词正文"
            >
              {lines.length ? (
                <div className="player-lyrics-lines">
                  {lines.map((line, i) =>
                    line.kind === "section" ? (
                      <div className="lyric-section" key={i}>
                        {line.text}
                      </div>
                    ) : (
                      <p
                        key={i}
                        className={
                          line.kind === "space" ? "lyric-space" : undefined
                        }
                      >
                        {line.text || "\u00a0"}
                      </p>
                    ),
                  )}
                </div>
              ) : (
                <div className="player-lyrics-empty">
                  <Music2 size={26} strokeWidth={1.3} />
                  <p>暂无歌词</p>
                  <span>让旋律继续</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="player-media-navigation">
        <IconButton
          label="切换到封面"
          onClick={() => show("cover")}
          disabled={view === "cover"}
        >
          <ChevronLeft size={17} />
        </IconButton>
        <div className="player-media-position">
          <span aria-live="polite" aria-atomic="true">
            {view === "cover" ? "封面" : "歌词"}
          </span>
          <div className="player-media-dots">
            <UnstyledButton
              aria-label="显示封面"
              aria-pressed={view === "cover"}
              onClick={() => show("cover")}
            >
              <i />
            </UnstyledButton>
            <UnstyledButton
              aria-label="显示歌词"
              aria-pressed={view === "lyrics"}
              onClick={() => show("lyrics")}
            >
              <i />
            </UnstyledButton>
          </div>
        </div>
        <IconButton
          label="切换到歌词"
          onClick={() => show("lyrics")}
          disabled={view === "lyrics"}
        >
          <ChevronRight size={17} />
        </IconButton>
      </div>
    </div>
  );
}
