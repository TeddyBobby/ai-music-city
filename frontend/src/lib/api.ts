import type { LyricsAlignment } from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function request(
  method: string,
  path: string,
  body?: any,
  opts: any = {},
) {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(
      0,
      "network_error",
      "服务暂时不可用，请稍后重试。",
    );
  }
  if (res.status === 204) return null;
  const raw = await res.text();
  let data: any;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(
      res.status,
      e?.code || "http_" + res.status,
      e?.message || "请求失败，请重试。",
    );
  }
  return opts.withStatus ? { status: res.status, data } : data;
}
const qs = (q: Record<string, any>) =>
  new URLSearchParams(
    Object.entries(q)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();
export const api = {
  status: () => request("GET", "/api/status"),
  settings: () => request("GET", "/api/settings"),
  get: (path: string) => request("GET", path),
  post: (path: string, body?: any) => request("POST", path, body),
  saveSettings: (body: any) => request("PUT", "/api/settings", body),
  submit: (body: any) => request("POST", "/api/jobs", body),
  jobs: (q: any = {}) => request("GET", "/api/jobs?" + qs(q)),
  job: (id: string) => request("GET", `/api/jobs/${id}`),
  lyricsAlignment: (id: string): Promise<LyricsAlignment> =>
    request("GET", `/api/jobs/${id}/lyrics-alignment`),
  alignLyrics: (id: string): Promise<LyricsAlignment> =>
    request("POST", `/api/jobs/${id}/lyrics-alignment`),
  remove: (id: string) => request("DELETE", `/api/jobs/${id}`),
  cancel: (id: string) =>
    request("POST", `/api/jobs/${id}/cancel`, undefined, { withStatus: true }),
  patchJob: (id: string, patch: any) =>
    request("PATCH", `/api/jobs/${id}`, patch),
  projects: () => request("GET", "/api/projects"),
  project: (id: string) => request("GET", `/api/projects/${id}`),
  createProject: (body: any) => request("POST", "/api/projects", body),
  patchProject: (id: string, body: any) =>
    request("PATCH", `/api/projects/${id}`, body),
  removeProject: (id: string) => request("DELETE", `/api/projects/${id}`),
  addTrack: (id: string, name: string) =>
    request("POST", `/api/projects/${id}/tracks`, { name }),
  orderTracks: (id: string, track_ids: string[]) =>
    request("PUT", `/api/projects/${id}/order`, { track_ids }),
  track: (id: string) => request("GET", `/api/tracks/${id}`),
  patchTrack: (id: string, body: any) =>
    request("PATCH", `/api/tracks/${id}`, body),
  removeTrack: (id: string) => request("DELETE", `/api/tracks/${id}`),
  attachTakes: (id: string, job_ids: string[], move = false) =>
    request("POST", `/api/tracks/${id}/takes`, { job_ids, move }),
  detachTake: (id: string) => request("DELETE", `/api/takes/${id}`),
  patchTake: (id: string, body: any) =>
    request("PATCH", `/api/takes/${id}`, body),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return request("POST", "/api/upload", fd);
  },
  listUploads: (unused = false) =>
    request("GET", "/api/uploads" + (unused ? "?unused=true" : "")),
  deleteUpload: (id: string) => request("DELETE", `/api/uploads/${id}`),
  pruneUploads: (body: any = {}) =>
    request("POST", "/api/uploads/prune", {
      unused: true,
      older_than_days: null,
      ...body,
    }),
  text: async (path: string) => {
    const r = await fetch(path);
    if (!r.ok) throw new ApiError(r.status, "not_found", "文件暂时不可读取");
    return r.text();
  },
};
export const songUrl = (id: string, name: string) => `/api/songs/${id}/${name}`;
export const albumUrl = (id: string, format = "flac") =>
  `/api/projects/${id}/album.zip?format=${format}`;
export function subscribe(id: string, { onProgress, onDone, onError }: any) {
  const es = new EventSource(`/api/jobs/${id}/events`);
  es.addEventListener("progress", (e) => {
    try {
      onProgress?.(JSON.parse(e.data));
    } catch {}
  });
  es.addEventListener("done", (e) => {
    es.close();
    try {
      onDone?.(JSON.parse(e.data).job);
    } catch {}
  });
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) onError?.();
  };
  return () => es.close();
}
