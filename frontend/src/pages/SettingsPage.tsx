import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { api, request } from "../lib/api";
import { errorMessage } from "../lib/utils";
import { useApp } from "../state/app";
import { useAuth } from "../state/auth";
import { Badge, Button, Input, Select } from "../components/ui";
import "./Settings.css";

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
    if (user?.is_admin)
      request("GET", "/api/assistant/config")
        .then((data: any) => {
          if (active) setAgentUrl(data.hermes_base_url || "");
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [attempt, user?.is_admin]);

  useEffect(() => {
    if (!settings?.theme) return;
    setSaved((old: any) => (old ? { ...old, theme: settings.theme } : old));
    setForm((old) => (old ? { ...old, theme: settings.theme } : old));
  }, [settings?.theme]);

  const dirty =
    !!form && !!saved && JSON.stringify(form) !== JSON.stringify(prefOf(saved));
  const change = <K extends keyof PrefValues>(key: K, value: PrefValues[K]) => {
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
      toast("助手连接已保存", "ok");
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
      <div className="preferences-page">
        <h1>设置</h1>
        <p className="preferences-hint" role="status">
          正在读取设置…
        </p>
      </div>
    );
  if (!form || !saved)
    return (
      <div className="preferences-page">
        <h1>设置</h1>
        <div
          className="preferences-section preferences-load-error"
          role="alert"
        >
          <span>{error || "设置暂时无法读取"}</span>
          <Button onClick={() => setAttempt((n) => n + 1)}>重新加载</Button>
        </div>
      </div>
    );

  return (
    <div className="preferences-page">
      <h1>设置</h1>

      <section
        className="preferences-section"
        aria-labelledby="preferences-account-title"
      >
        <header className="preferences-section-heading">
          <h2 id="preferences-account-title">账户</h2>
        </header>
        <div className="preferences-row preferences-account-row">
          {user ? (
            <>
              <div className="preferences-account-info">
                <span className="preferences-hint">登录邮箱</span>
                <p className="preferences-email">{user.email}</p>
              </div>
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await logout();
                  } catch (error) {
                    toast(errorMessage(error), "error");
                  }
                }}
              >
                退出登录
              </Button>
            </>
          ) : (
            <>
              <span className="preferences-hint">尚未登录</span>
              <Link className="preferences-login" to="/login">
                登录 / 注册
              </Link>
            </>
          )}
        </div>
      </section>

      <form
        className="preferences-section"
        onSubmit={save}
        aria-labelledby="preferences-general-title"
      >
        <header className="preferences-section-heading">
          <h2 id="preferences-general-title">通用设置</h2>
        </header>
        <div className="preferences-row">
          <label className="preferences-label" htmlFor="preferences-theme">
            界面外观
          </label>
          <Select
            id="preferences-theme"
            className="preferences-control"
            value={form.theme}
            onChange={(e) => change("theme", e.target.value)}
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </Select>
        </div>
        <div className="preferences-row">
          <div className="preferences-label-group">
            <label
              className="preferences-label"
              htmlFor="preferences-retention"
            >
              上传素材保留时间
            </label>
            <p className="preferences-hint" id="preferences-retention-help">
              仅清理闲置素材，已生成的歌曲不受影响。
            </p>
          </div>
          <Select
            id="preferences-retention"
            aria-describedby="preferences-retention-help"
            className="preferences-control"
            value={form.prune}
            onChange={(e) => change("prune", e.target.value)}
          >
            <option value="">一直保留</option>
            {form.prune && form.prune !== "30" && (
              <option value={form.prune}>{form.prune} 天</option>
            )}
            <option value="30">30 天</option>
          </Select>
        </div>
        {error && (
          <p className="preferences-error preferences-feedback" role="alert">
            {error}
          </p>
        )}
        <div className="preferences-actions">
          <span className="preferences-hint" role="status">
            {notice || (dirty ? "有未保存的更改" : "")}
          </span>
          <Button type="submit" variant="primary" disabled={busy || !dirty}>
            {busy ? "保存中…" : "保存更改"}
          </Button>
        </div>
      </form>

      <section
        className="preferences-section"
        aria-labelledby="preferences-assistant-title"
      >
        <header className="preferences-section-heading">
          <h2 id="preferences-assistant-title">AI 助手</h2>
          {assistant && (
            <Badge tone={assistant.chat?.available ? "ok" : "neutral"}>
              {assistant.chat?.available
                ? "已连接"
                : assistant.chat?.configured
                  ? "暂未连接"
                  : "未配置"}
            </Badge>
          )}
        </header>
        <div className="preferences-row preferences-connection-row">
          <div className="preferences-label-group">
            <span className="preferences-label">服务连接</span>
            <p className="preferences-hint">
              {assistant
                ? assistant.chat?.available
                  ? "连接正常"
                  : assistant.chat?.configured
                    ? "连接不可用，请重新检测。"
                    : user?.is_admin
                      ? "请在连接设置中配置服务。"
                      : "服务暂未配置，请联系管理员。"
                : assistantError || "正在读取连接状态…"}
            </p>
          </div>
          {user?.is_admin && (
            <Button disabled={checking} onClick={testConnection}>
              {checking ? "检测中…" : "检测连接"}
            </Button>
          )}
        </div>
        {assistantError && assistant && (
          <p className="preferences-error preferences-feedback" role="alert">
            {assistantError}
          </p>
        )}

        {user?.is_admin && (
          <details className="preferences-advanced">
            <summary>
              <span>连接设置</span>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <form onSubmit={saveAgent} className="preferences-agent-form">
              <div className="preferences-row">
                <label
                  className="preferences-label"
                  htmlFor="preferences-service-url"
                >
                  服务地址
                </label>
                <Input
                  id="preferences-service-url"
                  className="preferences-control"
                  value={agentUrl}
                  onChange={(e: any) => setAgentUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  type="url"
                  autoComplete="url"
                />
              </div>
              <div className="preferences-row">
                <div className="preferences-label-group">
                  <label
                    className="preferences-label"
                    htmlFor="preferences-service-key"
                  >
                    访问密钥
                  </label>
                  <p className="preferences-hint" id="preferences-key-help">
                    留空保留已保存的密钥。
                  </p>
                </div>
                <Input
                  id="preferences-service-key"
                  className="preferences-control"
                  aria-describedby="preferences-key-help"
                  value={agentKey}
                  onChange={(e: any) => setAgentKey(e.target.value)}
                  placeholder={
                    assistant?.chat?.configured
                      ? "填写以更换密钥"
                      : "输入 API Key"
                  }
                  type="password"
                  autoComplete="new-password"
                />
              </div>
              <div className="preferences-actions">
                <span className="preferences-hint">
                  {assistant?.chat?.model
                    ? `当前模型：${assistant.chat.model}`
                    : ""}
                </span>
                <Button type="submit" variant="primary" disabled={savingAgent}>
                  {savingAgent ? "保存中…" : "保存连接"}
                </Button>
              </div>
            </form>
          </details>
        )}
        {agentNotice && (
          <p
            className={
              agentNotice === "连接成功" || agentNotice === "已保存"
                ? "preferences-hint preferences-feedback"
                : "preferences-error preferences-feedback"
            }
            role="status"
          >
            {agentNotice}
          </p>
        )}
      </section>
    </div>
  );
}
