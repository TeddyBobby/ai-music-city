export const MUSIC_PROMPT_LABELS = [
  "音乐风格",
  "歌词/歌词风格",
  "避免的风格",
] as const;

/** Keep everything the user wrote; a repeated shortcut returns to its existing line. */
export function insertMusicPromptLabel(
  value: string,
  label: string,
  maxLength = Infinity,
): { value: string; cursor: number } {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existing = new RegExp(`(^|\\n)[\\t ]*${escaped}[\\t ]*[：:][^\\n]*`).exec(value);
  if (existing) return { value, cursor: existing.index + existing[0].length };
  const next = `${value}${value && !value.endsWith("\n") ? "\n" : ""}${label}：`;
  return next.length <= maxLength
    ? { value: next, cursor: next.length }
    : { value, cursor: value.length };
}

/** Empty shortcut labels are a template, not a request to start a generation. */
export function hasMusicPromptContent(value: string) {
  return value
    .replace(/^[\t ]*(?:音乐风格|歌词\s*[/／]\s*歌词风格|避免的风格)[\t ]*[：:][\t ]*/gm, "")
    .trim().length > 0;
}
