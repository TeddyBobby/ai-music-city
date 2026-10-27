import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Button, PasswordInput, TextInput } from "@mantine/core";
import { ArrowRight, AudioLines } from "lucide-react";
import { useViewportLayout } from "../hooks/useViewportLayout";
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
  const [visualPaused, setVisualPaused] = useState(false);
  const { keyboardOpen, viewportHeight } = useViewportLayout();
  useEffect(() => {
    document.title = "登录 · AI乐之城";
    const updateVisibility = () => setVisualPaused(document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () =>
      document.removeEventListener("visibilitychange", updateVisibility);
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
    <main
      className="auth-screen"
      data-keyboard-open={keyboardOpen}
      data-motion-paused={visualPaused}
      style={
        {
          "--auth-viewport-height": keyboardOpen
            ? `${viewportHeight}px`
            : "100dvh",
        } as CSSProperties
      }
    >
      <div className="auth-page">
        <section className="auth-story" aria-label="欢迎来到 AI乐之城">
          <a
            className="auth-brand"
            href="#/home"
            aria-label="AI乐之城，返回首页"
          >
            <AudioLines size={23} /> AI乐之城
          </a>
          <div className="auth-sound-field" aria-hidden="true">
            <svg viewBox="0 0 900 1000" preserveAspectRatio="xMidYMid slice">
              <defs>
                <linearGradient
                  id="auth-wave-color"
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="1"
                >
                  <stop offset="0%" stopColor="#6a965e" stopOpacity="0.14" />
                  <stop offset="48%" stopColor="#507e56" stopOpacity="0.7" />
                  <stop offset="100%" stopColor="#45887c" stopOpacity="0.16" />
                </linearGradient>
              </defs>
              <g className="auth-wave-ribbon auth-wave-ribbon-back">
                {Array.from({ length: 26 }, (_, index) => (
                  <path
                    key={index}
                    d={`M -200 ${315 + index * 12} C 110 ${520 + index * 9}, 190 ${900 - index * 9}, 465 ${650 - index * 5} S 790 ${200 + index * 10}, 1100 ${360 + index * 13}`}
                  />
                ))}
              </g>
              <g className="auth-wave-ribbon auth-wave-ribbon-front">
                {Array.from({ length: 22 }, (_, index) => (
                  <path
                    key={index}
                    d={`M -180 ${760 + index * 8} C 100 ${470 + index * 5}, 300 ${440 + index * 13}, 550 ${720 + index * 7} S 870 ${1080 - index * 8}, 1100 ${670 + index * 10}`}
                  />
                ))}
              </g>
            </svg>
          </div>
          <div className="auth-story-copy">
            <h1 aria-label="让想象，有回响。">
              {["让想象，", "有回响。"].map((line, lineIndex) => (
                <span className="auth-title-line" key={line} aria-hidden="true">
                  {Array.from(line).map((letter, index) => (
                    <span
                      className="auth-title-letter"
                      key={`${letter}-${index}`}
                      style={
                        {
                          "--letter-index": lineIndex * 4 + index,
                        } as CSSProperties
                      }
                    >
                      {letter}
                    </span>
                  ))}
                </span>
              ))}
            </h1>
          </div>
        </section>
        <div className="auth-form-area">
          <form className="auth-card" onSubmit={submit}>
            <div className="auth-head">
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
