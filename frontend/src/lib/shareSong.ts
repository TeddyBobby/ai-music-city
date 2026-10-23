import { songUrl } from "./api";
import { accountFetch } from "./accountBoundary";
import type { Job } from "./types";
import { titleOf } from "./utils";

export function songDownload(job: Job, mp3: boolean) {
  const extension = mp3 ? "mp3" : "flac";
  const title = titleOf(job)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .trim();
  return {
    url: songUrl(job.id, `audio.${extension}`),
    name: `${title || "我的音乐"}.${extension}`,
    type: mp3 ? "audio/mpeg" : "audio/flac",
  };
}

export async function prepareSongShare(
  job: Job,
  mp3: boolean,
  signal?: AbortSignal,
): Promise<File> {
  const download = songDownload(job, mp3);
  const response = await accountFetch(download.url, { signal });
  if (!response.ok) throw new Error("音频暂时无法读取，请重试。");
  const blob = await response.blob();
  if (!blob.size) throw new Error("音频暂时无法读取，请重试。");
  return new File([blob], download.name, { type: download.type });
}

export function canShareSong(file: File): boolean {
  try {
    return Boolean(navigator.share && navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
}
