import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { buildLyricTimeline } from "../lib/lyricTimeline";
import type { Job, LyricsAlignment } from "../lib/types";

// Remounts, breakpoints and Strict Mode must not repeatedly submit a failed job.
const automaticallyRequested = new Set<string>();
const pendingSubmissions = new Map<string, Promise<LyricsAlignment>>();

function submitAlignment(id: string, key: string) {
  const existing = pendingSubmissions.get(key);
  if (existing) return existing;
  const pending = api
    .alignLyrics(id)
    .finally(() => pendingSubmissions.delete(key));
  pendingSubmissions.set(key, pending);
  return pending;
}

export function useLyricsAlignment(job: Job | null) {
  const id = job?.id;
  const lyrics = String(job?.params?.lyrics || "");
  const plain = useMemo(() => buildLyricTimeline(lyrics, 0), [lyrics]);
  const eligible = Boolean(
    id &&
    job?.status === "done" &&
    job.artifacts.audio &&
    plain.lines.length &&
    plain.source !== "lrc",
  );
  const key = `${id || ""}\u0000${lyrics}`;
  const [state, setState] = useState<{
    key: string;
    alignment: LyricsAlignment;
  } | null>(null);
  const [retry, setRetry] = useState<{ key: string; version: number } | null>(
    null,
  );
  const handledRetry = useRef(0);
  const requestAlignment = useCallback(() => {
    setRetry((value) => ({ key, version: (value?.version || 0) + 1 }));
  }, [key]);

  useEffect(() => {
    if (!id || !eligible) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publish = (alignment: LyricsAlignment) => {
      if (live) setState({ key, alignment });
    };
    const poll = async (submit = false) => {
      try {
        let result = await (submit
          ? submitAlignment(id, key)
          : api.lyricsAlignment(id));
        if (!live) return;
        if (result.status === "idle" && !automaticallyRequested.has(key)) {
          automaticallyRequested.add(key);
          publish({ status: "queued", source: "audio", lines: [] });
          result = await submitAlignment(id, key);
          if (!live) return;
        } else if (result.status === "idle" && pendingSubmissions.has(key)) {
          result = await pendingSubmissions.get(key)!;
          if (!live) return;
        }
        publish(result);
        if (result.status === "queued" || result.status === "running")
          timer = setTimeout(() => void poll(), 2000);
      } catch {
        // Network failures never start a retry loop or another automatic POST.
        automaticallyRequested.add(key);
        publish({
          status: "failed",
          source: "audio",
          lines: [],
          message: "歌词校准暂时不可用",
        });
      }
    };
    const explicitRetry =
      retry?.key === key && retry.version !== handledRetry.current;
    if (explicitRetry) {
      handledRetry.current = retry.version;
      automaticallyRequested.add(key);
      publish({ status: "queued", source: "audio", lines: [] });
    }
    void poll(explicitRetry);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [id, key, eligible, retry]);

  return {
    alignment: eligible && state?.key === key ? state.alignment : null,
    requestAlignment,
  };
}
