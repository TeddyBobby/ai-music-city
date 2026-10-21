import { useEffect, useId, useState } from "react";
import { Badge, Drawer, UnstyledButton } from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  AudioLines,
  ChevronRight,
  Compass,
  Disc3,
  Folder,
  House,
  Layers,
  LayoutGrid,
  MessageCircle,
  Settings2,
} from "lucide-react";
import "./MobileNavigation.css";
import { UserIdentity } from "./UserIdentity";
import { ThemeToggle } from "./ThemeToggle";

const primaryItems = [
  { to: "/home", label: "首页", icon: House },
  { to: "/plaza", label: "广场", icon: Compass },
  { to: "/create", label: "创作", icon: AudioLines },
  { to: "/library", label: "作品", icon: Disc3 },
];

const moreItems = [
  { to: "/assistant", label: "创作助手", icon: MessageCircle },
  { to: "/projects", label: "我的项目", icon: Folder },
  { to: "/queue", label: "任务队列", icon: Layers },
  { to: "/settings", label: "设置", icon: Settings2 },
];

const moreRoutes = new Set([
  "assistant",
  "projects",
  "project",
  "queue",
  "settings",
  "cover",
  "hum",
]);

export function MobileNavigation({ taskCount }: { taskCount: number }) {
  const [opened, setOpened] = useState(false);
  const location = useLocation();
  const drawerId = useId();
  const reducedMotion = useReducedMotion();
  const route = location.pathname.split("/")[1] || "home";
  const moreActive = moreRoutes.has(route);
  const count = Math.max(0, Math.floor(taskCount || 0));

  useEffect(() => {
    setOpened(false);
  }, [location.key, location.pathname]);

  return (
    <>
      <nav className="mobile-navigation" aria-label="底部导航">
        {primaryItems.map(({ to, label, icon: Icon }) => {
          const aliasActive =
            to === "/library" && ["player", "song"].includes(route);
          const active = route === to.slice(1) || aliasActive;

          return (
            <UnstyledButton
              key={to}
              // NavLink computes aria-current from its URL. Legacy playback
              // routes need the library link to retain that same current state.
              component={aliasActive ? Link : NavLink}
              to={to}
              className="mobile-navigation-item"
              data-active={active || undefined}
              aria-current={active ? "page" : undefined}
              onClick={() => setOpened(false)}
            >
              <span className="mobile-navigation-icon" aria-hidden="true">
                <Icon size={21} strokeWidth={active ? 2 : 1.7} />
              </span>
              <span>{label}</span>
            </UnstyledButton>
          );
        })}
        <UnstyledButton
          type="button"
          className="mobile-navigation-item"
          data-active={moreActive || opened || undefined}
          aria-label="更多功能"
          aria-haspopup="dialog"
          aria-expanded={opened}
          aria-controls={opened ? drawerId : undefined}
          aria-current={moreActive ? "page" : undefined}
          onClick={() => setOpened(true)}
        >
          <span className="mobile-navigation-icon" aria-hidden="true">
            <LayoutGrid
              size={21}
              strokeWidth={moreActive || opened ? 2 : 1.7}
            />
            {count > 0 && <i className="mobile-navigation-task-dot" />}
          </span>
          <span>更多</span>
        </UnstyledButton>
      </nav>

      <Drawer
        id={drawerId}
        opened={opened}
        onClose={() => setOpened(false)}
        title="更多功能"
        position="bottom"
        zIndex={450}
        trapFocus
        returnFocus
        closeButtonProps={{ "aria-label": "关闭更多功能" }}
        transitionProps={{ duration: reducedMotion ? 0 : 200 }}
        classNames={{
          content: "mobile-navigation-sheet",
          header: "mobile-navigation-sheet-header",
          title: "mobile-navigation-sheet-title",
          body: "mobile-navigation-sheet-body",
          close: "mobile-navigation-sheet-close",
        }}
      >
        <div className="mobile-navigation-account">
          <UserIdentity withinPortal={false} />
          <ThemeToggle withinPortal={false} />
        </div>
        <nav className="mobile-navigation-more" aria-label="更多功能导航">
          {moreItems.map(({ to, label, icon: Icon }) => {
            const aliasActive = to === "/projects" && route === "project";
            const active = route === to.slice(1) || aliasActive;

            return (
              <UnstyledButton
                key={to}
                component={aliasActive ? Link : NavLink}
                to={to}
                className="mobile-navigation-more-item"
                data-active={active || undefined}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpened(false)}
              >
                <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
                <span>{label}</span>
                {to === "/queue" && count > 0 && (
                  <Badge
                    size="sm"
                    variant="light"
                    className="mobile-navigation-task-count"
                    aria-label={`${count} 个任务`}
                  >
                    {count > 99 ? "99+" : count}
                  </Badge>
                )}
                <ChevronRight
                  size={16}
                  className="mobile-navigation-more-chevron"
                  aria-hidden="true"
                />
              </UnstyledButton>
            );
          })}
        </nav>
      </Drawer>
    </>
  );
}
