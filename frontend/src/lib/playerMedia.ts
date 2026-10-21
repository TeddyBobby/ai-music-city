export type PlayerMediaView = "cover" | "lyrics";

export type LyricLine = {
  kind: "section" | "line" | "space";
  text: string;
};

const sectionNames: Record<string, string> = {
  intro: "前奏",
  verse: "主歌",
  chorus: "副歌",
  prechorus: "预副歌",
  postchorus: "后副歌",
  bridge: "桥段",
  outro: "尾声",
  instrumental: "器乐段落",
  interlude: "间奏",
  solo: "独奏",
};

function sectionLabel(value: string): string {
  return value.replace(
    /^(pre[-_ ]?chorus|post[-_ ]?chorus|intro|verse|chorus|bridge|outro|instrumental|interlude|solo)(?=$|\s|\d|[:：-])/i,
    (name) => sectionNames[name.toLowerCase().replace(/[-_ ]/g, "")],
  );
}

// Section markers alone describe an instrumental arrangement, not sung lyrics.
export function lyricLines(text: string): LyricLine[] {
  const lines: LyricLine[] = text.split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    if (!line) return { kind: "space", text: "" };
    const section = line.match(/^\[([^\[\]]+)\]$/);
    if (section) {
      return { kind: "section", text: sectionLabel(section[1].trim()) };
    }
    return { kind: "line", text: line };
  });
  return lines.some((line) => line.kind === "line") ? lines : [];
}

export function swipeTarget(
  view: PlayerMediaView,
  dx: number,
  dy: number,
): PlayerMediaView | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return null;
  if (view === "cover" && dx < 0) return "lyrics";
  if (view === "lyrics" && dx > 0) return "cover";
  return null;
}
