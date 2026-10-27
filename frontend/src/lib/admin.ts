import { api } from "./api";

export type AdminJobStatus =
  "done" | "failed" | "running" | "queued" | "cancelled";
export interface AdminJobStats extends Record<AdminJobStatus, number> {
  jobs_total: number;
  audio_seconds: number;
  last_created_at: string | null;
}
export interface AdminUser {
  id: string;
  email: string;
  is_admin: number | boolean;
  legacy_owner: number | boolean;
  created_at: number;
  last_login: number | null;
  active: number;
  stats: AdminJobStats;
}
export interface AdminOverview {
  users_total: number;
  sessions_active: number;
  users_active_1d: number;
  users_active_7d: number;
  engine: string;
  fake: boolean;
  jobs_total: number;
  songs_total: number;
  audio_seconds: number;
  job_totals: Record<AdminJobStatus, number>;
}
export interface AdminJob {
  id: string;
  title: string;
  kind: string;
  music_kind: "instrumental" | "vocal";
  status: AdminJobStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  timing: { audio_seconds?: number };
  params: Record<string, unknown>;
  preset?: string;
  precision?: string;
  ode_steps?: number;
  seed?: number;
  progress?: unknown;
  error?: string | null;
  audio_url: string | null;
  download_url: string | null;
}
export const ADMIN_PAGE_SIZE = 20;
export const adminStatusLabels: Record<AdminJobStatus, string> = {
  done: "已完成",
  failed: "失败",
  running: "生成中",
  queued: "排队中",
  cancelled: "已取消",
};
const queryString = (query: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return params.toString();
};
export const adminApi = {
  overview: (): Promise<AdminOverview> => api.get("/api/admin/overview"),
  users: (
    q: string,
    page: number,
  ): Promise<{ users: AdminUser[]; total: number }> =>
    api.get(
      "/api/admin/users?" +
        queryString({
          q,
          limit: ADMIN_PAGE_SIZE,
          offset: (page - 1) * ADMIN_PAGE_SIZE,
        }),
    ),
  user: (id: string): Promise<{ user: AdminUser }> =>
    api.get(`/api/admin/users/${encodeURIComponent(id)}`),
  jobs: (
    id: string,
    filters: { q: string; status: string; music_kind: string; page: number },
  ): Promise<{ jobs: AdminJob[]; total: number }> =>
    api.get(
      `/api/admin/users/${encodeURIComponent(id)}/jobs?` +
        queryString({
          q: filters.q,
          status: filters.status || undefined,
          music_kind: filters.music_kind || undefined,
          limit: ADMIN_PAGE_SIZE,
          offset: (filters.page - 1) * ADMIN_PAGE_SIZE,
        }),
    ),
};

export function adminDate(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";
}
export function adminDuration(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  const seconds = Math.floor(Math.max(0, value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
