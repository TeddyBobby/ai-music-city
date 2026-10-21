import { lyricLines } from "./playerMedia";
import type { LyricAlignmentLine, LyricsAlignment } from "./types";

export type TimedLyric = LyricAlignmentLine;

export type LyricTimeline = {
  lines: TimedLyric[];
  source: "lrc" | "audio" | "none";
};

const timestamp = /\[(\d+):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;
const metadata = /^\[(?:ar|ti|al|by|re|ve|length|offset):[^\]]*\]\s*$/i;

function seconds(minutes: string, seconds: string, fraction = "") {
  return (
    Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction || "0"}`)
  );
}

export function hasLyricTime(
  line: TimedLyric,
): line is TimedLyric & { at: number } {
  return (
    typeof line.at === "number" && Number.isFinite(line.at) && line.at >= 0
  );
}

export function buildLyricTimeline(
  text: string,
  _duration: number,
  alignment?: LyricsAlignment | null,
): LyricTimeline {
  const rawLines = (text || "").split(/\r?\n/);
  const offsetMatch = text.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
  const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  const timed: TimedLyric[] = [];
  let section: string | undefined;

  for (const raw of rawLines) {
    const stamps = [...raw.matchAll(timestamp)];
    if (metadata.test(raw.trim())) continue;
    const content = raw.replace(timestamp, "").trim();
    const parsed = lyricLines(`${content}\n__section_probe__`)[0];
    if (parsed?.kind === "section") {
      section = parsed.text;
      continue;
    }
    if (!stamps.length || !content) continue;
    for (const stamp of stamps) {
      timed.push({
        text: content.replace(/<\d+:[0-5]\d(?:[.:]\d{1,3})?>/g, ""),
        at: Math.max(0, seconds(stamp[1], stamp[2], stamp[3]) + offset),
        ...(section ? { section } : {}),
      });
    }
    section = undefined;
  }

  if (timed.length) {
    const lines: TimedLyric[] = [];
    for (const line of timed.sort((a, b) => a.at! - b.at!)) {
      const previous = lines.at(-1);
      // Bilingual LRCs often put both translations at the same timestamp.
      if (previous?.at === line.at) {
        if (!previous.text.split("\n").includes(line.text))
          previous.text += `\n${line.text}`;
        if (!previous.section && line.section) previous.section = line.section;
      } else lines.push({ ...line });
    }
    return { lines, source: "lrc" };
  }

  if (alignment?.status === "ready" && alignment.lines.length) {
    let previousAt = -1;
    const lines = alignment.lines.map((line) => {
      // Preserve the original lyric order and repeated choruses. Unmatched or
      // invalid cues stay untimed; no interpolation can prove a vocal onset.
      const valid =
        hasLyricTime(line) &&
        line.at >= previousAt &&
        (line.end === undefined ||
          (Number.isFinite(line.end) && line.end > line.at));
      if (valid) previousAt = line.at!;
      return {
        text: line.text,
        at: valid ? line.at : null,
        ...(valid && line.end !== undefined ? { end: line.end } : {}),
        ...(line.section ? { section: line.section } : {}),
      };
    });
    return { lines, source: "audio" };
  }

  const cleanText = rawLines
    .filter((line) => !metadata.test(line.trim()))
    .join("\n");
  const plain = lyricLines(cleanText);
  const lines: TimedLyric[] = [];
  section = undefined;
  for (const line of plain) {
    if (line.kind === "section") section = line.text;
    if (line.kind !== "line") continue;
    lines.push({ text: line.text, at: null, ...(section ? { section } : {}) });
    section = undefined;
  }
  return { lines, source: "none" };
}

export function precedingLyricIndex(lines: TimedLyric[], time: number): number {
  // Media clocks can round a seek down by a few milliseconds. Keep the selected
  // lyric current after seeking instead of highlighting the previous sentence.
  const clockTime = time + 0.002;
  if (!Number.isFinite(time)) return -1;
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (hasLyricTime(line) && line.at <= clockTime) index = i;
  }
  return index;
}

export function activeLyricIndex(lines: TimedLyric[], time: number): number {
  const index = precedingLyricIndex(lines, time);
  if (index < 0) return -1;
  const line = lines[index];
  return line.end !== undefined && time >= line.end ? -1 : index;
}

export function lyricSeekTime(
  line: TimedLyric,
  duration: number,
): number | null {
  if (!hasLyricTime(line) || !Number.isFinite(duration) || duration <= 0)
    return null;
  return Math.min(duration, line.at);
}
