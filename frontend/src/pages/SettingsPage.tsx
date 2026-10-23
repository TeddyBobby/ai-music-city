import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { errorMessage } from "../lib/utils";
import { useApp } from "../state/app";
import { useAuth } from "../state/auth";
import { Button, Select } from "../components/ui";
import { AssistantConnectionSettings } from "../components/AssistantConnectionSettings";
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
    return () => {
      active = false;
    };
  }, [attempt, user?.id]);

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
      try {
        await refresh();
      } catch {
        setNotice("设置已保存，状态稍后更新");
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <div className="preferences-page">
        <p className="preferences-hint" role="status">
          正在读取设置…
        </p>
      </div>
    );
  if (!form || !saved)
    return (
      <div className="preferences-page">
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
              不影响已生成的歌曲
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
        </header>
        <AssistantConnectionSettings />
      </section>
    </div>
  );
}
