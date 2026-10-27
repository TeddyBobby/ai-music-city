/** Optional Suno settings. Omitted values use the service's own defaults.
 * https://docs.sunoapi.org/suno-api/generate-music
 * https://docs.sunoapi.org/suno-api/upload-and-cover-audio
 */
export type SunoOptions = {
  model?: "V6" | "V6_WILD" | "V6_MINI";
  negativeTags?: string;
  vocalGender?: "m" | "f";
  styleWeight?: number;
  weirdnessConstraint?: number;
  audioWeight?: number;
  variety?: number;
  duration?: number;
  personaId?: string;
  personaModel?: "style_persona" | "voice_persona";
};

export function sunoOptionsForRevision(
  options: SunoOptions | undefined,
  kind: string,
  musicKind: string,
): SunoOptions {
  const result: SunoOptions = {};
  if (!options) return result;
  if (options.model) {
    if (!["V6", "V6_WILD", "V6_MINI"].includes(options.model))
      throw new Error("请选择支持的 Suno 模型。");
    result.model = options.model;
  }
  if (options.negativeTags?.trim()) {
    result.negativeTags = options.negativeTags.trim();
    if (Array.from(result.negativeTags).length > 1000)
      throw new Error("避免的风格不能超过 1000 字。");
  }
  if (musicKind === "vocal" && options.vocalGender) {
    if (!["m", "f"].includes(options.vocalGender))
      throw new Error("请选择有效的人声类型。");
    result.vocalGender = options.vocalGender;
  }
  const weights = [
    ["styleWeight", "风格影响度"],
    ["weirdnessConstraint", "创意度"],
    ...(kind === "hum" || musicKind === "vocal"
      ? [["audioWeight", "音频影响度"]]
      : []),
  ] as const;
  for (const [key, label] of weights) {
    const value = options[key as keyof SunoOptions];
    if (value == null) continue;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    )
      throw new Error(`${label}必须在 0–100% 之间。`);
    Object.assign(result, { [key]: Math.round(value * 100) / 100 });
  }
  if (options.variety != null) {
    if (
      !Number.isInteger(options.variety) ||
      options.variety < 0 ||
      options.variety > 4
    )
      throw new Error("变化程度必须在 0–4 之间。");
    result.variety = options.variety;
  }
  if (options.duration != null) {
    if (
      !Number.isInteger(options.duration) ||
      options.duration < 10 ||
      options.duration > 360
    )
      throw new Error("时长必须为 10–360 秒的整数。");
    result.duration = options.duration;
  }
  if (options.personaId?.trim()) {
    result.personaId = options.personaId.trim();
    if (options.personaModel) {
      if (!["style_persona", "voice_persona"].includes(options.personaModel))
        throw new Error("请选择有效的 Persona 类型。");
      result.personaModel = options.personaModel;
    }
  }
  return result;
}

export function validateSunoText(
  draft: { title: string; style: string; lyrics: string },
  musicKind: string,
) {
  for (const [value, limit, label] of [
    [draft.title, 80, "作品名称"],
    [draft.style, 1000, "音乐风格"],
    [musicKind === "vocal" ? draft.lyrics : "", 5000, "歌词"],
  ] as const) {
    if (Array.from(value).length > limit)
      throw new Error(`Suno 的${label}不能超过 ${limit} 字，请缩短后再生成。`);
  }
}
