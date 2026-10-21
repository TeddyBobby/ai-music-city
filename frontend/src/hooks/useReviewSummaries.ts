import { useEffect, useState } from "react";
import { request } from "../lib/api";

interface ReviewSummary {
  manual_score: number | null;
  has_comment: boolean;
  ai_score: number | null;
  ai_status: "idle" | "running" | "complete" | "failed";
}

export function useReviewSummaries(ids: string[]) {
  const key = ids.join(",");
  const [reviews, setReviews] = useState<Record<string, ReviewSummary>>({});
  useEffect(() => {
    let live = true;
    let revision = 0;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const selected = key ? key.split(",") : [];
    async function load() {
      clearTimeout(timer);
      const current = ++revision;
      let retryDelay = 3000;
      try {
        const chunks = Array.from(
          { length: Math.ceil(selected.length / 60) },
          (_, i) => selected.slice(i * 60, (i + 1) * 60),
        );
        const results = await Promise.all(
          chunks.map((chunk) =>
            request(
              "GET",
              `/api/reviews?ids=${encodeURIComponent(chunk.join(","))}`,
            ),
          ),
        );
        if (live && current === revision) {
          const next: Record<string, ReviewSummary> = Object.assign(
            {},
            ...results.map((r) => r.reviews),
          );
          setReviews(next);
          running = Object.values(next).some(
            (review) => review.ai_status === "running",
          );
        }
      } catch {
        // The review entry remains available even if its optional summary fails.
        retryDelay = 8000;
      } finally {
        if (live && current === revision && running)
          timer = setTimeout(load, retryDelay);
      }
    }
    void load();
    const refresh = () => void load();
    window.addEventListener("yue2:review-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener("yue2:review-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [key]);
  return reviews;
}
