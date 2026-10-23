import { useMemo } from "react";
import { UnstyledButton } from "@mantine/core";
import {
  activeLyricIndex,
  buildLyricTimeline,
  precedingLyricIndex,
} from "../lib/lyricTimeline";
import type { LyricsAlignment } from "../lib/types";

type Props = {
  lyrics: string;
  time: number;
  duration: number;
  alignment?: LyricsAlignment | null;
  onExpand: () => void;
};

export function LyricPreview({
  lyrics,
  time,
  duration,
  alignment,
  onExpand,
}: Props) {
  const { lines } = useMemo(
    () => buildLyricTimeline(lyrics, duration, alignment),
    [lyrics, duration, alignment],
  );

  if (!lines.length) return null;

  const hasClock = Number.isFinite(duration) && duration > 0;
  const current = hasClock ? activeLyricIndex(lines, time) : -1;
  // An interlude keeps nearby lyrics in view without highlighting an ended
  // vocal cue. Untimed lyrics remain a static preview of the opening lines.
  const anchor = hasClock ? precedingLyricIndex(lines, time) : -1;
  const first = Math.max(0, Math.min(anchor, lines.length - 2));

  return (
    <UnstyledButton
      className="player-lyric-preview"
      aria-label="查看完整歌词"
      onClick={onExpand}
    >
      {lines.slice(first, first + 2).map((line, index) => (
        <span
          key={`${first + index}-${line.text}`}
          className="player-lyric-preview-line"
          data-current={first + index === current || undefined}
          aria-current={first + index === current ? "true" : undefined}
        >
          {line.text}
        </span>
      ))}
    </UnstyledButton>
  );
}
