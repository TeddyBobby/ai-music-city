import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { UnstyledButton } from "@mantine/core";
import { Music2, Play, RotateCcw } from "lucide-react";
import {
  activeLyricIndex,
  buildLyricTimeline,
  hasLyricTime,
  lyricSeekTime,
  precedingLyricIndex,
} from "../lib/lyricTimeline";
import type { LyricsAlignment } from "../lib/types";
import "./SyncedLyrics.css";

type Props = {
  lyrics: string;
  time: number;
  duration: number;
  seekable: boolean;
  onSeek: (seconds: number) => void;
  active?: boolean;
  alignment?: LyricsAlignment | null;
  onAlign?: () => void;
};

function clock(seconds: number) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function SyncedLyrics({
  lyrics,
  time,
  duration,
  seekable,
  onSeek,
  active = true,
  alignment,
  onAlign,
}: Props) {
  const timeline = useMemo(
    () => buildLyricTimeline(lyrics, duration, alignment),
    [lyrics, duration, alignment],
  );
  const currentIndex =
    duration > 0 ? activeLyricIndex(timeline.lines, time) : -1;
  const followIndex = precedingLyricIndex(timeline.lines, time);
  const hasTimes = timeline.lines.some(hasLyricTime);
  const canSeek =
    hasTimes && seekable && active && Number.isFinite(duration) && duration > 0;
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const manual = useRef(false);
  const touching = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const pointer = useRef<{
    id: number;
    x: number;
    y: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const touchOrigin = useRef<{ x: number; y: number } | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const latest = useRef({
    active,
    canSeek,
    onSeek,
    timeline,
    duration,
    currentIndex,
    followIndex,
    hasTimes,
  });
  latest.current = {
    active,
    canSeek,
    onSeek,
    timeline,
    duration,
    currentIndex,
    followIndex,
    hasTimes,
  };

  const cancelTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const center = useCallback((index: number, smooth = true) => {
    const viewport = scroller.current;
    const row = rows.current[index];
    if (!viewport || !row || !latest.current.active) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    viewport.scrollTo({
      top: row.offsetTop + row.offsetHeight / 2 - viewport.clientHeight / 2,
      behavior: smooth && !reducedMotion ? "smooth" : "instant",
    });
  }, []);

  const nearest = useCallback(() => {
    const viewport = scroller.current;
    if (!viewport) return -1;
    const middle = viewport.scrollTop + viewport.clientHeight / 2;
    let closest = -1;
    let distance = Infinity;
    rows.current
      .slice(0, latest.current.timeline.lines.length)
      .forEach((row, index) => {
        if (!row) return;
        const delta = Math.abs(row.offsetTop + row.offsetHeight / 2 - middle);
        if (delta < distance) {
          distance = delta;
          closest = index;
        }
      });
    return closest;
  }, []);

  const begin = useCallback(() => {
    if (!latest.current.active) return;
    cancelTimer();
    if (!manual.current) {
      // Cancel an automatic smooth scroll before handing control to the gesture.
      const viewport = scroller.current;
      viewport?.scrollTo({ top: viewport.scrollTop, behavior: "instant" });
    }
    manual.current = true;
    setPreviewIndex(nearest());
  }, [cancelTimer, nearest]);

  const seekLine = useCallback(
    (index: number, smooth = true) => {
      const state = latest.current;
      if (!state.active) return;
      const line = state.timeline.lines[index];
      if (!line) return;
      const seconds = lyricSeekTime(line, state.duration);
      if (!state.canSeek || seconds === null) return;
      cancelTimer();
      manual.current = false;
      setPreviewIndex(null);
      state.onSeek(seconds);
      center(index, smooth);
    },
    [cancelTimer, center],
  );

  const resumeFollowing = useCallback(() => {
    cancelTimer();
    manual.current = false;
    setPreviewIndex(null);
    if (latest.current.hasTimes)
      center(Math.max(0, latest.current.followIndex));
  }, [cancelTimer, center]);

  const settle = useCallback(() => {
    cancelTimer();
    if (!manual.current || !latest.current.active || !latest.current.hasTimes)
      return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (touching.current || pointer.current || !latest.current.active) return;
      // Browsing never changes audio time. After inactivity only the view
      // returns to the currently playing line; seeking requires confirmation.
      resumeFollowing();
    }, 5000);
  }, [cancelTimer, resumeFollowing]);

  useEffect(() => {
    if (!active) {
      cancelTimer();
      manual.current = false;
      touching.current = false;
      pointer.current = null;
      setPreviewIndex(null);
      return;
    }
    if (!manual.current && hasTimes) center(Math.max(0, followIndex));
  }, [active, followIndex, hasTimes, timeline, center, cancelTimer]);

  useEffect(() => {
    const viewport = scroller.current;
    if (!viewport || !active) return;
    const resize = new ResizeObserver(() => {
      viewport.style.setProperty(
        "--lyric-viewport-height",
        `${viewport.clientHeight}px`,
      );
      if (!manual.current)
        center(Math.max(0, latest.current.followIndex), false);
    });
    resize.observe(viewport);
    const wheel = (event: WheelEvent) => {
      if (
        !latest.current.active ||
        event.ctrlKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      )
        return;
      if (!event.deltaY) return;
      event.preventDefault();
      event.stopPropagation();
      begin();
      const multiplier =
        event.deltaMode === 1
          ? 20
          : event.deltaMode === 2
            ? viewport.clientHeight
            : 1;
      viewport.scrollTop += event.deltaY * multiplier;
      setPreviewIndex(nearest());
      settle();
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => {
      resize.disconnect();
      viewport.removeEventListener("wheel", wheel);
      cancelTimer();
    };
  }, [
    active,
    timeline.lines.length,
    begin,
    cancelTimer,
    center,
    nearest,
    settle,
  ]);

  useEffect(() => {
    cancelTimer();
    manual.current = false;
    pointer.current = null;
    touching.current = false;
    rows.current.length = timeline.lines.length;
    setPreviewIndex(null);
    center(Math.max(0, latest.current.followIndex), false);
    return cancelTimer;
  }, [lyrics, cancelTimer, center, timeline.lines.length]);

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      !active ||
      event.pointerType === "touch" ||
      !event.isPrimary ||
      event.button !== 0
    )
      return;
    cancelTimer();
    suppressClick.current = false;
    pointer.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      top: event.currentTarget.scrollTop,
      moved: false,
    };
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const gesture = pointer.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const dy = event.clientY - gesture.y;
    if (!gesture.moved) {
      if (Math.abs(dy) < 6) return;
      if (Math.abs(event.clientX - gesture.x) > Math.abs(dy)) {
        pointer.current = null;
        return;
      }
      gesture.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      begin();
    }
    event.preventDefault();
    event.stopPropagation();
    suppressClick.current = true;
    event.currentTarget.scrollTop = gesture.top - dy;
    setPreviewIndex(nearest());
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    const gesture = pointer.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (gesture.moved) {
      event.stopPropagation();
    }
    if (manual.current) settle();
  }

  if (!timeline.lines.length)
    return (
      <div className="synced-lyrics synced-lyrics-empty">
        <Music2 size={28} strokeWidth={1.3} />
        <p>让旋律继续</p>
        <span>这首作品暂无歌词</span>
      </div>
    );

  const preview = previewIndex !== null ? timeline.lines[previewIndex] : null;
  const previewTime = preview ? lyricSeekTime(preview, duration) : null;
  const aligning =
    alignment?.status === "queued" || alignment?.status === "running";
  const alignmentFailed =
    alignment?.status === "failed" || alignment?.status === "unavailable";
  return (
    <section
      className="synced-lyrics"
      aria-label="同步歌词"
      data-browsing={previewIndex !== null || undefined}
    >
      <div className="synced-lyrics-stage">
        <div
          ref={scroller}
          className="synced-lyrics-scroll"
          tabIndex={active ? 0 : -1}
          role="region"
          aria-label={
            canSeek
              ? "歌词，上下滑动浏览，点击歌词跳转；方向键浏览，回车确认"
              : "歌词正文"
          }
          onScroll={() => {
            if (!active || !manual.current) return;
            setPreviewIndex(nearest());
            settle();
          }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerEnd}
          onPointerCancel={pointerEnd}
          onLostPointerCapture={() => {
            if (pointer.current?.moved) {
              pointer.current = null;
              settle();
            }
          }}
          onTouchStart={(event) => {
            if (!active || event.touches.length !== 1) return;
            touching.current = true;
            suppressClick.current = false;
            touchOrigin.current = {
              x: event.touches[0].clientX,
              y: event.touches[0].clientY,
            };
            cancelTimer();
          }}
          onTouchMove={(event) => {
            const origin = touchOrigin.current;
            if (!active || !origin || event.touches.length !== 1) return;
            const dy = Math.abs(event.touches[0].clientY - origin.y);
            const dx = Math.abs(event.touches[0].clientX - origin.x);
            if (dy > 6 && dy > dx) {
              if (!manual.current) begin();
              suppressClick.current = true;
            }
          }}
          onTouchEnd={() => {
            touching.current = false;
            touchOrigin.current = null;
            settle();
          }}
          onTouchCancel={() => {
            touching.current = false;
            touchOrigin.current = null;
            settle();
          }}
          onClickCapture={(event) => {
            if (suppressClick.current && event.detail > 0) {
              event.preventDefault();
              event.stopPropagation();
              suppressClick.current = false;
            }
          }}
          onKeyDown={(event) => {
            if (
              !active ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey
            )
              return;
            if (
              manual.current &&
              previewIndex !== null &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              event.stopPropagation();
              seekLine(previewIndex);
              return;
            }
            const from = previewIndex ?? Math.max(0, followIndex);
            const next =
              event.key === "ArrowUp"
                ? from - 1
                : event.key === "ArrowDown"
                  ? from + 1
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? timeline.lines.length - 1
                      : null;
            if (next === null) return;
            event.preventDefault();
            event.stopPropagation();
            const index = Math.max(
              0,
              Math.min(timeline.lines.length - 1, next),
            );
            begin();
            setPreviewIndex(index);
            center(index, false);
            settle();
          }}
        >
          <div className="synced-lyrics-lines">
            {timeline.lines.map((line, index) => (
              <UnstyledButton
                key={`${index}-${line.text}`}
                ref={(node) => {
                  rows.current[index] = node;
                }}
                className="synced-lyric-line"
                data-current={index === currentIndex || undefined}
                data-preview={previewIndex === index || undefined}
                aria-current={index === currentIndex ? "true" : undefined}
                aria-label={
                  canSeek && hasLyricTime(line)
                    ? `${clock(lyricSeekTime(line, duration)!)}，${line.text}，跳转到此句`
                    : line.text
                }
                tabIndex={active && canSeek && hasLyricTime(line) ? 0 : -1}
                aria-disabled={!canSeek || !hasLyricTime(line) || undefined}
                onClick={() => {
                  if (canSeek) seekLine(index);
                }}
              >
                {line.section && (
                  <span className="synced-lyric-section">{line.section}</span>
                )}
                <span className="synced-lyric-text">{line.text}</span>
              </UnstyledButton>
            ))}
          </div>
        </div>
        {preview && previewTime !== null && canSeek && (
          <div
            className="synced-lyrics-seek-hint"
            onPointerEnter={cancelTimer}
            onPointerLeave={settle}
          >
            <span>{clock(previewTime)}</span>
            <i />
            <UnstyledButton
              className="lyric-seek-confirm"
              aria-label={`跳转到 ${clock(previewTime)}，${preview.text}`}
              onFocus={cancelTimer}
              onBlur={settle}
              onClick={() => seekLine(previewIndex!)}
            >
              <Play size={13} fill="currentColor" />
              <span>跳转</span>
            </UnstyledButton>
          </div>
        )}
      </div>
      <div className="synced-lyrics-note">
        {aligning ? (
          <span role="status">正在校准歌词…</span>
        ) : alignmentFailed ? (
          <>
            <span title={alignment?.message}>歌词暂未校准</span>
            {onAlign && (
              <UnstyledButton className="lyric-follow-button" onClick={onAlign}>
                重试校准
              </UnstyledButton>
            )}
          </>
        ) : !hasTimes ? (
          <>
            <span>歌词尚未匹配到演唱时间</span>
            {onAlign && alignment && (
              <UnstyledButton className="lyric-follow-button" onClick={onAlign}>
                校准歌词
              </UnstyledButton>
            )}
          </>
        ) : duration <= 0 ? (
          <span>等待音频时长</span>
        ) : canSeek ? (
          preview ? (
            <>
              {previewTime === null && <span>此句暂未校准</span>}
              <UnstyledButton
                className="lyric-follow-button"
                onFocus={cancelTimer}
                onBlur={settle}
                onClick={resumeFollowing}
              >
                <RotateCcw size={12} />
                回到当前
              </UnstyledButton>
            </>
          ) : (
            <span>滑动浏览 · 点击跳转</span>
          )
        ) : (
          <span>播放这首作品后同步歌词</span>
        )}
      </div>
    </section>
  );
}
