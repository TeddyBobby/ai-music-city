import { request } from "./api";
import type { Job } from "./types";

export interface PlazaPost {
  id: string;
  job_id: string;
  caption: string;
  author: { id: string; name: string };
  published_at: string;
  updated_at: string;
  can_manage: boolean;
  job: Job;
}

export interface PlazaFeed {
  posts: PlazaPost[];
  total: number;
  scope: "local";
}

export interface PlazaAlbum {
  id: string;
  title: string;
  caption: string;
  job_ids: string[];
  tracks: Job[];
  track_count: number;
  unavailable_count: number;
  duration_seconds: number;
  author: { id: string; name: string };
  published_at: string;
  updated_at: string;
  can_manage: boolean;
}

export interface PlazaAlbumBody {
  title: string;
  caption: string;
  job_ids: string[];
}

export interface PlazaAlbumFeed {
  albums: PlazaAlbum[];
  total: number;
  scope: "local";
}

export interface PlazaRankingEntry {
  rank: number;
  score: number;
  post: PlazaPost;
}

export interface PlazaRankings {
  manual: PlazaRankingEntry[];
  ai: PlazaRankingEntry[];
  scope: "local";
}

const url = (jobId: string) => `/api/plaza/${encodeURIComponent(jobId)}`;
const albumUrl = (id: string) => `/api/plaza/albums/${encodeURIComponent(id)}`;
export const plazaApi = {
  list: (query = "", offset = 0): Promise<PlazaFeed> =>
    request(
      "GET",
      `/api/plaza?${new URLSearchParams({ query, offset: String(offset), limit: "24" })}`,
    ),
  get: (jobId: string): Promise<{ post: PlazaPost | null; scope: "local" }> =>
    request("GET", url(jobId)),
  publish: (
    jobId: string,
    caption: string,
  ): Promise<{ post: PlazaPost; scope: "local" }> =>
    request("PUT", url(jobId), { caption }),
  withdraw: (jobId: string): Promise<null> => request("DELETE", url(jobId)),
  albums: (query = "", offset = 0): Promise<PlazaAlbumFeed> =>
    request(
      "GET",
      `/api/plaza/albums?${new URLSearchParams({ query, offset: String(offset), limit: "24" })}`,
    ),
  getAlbum: (id: string): Promise<{ album: PlazaAlbum; scope: "local" }> =>
    request("GET", albumUrl(id)),
  createAlbum: (
    body: PlazaAlbumBody,
  ): Promise<{ album: PlazaAlbum; scope: "local" }> =>
    request("POST", "/api/plaza/albums", body),
  updateAlbum: (
    id: string,
    body: PlazaAlbumBody,
  ): Promise<{ album: PlazaAlbum; scope: "local" }> =>
    request("PUT", albumUrl(id), body),
  withdrawAlbum: (id: string): Promise<null> => request("DELETE", albumUrl(id)),
  rankings: (query = ""): Promise<PlazaRankings> =>
    request("GET", `/api/plaza/rankings?${new URLSearchParams({ query })}`),
};

export function notifyPlazaUpdated(jobId: string) {
  window.dispatchEvent(
    new CustomEvent("tingjian:plaza-updated", { detail: { jobId } }),
  );
}
