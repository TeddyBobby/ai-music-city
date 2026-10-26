import { useEffect, useState, type FormEvent } from "react";
import { Button, PasswordInput, TextInput } from "@mantine/core";
import { ArrowRight, AudioLines, LockKeyhole } from "lucide-react";
import { api } from "../lib/api";
import { leaveAccount } from "../lib/accountBoundary";
import { useAuth } from "../state/auth";
import "./Auth.css";

export function LoginPage() {
  const setupRequired = useAuth((s) => s.setupRequired);
  const [register, setRegister] = useState(setupRequired);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = "登录 · AI乐之城";
  }, []);
  const creating = setupRequired || register;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (creating && password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      const result = await api.post(
        creating ? "/api/auth/register" : "/api/auth/login",
        {
          email: email.trim(),
          password,
        },
      );
      // 登录/注册成功后回到首页（leaveAccount 会整页重载，用 hash 控制落点）
      window.location.hash = "#/home";
      leaveAccount(result.user.id);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "暂时无法登录，请稍后重试。",
      );
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-page">
        <section className="auth-story" aria-label="欢迎来到 AI乐之城">
          <span className="auth-brand">
            <AudioLines size={23} /> AI乐之城
          </span>
          <div className="auth-story-copy">
            <h1>
              让想象，
              <br />
              有回响。
            </h1>
          </div>
          <div className="auth-sound-art" aria-hidden="true">
            <div className="auth-sound-disc">
              <span>
                <AudioLines size={32} strokeWidth={1.5} />
              </span>
            </div>
          </div>
        </section>
        <div className="auth-form-area">
          <form className="auth-card" onSubmit={submit}>
            <div className="auth-head">
              <span className="auth-logo">
                <LockKeyhole size={21} />
              </span>
              <h2>{creating ? "创建账号" : "登录"}</h2>
            </div>
            {setupRequired && (
              <p className="auth-setup-note">
                首个账号将接收本机现有的作品和对话。
              </p>
            )}
            <TextInput
              label="邮箱"
              placeholder="you@example.com"
              type="email"
              inputMode="email"
              size="md"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              required
              maxLength={254}
              disabled={busy}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
            />
            <PasswordInput
              label="密码"
              placeholder={creating ? "设置至少 10 位密码" : "输入密码"}
              size="md"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              required
              minLength={creating ? 10 : undefined}
              maxLength={128}
              disabled={busy}
              autoComplete={creating ? "new-password" : "current-password"}
              visibilityToggleButtonProps={{ "aria-label": "显示或隐藏密码" }}
            />
            {creating && (
              <PasswordInput
                label="确认密码"
                placeholder="再次输入密码"
                size="md"
                value={confirm}
                onChange={(e) => setConfirm(e.currentTarget.value)}
                required
                minLength={10}
                maxLength={128}
                disabled={busy}
                autoComplete="new-password"
                visibilityToggleButtonProps={{
                  "aria-label": "显示或隐藏确认密码",
                }}
              />
            )}
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              fullWidth
              loading={busy}
              rightSection={<ArrowRight size={17} />}
            >
              {creating ? "创建账号" : "登录"}
            </Button>
            {!setupRequired && (
              <p className="auth-switch">
                {creating ? "已有账号？" : "没有账号？"}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setRegister(!register);
                    setError("");
                    setPassword("");
                    setConfirm("");
                  }}
                >
                  {creating ? "去登录" : "创建账号"}
                </button>
              </p>
            )}
          </form>
        </div>
      </div>
    </main>
  );
}
