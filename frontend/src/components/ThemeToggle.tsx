import { useState } from "react";
import { Menu, ActionIcon } from "@mantine/core";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { useApp } from "../state/app";
import { api } from "../lib/api";
import { readStore, writeStore, errorMessage } from "../lib/utils";

const choices = [
  { value: "light", label: "浅色", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
  { value: "system", label: "跟随系统", Icon: Monitor },
];
export function ThemeToggle({
  withinPortal = true,
}: {
  withinPortal?: boolean;
}) {
  const settings = useApp((s) => s.settings),
    toast = useApp((s) => s.toast),
    [saving, setSaving] = useState(false);
  const mode = settings?.theme || readStore("theme", "dark"),
    Icon = choices.find((c) => c.value === mode)?.Icon || Moon;
  async function choose(theme: string) {
    if (saving || theme === mode) return;
    setSaving(true);
    writeStore("theme", theme);
    useApp.setState((s) => ({ settings: { ...s.settings, theme } }));
    try {
      const result = await api.saveSettings({ theme });
      useApp.setState({ settings: result });
    } catch (e) {
      writeStore("theme", mode);
      useApp.setState((s) => ({ settings: { ...s.settings, theme: mode } }));
      toast(errorMessage(e), "err");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Menu position="bottom-end" width={170} withinPortal={withinPortal}>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          className="theme-toggle"
          aria-label="切换主题"
          title="切换主题"
          disabled={saving}
        >
          <Icon size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>外观</Menu.Label>
        {choices.map((c) => (
          <Menu.Item
            key={c.value}
            leftSection={<c.Icon size={15} />}
            rightSection={mode === c.value ? <Check size={14} /> : null}
            onClick={() => choose(c.value)}
            aria-current={mode === c.value ? "true" : undefined}
          >
            {c.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
