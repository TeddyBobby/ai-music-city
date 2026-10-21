import { UnstyledButton, FileButton, SegmentedControl } from "@mantine/core";
import { Input, Textarea, Select, Checkbox } from "../components/ui";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  AudioLines,
  ChevronDown,
  Dice5,
  FileMusic,
  FolderOpen,
  LoaderCircle,
  Plus,
  Settings2,
  Undo2,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import {
  applyHomeDraft,
  clearHomeDraft,
  readHomeDraft,
} from "../lib/homeDraft";
import { errorMessage, presetLabel, readStore, writeStore } from "../lib/utils";
import { useApp } from "../state/app";
import { Badge, Button } from "../components/ui";
import { JobResultRow, LiveJobCard, useMusicJobs } from "./QueuePage";
import "./Music.css";

type Adapter = { name: string; scale: number };
const adapterDescription = (adapter: any) =>
  adapter
    ? [
        adapter.parts?.map((part: string) => part.toUpperCase()).join(" + "),
        adapter.rank ? `秩 ${adapter.rank}` : "",
        adapter.metadata?.intended_cot
          ? `编曲 ${adapter.metadata.intended_cot}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
type Draft = {
  title: string;
  style: string;
  lyrics: string;
  cot: string;
  seed: string | number;
  random_seed: boolean;
  cfg_scale: string | number;
  abc: string;
  count: number;
  random_seeds: boolean;
  preset: string;
  precision: string;
  ode_steps: number;
  loras: Adapter[];
};
const DEFAULTS: Draft = {
  title: "",
  style: "",
  lyrics: "",
  cot: "full",
  seed: "",
  random_seed: true,
  cfg_scale: "",
  abc: "",
  count: 1,
  random_seeds: false,
  preset: "fast",
  precision: "8bit",
  ode_steps: 8,
  loras: [],
};
const MODES = [
  { value: "full", label: "完整编曲" },
  { value: "melody", label: "只编旋律" },
  { value: "off", label: "自由生成" },
];
const GENRES = ["华语流行", "温柔民谣", "轻快女声", "木吉他"];
const SECTIONS = [
  ["[Verse]", "主歌"],
  ["[Chorus]", "副歌"],
  ["[Bridge]", "桥段"],
  ["[Interlude]", "间奏"],
  ["[Outro]", "结尾"],
];

export function CreatePage() {
  const { status, settings, refresh, toast } = useApp();
  const [query, setQuery] = useSearchParams();
  const fromId = query.get("from"),
    trackParam = query.get("track"),
    assistantRequested = query.get("assistantDraft"),
    homeRequested = query.get("homeDraft");
  const [draft, setDraft] = useState<Draft>(DEFAULTS),
    [ready, setReady] = useState(false),
    [submitting, setSubmitting] = useState(false);
  const [track, setTrack] = useState<any>(null),
    [savedSettings, setSavedSettings] = useState<any>(settings);
  const [undo, setUndo] = useState<Partial<Draft> | null>(null),
    [draftNotice, setDraftNotice] = useState(""),
    [advancedOpen, setAdvancedOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const lyricsRef = useRef<HTMLTextAreaElement>(null),
    baseTitle = useRef(""),
    clearedHomeQuery = useRef(false);
  const jobs = useMusicJobs(5);
  const busy =
    jobs.active.length > 0 ||
    !!status?.queue?.running ||
    !!status?.queue?.queued;
  const adapters = (status?.loras?.adapters || []).filter(
    (adapter: any) => adapter.kind !== "hum",
  );
  const availableAdapters = adapters.filter((adapter: any) => adapter.valid);
  const latest = jobs.history.find((job) => job.status === "done");
  const firstActive = jobs.active[0];
  const latestUnfinished =
    jobs.history[0] && jobs.history[0].status !== "done"
      ? jobs.history[0]
      : null;
  const presetOptions = status?.presets?.length
    ? status.presets
    : [{ name: "fast" }, { name: "quality" }, { name: "custom" }];
  const preset = status?.presets?.find(
    (value: any) => value.name === draft.preset,
  );
  const actualPrecision =
    draft.preset === "custom"
      ? draft.precision
      : preset?.precision || (draft.preset === "fast" ? "8bit" : "bf16");
  const actualSteps =
    draft.preset === "custom"
      ? draft.ode_steps
      : preset?.ode_steps || (draft.preset === "fast" ? 8 : 32);
  const effectiveSettings = settings || savedSettings;
  const lowMemory =
    effectiveSettings?.low_memory_effective ??
    status?.memory?.low_memory_effective;
  const summary = `${MODES.find((mode) => mode.value === draft.cot)?.label || "完整编曲"} · ${draft.random_seed ? "随机变化" : "固定种子"} · ${draft.count} 个版本`;
  const lyricsCount = useMemo(
    () => draft.lyrics.replace(/\s/g, "").length,
    [draft.lyrics],
  );

  useEffect(() => {
    // Removing the consumed query must not reload the persisted draft or lose Undo.
    if (!homeRequested && clearedHomeQuery.current) {
      clearedHomeQuery.current = false;
      return;
    }
    let disposed = false;
    setReady(false);
    setFormError("");
    setUndo(null);
    setDraftNotice("");
    async function initialize() {
      const previous = readStore("create", null);
      const homeSuggestion = homeRequested ? readHomeDraft() : null;
      let serverSettings = settings;
      let installedAdapters: { name: string; valid: boolean }[] = [];
      try {
        serverSettings = await api.settings();
      } catch {
        /* Local drafts remain usable when offline. */
      }
      if (disposed) return;
      if (homeSuggestion?.instrumental) {
        try {
          const currentStatus = await api.status();
          installedAdapters = currentStatus?.loras?.adapters || [];
        } catch {
          /* A fresh model check is required before applying an instrumental preset. */
        }
        if (disposed) return;
      }
      setSavedSettings(serverSettings);
      let next: Draft = { ...DEFAULTS, ...(previous || {}) };
      next.precision = next.precision || "8bit";
      next.ode_steps = next.ode_steps || 8;
      next.loras = Array.isArray(next.loras)
        ? next.loras
            .filter((adapter) => adapter?.name)
            .map((adapter) => ({
              name: adapter.name,
              scale: Number.isFinite(Number(adapter.scale))
                ? Number(adapter.scale)
                : 1,
            }))
        : [];
      if (!previous) next.preset = serverSettings?.default_preset || "fast";
      if (fromId) {
        try {
          const { job } = await api.job(fromId);
          if (disposed) return;
          next = {
            ...next,
            title: job.title || job.params?.title || "",
            style: job.params?.style || "",
            lyrics: job.params?.lyrics || "",
            cot: job.params?.cot || "full",
            seed: job.seed ?? "",
            random_seed: false,
            cfg_scale: job.params?.cfg_scale ?? "",
            abc: job.params?.abc || "",
            preset: job.preset,
            precision: job.precision || "8bit",
            ode_steps: job.ode_steps || 8,
            loras: job.loras || [],
            count: 1,
          };
        } catch (err) {
          if (!disposed) toast(errorMessage(err), "err");
        }
      }
      baseTitle.current = next.title;
      let target: any = null;
      if (trackParam) {
        try {
          const response = await api.track(trackParam);
          if (disposed) return;
          target = response.track;
          next.title = target.name;
        } catch (err) {
          if (!disposed) toast(errorMessage(err), "err");
        }
      }
      if (disposed) return;
      setTrack(target);
      if (assistantRequested) {
        try {
          const suggestion = JSON.parse(
            localStorage.getItem("yue2-assistant-draft") || "null",
          );
          if (suggestion) {
            setUndo({
              title: next.title,
              style: next.style,
              lyrics: next.lyrics,
            });
            setDraftNotice("已填入助手建议，可以继续编辑。");
            for (const key of ["title", "style", "lyrics"] as const)
              if (typeof suggestion[key] === "string")
                next[key] = suggestion[key];
            localStorage.removeItem("yue2-assistant-draft");
          }
        } catch {
          toast("助手草稿无法读取，请重新填入。", "err");
        }
      }
      if (homeRequested) {
        if (fromId || trackParam || assistantRequested) {
          setFormError("首页灵感未应用到当前作品，请从首页重新进入独立创作。");
        } else if (!homeSuggestion) {
          setFormError("首页灵感已失效，原草稿已保留。请返回首页重新填写。");
        } else {
          try {
            const original = {
              ...next,
              loras: next.loras.map((item) => ({ ...item })),
            };
            next = applyHomeDraft(next, homeSuggestion, installedAdapters);
            setUndo(original);
            setDraftNotice(
              homeSuggestion.instrumental
                ? "已填入首页灵感，并启用纯音乐编曲。确认设置后开始生成。"
                : next.lyrics.trim()
                  ? "已填入首页灵感，原歌词已保留，纯音乐适配器已关闭。确认后开始生成。"
                  : "已填入首页灵感，纯音乐适配器已关闭。请先补充歌词，再开始生成。",
            );
          } catch (err) {
            const message = errorMessage(err);
            setFormError(message);
            toast(message, "err");
          }
        }
        clearHomeDraft();
        clearedHomeQuery.current = true;
      }
      setDraft(next);
      setReady(true);
      if (homeRequested) {
        setQuery(
          (current) => {
            const cleaned = new URLSearchParams(current);
            cleaned.delete("homeDraft");
            return cleaned;
          },
          { replace: true },
        );
      }
    }
    initialize();
    return () => {
      disposed = true;
    };
  }, [fromId, trackParam, assistantRequested, homeRequested]);

  useEffect(() => {
    if (!ready) return;
    // A track-specific title should not replace the user's independent draft title.
    writeStore(
      "create",
      track ? { ...draft, title: baseTitle.current } : draft,
    );
  }, [draft, ready, track]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFormError("");
  }
  function addSection(tag: string) {
    const textarea = lyricsRef.current;
    const start = textarea?.selectionStart ?? draft.lyrics.length,
      end = textarea?.selectionEnd ?? start;
    const before = draft.lyrics.slice(0, start),
      after = draft.lyrics.slice(end);
    const gap =
      before && !before.endsWith("\n\n")
        ? before.endsWith("\n")
          ? "\n"
          : "\n\n"
        : "";
    const insertion = `${gap}${tag}\n`;
    update("lyrics", before + insertion + after);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(
        start + insertion.length,
        start + insertion.length,
      );
    });
  }
  async function importScore(file: File | null) {
    if (!file) return;
    try {
      update("abc", await file.text());
      toast(`已导入 ${file.name}`, "ok");
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  }
  function addAdapter() {
    const adapter = availableAdapters.find(
      (item: any) => !draft.loras.some((value) => value.name === item.name),
    );
    if (adapter)
      update("loras", [...draft.loras, { name: adapter.name, scale: 1 }]);
  }
  function changeAdapter(index: number, patch: Partial<Adapter>) {
    update(
      "loras",
      draft.loras.map((adapter, position) =>
        position === index ? { ...adapter, ...patch } : adapter,
      ),
    );
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!draft.style.trim() || !draft.lyrics.trim()) {
      setFormError("请填写音乐风格和歌词。");
      return;
    }
    if (draft.abc.trim() && draft.cot === "off") {
      setFormError("使用 ABC 乐谱时，请选择完整编曲或只编旋律。");
      setAdvancedOpen(true);
      return;
    }
    if (!Number.isInteger(draft.count) || draft.count < 1 || draft.count > 16) {
      setFormError("生成版本数应为 1–16 的整数。");
      return;
    }
    const seed =
      draft.random_seed || draft.seed === "" ? null : Number(draft.seed);
    if (
      seed !== null &&
      (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)
    ) {
      setFormError("随机种子应为 0–2147483647 的整数。");
      return;
    }
    const cfg = draft.cfg_scale === "" ? null : Number(draft.cfg_scale);
    if (cfg !== null && (!Number.isFinite(cfg) || cfg < 0 || cfg > 20)) {
      setFormError("风格引导强度应为 0–20。");
      return;
    }
    if (
      draft.loras.some(
        (adapter) =>
          !Number.isFinite(adapter.scale) ||
          adapter.scale < 0 ||
          adapter.scale > 4,
      )
    ) {
      setFormError("适配器强度应为 0–4。");
      setAdvancedOpen(true);
      return;
    }
    if (
      draft.preset === "custom" &&
      (!Number.isInteger(draft.ode_steps) ||
        draft.ode_steps < 4 ||
        draft.ode_steps > 64)
    ) {
      setFormError("合成步数应为 4–64 的整数。");
      return;
    }
    setSubmitting(true);
    setFormError("");
    const base = {
      title: draft.title.trim() || null,
      style: draft.style.trim(),
      lyrics: draft.lyrics,
      cot: draft.cot,
      seed,
      cfg_scale: cfg,
      abc: draft.abc.trim() || null,
    };
    const common = {
      preset: draft.preset,
      precision: draft.preset === "custom" ? draft.precision : null,
      ode_steps: draft.preset === "custom" ? draft.ode_steps : null,
      loras: draft.loras,
      track_id: track?.id || null,
    };
    try {
      if (draft.count > 1) {
        const result = await api.submit({
          kind: "variations",
          ...common,
          params: {
            count: draft.count,
            base,
            random_seeds: draft.random_seeds || draft.random_seed,
            label: null,
          },
        });
        if (result.group) {
          const groups = readStore("groups", {});
          groups[result.group.id] = {
            label: result.group.label,
            ids: result.jobs.map((job: any) => job.id),
          };
          writeStore("groups", groups);
        }
        toast(`已加入 ${result.jobs.length} 个版本，按顺序生成。`, "ok");
      } else {
        await api.submit({ kind: "create", ...common, params: base });
        toast("已加入队列，完成后自动保存。", "ok");
      }
      await Promise.all([jobs.reload(), refresh()]);
    } catch (err) {
      const message = errorMessage(err);
      setFormError(message);
      toast(message, "err");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="create-page music-page">
      {!ready ? (
        <div className="music-loading">
          <LoaderCircle size={18} className="music-spin" />
          正在读取草稿和生成设置…
        </div>
      ) : (
        <>
          {track && (
            <div className="create-track-banner">
              <FolderOpen size={15} />
              <span>
                新版本将收录到{" "}
                <Link to={`/project/${track.project_id}`}>
                  {track.project_name} / {track.name}
                </Link>
              </span>
              <UnstyledButton
                type="button"
                aria-label="取消收录到此曲目"
                onClick={() => {
                  setTrack(null);
                  const next = new URLSearchParams(query);
                  next.delete("track");
                  setQuery(next, { replace: true });
                }}
              >
                <X size={14} />
              </UnstyledButton>
            </div>
          )}
          <div className="create-workspace">
            <form className="card create-form" onSubmit={submit}>
              <div className="create-form-heading">
                <h2>{busy ? "下一首草稿" : "创作草稿"}</h2>
                <span className="muted small">
                  {busy ? "编辑不影响正在生成的任务" : "自动保存在本机"}
                </span>
              </div>
              {undo && (
                <div className="create-draft-notice" role="status">
                  <span>{draftNotice}</span>
                  <UnstyledButton
                    type="button"
                    onClick={() => {
                      setDraft((current) => ({ ...current, ...undo }));
                      setUndo(null);
                      setFormError("");
                      toast("已恢复填入前的草稿。");
                    }}
                  >
                    <Undo2 size={13} />
                    撤销填入
                  </UnstyledButton>
                </div>
              )}
              <label className="field">
                <span className="music-field-label">
                  作品名称 <small>选填</small>
                </span>
                <Input
                  value={draft.title}
                  onChange={(event) => update("title", event.target.value)}
                  placeholder="为这首歌起个名字"
                  maxLength={200}
                  autoComplete="off"
                />
              </label>
              <div className="field">
                <div className="music-field-label">
                  <label htmlFor="create-style">
                    音乐风格 <em>必填</em>
                  </label>
                  <Link to="/assistant">
                    曲风建议
                    <ArrowRight size={12} />
                  </Link>
                </div>
                <Textarea
                  id="create-style"
                  value={draft.style}
                  onChange={(event) => update("style", event.target.value)}
                  placeholder="曲风、情绪、人声、乐器，例如：温暖的华语流行，清澈女声，木吉他与钢琴"
                  rows={2}
                  required
                />
                <div className="create-chips" aria-label="添加曲风">
                  {GENRES.map((genre) => (
                    <UnstyledButton
                      type="button"
                      key={genre}
                      onClick={() =>
                        update(
                          "style",
                          `${draft.style.trim()}${draft.style.trim() ? "，" : ""}${genre}`,
                        )
                      }
                    >
                      {genre}
                    </UnstyledButton>
                  ))}
                </div>
              </div>
              <div className="field">
                <div className="music-field-label">
                  <label htmlFor="create-lyrics">
                    歌词 <em>必填</em>
                  </label>
                  <Link to="/assistant">
                    助手写词
                    <ArrowRight size={12} />
                  </Link>
                </div>
                <div className="create-lyrics-editor">
                  <div className="create-sections" aria-label="插入歌词段落">
                    {SECTIONS.map(([tag, label]) => (
                      <UnstyledButton
                        key={tag}
                        type="button"
                        onClick={() => addSection(tag)}
                      >
                        <Plus size={11} />
                        {label}
                      </UnstyledButton>
                    ))}
                    <span>{lyricsCount} 字</span>
                  </div>
                  <Textarea
                    id="create-lyrics"
                    ref={lyricsRef}
                    value={draft.lyrics}
                    onChange={(event) => update("lyrics", event.target.value)}
                    placeholder={"[Verse]\n写下你的第一句歌词\n\n[Chorus]\n"}
                    spellCheck={false}
                    required
                  />
                </div>
              </div>
              <details
                className="create-advanced"
                open={advancedOpen}
                onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
              >
                <summary>
                  <Settings2 size={15} />
                  <strong>高级设置</strong>
                  <span>{summary}</span>
                  <ChevronDown size={14} />
                </summary>
                <div className="create-advanced-body">
                  <div className="field">
                    <span className="music-field-label">生成模式</span>
                    <SegmentedControl
                      fullWidth
                      size="xs"
                      aria-label="生成模式"
                      value={draft.preset}
                      onChange={(preset) => update("preset", preset)}
                      data={presetOptions.map((option: any) => ({
                        value: option.name,
                        label: presetLabel(option.name),
                      }))}
                    />
                    <p className="muted small">
                      {draft.preset === "fast"
                        ? "8bit 量化，8 步合成，已在本机验证。"
                        : draft.preset === "quality"
                          ? "BF16，32 步合成，尚未在本机验收。"
                          : "自定义精度与合成步数，尚未在本机验收。"}
                    </p>
                  </div>
                  {draft.preset === "custom" && (
                    <div className="create-options-grid">
                      <label className="field">
                        <span>模型精度</span>
                        <Select
                          value={draft.precision}
                          onChange={(event) =>
                            update("precision", event.target.value)
                          }
                        >
                          {["bf16", "8bit", "4bit"].map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </Select>
                      </label>
                      <label className="field">
                        <span>合成步数</span>
                        <Input
                          type="number"
                          min={4}
                          max={64}
                          step={1}
                          value={draft.ode_steps}
                          onChange={(event) =>
                            update("ode_steps", Number(event.target.value))
                          }
                        />
                      </label>
                    </div>
                  )}
                  <div className="create-options-grid">
                    <label className="field">
                      <span>编曲方式</span>
                      <Select
                        value={draft.cot}
                        onChange={(event) => update("cot", event.target.value)}
                      >
                        {MODES.map((mode) => (
                          <option key={mode.value} value={mode.value}>
                            {mode.label}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="field">
                      <span>
                        风格引导强度 <small className="muted">CFG</small>
                      </span>
                      <Input
                        type="number"
                        min={0}
                        max={20}
                        step={0.1}
                        value={draft.cfg_scale}
                        placeholder="模型默认值"
                        onChange={(event) =>
                          update("cfg_scale", event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <div className="create-options-grid">
                    <div className="field">
                      <span>随机种子</span>
                      <div className="create-seed-row">
                        <Input
                          aria-label="随机种子"
                          type="number"
                          min={0}
                          max={2147483647}
                          step={1}
                          disabled={draft.random_seed}
                          value={draft.seed}
                          placeholder="每次随机"
                          onChange={(event) =>
                            update("seed", event.target.value)
                          }
                        />
                        <UnstyledButton
                          type="button"
                          disabled={draft.random_seed}
                          aria-label="生成一个随机种子"
                          onClick={() =>
                            update(
                              "seed",
                              Math.floor(Math.random() * 2147483648),
                            )
                          }
                        >
                          <Dice5 size={16} />
                        </UnstyledButton>
                      </div>
                      <Checkbox
                        className="music-checkbox"
                        label="每次随机变化"
                        checked={draft.random_seed}
                        onChange={(event) =>
                          update("random_seed", event.target.checked)
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="create-count">版本数量</label>
                      <Input
                        id="create-count"
                        type="number"
                        min={1}
                        max={16}
                        step={1}
                        value={draft.count}
                        onChange={(event) =>
                          update("count", Number(event.target.value))
                        }
                      />
                      <Checkbox
                        className="music-checkbox"
                        label="多个版本使用独立随机种子"
                        checked={draft.random_seeds}
                        disabled={draft.random_seed || draft.count < 2}
                        onChange={(event) =>
                          update("random_seeds", event.target.checked)
                        }
                      />
                    </div>
                  </div>
                  <div className="field">
                    <div className="music-field-label">
                      <span>
                        风格适配器 <small>LoRA</small>
                      </span>
                      <UnstyledButton
                        type="button"
                        disabled={
                          draft.loras.length >=
                          Math.min(8, availableAdapters.length)
                        }
                        onClick={addAdapter}
                      >
                        <Plus size={12} />
                        添加
                      </UnstyledButton>
                    </div>
                    {!draft.loras.length && (
                      <p className="muted small">
                        {availableAdapters.length
                          ? `${availableAdapters.length} 个可用，当前未选择。`
                          : "本机没有安装风格适配器。"}
                      </p>
                    )}
                    {draft.loras.map((adapter, index) => (
                      <div className="create-adapter-row" key={index}>
                        <Select
                          aria-label={`第 ${index + 1} 个风格适配器`}
                          value={adapter.name}
                          onChange={(event) =>
                            changeAdapter(index, { name: event.target.value })
                          }
                        >
                          {!adapters.some(
                            (value: any) => value.name === adapter.name,
                          ) && (
                            <option value={adapter.name}>
                              {adapter.name}（未找到）
                            </option>
                          )}
                          {adapters.map((option: any) => (
                            <option
                              key={option.name}
                              value={option.name}
                              disabled={!option.valid}
                              title={
                                option.valid
                                  ? adapterDescription(option)
                                  : option.error
                              }
                            >
                              {option.name}
                              {!option.valid ? "（不可用）" : ""}
                            </option>
                          ))}
                        </Select>
                        <span>×</span>
                        <Input
                          aria-label={`第 ${index + 1} 个适配器强度`}
                          type="number"
                          min={0}
                          max={4}
                          step={0.05}
                          value={adapter.scale}
                          onChange={(event) =>
                            changeAdapter(index, {
                              scale: Number(event.target.value),
                            })
                          }
                        />
                        <UnstyledButton
                          type="button"
                          aria-label={`移除 ${adapter.name}`}
                          onClick={() =>
                            update(
                              "loras",
                              draft.loras.filter(
                                (_, position) => position !== index,
                              ),
                            )
                          }
                        >
                          <X size={15} />
                        </UnstyledButton>
                        <small className="create-adapter-note">
                          {adapterDescription(
                            adapters.find(
                              (value: any) => value.name === adapter.name,
                            ),
                          )}
                        </small>
                      </div>
                    ))}
                  </div>
                  <div className="field">
                    <div className="music-field-label">
                      <label htmlFor="create-abc">
                        ABC 乐谱 <small>可选</small>
                      </label>
                      <FileButton
                        onChange={importScore}
                        accept=".abc,.txt,text/plain"
                      >
                        {(props) => (
                          <UnstyledButton {...props} type="button">
                            <FileMusic size={13} />
                            导入乐谱
                          </UnstyledButton>
                        )}
                      </FileButton>
                    </div>
                    <Textarea
                      id="create-abc"
                      className="create-abc"
                      rows={5}
                      value={draft.abc}
                      onChange={(event) => update("abc", event.target.value)}
                      placeholder={"X:1\nK:C\n"}
                      spellCheck={false}
                    />
                    <p className="muted small">
                      提供乐谱会跳过编谱阶段。自由生成模式不支持此选项。
                    </p>
                  </div>
                </div>
              </details>
              {formError && (
                <div className="music-fetch-error" role="alert">
                  {formError}
                </div>
              )}
              <div className="create-submit">
                <div>
                  <strong>{presetLabel(draft.preset)}</strong>
                  <span>
                    {actualPrecision} · {actualSteps} 步 · 结果自动保存
                  </span>
                </div>
                <Button variant="primary" type="submit" disabled={submitting}>
                  {submitting ? (
                    <LoaderCircle size={15} className="music-spin" />
                  ) : (
                    <AudioLines size={15} />
                  )}
                  {submitting
                    ? "正在提交…"
                    : busy
                      ? `加入队列${draft.count > 1 ? ` · ${draft.count} 个版本` : ""}`
                      : `开始生成${draft.count > 1 ? ` · ${draft.count} 个版本` : ""}`}
                </Button>
              </div>
            </form>
            <aside className="create-sidebar">
              <div className="card create-engine-card">
                <div className="music-section-head">
                  <h2>生成引擎</h2>
                  <Badge tone={status?.models?.present ? "success" : "neutral"}>
                    {status?.models?.present ? "本机运行" : "待连接"}
                  </Badge>
                </div>
                <strong>{status?.models?.name || "本机音乐模型"}</strong>
                <p>{status?.models?.runtime || "正在读取运行环境"}</p>
                <div className="create-engine-meta">
                  <span>{actualPrecision} 量化</span>
                  <span>
                    {lowMemory === true
                      ? "低内存模式"
                      : lowMemory === false
                        ? "标准内存模式"
                        : "读取内存设置"}
                  </span>
                </div>
                <Link to="/settings" className="music-text-link">
                  查看模型与设置
                  <ArrowRight size={12} />
                </Link>
              </div>
              {firstActive ? (
                <>
                  <div className="music-section-head">
                    <h2>当前任务</h2>
                    <Link to="/queue" className="music-text-link">
                      全部任务
                      {jobs.active.length > 1 && ` ${jobs.active.length}`}
                      <ArrowRight size={12} />
                    </Link>
                  </div>
                  <LiveJobCard
                    job={firstActive}
                    compact
                    onFinish={jobs.reload}
                  />
                  {jobs.active.length > 1 && (
                    <p className="muted small">
                      另有 {jobs.active.length - 1} 个任务，按提交顺序生成。
                    </p>
                  )}
                </>
              ) : latestUnfinished ? (
                <section className="card create-recent">
                  <div className="music-section-head">
                    <h2>最近任务</h2>
                    <Link to="/queue" className="music-text-link">
                      任务详情
                      <ArrowRight size={12} />
                    </Link>
                  </div>
                  <JobResultRow job={latestUnfinished} compact />
                </section>
              ) : (
                <div className="card create-idle-result">
                  <AudioLines size={26} strokeWidth={1.2} />
                  <h3>等待生成</h3>
                  <p>
                    提交后会显示实时进度。完成后可直接试听，或打开独立播放页。
                  </p>
                </div>
              )}
              <section className="card create-recent">
                <div className="music-section-head">
                  <h2>最近完成</h2>
                  <Link to="/library" className="music-text-link">
                    作品库
                    <ArrowRight size={12} />
                  </Link>
                </div>
                {latest ? (
                  <JobResultRow job={latest} compact />
                ) : (
                  <p className="music-empty-inline">还没有完成的作品。</p>
                )}
              </section>
              {jobs.error && (
                <p className="music-sidebar-error">
                  任务连接暂时中断，正在重试。
                </p>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
