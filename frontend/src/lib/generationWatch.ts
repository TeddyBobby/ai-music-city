import { api, subscribe } from "./api";
import type { Job } from "./types";

export const isGenerating = (job: Job) =>
  job.status === "queued" || job.status === "running";

/** The server owns the task; leaving this view only releases its observers. */
export function watchGeneration(
  id: string,
  callbacks: { onJob: (job: Job) => void; onError: (error: unknown) => void },
) {
  let closed = false;
  let current: Job | null = null;
  let fetching = false;
  let revision = 0;
  let disconnect: (() => void) | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;

  function accept(job: Job) {
    if (closed) return;
    current = job;
    callbacks.onJob(job);
    if (!isGenerating(job)) {
      if (poll) clearInterval(poll);
      disconnect?.();
      disconnect = undefined;
    }
  }

  async function refresh() {
    if (closed || fetching) return;
    fetching = true;
    const atRequest = revision;
    try {
      const { job } = await api.job(id);
      if (closed) return;
      // A slow poll must not replace a completed task or a newer stream event.
      if (current && !isGenerating(current) && isGenerating(job)) return;
      accept(
        current && atRequest !== revision && isGenerating(job)
          ? { ...job, status: current.status, progress: current.progress }
          : job,
      );
      if (isGenerating(job) && !disconnect) {
        disconnect = subscribe(id, {
          onProgress(event: Record<string, any>) {
            if (closed || !current || !isGenerating(current)) return;
            if (event.type === "stage") {
              revision++;
              accept({ ...current, status: "running", progress: event });
            } else if (event.type === "status" && event.status === "running") {
              revision++;
              accept({ ...current, status: "running" });
            }
          },
          onDone(job: Job) {
            revision++;
            accept(job);
          },
          // Polling stays active through temporary SSE disconnections.
          onError() {},
        });
      }
    } catch (error) {
      if (!closed) callbacks.onError(error);
    } finally {
      fetching = false;
    }
  }

  poll = setInterval(() => void refresh(), 2500);
  void refresh();
  return {
    refresh,
    close() {
      closed = true;
      if (poll) clearInterval(poll);
      disconnect?.();
    },
  };
}
