import type { Job } from "./types";
export const titleOf = (job: Partial<Job>) =>
  job?.title ||
  job?.params?.title ||
  job?.params?.style?.slice(0, 50) ||
  "未命名作品";
export const duration = (s: number) => {
  if (!Number.isFinite(s)) return "00:00";
  const n = Math.max(0, Math.floor(s));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};
export const when = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso),
    t = (Date.now() - d.getTime()) / 1000;
  if (t < 60) return "刚刚";
  if (t < 3600) return `${Math.floor(t / 60)} 分钟前`;
  if (t < 86400) return `${Math.floor(t / 3600)} 小时前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
};
export const statusLabel = (s: string) =>
  ({
    done: "已完成",
    failed: "生成失败",
    cancelled: "已取消",
    queued: "排队中",
    running: "生成中",
  })[s] || s;
export const presetLabel = (s: string) =>
  ({ fast: "快速 · 8bit", quality: "高质量", custom: "自定义" })[s] || s;
export const errorMessage = (e: any) =>
  /MemoryError|memory pressure|swapping/i.test(e?.message || e || "")
    ? "内存不足，生成已安全停止。关闭暂时不用的应用后，使用快速和低内存模式重试。"
    : e?.message || String(e || "操作失败，请重试。");
export function readStore<T = any>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem("yue2." + key);
    return s === null ? fallback : JSON.parse(s);
  } catch {
    return fallback;
  }
}
export function writeStore(key: string, value: any) {
  try {
    localStorage.setItem("yue2." + key, JSON.stringify(value));
  } catch {}
}
export function removeStore(key: string) {
  try {
    localStorage.removeItem("yue2." + key);
  } catch {}
}
