import { useState } from "react";
import { Avatar, Popover, Tooltip, UnstyledButton } from "@mantine/core";
import { ArrowUpRight, ChevronDown, Disc3, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import "./UserIdentity.css";

const creatorName = "本机创作者";

export function UserIdentity({
  withinPortal = true,
}: {
  withinPortal?: boolean;
}) {
  const [opened, setOpened] = useState(false);

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
          label={`${creatorName} · 未登录`}
          position="bottom-end"
          openDelay={350}
          disabled={opened}
          events={{ hover: true, focus: true, touch: false }}
        >
          <Popover.Target>
            <UnstyledButton
              type="button"
              className="user-identity-trigger"
              aria-label={`用户身份：${creatorName}，未登录`}
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
                <strong>{creatorName}</strong>
                <small>未登录</small>
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
          aria-label="本机用户身份"
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
              <strong>{creatorName}</strong>
              <span>本机身份</span>
            </div>
          </div>
          <p className="user-identity-note">
            当前使用本机工作台。账号登录将在网站版本接入。
          </p>
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
