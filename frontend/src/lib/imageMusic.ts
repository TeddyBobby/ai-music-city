import {
  generateFromPrompt,
  generateFromSuggestion,
  type CreationOptions,
  type CreationPhase,
  type MusicKind,
} from "./musicCreation";
import { accountFetch } from "./accountBoundary";

export interface ImageMood {
  title: string;
  summary: string;
  mood: string;
  style: string;
  /** Suno 引擎可用时后端附带的图片参考 URL（imageUrls） */
  ref_image_url?: string;
}
export type ImageCreationPhase = "analyzing" | CreationPhase;
export type ImageCreationOptions = Omit<CreationOptions, "onPhase"> & {
  musicKind: MusicKind;
  onPhase?: (phase: ImageCreationPhase) => void;
  onAnalysis?: (analysis: ImageMood) => void;
};

export function validateImageFile(file: File) {
  if (!file.size) throw new Error("这张图片是空的，请重新选择。");
  if (file.size > 8 * 1024 * 1024)
    throw new Error("请选择不超过 8 MB 的图片。");
  if (
    !/^image\/(jpeg|png|webp)$/i.test(file.type) &&
    !/\.(jpe?g|png|webp)$/i.test(file.name)
  )
    throw new Error("请选择 JPG、PNG 或 WebP 图片。");
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("创作已取消", "AbortError");
}

export async function analyzeImageMood(
  file: File,
  description = "",
  signal?: AbortSignal,
): Promise<ImageMood> {
  validateImageFile(file);
  checkCancelled(signal);
  const body = new FormData();
  body.append("file", file, file.name);
  if (description.trim()) body.append("description", description.trim());
  let response: Response;
  try {
    response = await accountFetch("/api/assistant/image-mood", {
      method: "POST",
      body,
      signal,
    });
  } catch (error) {
    checkCancelled(signal);
    throw new Error("图片识别连接失败，请稍后重试。");
  }
  const result = await response.json().catch(() => null);
  checkCancelled(signal);
  if (!response.ok)
    throw new Error(
      result?.error?.message || "图片识别失败，请换一张图片或重试。",
    );
  if (
    !result ||
    ["title", "summary", "mood", "style"].some(
      (key) => typeof result[key] !== "string" || !result[key].trim(),
    )
  )
    throw new Error("还没能读懂这张图片的氛围，请再试一次。");
  return result;
}

/** Read the actual picture first. The chosen music type owns how its atmosphere is composed. */
export async function generateFromImage(
  file: File,
  description: string,
  options: ImageCreationOptions,
) {
  checkCancelled(options.signal);
  options.onPhase?.("analyzing");
  const analysis = await analyzeImageMood(file, description, options.signal);
  checkCancelled(options.signal);
  options.onAnalysis?.(analysis);
  checkCancelled(options.signal);
  const musicOptions: CreationOptions = {
    musicKind: options.musicKind,
    signal: options.signal,
    onPhase: options.onPhase,
  };
  if (options.musicKind === "instrumental")
    return generateFromSuggestion(
      { title: analysis.title, description: analysis.style, ref_image_url: analysis.ref_image_url },
      musicOptions,
    );
  const prompt = [
    "根据图片的氛围写一首带歌词的中文歌曲，音乐应营造画面感。",
    `歌名灵感：${analysis.title}`,
    `画面：${analysis.summary}`,
    `氛围：${analysis.mood}`,
    `音乐方向：${analysis.style}`,
    description.trim() ? `用户补充：${description.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return generateFromPrompt(prompt, musicOptions, analysis.ref_image_url);
}
