import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, request } from "../lib/api";
import { errorMessage } from "../lib/utils";
import { useApp } from "../state/app";
import { useAuth } from "../state/auth";
import { Badge, Button, Input, Select } from "../components/ui";
import "./Workspace.css";

type PrefValues = {
  theme: string;
  prune: string;
};
const prefOf = (s: any): PrefValues => ({
  theme: s.theme || "system",
  prune: s.prune_uploads_days == null ? "" : String(s.prune_uploads_days),
});

export function SettingsPage() {
  const { settings, refresh, toast } = useApp();
  const { user, logout } = useAuth();
  const [saved, setSaved] = useState<any>(null);
  const [form, setForm] = useState<PrefValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [assistant, setAssistant] = useState<any>(null);
  const [assistantError, setAssistantError] = useState("");
  const [checking, setChecking] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  const [agentUrl, setAgentUrl] = useState("");
  const [agentKey, setAgentKey] = useState("");
  const [agentNotice, setAgentNotice] = useState("");
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
          setForm(prefOf(data));
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
    request("GET", "/api/assistant/config")
      .then((data: any) => {
        if (active) setAgentUrl(data.hermes_base_url || "");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (!settings?.theme) return;
    setSaved((old: any) => (old ? { ...old, theme: settings.theme } : old));
    setForm((old) => (old ? { ...old, theme: settings.theme } : old));
  }, [settings?.theme]);

  const dirty = !!form && !!saved && JSON.stringify(form) !== JSON.stringify(prefOf(saved));
  const change = <K extends keyof PrefValues>(key: K, value: PrefValues[K]) => {
    setForm((old) => (old ? { ...old, [key]: value } : old));
    setNotice("");
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || busy) return;
    const prune = form.prune.trim() ? Number(form.prune) : null;
    if (prune !== null && (!Number.isInteger(prune) || prune < 1 || prune > 365)) {
      setError("清理天数需为 1–365，留空表示保留。");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api.saveSettings({
        theme: form.theme,
        prune_uploads_days: prune,
      });
      setSaved(result);
      setForm(prefOf(result));
      setNotice("设置已保存");
      toast("设置已保存", "ok");
      try {
        await refresh();
      } catch {
        setNotice("设置已保存，状态稍后更新");
      }
    } catch (e) {
      setError(errorMessage(e));
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  }

  async function saveAgent(event: FormEvent) {
    event.preventDefault();
    if (savingAgent) return;
    setSavingAgent(true);
    setAgentNotice("");
    try {
      const patch: any = { hermes_base_url: agentUrl.trim() };
      if (agentKey.trim()) patch.hermes_api_key = agentKey.trim();
      await request("PUT", "/api/assistant/config", patch);
      setAgentKey("");
      setAgentNotice("已保存");
      const data = await request("POST", "/api/assistant/check");
      setAssistant(data);
      toast("Agent 连接已保存", "ok");
    } catch (e) {
      setAgentNotice(errorMessage(e));
    } finally {
      setSavingAgent(false);
    }
  }

  async function testConnection() {
    setChecking(true);
    setAgentNotice("");
    try {
      const data = await request("POST", "/api/assistant/check");
      setAssistant(data);
      setAgentNotice(
        data?.chat?.available ? "连接成功" : data?.chat?.message || "连接失败",
      );
    } catch (e) {
      setAgentNotice(errorMessage(e));
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

  return (
    <div className="wk-page wk-settings-page">
      <div className="wk-settings-layout">
        <div className="wk-settings-col">
          <section className="card wk-status-card">
            <h2>账户</h2>
            {user ? (
              <>
                <div className="row between" style={{ marginBottom: 8 }}>
                  <span className="wk-account-email">{user.email}</span>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      await logout();
                      toast("已退出登录", "ok");
                    }}
                  >
                    退出登录
                  </Button>
                </div>
                <p className="muted small">邮箱账号 · 已登录</p>
              </>
            ) : (
              <>
                <p className="muted small" style={{ marginBottom: 10 }}>
                  登录后可保存作品、创作助手会话与播放列表。
                </p>
                <Link className="btn primary" to="/login">
                  邮箱快捷登录 →
                </Link>
              </>
            )}
          </section>

          <section className="card wk-status-card">
            <h2>Agent 连接</h2>
            <p className="muted small">
              配置创作助手的 AI 服务地址与密钥，用于对话、写词与曲风构思。
            </p>
            <form onSubmit={saveAgent} className="wk-agent-form">
              <label className="field">
                <span>服务地址（Base URL）</span>
                <Input
                  value={agentUrl}
                  onChange={(e: any) => setAgentUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  type="url"
                />
              </label>
              <label className="field">
                <span>API Key</span>
                <Input
                  value={agentKey}
                  onChange={(e: any) => setAgentKey(e.target.value)}
                  placeholder={assistant?.chat?.configured ? "已配置（输入可更换）" : "sk-…"}
                  type="password"
                />
              </label>
              {agentNotice && (
                <p className={agentNotice === "连接成功" || agentNotice === "已保存" ? "muted small" : "wk-inline-error small"} role="status">
                  {agentNotice}
                </p>
              )}
              <div className="row">
                <Button type="submit" variant="primary" disabled={savingAgent}>
                  {savingAgent ? "保存中…" : "保存"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={checking || !assistant?.chat?.configured}
                  onClick={testConnection}
                >
                  {checking ? "测试中…" : "测试连接"}
                </Button>
              </div>
            </form>
            {assistant?.chat && (
              <div className="wk-agent-status row between" style={{ marginTop: 10 }}>
                <span className="muted small">
                  {assistant.chat.model || "未选择模型"}
                </span>
                <Badge tone={assistant.chat.available ? "ok" : "neutral"}>
                  {assistant.chat.available ? "已连接" : "未连接"}
                </Badge>
              </div>
            )}
          </section>

          <form className="card wk-settings-form" onSubmit={save}>
            <h2>偏好</h2>
            <label className="field">
              <span>外观</span>
              <Select
                value={form.theme}
                onChange={(e) => change("theme", e.target.value)}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </Select>
            </label>
            <label className="field">
              <span>上传文件保留天数</span>
              <Select value={form.prune ? "30" : ""} onChange={(e) => change("prune", e.target.value)}>
                <option value="">永久保留</option>
                <option value="30">30 天</option>
              </Select>
              <small className="muted">
                仅清理未被任务引用的上传文件，不删除已生成作品。
              </small>
            </label>
            {error && (
              <p className="wk-inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="wk-settings-save row between">
              <span className="muted small" role="status">
                {notice || (dirty ? "有尚未保存的修改" : "偏好对下次操作生效")}
              </span>
              <Button type="submit" variant="primary" disabled={busy || !dirty}>
                {busy ? "保存中…" : "保存偏好"}
              </Button>
            </div>
          </form>
        </div>

        <aside className="wk-settings-side">
          <section className="card wk-status-card">
            <div className="row between">
              <h2>AI 助手</h2>
              <Button
                variant="ghost"
                disabled={checking}
                onClick={testConnection}
              >
                {checking ? "检测中…" : "检测连接"}
              </Button>
            </div>
            {assistant ? (
              <div className="wk-capability">
                <div className="row between">
                  <span>Agent 对话</span>
                  <Badge tone={assistant.chat?.available ? "ok" : "neutral"}>
                    {assistant.chat?.available
                      ? "已连接"
                      : assistant.chat?.configured
                        ? "未连接"
                        : "未配置"}
                  </Badge>
                </div>
                <p className="muted small">
                  {assistant.chat?.model || "未选择模型"}
                </p>
              </div>
            ) : (
              <p className="muted small">{assistantError || "正在检测…"}</p>
            )}
            {assistantError && assistant && (
              <p className="wk-inline-error small" role="alert">
                {assistantError}
              </p>
            )}
            <p className="muted small">对话使用联网模型，需配置 Agent 连接。</p>
            <Link className="btn ghost wk-connect-link" to="/assistant">
              进入创作助手 →
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
