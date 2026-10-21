import { useState } from "react";
import { Popover, Tooltip, UnstyledButton } from "@mantine/core";
import { ChevronRight, Crown } from "lucide-react";
import "./SubscriptionStatus.css";

/** Local mode has no billing account; show its real status until billing is connected. */
export function SubscriptionStatus({ collapsed }: { collapsed: boolean }) {
  const [opened, setOpened] = useState(false);

  return (
    <div className="sidebar-subscription" data-collapsed={collapsed}>
      <Popover
        opened={opened}
        onChange={setOpened}
        position="right-end"
        offset={14}
        width={260}
        shadow="md"
        radius="md"
        zIndex={200}
        trapFocus
        returnFocus
      >
        <Tooltip
          label="订阅信息 · 本地版 · 未订阅"
          position="right"
          disabled={!collapsed || opened}
          openDelay={250}
          events={{ hover: true, focus: true, touch: false }}
        >
          <Popover.Target>
            <UnstyledButton
              type="button"
              className="subscription-trigger"
              aria-label="订阅信息：本地版，未订阅"
              aria-expanded={opened}
              onClick={() => setOpened((value) => !value)}
            >
              <span className="subscription-icon" aria-hidden="true">
                <Crown size={18} strokeWidth={1.7} />
              </span>
              <span className="subscription-copy">
                <strong>本地版</strong>
                <small>未订阅</small>
              </span>
              <ChevronRight
                className="subscription-chevron"
                size={14}
                aria-hidden="true"
              />
            </UnstyledButton>
          </Popover.Target>
        </Tooltip>
        <Popover.Dropdown
          className="subscription-details"
          aria-label="订阅信息"
        >
          <div className="subscription-details-heading">
            <strong>我的订阅</strong>
            <span>未订阅</span>
          </div>
          <p>当前使用 AI乐之城本地版，本地创作无需订阅。</p>
          <small>在线订阅暂未开放。</small>
        </Popover.Dropdown>
      </Popover>
    </div>
  );
}
