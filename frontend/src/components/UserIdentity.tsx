import { useState } from "react";
import { Avatar, Popover, Tooltip, UnstyledButton } from "@mantine/core";
import { ArrowUpRight, ChevronDown, Disc3, LogIn, LogOut, UserRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../state/auth";
import "./UserIdentity.css";

export function UserIdentity({
  withinPortal = true,
}: {
  withinPortal?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const name = user?.email || "游客";

  return (
    <div className="user-identity" aria-label="用户身份">
      <Popover
        opened={opened}
        onChange={setOpened}
        position="bottom-end"
        offset={12}
        width={264}
        shadow="md"
        radius="md"
        zIndex={650}
        trapFocus
        returnFocus
        withinPortal={withinPortal}
      >
        <Tooltip
          label={user ? `${name} · 已登录` : "未登录"}
          position="bottom-end"
          openDelay={350}
          disabled={opened}
          events={{ hover: true, focus: true, touch: false }}
        >
          <Popover.Target>
            <UnstyledButton
              type="button"
              className="user-identity-trigger"
              aria-label={`用户身份：${name}${user ? "，已登录" : "，未登录"}`}
              onClick={() => setOpened((value) => !value)}
            >
              <Avatar
                size={32}
                radius="xl"
                className="user-identity-avatar"
                aria-hidden="true"
              >
                <UserRound size={17} strokeWidth={1.7} />
              </Avatar>
              <span className="user-identity-label">
                <strong>{user ? name.split("@")[0] : "未登录"}</strong>
                <small>{user ? "已登录" : "点击登录"}</small>
              </span>
              <ChevronDown
                size={13}
                className="user-identity-chevron"
                aria-hidden="true"
              />
            </UnstyledButton>
          </Popover.Target>
        </Tooltip>
        <Popover.Dropdown
          className="user-identity-popover"
          aria-label="用户身份"
        >
          <div className="user-identity-summary">
            <Avatar
              size={40}
              radius="xl"
              className="user-identity-avatar"
              aria-hidden="true"
            >
              <UserRound size={21} strokeWidth={1.7} />
            </Avatar>
            <div>
              <strong>{user ? name : "游客"}</strong>
              <span>{user ? "邮箱账号" : "未登录"}</span>
            </div>
          </div>
          {!user ? (
            <>
              <p className="user-identity-note">
                登录后可保存作品与创作助手会话。
              </p>
              <UnstyledButton
                component={Link}
                to="/login"
                className="user-identity-link"
                onClick={() => setOpened(false)}
              >
                <LogIn size={16} aria-hidden="true" />
                <span>邮箱快捷登录</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </UnstyledButton>
            </>
          ) : (
            <UnstyledButton
              type="button"
              className="user-identity-link"
              onClick={async () => {
                setOpened(false);
                await logout();
                nav("/home");
              }}
            >
              <LogOut size={16} aria-hidden="true" />
              <span>退出登录</span>
            </UnstyledButton>
          )}
          <UnstyledButton
            component={Link}
            to="/plaza"
            className="user-identity-link"
            onClick={() => setOpened(false)}
          >
            <Disc3 size={16} aria-hidden="true" />
            <span>音乐广场</span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </UnstyledButton>
        </Popover.Dropdown>
      </Popover>
    </div>
  );
}
