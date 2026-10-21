import { useEffect, type ReactNode } from "react";
import { MantineProvider, createTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useApp } from "../state/app";
import { readStore, writeStore } from "../lib/utils";

const theme = createTheme({
  primaryColor: "sage",
  primaryShade: { light: 6, dark: 3 },
  defaultRadius: "md",
  fontFamily:
    'Inter,-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif',
  fontSizes: { xs: "11px", sm: "12px", md: "13px", lg: "15px", xl: "20px" },
  headings: {
    fontFamily: "inherit",
    sizes: {
      h1: { fontSize: "24px" },
      h2: { fontSize: "18px" },
      h3: { fontSize: "14px" },
    },
  },
  colors: {
    sage: [
      "#f5f9ef",
      "#e7f2d9",
      "#d4e9b7",
      "#bce889",
      "#9ac865",
      "#79a948",
      "#527e30",
      "#436b29",
      "#345422",
      "#29441c",
    ],
    dark: [
      "#e8eee9",
      "#c6d1c9",
      "#93a398",
      "#73877b",
      "#405448",
      "#2b382f",
      "#202b23",
      "#18211b",
      "#101612",
      "#0c110e",
    ],
  },
  components: {
    Button: {
      defaultProps: { size: "sm", radius: "md" },
      styles: { label: { gap: 7, fontSize: 12, fontWeight: 500 } },
    },
    ActionIcon: { defaultProps: { radius: "md" } },
    TextInput: { defaultProps: { size: "sm" } },
    Textarea: { defaultProps: { size: "sm" } },
    Select: { defaultProps: { size: "sm" } },
    MultiSelect: { defaultProps: { size: "sm" } },
    Checkbox: {
      defaultProps: { size: "xs" },
      styles: {
        body: { alignItems: "center" },
        label: { fontSize: 12, paddingLeft: 8 },
        input: { cursor: "pointer" },
      },
    },
    Slider: {
      defaultProps: { size: 3, thumbSize: 10 },
      styles: {
        track: { background: "var(--line)" },
        bar: { background: "var(--accent)" },
        thumb: { background: "var(--accent)", borderColor: "var(--accent)" },
      },
    },
    Badge: {
      styles: {
        root: { textTransform: "none", fontWeight: 500, letterSpacing: 0 },
      },
    },
    Menu: {
      defaultProps: {
        shadow: "md",
        radius: "md",
        zIndex: 650,
        transitionProps: { transition: "pop-top-right", duration: 150 },
      },
    },
  },
});
export function StudioProvider({ children }: { children: ReactNode }) {
  const mode = useApp((s) => s.settings?.theme) || readStore("theme", "dark");
  const dark = useMediaQuery("(prefers-color-scheme:dark)");
  const scheme =
    mode === "system"
      ? dark
        ? "dark"
        : "light"
      : mode === "light"
        ? "light"
        : "dark";
  useEffect(() => {
    document.documentElement.dataset.theme = scheme;
    writeStore("theme", mode);
  }, [mode, scheme]);
  const palette = {
    "--mantine-color-body": "var(--bg)",
    "--mantine-color-text": "var(--text)",
    "--mantine-color-dimmed": "var(--muted)",
    "--mantine-color-placeholder": "var(--muted)",
    "--mantine-color-default": "var(--surface)",
    "--mantine-color-default-hover": "var(--surface-2)",
    "--mantine-color-default-border": "var(--line)",
    "--mantine-color-default-color": "var(--text)",
  };
  return (
    <MantineProvider
      theme={theme}
      forceColorScheme={scheme}
      cssVariablesResolver={() => ({
        variables: {},
        light: palette,
        dark: palette,
      })}
    >
      {children}
    </MantineProvider>
  );
}
