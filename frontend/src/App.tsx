import { useEffect, useState } from "react";
import { Tooltip } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
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
  AudioLines,
  Disc3,
  Folder,
  Layers,
  MessageCircle,
  Settings2,
  Lock,
  ChevronRight,
  X,
  ArrowUpRight,
  House,
  Compass,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { readStore, writeStore } from "./lib/utils";
import { useApp } from "./state/app";
import { restorePlayer } from "./state/player";
import { ThemeToggle } from "./components/ThemeToggle";
import { UserIdentity } from "./components/UserIdentity";
import { BrandWordmark } from "./components/BrandWordmark";
import { SubscriptionStatus } from "./components/SubscriptionStatus";
import { MobileNavigation } from "./components/MobileNavigation";
import { FullscreenPlayer } from "./components/FullscreenPlayer";
import { usePlayerOverlay } from "./state/playerOverlay";
import { PlayerBar } from "./components/PlayerBar";
import { IconButton, EmptyState } from "./components/ui";
import { CreatePage } from "./pages/CreatePage";
import { QueuePage } from "./pages/QueuePage";
import { LibraryPage } from "./pages/LibraryPage";
import { AssistantPage } from "./pages/AssistantPage";
import { LoginPage } from "./pages/LoginPage";
import { useAuth } from "./state/auth";
import { ProjectsPage, ProjectPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { HomePage } from "./pages/HomePage";
import { PlazaPage } from "./pages/PlazaPage";
const nav = [
  { to: "/home", label: "首页", icon: House },
  { to: "/plaza", label: "音乐广场", icon: Compass },
  { to: "/create", label: "开始创作", icon: AudioLines },
  { to: "/library", label: "我的作品", icon: Disc3 },
  { to: "/projects", label: "我的项目", icon: Folder },
  { to: "/queue", label: "任务队列", icon: Layers },
  { to: "/assistant", label: "创作助手", icon: MessageCircle },
];
function SidebarContent({
  name,
  count,
  connected,
  ram,
  collapsed = false,
  onNavigate,
}: {
  name: string;
  count: number;
  connected: boolean;
  ram?: number;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      <Link
        className="brand"
        to="/home"
        aria-label="AI乐之城首页"
        onClick={onNavigate}
      >
        <BrandWordmark compact={collapsed} />
      </Link>
      <nav className="sidebar-nav" aria-label="主导航">
        {nav.map(({ to, label, icon: Icon }) => (
          <Tooltip
            key={to}
            label={label}
            position="right"
            disabled={!collapsed}
            openDelay={250}
            events={{ hover: true, focus: true, touch: false }}
          >
            <NavLink
              to={to}
              onClick={onNavigate}
              className={({ isActive }) =>
                isActive ||
                (to === "/library" && ["player", "song"].includes(name)) ||
                (to === "/projects" && name === "project")
                  ? "active"
                  : ""
              }
              aria-label={label}
            >
              <Icon size={17} strokeWidth={1.7} />
              <span>{label}</span>
              {to === "/queue" && count > 0 && (
                <b className="nav-count" aria-label={`${count} 个任务`}>
                  {count}
                </b>
              )}
            </NavLink>
          </Tooltip>
        ))}
      </nav>
      <div className="sidebar-other">
        <div className="sidebar-label">更多创作方式</div>
        <nav className="sidebar-nav" aria-label="更多创作方式">
          <NavLink
            to="/cover"
            onClick={onNavigate}
            aria-label="音频改编（未启用）"
          >
            <Lock size={13} />
            <span>音频改编</span>
            <span className="badge">未启用</span>
          </NavLink>
          <NavLink
            to="/hum"
            onClick={onNavigate}
            aria-label="哼唱成歌（未启用）"
          >
            <Lock size={13} />
            <span>哼唱成歌</span>
            <span className="badge">未启用</span>
          </NavLink>
        </nav>
      </div>
      <div className="sidebar-footer">
        <nav className="sidebar-nav">
          <Tooltip
            label="设置"
            position="right"
            disabled={!collapsed}
            openDelay={250}
            events={{ hover: true, focus: true, touch: false }}
          >
            <NavLink to="/settings" onClick={onNavigate} aria-label="设置">
              <Settings2 size={17} strokeWidth={1.7} />
              <span>设置</span>
            </NavLink>
          </Tooltip>
        </nav>
        <div
          className="engine-summary"
          title={`音乐在这台 Mac 上生成 · ${ram ? Math.round(ram) + " GB" : ""}`}
        >
          <i className={`status-dot ${connected ? "" : "off"}`} />
          <span>{connected ? "服务在线" : "未连接"}</span>
          <Link to="/settings" onClick={onNavigate}>
            {ram ? `${Math.round(ram)} GB` : "连接设置"}
            <ArrowUpRight size={10} />
          </Link>
        </div>
        <SubscriptionStatus collapsed={collapsed} />
      </div>
    </>
  );
}
function Shell() {
  const location = useLocation(),
    app = useApp(),
    name = location.pathname.split("/")[1] || "home";
  const compact = useMediaQuery("(max-width: 760px)", undefined, {
    getInitialValueInEffect: false,
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => readStore<boolean>("sidebar.collapsed", false) === true,
  );
  const collapsed = sidebarCollapsed;
  const toggleLabel = collapsed ? "展开侧边栏" : "收起侧边栏";
  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    writeStore("sidebar.collapsed", next);
  }
  const labels = {
    home: "首页",
    plaza: "音乐广场",
    create: "开始创作",
    library: "我的作品",
    projects: "我的项目",
    project: "我的项目",
    queue: "任务队列",
    assistant: "创作助手",
    player: "播放",
    song: "播放",
    settings: "设置",
    cover: "音频改编",
    hum: "哼唱成歌",
  };
  const e = app.status?.engine,
    connected = !!app.status,
    engineText = !connected
      ? "服务未连接"
      : {
          cold: "等待创作",
          ready: "就绪",
          busy: "生成中",
          loading: "加载模型",
          error: "引擎异常",
        }[e?.state] || "就绪";
  const n =
      (app.status?.queue?.queued || 0) + (app.status?.queue?.running ? 1 : 0),
    ram = app.settings?.machine_ram_gib || app.status?.memory?.machine_ram_gib;
  useEffect(() => {
    app.refresh();
    restorePlayer();
    useAuth.getState().refresh();
    const timer = setInterval(() => useApp.getState().refresh(), 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.title = (labels[name] || "音乐工作台") + " · AI乐之城";
  }, [name]);

  return (
    <div className="app-shell" data-sidebar-collapsed={collapsed}>
      {!compact && (
        <aside
          className="app-sidebar"
          id="app-navigation"
          aria-label="侧边导航"
        >
          <SidebarContent
            name={name}
            count={n}
            connected={connected}
            ram={ram}
            collapsed={collapsed}
          />
        </aside>
      )}
      <section className="app-workspace">
        {!compact && (
          <header className="workspace-topbar">
            <Tooltip label={toggleLabel} position="bottom" openDelay={400}>
              <IconButton
                label={toggleLabel}
                className="sidebar-toggle"
                aria-expanded={!collapsed}
                aria-controls="app-navigation"
                onClick={toggleSidebar}
              >
                {collapsed ? (
                  <PanelLeftOpen size={17} />
                ) : (
                  <PanelLeftClose size={17} />
                )}
              </IconButton>
            </Tooltip>
            <div className="crumb">
              <span>工作台</span>
              <ChevronRight size={11} />
              <span>{labels[name] || "开始创作"}</span>
            </div>
            <div className="topbar-right">
              <div className="topbar-engine">
                <span>创作引擎</span>
                <i className={`status-dot ${connected ? "" : "off"}`} />
                <span>{engineText}</span>
              </div>
              <ThemeToggle />
              <UserIdentity />
            </div>
          </header>
        )}
        <main className={`workspace-content route-${name}`} id="main-content">
          <div className="page-container">
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<Navigate to="/home" replace />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/plaza" element={<PlazaPage />} />
              <Route path="/create" element={<CreatePage />} />
              <Route path="/queue" element={<QueuePage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/song/:id" element={<LegacyPlayer />} />
              <Route path="/player/:id" element={<LegacyPlayer />} />
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/project/:id" element={<ProjectPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/cover" element={<Unavailable title="音频改编" />} />
              <Route path="/hum" element={<Unavailable title="哼唱成歌" />} />
              <Route
                path="*"
                element={
                  <EmptyState title="页面不存在">
                    <Link className="btn" to="/create">
                      返回创作
                    </Link>
                  </EmptyState>
                }
              />
            </Routes>
          </div>
        </main>
      </section>
      <PlayerBar />
      {compact && <MobileNavigation taskCount={n} />}
      <FullscreenPlayer />
      <div className="app-toasts" role="status">
        {app.toasts.map((t) => (
          <div className={`toast-item ${t.kind}`} key={t.id}>
            <span>{t.text}</span>
            <IconButton label="关闭提示" onClick={() => app.dismiss(t.id)}>
              <X size={14} />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}
function LegacyPlayer() {
  const { id } = useParams(),
    navigate = useNavigate();
  useEffect(() => {
    if (id) usePlayerOverlay.getState().open(id);
    navigate("/library", { replace: true });
  }, [id, navigate]);
  return null;
}
function Unavailable({ title }: { title: string }) {
  return (
    <EmptyState
      title={`${title}尚未启用`}
      description="该功能即将上线，敬请期待。"
    >
      <Link className="btn primary" to="/create">
        歌词创作
      </Link>
      <Link className="btn ghost" to="/settings">
        查看模型状态
      </Link>
    </EmptyState>
  );
}
export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
