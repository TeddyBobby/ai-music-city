import { useRef, useState, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { ChevronLeft, ChevronRight, ImagePlus } from "lucide-react";
import type { Job, LyricsAlignment } from "../lib/types";
import { swipeTarget } from "../lib/playerMedia";
import { SyncedLyrics } from "./SyncedLyrics";
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
  time,
  duration,
  seekable,
  onSeek,
  active,
  alignment,
  onAlign,
}: {
  job: Job;
  playing: boolean;
  onClose: () => void;
  time: number;
  duration: number;
  seekable: boolean;
  onSeek: (seconds: number) => void;
  active: boolean;
  alignment?: LyricsAlignment | null;
  onAlign?: () => void;
}) {
  const [view, setView] = useState<MediaView>("cover");
  const [drag, setDrag] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const mobile = useMediaQuery("(max-width: 760px)");

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
          "a,button:not(.player-media-cover-button):not(.synced-lyric-line),input,textarea,select,[role=slider]",
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

  if (!mobile)
    return (
      <div className="player-media player-media-desktop">
        <div className="player-media-viewport player-media-cover">
          <Artwork job={job} />
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
      </div>
    );

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
            {mobile && (
              <SyncedLyrics
                lyrics={job.params?.lyrics || ""}
                time={time}
                duration={duration}
                seekable={seekable}
                onSeek={onSeek}
                active={active && view === "lyrics"}
                alignment={alignment}
                onAlign={onAlign}
              />
            )}
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
