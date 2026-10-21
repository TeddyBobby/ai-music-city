import { Slider } from "@mantine/core";
import { Input, Select, Checkbox } from "../components/ui";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, request } from "../lib/api";
import { errorMessage } from "../lib/utils";
import { useApp } from "../state/app";
import { Badge, Button } from "../components/ui";
import "./Workspace.css";

type FormValues = {
  default_preset: string;
  low_memory: string;
  memory_budget_gib: number;
  require_ac: boolean;
  fast_numerics: boolean;
  prune: string;
  theme: string;
};
const formOf = (s: any): FormValues => ({
  default_preset: s.default_preset || "fast",
  low_memory: s.low_memory || "auto",
  memory_budget_gib: s.memory_budget_gib,
  require_ac: !!s.require_ac,
  fast_numerics: s.fast_numerics !== false,
  prune: s.prune_uploads_days == null ? "" : String(s.prune_uploads_days),
  theme: s.theme || "system",
});
const ENGINE_STATE: Record<string, string> = {
  cold: "等待创作",
  idle: "待加载",
  ready: "就绪",
  busy: "生成中",
  loading: "加载中",
  error: "异常",
};

function Capability({
  title,
  available,
  detail,
  stateLabel,
}: {
  title: string;
  available: boolean;
  detail?: string;
  stateLabel?: string;
}) {
  return (
    <div className="wk-capability">
      <div className="row between">
        <span>{title}</span>
        <Badge tone={available ? "ok" : "neutral"}>
          {stateLabel || (available ? "可用" : "未配置")}
        </Badge>
      </div>
      {detail && <p className="muted small">{detail}</p>}
    </div>
  );
}

export function SettingsPage() {
  const { status, settings, refresh, toast } = useApp();
  const [saved, setSaved] = useState<any>(null);
  const [form, setForm] = useState<FormValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [assistant, setAssistant] = useState<any>(null);
  const [assistantError, setAssistantError] = useState("");
  const [checking, setChecking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api
      .settings()
      .then((data: any) => {
        if (active) {
          setSaved(data);
          setForm(formOf(data));
        }
      })
      .catch((e: any) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    request("GET", "/api/assistant/status")
      .then((data: any) => {
        if (active) {
          setAssistant(data);
          setAssistantError("");
        }
      })
      .catch((e: any) => {
        if (active) setAssistantError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  // Header appearance changes should not discard pending generation settings.
  useEffect(() => {
    if (!settings?.theme) return;
    setSaved((old: any) => (old ? { ...old, theme: settings.theme } : old));
    setForm((old) => (old ? { ...old, theme: settings.theme } : old));
  }, [settings?.theme]);
  const dirty =
    !!form && !!saved && JSON.stringify(form) !== JSON.stringify(formOf(saved));
  const change = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setForm((old) => (old ? { ...old, [key]: value } : old));
    setNotice("");
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || busy) return;
    const prune = form.prune.trim() ? Number(form.prune) : null;
    if (
      prune !== null &&
      (!Number.isInteger(prune) || prune < 1 || prune > 365)
    ) {
      setError("清理天数需为 1–365，留空表示保留。");
      return;
    }
    const min = saved.min_memory_budget_gib ?? 6,
      max = saved.max_memory_budget_gib ?? 12;
    if (
      !Number.isFinite(form.memory_budget_gib) ||
      form.memory_budget_gib < min ||
      form.memory_budget_gib > max
    ) {
      setError(`内存预算需在 ${min}–${max} GiB 之间。`);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api.saveSettings({
        default_preset: form.default_preset,
        low_memory: form.low_memory,
        memory_budget_gib: form.memory_budget_gib,
        require_ac: form.require_ac,
        fast_numerics: form.fast_numerics,
        prune_uploads_days: prune,
        theme: form.theme,
      });
      setSaved(result);
      setForm(formOf(result));
      setNotice("设置已保存");
      toast("设置已保存", "ok");
      try {
        await refresh();
      } catch {
        setNotice("设置已保存，运行状态稍后更新");
      }
    } catch (e) {
      setError(errorMessage(e));
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  }
  async function checkConnections() {
    setChecking(true);
    try {
      const data = await request("POST", "/api/assistant/check");
      setAssistant(data);
      setAssistantError("");
    } catch (e) {
      setAssistantError(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }
  if (loading)
    return (
      <div className="wk-page">
        <p className="muted" role="status">
          正在读取设置…
        </p>
      </div>
    );
  if (!form || !saved)
    return (
      <div className="wk-page">
        <div className="card wk-error" role="alert">
          <span>{error || "设置暂时无法读取"}</span>
          <Button onClick={() => setAttempt((n) => n + 1)}>重新加载</Button>
        </div>
      </div>
    );
  const min = saved.min_memory_budget_gib ?? 6,
    max = saved.max_memory_budget_gib ?? 12;
  const engine = status?.engine;
  const model = status?.models;
  const memory = saved.machine_ram_gib ?? status?.memory?.machine_ram_gib;
  const loras = status?.loras?.adapters?.filter((a: any) => a.valid) || [];
  return (
    <div className="wk-page wk-settings-page">
      <div className="wk-settings-layout">
        <form className="card wk-settings-form" onSubmit={save}>
          <div className="row between wk-section-heading">
            <h2>生成与外观</h2>
            {memory && (
              <span className="muted small">
                {Math.round(memory)} GB 统一内存
              </span>
            )}
          </div>
          <label className="field">
            <span>默认生成预设</span>
            <Select
              value={form.default_preset}
              onChange={(e) => change("default_preset", e.target.value)}
            >
              <option value="fast">快速 · AR 8bit</option>
              <option value="quality">高质量 · bf16</option>
              <option value="custom">自定义参数</option>
            </Select>
            <small className="muted">
              16 GB 内存建议使用快速预设；高质量预设需要更多内存。
            </small>
          </label>
          <label className="field">
            <span>低内存模式</span>
            <Select
              value={form.low_memory}
              onChange={(e) => change("low_memory", e.target.value)}
            >
              <option value="on">开启</option>
              <option value="auto">自动选择</option>
              <option value="off">关闭</option>
            </Select>
            <small className="muted">依次加载模型，减少峰值内存占用。</small>
          </label>
          <div className="field wk-memory-field">
            <span className="row between">
              <span>内存预算</span>
              <strong>{form.memory_budget_gib} GiB</strong>
            </span>
            <Slider
              label={(value) => `${value} GiB`}
              thumbLabel="内存预算"
              min={min}
              max={max}
              step={1}
              value={form.memory_budget_gib}
              onChange={(value) => change("memory_budget_gib", value)}
            />
            <span className="row between muted small">
              <span>{min} GiB</span>
              <span>{max} GiB</span>
            </span>
            <small className="muted">为系统和其他应用保留足够内存。</small>
          </div>
          <label className="field">
            <span>界面主题</span>
            <Select
              value={form.theme}
              onChange={(e) => change("theme", e.target.value)}
            >
              <option value="system">跟随系统</option>
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </Select>
          </label>
          <Checkbox
            className="wk-check"
            label="仅在接通电源时开始生成"
            checked={form.require_ac}
            onChange={(e) => change("require_ac", e.target.checked)}
          />
          <details className="wk-settings-advanced">
            <summary>高级设置</summary>
            <div className="stack">
              <Checkbox
                className="wk-check"
                label="使用快速计算"
                checked={form.fast_numerics}
                onChange={(e) => change("fast_numerics", e.target.checked)}
              />
              <p className="muted small">
                复现结果时，请保持随机种子与计算模式一致。
              </p>
              <label className="field">
                <span>自动清理闲置上传文件（天）</span>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  value={form.prune}
                  onChange={(e) => change("prune", e.target.value)}
                  placeholder="留空则保留"
                />
                <small className="muted">
                  仅清理未被任务引用的上传文件，不删除已生成作品。
                </small>
              </label>
            </div>
          </details>
          {error && (
            <p className="wk-inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="wk-settings-save row between">
            <span className="muted small" role="status">
              {notice ||
                (dirty ? "有尚未保存的修改" : "生成设置对下一次任务生效")}
            </span>
            <div className="row">
              {dirty && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setForm(formOf(saved));
                    setError("");
                    setNotice("");
                  }}
                >
                  撤销修改
                </Button>
              )}
              <Button type="submit" variant="primary" disabled={busy || !dirty}>
                {busy ? "保存中…" : "保存设置"}
              </Button>
            </div>
          </div>
        </form>
        <aside className="wk-settings-side">
          <section className="card wk-status-card">
            <div className="row between">
              <h2>音乐模型</h2>
              <Badge tone={model?.present ? "ok" : "neutral"}>
                {model ? (model.present ? "本机已安装" : "模型缺失") : "未连接"}
              </Badge>
            </div>
            {status ? (
              <>
                <strong className="wk-model-name">
                  {model?.name || "YuE2-3B"}
                </strong>
                <p className="muted small">
                  {model?.runtime || "MLX / Apple GPU"} ·{" "}
                  {engine?.precision || "尚未加载"}
                </p>
                <dl className="wk-kv">
                  <dt>运行状态</dt>
                  <dd>
                    {ENGINE_STATE[engine?.state] || engine?.state || "未知"}
                  </dd>
                  <dt>模型内存</dt>
                  <dd>
                    {Number.isFinite(engine?.memory_gib)
                      ? `${engine.memory_gib.toFixed(1)} GiB`
                      : "未加载"}
                  </dd>
                  <dt>等待任务</dt>
                  <dd>{status.queue?.queued || 0}</dd>
                </dl>
                <p className="muted small">
                  快速预设量化 AR 模型，音频合成部分仍为 bf16。
                </p>
                <details className="wk-settings-advanced">
                  <summary>模型文件与版本</summary>
                  <dl className="wk-kv wk-paths">
                    <dt>权重目录</dt>
                    <dd>{model?.converted_dir || "—"}</dd>
                    <dt>解码器目录</dt>
                    <dd>{model?.vae_dir || "—"}</dd>
                    <dt>应用版本</dt>
                    <dd>{status.version}</dd>
                  </dl>
                </details>
              </>
            ) : (
              <p className="muted small">
                无法读取运行状态，请确认本机服务已启动。
              </p>
            )}
          </section>
          <section className="card wk-status-card">
            <div className="row between">
              <h2>AI 助手</h2>
              <Button
                variant="ghost"
                disabled={checking}
                onClick={checkConnections}
              >
                {checking ? "检测中…" : "检测连接"}
              </Button>
            </div>
            {assistant ? (
              <>
                <Capability
                  title="Hermes 对话"
                  available={!!assistant.chat?.available}
                  stateLabel={
                    assistant.chat?.available
                      ? "已连接"
                      : assistant.chat?.configured
                        ? "未连接"
                        : "未配置"
                  }
                  detail={assistant.chat?.model}
                />
                <Capability
                  title="封面生成"
                  available={
                    !!assistant.image?.available && !!assistant.image?.verified
                  }
                  stateLabel={
                    assistant.image?.available && assistant.image?.verified
                      ? "已验证"
                      : assistant.image?.configured
                        ? "待验证"
                        : "未配置"
                  }
                  detail={`${assistant.image?.model || "未配置模型"} · ${assistant.image?.message || ""}`}
                />
              </>
            ) : (
              <p className="muted small">
                {assistantError || "正在检测本机 Hermes…"}
              </p>
            )}
            {assistantError && assistant && (
              <p className="wk-inline-error small" role="alert">
                {assistantError}
              </p>
            )}
            <p className="muted small">对话与封面使用联网模型。</p>
            <Link
              className="btn ghost wk-connect-link"
              to="/assistant?mode=settings"
            >
              管理助手连接 →
            </Link>
          </section>
          <section className="card wk-status-card">
            <h2>扩展功能</h2>
            <Capability
              title="音频改编"
              available={!!status?.cover?.available}
            />
            <Capability title="哼唱创作" available={!!status?.hum?.available} />
            <Capability
              title="LoRA 风格适配"
              available={loras.length > 0}
              detail={`${loras.length} 个可用适配器`}
            />
            <Capability title="MP3 导出" available={!!status?.ffmpeg} />
          </section>
        </aside>
      </div>
    </div>
  );
}

export default SettingsPage;
