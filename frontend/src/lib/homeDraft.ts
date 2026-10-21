import { lyricLines } from "./playerMedia";

export type HomeDraft = { prompt: string; instrumental: boolean };

const STORAGE_KEY = "tingjian.home-draft";
const INSTRUMENTAL_AR = "ar_lora_inst_v3abc.bf16";
const SHARED_NAR = "nar_lora_joint_v4.bf16";

export function saveHomeDraft(draft: HomeDraft): boolean {
  if (!draft.prompt.trim()) return false;
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        prompt: draft.prompt.trim(),
        instrumental: draft.instrumental === true,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

// Reading must not consume the handoff: a cancelled initialization may retry.
export function readHomeDraft(): HomeDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    return typeof value?.prompt === "string" && value.prompt.trim()
      ? {
          prompt: value.prompt.trim(),
          instrumental: value.instrumental === true,
        }
      : null;
  } catch {
    return null;
  }
}

export function clearHomeDraft() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* The URL is also cleared so the handoff cannot be applied again. */
  }
}

type DraftFields = {
  style: string;
  lyrics: string;
  cot: string;
  abc: string;
  loras: { name: string; scale: number }[];
};
type InstalledAdapter = { name: string; valid: boolean };

export function applyHomeDraft<T extends DraftFields>(
  previous: T,
  handoff: HomeDraft,
  installed: InstalledAdapter[],
): T {
  if (!handoff.instrumental) {
    return {
      ...previous,
      style: handoff.prompt,
      lyrics: lyricLines(previous.lyrics).length ? previous.lyrics : "",
      loras: previous.loras.filter(
        (adapter) => adapter.name !== INSTRUMENTAL_AR,
      ),
    };
  }

  const names = [INSTRUMENTAL_AR, SHARED_NAR];
  if (
    !names.every((name) =>
      installed.some((item) => item.name === name && item.valid),
    )
  ) {
    throw new Error(
      "纯音乐适配器尚未就绪，未改动原草稿。请先在设置中安装并检查纯音乐模型。",
    );
  }

  return {
    ...previous,
    style: `${handoff.prompt}，纯音乐，无人声`,
    lyrics: "[Intro]",
    cot: "full",
    abc: "",
    loras: names.map((name) => ({ name, scale: 1 })),
  };
}
