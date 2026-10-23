import { api } from "./api";
import { assistantApi, streamMessage, type Suggestion } from "./assistant";
import type { Job, Status } from "./types";

export type CreationPhase = "writing" | "submitting";
export type MusicKind = "instrumental" | "vocal";
export type CreationOptions = {
  signal?: AbortSignal;
  onPhase?: (phase: CreationPhase) => void;
  musicKind?: MusicKind;
};

/** Keep generation within smaller Macs' memory without exposing engine controls. */
export function defaultMusicOptions(status: Status) {
  const ram = status?.memory?.machine_ram_gib;
  if (
    typeof ram === "number" &&
    Number.isFinite(ram) &&
    ram > 0 &&
    ram <= 16 &&
    status?.models?.precisions?.includes("4bit")
  )
    return { preset: "custom", precision: "4bit", ode_steps: 8 };
  return { preset: "fast" };
}

export async function readMusicStatus(signal?: AbortSignal): Promise<Status> {
  checkAborted(signal);
  const status = await api.status();
  checkAborted(signal);
  if (status?.models?.present === false)
    throw new Error("音乐模型尚未就绪，请先完成模型配置后重试。");
  return status;
}

const instrumentalAdapters = [
  "ar_lora_inst_v3abc.bf16",
  "nar_lora_joint_v4.bf16",
];

/** Only explicit requests opt into the installed instrumental model. */
export function isInstrumentalPrompt(prompt: string) {
  if (
    /不要(?:做成)?纯音乐|不是纯音乐|不想要纯音乐|非纯音乐|not\s+(?:an?\s+)?instrumental|non[- ]instrumental/i.test(
      prompt,
    )
  )
    return false;
  return /纯音乐|无人声|无歌词|无演唱|不要人声|没有人声|\binstrumental\b|\bno vocals?\b|\bwithout vocals?\b/i.test(
    prompt,
  );
}

function wantsInstrumental(prompt: string, musicKind?: MusicKind) {
  return musicKind === undefined
    ? isInstrumentalPrompt(prompt)
    : musicKind === "instrumental";
}

function vocalStyle(style: string) {
  // The explicit type is authoritative even when an image analysis or an older
  // assistant draft recommends an instrumental arrangement.
  const arrangement = style
    .replace(
      /(?:不要|不是|不想要|非)?纯音乐|无人声|无歌词|无演唱|不要人声|没有人声/gi,
      "",
    )
    .replace(
      /\b(?:no|without)\s+(?:vocals?|lyrics)\b|\b(?:(?:not\s+(?:an?\s+)?)|non[- ])?instrumental\b/gi,
      "",
    )
    .replace(/^[\s，,、；;]+|[\s，,、；;]+$/g, "");
  return [arrangement, "人声演唱，带歌词"].filter(Boolean).join("，");
}

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("创作已取消", "AbortError");
}

/** Only complete song drafts reach the music engine; a prompt is never used as lyrics. */
export function validateMusicDraft(suggestion: Suggestion) {
  const title =
    typeof suggestion?.title === "string" ? suggestion.title.trim() : "";
  const style =
    [suggestion?.description, suggestion?.style]
      .find((value) => typeof value === "string" && value.trim())
      ?.trim() || "";
  const lyrics =
    typeof suggestion?.lyrics === "string" ? suggestion.lyrics.trim() : "";
  const lyricLines = lyrics
    .replace(/\[[^\]]*\]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!style) throw new Error("还缺少曲风，请让助手补充后再生成。");
  if (lyricLines.length < 2 || lyricLines.join("").length < 8)
    throw new Error("歌词尚未完成，请让助手补充完整歌词后再生成。");
  return { title: title || "未命名的歌", style, lyrics };
}

/** The same engine contract is used for a sentence, an image mood and a hum. */
export function musicDraftForEngine(
  suggestion: Suggestion,
  status: Status,
  musicKind?: MusicKind,
) {
  musicKind ??= suggestion.music_kind;
  const style =
    suggestion.description?.trim() || suggestion.style?.trim() || "";
  if (!style) throw new Error("还缺少曲风，请让助手补充后再生成。");
  if (wantsInstrumental(style, musicKind)) {
    if (
      !instrumentalAdapters.every((name) =>
        status?.loras?.adapters?.some(
          (adapter: { name: string; valid: boolean }) =>
            adapter.name === name && adapter.valid,
        ),
      )
    )
      throw new Error("纯音乐模型尚未就绪，请先完成模型配置后重试。");
    return {
      draft: {
        title: suggestion.title?.trim() || "未命名的纯音乐",
        style: `${style}，纯音乐，无人声`,
        // YuE2 requires a section marker; this is score grammar, not sung text.
        lyrics: "[Intro]",
      },
      loras: instrumentalAdapters.map((name) => ({ name, scale: 1 })),
    };
  }
  const draft = validateMusicDraft(suggestion);
  if (musicKind === "vocal") draft.style = vocalStyle(draft.style);
  return { draft, loras: [] };
}

export async function prepareMusicDraft(
  prompt: string,
  { signal, onPhase, musicKind }: CreationOptions = {},
): Promise<Suggestion> {
  const content = prompt.trim();
  if (!content) throw new Error("写下你想要的音乐。");
  checkAborted(signal);
  if (wantsInstrumental(content, musicKind)) {
    return {
      title: content.slice(0, 36),
      description: content,
      lyrics: "[Intro]",
      music_kind: "instrumental",
    };
  }
  onPhase?.("writing");
  const session = await assistantApi.newSession(
    { title: content.slice(0, 40) },
    signal,
  );
  let suggestion: Suggestion | undefined;
  const stop = () => {
    void assistantApi.stop(session.id).catch(() => {});
  };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    checkAborted(signal);
    await streamMessage(
      session.id,
      {
        content: [
          musicKind === "vocal"
            ? `${content}\n\n音乐类型：带歌词的人声歌曲（用户已明确选择）。即使前文出现纯音乐、无人声或 instrumental 等表述，也仅参考其氛围与配器；必须创作完整可演唱歌词，并在 description 中描述人声歌曲的曲风。`
            : content,
          "用户已确认开始生成。请根据以上想法补全合理细节，直接给出可生成的完整创作方案，无需再追问。",
        ].join("\n\n"),
        mode: "lyrics",
      },
      {
        signal,
        onEvent: (event) => {
          if (event.type === "done") suggestion = event.message.suggestion;
        },
      },
    );
    checkAborted(signal);
    const style =
      suggestion?.description?.trim() || suggestion?.style?.trim() || "";
    if (
      wantsInstrumental(style, musicKind ?? suggestion?.music_kind) &&
      style
    ) {
      return {
        title: suggestion?.title?.trim() || "未命名的纯音乐",
        description: style,
        lyrics: "[Intro]",
        music_kind: "instrumental",
      };
    }
    const draft = validateMusicDraft(suggestion || {});
    return {
      title: draft.title,
      lyrics: draft.lyrics,
      description: draft.style,
      music_kind: "vocal",
    };
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}

/** Submission is intentionally attempted once: a failed response must not create duplicates. */
async function submitDraft(
  draft: { title: string; style: string; lyrics: string },
  status: Status,
  loras: { name: string; scale: number }[] = [],
): Promise<Job> {
  const result = await api.submit({
    kind: "create",
    ...defaultMusicOptions(status),
    loras,
    params: { ...draft, cot: "full", seed: null, cfg_scale: null, abc: null },
  });
  if (!result?.job?.id)
    throw new Error("未收到生成结果，请先到「我的音乐」查看，避免重复生成。");
  return result.job;
}

async function submitSuggestion(
  suggestion: Suggestion,
  status: Status,
  options: CreationOptions,
): Promise<Job> {
  checkAborted(options.signal);
  const { draft, loras } = musicDraftForEngine(
    suggestion,
    status,
    options.musicKind,
  );
  options.onPhase?.("submitting");
  checkAborted(options.signal);
  return submitDraft(draft, status, loras);
}

export async function generateFromSuggestion(
  suggestion: Suggestion,
  options: CreationOptions = {},
): Promise<Job> {
  const status = await readMusicStatus(options.signal);
  return submitSuggestion(suggestion, status, options);
}

export async function generateFromPrompt(
  prompt: string,
  options: CreationOptions = {},
): Promise<Job> {
  const content = prompt.trim();
  if (!content) throw new Error("写下你想要的音乐。");
  // One snapshot covers readiness, memory defaults and instrumental adapters.
  const status = await readMusicStatus(options.signal);
  const draft = await prepareMusicDraft(content, options);
  // Once submitted, the music library owns the engine job's lifetime.
  return submitSuggestion(draft, status, options);
}
