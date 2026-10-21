import { request } from "./api";

export interface ManualReview {
  score: number | null;
  comment: string;
  updated_at: string;
}

export interface AiReviewResult {
  score: number;
  headline: string;
  summary: string;
  body: string;
  dimensions: { name: string; score: number; reason: string }[];
  strengths: string[];
  suggestions: string[];
  model: string;
  created_at: string;
  basis: string[];
  evidence: Record<string, unknown>;
}

export interface SongReview {
  job_id: string;
  manual: ManualReview | null;
  ai: {
    status: "idle" | "running" | "complete" | "failed";
    result: AiReviewResult | null;
    error: string | null;
    started_at: string | null;
    updated_at: string | null;
  };
}

const url = (jobId: string) => `/api/reviews/${encodeURIComponent(jobId)}`;
export const reviewsApi = {
  get: (jobId: string): Promise<SongReview> => request("GET", url(jobId)),
  saveManual: (
    jobId: string,
    manual: { score: number | null; comment: string },
  ): Promise<SongReview> => request("PUT", `${url(jobId)}/manual`, manual),
  deleteManual: (jobId: string): Promise<SongReview> =>
    request("DELETE", `${url(jobId)}/manual`),
  generate: (jobId: string): Promise<SongReview> =>
    request("POST", `${url(jobId)}/ai`),
};

export function notifyReviewUpdated(jobId: string) {
  window.dispatchEvent(
    new CustomEvent("yue2:review-updated", { detail: { jobId } }),
  );
}
