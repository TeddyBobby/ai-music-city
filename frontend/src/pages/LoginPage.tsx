import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Divider, Text, TextInput } from "@mantine/core";
import { Mail, ShieldCheck, ArrowRight } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";
import "./Auth.css";

export function LoginPage() {
  const nav = useNavigate();
  const { user, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (user) nav("/home", { replace: true });
  }, [user, nav]);

  useEffect(() => {
    if (cooldown <= 0) return;
    timer.current = window.setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearInterval(timer.current);
  }, [cooldown]);

  async function requestCode() {
    setError("");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("请输入有效的邮箱地址");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/code", { email });
      setSent(true);
      setCooldown(60);
    } catch (e: any) {
      setError(e?.message || "验证码发送失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    setError("");
    if (!code.trim()) {
      setError("请输入验证码");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/login", { email, code });
      await refresh();
      nav("/home", { replace: true });
    } catch (e: any) {
      setError(e?.message || "登录失败，请检查验证码");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-head">
          <div className="auth-logo">
            <Mail size={20} />
          </div>
          <h2>AI乐之城</h2>
          <Text size="sm" c="dimmed">
            {sent ? "验证码已发送，登录或注册只需一步" : "输入邮箱，验证码快捷登录"}
          </Text>
        </div>

        <TextInput
          label="邮箱"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value.trim())}
          disabled={busy}
          autoComplete="email"
        />

        {sent && (
          <TextInput
            label="验证码"
            placeholder="6 位数字"
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            disabled={busy}
            inputMode="numeric"
            maxLength={6}
            onKeyDown={(e) => e.key === "Enter" && login()}
          />
        )}

        {error && (
          <Text size="sm" c="red" className="auth-error">
            {error}
          </Text>
        )}

        {!sent ? (
          <Button fullWidth loading={busy} onClick={requestCode} rightSection={<ArrowRight size={16} />}>
            获取验证码
          </Button>
        ) : (
          <>
            <Button fullWidth loading={busy} onClick={login} rightSection={<ShieldCheck size={16} />}>
              登录 / 注册
            </Button>
            <Button variant="subtle" fullWidth disabled={cooldown > 0} onClick={requestCode}>
              {cooldown > 0 ? `重新发送（${cooldown}s）` : "重新发送验证码"}
            </Button>
          </>
        )}

        <Divider my="sm" label="首次使用的邮箱将自动注册" labelPosition="center" />
        <Text size="xs" c="dimmed" ta="center">
          登录后可保存作品、创作助手会话与播放列表
        </Text>
      </div>
    </div>
  );
}
