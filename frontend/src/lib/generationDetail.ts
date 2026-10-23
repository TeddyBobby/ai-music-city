import { api } from "./api";
import {
  defaultMusicOptions,
  isInstrumentalPrompt,
  musicDraftForEngine,
  prepareMusicDraft,
  type CreationOptions,
  type MusicKind,
} from "./musicCreation";
import type { Job } from "./types";

export type GenerationDraft = {
  title: string;
  style: string;
  lyrics: string;
  musicKind: MusicKind;
};

export type GenerationStep = {
  id: string;
  label: string;
  state: "complete" | "current" | "pending" | "failed" | "cancelled";
};

export type GenerationProgress = {
  title: string;
  description: string;
  steps: GenerationStep[];
  /** Measured progress of the current engine stage, never an overall estimate. */
  stagePercent?: number;
  stageDetail?: string;
};

const instrumentalAdapters = [
  "ar_lora_inst_v3abc.bf16",
  "nar_lora_joint_v4.bf16",
];

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

function hasLyricText(lyrics: string) {
  const body = lyrics.replace(/\[[^\]]*\]/g, "").trim();
  // 占位词（纯音乐/无人声/instrumental 等）不是可唱歌词，视为无词。
  if (
    /^(纯音乐|无人声|无歌词|instrumental|inst|no vocals?|без слов)$/i.test(body)
  )
    return false;
  return Boolean(body);
}

export function draftFromJob(job: Job): GenerationDraft {
  const style = text(job.params?.style);
  const lyrics = text(job.params?.lyrics);
  const hasInstrumentalAdapters = instrumentalAdapters.every((name) =>
    job.loras?.some(
      (adapter) => adapter.name === name && (adapter.scale ?? 1) > 0,
    ),
  );
  const musicKind =
    hasInstrumentalAdapters ||
    (!hasLyricText(lyrics) && isInstrumentalPrompt(style))
      ? "instrumental"
      : "vocal";
  return {
    title: text(job.title) || text(job.params?.title) || "未命名的音乐",
    style,
    // A section marker is engine score grammar, not a lyric the user can sing.
    lyrics: hasLyricText(lyrics) ? lyrics : "",
    musicKind,
  };
}

const stageInfo: Record<
  string,
  { step: string; title: string; description: string }
> = {
  writing: {
    step: "write",
    title: "AI 正在创作歌词",
    description: "根据你的描述补全歌词与曲风，完成后自动进入生成。",
  },
  load: {
    step: "prepare",
    title: "正在准备创作",
    description: "音乐模型正在准备，首次生成可能需要多一点时间。",
  },
  transcribe: {
    step: "melody",
    title: "正在识别旋律",
    description: "正在听取音频中的音高与节奏。",
  },
  hum: {
    step: "melody",
    title: "正在识别旋律",
    description: "正在将你的哼唱转成旋律线索。",
  },
  plan: {
    step: "compose",
    title: "正在编排旋律",
    description: "正在安排音乐的旋律、段落与配器。",
  },
  semantic: {
    step: "generate",
    title: "正在生成音乐",
    description: "正在把创作设定变成音乐内容。",
  },
  synthesize: {
    step: "finish",
    title: "正在合成音频",
    description: "正在合成人声与乐器，纯音乐只包含乐器演奏。",
  },
  decode: {
    step: "finish",
    title: "正在完成音频",
    description: "正在处理可播放的音频。",
  },
  save: {
    step: "finish",
    title: "正在保存作品",
    description: "完成后就可以试听、下载或分享。",
  },
};

function failureDescription(job: Job) {
  const error = text(job.error);
  if (/hum transcription has no notes|only rests/i.test(error))
    return "这段哼唱没有识别到清晰旋律，请重新录音或上传一段更清楚的哼唱。";
  if (
    /MemoryError|memory pressure|out of memory|failed to allocate|内存不足/i.test(
      error,
    )
  )
    return "可用内存不足，生成已停止。关闭闲置应用后，可以保留这些设定重新生成。";
  if (
    /upload.*(?:missing|not found|does not exist)|上传.*(?:丢失|不存在)/i.test(
      error,
    )
  )
    return "原始音频已不可用，请回到创作页重新录音或上传。";
  if (
    /models?.*(missing|not found|unavailable|not installed|not ready)|missing.*models?|weights?.*(missing|not found)|模型.*(缺失|未安装|不可用|未就绪)|未找到.*模型|engine_unavailable/i.test(
      error,
    )
  )
    return "音乐模型暂未就绪，完成模型配置后可以继续生成。";
  return "本次生成没有完成。你可以调整下方的创作设定，生成一个新版本。";
}

/** Use measured engine stages; elapsed time alone must never advance the timeline. */
export function generationProgress(job: Job): GenerationProgress {
  const progress = job.progress || {};
  const stage = text(progress.stage);
  const info = stageInfo[stage];
  const stepDefinitions = [
    { id: "prepare", label: "准备创作" },
    ...(job.kind === "hum" || job.kind === "cover"
      ? [{ id: "melody", label: "识别旋律" }]
      : []),
    ...(job.params?.description
      ? [{ id: "write", label: "AI 写词" }]
      : []),
    { id: "compose", label: "编排旋律" },
    { id: "generate", label: "生成音乐" },
    { id: "finish", label: "合成与保存" },
  ];
  const current = stepDefinitions.findIndex((step) => step.id === info?.step);
  const steps: GenerationStep[] = stepDefinitions.map((step, index) => ({
    ...step,
    state:
      job.status === "done"
        ? "complete"
        : job.status === "queued" || current < 0
          ? "pending"
          : index < current
            ? "complete"
            : index > current
              ? "pending"
              : job.status === "failed"
                ? "failed"
                : job.status === "cancelled"
                  ? "cancelled"
                  : "current",
  }));

  if (job.status === "queued") {
    const ahead = job.position;
    return {
      title: "等待开始",
      description:
        typeof ahead === "number" && Number.isInteger(ahead) && ahead > 0
          ? `前面还有 ${ahead} 个排队任务，开始后会在这里更新进度。`
          : "任务已加入队列，开始后会在这里更新进度。",
      steps,
    };
  }
  if (job.status === "done")
    return {
      title: "音乐已完成",
      description: "先听听效果，也可以调整设定再生成一个版本。",
      steps,
    };
  if (job.status === "failed")
    return {
      title: "这次没有完成",
      description: failureDescription(job),
      steps,
    };
  if (job.status === "cancelled")
    return {
      title: "已停止生成",
      description: "创作设定已保留，可以调整后重新生成。",
      steps,
    };

  const result: GenerationProgress = {
    title: info?.title || "正在生成",
    description:
      info?.description || "生成仍在进行中，收到新的进度后会自动更新。",
    steps,
  };
  const { completed, total } = progress;
  if (
    info &&
    typeof completed === "number" &&
    Number.isFinite(completed) &&
    completed >= 0 &&
    typeof total === "number" &&
    Number.isFinite(total) &&
    total > 0 &&
    completed <= total
  ) {
    result.stagePercent = Math.round((completed / total) * 100);
    result.stageDetail = `当前阶段 ${completed} / ${total}`;
  }
  return result;
}

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("创作已取消", "AbortError");
}

/** A revision is a new job; never mutate the source or retry an ambiguous submission. */
export async function submitRevision(
  job: Job,
  edited: GenerationDraft,
  options: CreationOptions = {},
): Promise<Job> {
  checkAborted(options.signal);
  if (!job.id) throw new Error("找不到原作品，请刷新页面后重试。");
  if (!["done", "failed", "cancelled"].includes(job.status))
    throw new Error("请等待本次生成结束，或先停止生成，再创建新版本。");
  // Snapshot before awaiting: later UI edits cannot change an in-flight version.
  const source = { ...job.params };
  const originalId = job.id;
  const humming = job.kind === "hum";
  const draft = {
    title: text(edited.title),
    style: text(edited.style),
    lyrics: text(edited.lyrics),
    musicKind: edited.musicKind,
  };
  if (!draft.style) throw new Error("请先描述想要的曲风与氛围。");
  if (!["instrumental", "vocal"].includes(draft.musicKind))
    throw new Error("请选择纯音乐或带歌词。");
  if (humming && !text(source.upload_id))
    throw new Error("原始哼唱已不可用，请回到创作页重新录音或上传。");

  const status = await api.status();
  checkAborted(options.signal);
  if (status?.models?.present === false)
    throw new Error("音乐模型尚未就绪，请先完成模型配置后重试。");
  if (humming && !status?.hum?.available)
    throw new Error("哼唱生成暂未启用，请恢复哼唱功能后重试。");

  if (draft.musicKind === "vocal" && !hasLyricText(draft.lyrics)) {
    const generated = await prepareMusicDraft(
      `${draft.title ? `歌名：${draft.title}\n` : ""}曲风与氛围：${draft.style}\n请为这首歌创作完整的可演唱歌词。`,
      { ...options, musicKind: "vocal" },
    );
    checkAborted(options.signal);
    draft.lyrics = text(generated.lyrics);
    draft.title ||= text(generated.title);
  }
  const { draft: engineDraft, loras } = musicDraftForEngine(
    { title: draft.title, description: draft.style, lyrics: draft.lyrics },
    status,
    draft.musicKind,
  );
  const params = humming
    ? {
        ...engineDraft,
        upload_id: source.upload_id,
        melody: source.melody ?? "continue",
        adapter: source.adapter ?? null,
        hum_influence: source.hum_influence ?? 1,
        offset_s: source.offset_s ?? 0,
        cfg_scale: source.cfg_scale ?? null,
        seed: null,
      }
    : {
        ...engineDraft,
        cot: "full",
        abc: null,
        cfg_scale: source.cfg_scale ?? null,
        seed: null,
      };
  options.onPhase?.("submitting");
  checkAborted(options.signal);
  const result = await api.submit({
    kind: humming ? "hum" : "create",
    parent_id: originalId,
    ...defaultMusicOptions(status),
    loras,
    params,
  });
  if (!result?.job?.id)
    throw new Error("未收到生成结果，请先到「我的音乐」查看，避免重复生成。");
  return result.job;
}
