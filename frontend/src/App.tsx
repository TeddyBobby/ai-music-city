import { useEffect, useState, type CSSProperties } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { Menu, Loader, ActionIcon } from "@mantine/core";
import {
  HashRouter,
  NavLink,
  Route,
  Routes,
  useLocation,
  Link,
  Navigate,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  X,
  LogOut,
  Settings,
  Sparkles,
  MessageCircle,
  Music2,
  ChevronDown,
  Crown,
  ArrowLeft,
  Github,
} from "lucide-react";
import { useApp } from "./state/app";
import {
  restorePlayer,
  resetPlayerForAccount,
  usePlayer,
} from "./state/player";
import { useAuth } from "./state/auth";
import {
  accountChangeKey,
  leaveAccount,
  registerAccountCleanup,
} from "./lib/accountBoundary";
import { assistantConversation } from "./lib/assistantConversation";
import { ThemeToggle } from "./components/ThemeToggle";
import { BrandWordmark } from "./components/BrandWordmark";
import { useViewportLayout } from "./hooks/useViewportLayout";
import { MobileNavigation } from "./components/MobileNavigation";
import { FullscreenPlayer } from "./components/FullscreenPlayer";
import { usePlayerOverlay } from "./state/playerOverlay";
import { PlayerBar } from "./components/PlayerBar";
import { IconButton } from "./components/ui";
import { LibraryPage } from "./pages/LibraryPage";
import { AssistantPage } from "./pages/AssistantPage";
import { SettingsPage } from "./pages/SettingsPage";
import { HomePage } from "./pages/HomePage";
import { GenerationPage } from "./pages/GenerationPage";
import { LoginPage } from "./pages/LoginPage";
import { AdminPage } from "./pages/AdminPage";
import { PricingPage } from "./pages/PricingPage";
import { SubscriptionStatus } from "./components/SubscriptionStatus";

const destinations = [
  { to: "/home", label: "创作", icon: Sparkles },
  { to: "/assistant", label: "AI 助手", icon: MessageCircle },
  { to: "/library", label: "我的音乐", icon: Music2 },
];

function Shell() {
  const location = useLocation();
  const app = useApp();
  const route = location.pathname.split("/")[1] || "home";
  const standalone = route === "pricing";
  const pricingFrom = location.state?.pricingFrom;
  const pricingReturn =
    typeof pricingFrom === "string" &&
    /^\/(?:home|assistant|library|settings|generation)(?:[/?#]|$)/.test(
      pricingFrom,
    )
      ? pricingFrom
      : "/home";
  const compact = useMediaQuery("(max-width: 760px)", undefined, {
    getInitialValueInEffect: false,
  });
  const desktop = useMediaQuery("(min-width: 1024px)", undefined, {
    getInitialValueInEffect: false,
  });
  const hasPlayer = usePlayer((s) => !!s.current || s.queue.length > 0);
  const showPlayerBar = !standalone && !(compact && route === "home");
  const reservePlayer = hasPlayer && showPlayerBar;
  const { keyboardOpen, viewportHeight, keyboardInset } = useViewportLayout();
  const taskCount =
    (app.status?.queue?.queued || 0) + (app.status?.queue?.running ? 1 : 0);
  const pageTitle =
    destinations.find((item) => item.to === location.pathname)?.label ||
    (route === "generation"
      ? "音乐创作"
      : route === "settings"
        ? "个人设置"
        : route === "pricing"
          ? "订阅与定价"
          : "音乐");

  useEffect(() => {
    // Portal dialogs and the composer use the same visible keyboard bounds.
    const root = document.documentElement;
    root.style.setProperty("--app-viewport-height", `${viewportHeight}px`);
    root.dataset.keyboardOpen = String(keyboardOpen);
    const frame = requestAnimationFrame(() => {
      const field = document.activeElement;
      if (!keyboardOpen || !(field instanceof HTMLElement)) return;
      const bounds = field.getBoundingClientRect();
      if (bounds.bottom > viewportHeight - 12 || bounds.top < 0) {
        field.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      root.style.removeProperty("--app-viewport-height");
      delete root.dataset.keyboardOpen;
    };
  }, [keyboardOpen, viewportHeight]);

  useEffect(() => {
    void useApp.getState().refresh();
    restorePlayer();
    // 5 秒轮询在游客态暂停：未登录时引擎/设置状态不会变化，避免公网链路慢时反复请求
    const tick = () => {
      if (useAuth.getState().user === null) return;
      void useApp.getState().refresh();
    };
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.title = `${pageTitle} · AI乐之城`;
  }, [pageTitle]);

  return (
    <div
      className="app-shell"
      data-layout={desktop ? "desktop" : compact ? "mobile" : "tablet"}
      data-keyboard-open={keyboardOpen}
      data-has-player={reservePlayer}
      data-standalone={standalone}
      style={
        {
          "--app-viewport-height": `${viewportHeight}px`,
          "--keyboard-inset": `${keyboardInset}px`,
          "--player-height": reservePlayer ? "var(--dock)" : "0px",
        } as CSSProperties
      }
    >
      {desktop && !standalone && <DesktopNavigation taskCount={taskCount} />}
      <section className="app-workspace">
        <header className="workspace-topbar">
          {standalone ? (
            <Link className="pricing-back-link" to={pricingReturn}>
              <ArrowLeft size={18} aria-hidden="true" />
              <span>返回</span>
            </Link>
          ) : desktop ? (
            <div className="desktop-page-path" aria-label="当前位置">
              <strong>{pageTitle}</strong>
            </div>
          ) : (
            <Link className="music-brand" to="/home" aria-label="AI乐之城首页">
              <BrandWordmark />
            </Link>
          )}
          {!standalone && !compact && !desktop && (
            <nav className="music-navigation" aria-label="主导航">
              {destinations.map(({ to, label }) => (
                <NavLink key={to} to={to}>
                  {label}
                  {to === "/library" && taskCount > 0 && (
                    <i aria-label={`${taskCount} 首正在生成`} />
                  )}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="topbar-right">
            {!standalone && desktop && taskCount > 0 && (
              <Link className="desktop-task-link" to="/library">
                <span aria-hidden="true" />
                {taskCount} 首正在生成
              </Link>
            )}
            <ActionIcon
              component="a"
              href="https://github.com/TeddyBobby"
              target="_blank"
              rel="noopener noreferrer"
              variant="subtle"
              color="gray"
              size={44}
              className="topbar-github"
              aria-label="TeddyBobby 的 GitHub 主页（新标签页）"
              title="GitHub · TeddyBobby"
            >
              <Github size={19} strokeWidth={1.7} aria-hidden="true" />
            </ActionIcon>
            <ThemeToggle />
            <AccountMenu showName={desktop} />
          </div>
        </header>
        <main className={`workspace-content route-${route}`} id="main-content">
          <div className="page-container">
            <Routes>
              <Route path="/home" element={<HomePage />} />
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/generation/:id" element={<GenerationPage />} />
              <Route path="/song/:id" element={<LegacyPlayer />} />
              <Route path="/player/:id" element={<LegacyPlayer />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/hum"
                element={<Navigate to="/home?mode=hum" replace />}
              />
              <Route
                path="/queue"
                element={<Navigate to="/library" replace />}
              />
              <Route
                path="/projects"
                element={<Navigate to="/library" replace />}
              />
              <Route
                path="/project/:id"
                element={<Navigate to="/library" replace />}
              />
              <Route
                path="/plaza"
                element={<Navigate to="/library" replace />}
              />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          </div>
        </main>
      </section>
      {showPlayerBar && <PlayerBar />}
      {compact && !standalone && <MobileNavigation taskCount={taskCount} />}
      <FullscreenPlayer />
      <div className="app-toasts" role="status">
        {app.toasts.map((toast) => (
          <div className={`toast-item ${toast.kind}`} key={toast.id}>
            <span>{toast.text}</span>
            <IconButton label="关闭提示" onClick={() => app.dismiss(toast.id)}>
              <X size={14} />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

function DesktopNavigation({ taskCount }: { taskCount: number }) {
  return (
    <aside className="desktop-navigation" aria-label="工作区侧栏">
      <Link
        className="music-brand desktop-brand"
        to="/home"
        aria-label="AI乐之城首页"
      >
        <BrandWordmark />
      </Link>
      <nav className="desktop-destinations" aria-label="主导航">
        {destinations.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}>
            <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
            <span>{label}</span>
            {to === "/library" && taskCount > 0 && (
              <span
                className="desktop-task-count"
                aria-label={`${taskCount} 首正在生成`}
              >
                {taskCount}
              </span>
            )}
          </NavLink>
        ))}
        <NavLink to="/settings">
          <Settings size={19} strokeWidth={1.7} aria-hidden="true" />
          <span>设置</span>
        </NavLink>
      </nav>
      <div className="desktop-utilities">
        <SubscriptionStatus />
      </div>
    </aside>
  );
}

function AccountMenu({ showName = false }: { showName?: boolean }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user)
    return (
      <Link to="/login" className="account-guest-login" aria-label="登录">
        <span className="account-avatar" aria-hidden="true">?</span>
        {showName && <span className="account-name">登录</span>}
      </Link>
    );
  return (
    <Menu position="bottom-end" width={240}>
      <Menu.Target>
        <button
          className={`account-menu-trigger${showName ? " account-menu-with-name" : ""}`}
          aria-label="我的账号"
          title={user.email}
        >
          <span className="account-avatar" aria-hidden="true">
            {user.email.charAt(0).toUpperCase()}
          </span>
          {showName && (
            <span className="account-name">{user.email.split("@")[0]}</span>
          )}
          {showName && <ChevronDown size={13} aria-hidden="true" />}
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>我的账号</Menu.Label>
        <div className="account-menu-email">{user.email}</div>
        {user.is_admin && (
          <Menu.Item
            component={Link}
            to="/admin"
            leftSection={<Settings size={15} />}
          >
            管理控制台
          </Menu.Item>
        )}
        <Menu.Item
          component={Link}
          to="/pricing"
          state={{
            pricingFrom:
              location.pathname === "/pricing"
                ? location.state?.pricingFrom
                : location.pathname + location.search,
          }}
          leftSection={<Crown size={15} />}
        >
          订阅与定价
        </Menu.Item>
        <Menu.Item
          component={Link}
          to="/settings"
          leftSection={<Settings size={15} />}
        >
          个人设置
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          leftSection={<LogOut size={15} />}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await logout();
            } catch (error) {
              useApp
                .getState()
                .toast(
                  error instanceof Error ? error.message : "退出失败，请重试。",
                  "error",
                );
              setBusy(false);
            }
          }}
        >
          {busy ? "正在退出…" : "退出登录"}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function AuthGate() {
  const { user, loading, error, refresh } = useAuth();
  const location = useLocation();
  // 登录页是独立全屏页：不进 Shell（无侧边栏/顶栏/播放条），登录后再回到应用。
  const onLoginPage = location.pathname.startsWith("/login");
  useEffect(() => {
    const unregister = registerAccountCleanup(() => {
      resetPlayerForAccount();
      usePlayerOverlay.setState({
        jobId: null,
        opened: false,
        initialView: "cover",
      });
      assistantConversation.dispose();
      useApp.setState({ status: null, settings: null, toasts: [] });
    });
    const accountChanged = (event: StorageEvent) => {
      if (event.key !== accountChangeKey || !event.newValue) return;
      let user: string | null = null;
      try {
        const value = JSON.parse(event.newValue);
        user = typeof value.user === "string" ? value.user : null;
      } catch {}
      leaveAccount(user, false);
    };
    const revalidate = () => {
      // 游客态不需要在每次聚焦时重拉登录状态（公网链路慢，会造成页面反复“加载中”）；
      // 登录态也仅在会话较旧时刷新。
      if (document.hidden) return;
      const known = useAuth.getState();
      if (known.user === null && !known.loading) return;
      void refresh();
    };
    window.addEventListener("storage", accountChanged);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    void refresh();
    return () => {
      unregister();
      window.removeEventListener("storage", accountChanged);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [refresh]);
  if (loading)
    return (
      <div className="auth-loading" role="status">
        <div className="auth-loading-brand">
          <span className="auth-loading-note" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </span>
          <strong>AI乐之城</strong>
        </div>
        <span className="auth-loading-text">正在加载…</span>
      </div>
    );
  if (!user && error)
    return (
      <div className="auth-loading" role="alert">
        <div className="auth-loading-brand">
          <strong>AI乐之城</strong>
        </div>
        <p>{error}</p>
        <button className="btn" onClick={() => void refresh()}>
          重新连接
        </button>
      </div>
    );
  if (onLoginPage)
    return (
      <div className="app-shell" data-standalone="true">
        <LoginPage />
      </div>
    );
  // 游客可浏览：未登录也进入主界面，需要登录的操作（生成等）由后端 401 引导跳转登录。
  return <Shell />;
}

function LegacyPlayer() {
  const { id } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (id) usePlayerOverlay.getState().open(id);
    navigate("/library", { replace: true });
  }, [id, navigate]);
  return null;
}

export default function App() {
  return (
    <HashRouter>
      <AuthGate />
    </HashRouter>
  );
}
