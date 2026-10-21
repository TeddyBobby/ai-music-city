import { create } from "zustand";
import { api, songUrl } from "../lib/api";
import type { Job } from "../lib/types";
import { titleOf, readStore, writeStore } from "../lib/utils";
import { useApp } from "./app";
interface State {
  current: Job | null;
  queue: Job[];
  index: number;
  playing: boolean;
  time: number;
  duration: number;
  volume: number;
  repeat: "off" | "all" | "one";
  shuffle: boolean;
  play: (jobs: Job[], index?: number) => void;
  toggle: () => void;
  pause: () => void;
  seek: (n: number) => void;
  seekTo: (job: Job, seconds: number) => void;
  setVolume: (n: number) => void;
  next: () => void;
  prev: () => void;
  remove: (id: string) => void;
  setRepeat: () => void;
  setShuffle: () => void;
}
const audio = new Audio();
audio.preload = "metadata";
audio.volume = readStore("player.volume", 0.8);
// Keep deferred metadata and queue restoration behind the latest user selection.
let selectionVersion = 0;
let sourceVersion = 0;
let pendingSeek: { id: string; sourceVersion: number; seconds: number } | null =
  null;
const metadataReady = () =>
  audio.readyState >= 1 &&
  audio.currentSrc === audio.src &&
  Number.isFinite(audio.duration) &&
  audio.duration >= 0;
const loadSong = (job: Job) => {
  sourceVersion += 1;
  pendingSeek = null;
  audio.src = songUrl(job.id, "audio.flac");
};
const safePlay = () => {
  const version = sourceVersion;
  return audio.play().catch((e) => {
    if (version === sourceVersion && e.name !== "AbortError") {
      audio.pause();
      useApp.getState().toast("无法播放音频，请重试。", "error");
    }
  });
};
const persist = () => {
  const s = usePlayer.getState();
  writeStore("player.v2", {
    ids: s.queue.map((j) => j.id),
    index: s.index,
    time: pendingSeek?.seconds ?? (audio.currentTime || 0),
  });
};
export const usePlayer = create<State>((set, get) => ({
  current: null,
  queue: [],
  index: -1,
  playing: false,
  time: 0,
  duration: 0,
  volume: audio.volume,
  repeat: "off",
  shuffle: false,
  play: (jobs, index = 0) => {
    const list = jobs.filter((j) => j.status === "done" && j.artifacts?.audio);
    if (!list.length) return;
    selectionVersion += 1;
    pendingSeek = null;
    const requested = jobs[index]?.id,
      found = list.findIndex((j) => j.id === requested),
      i = found >= 0 ? found : 0,
      j = list[i],
      same = get().current?.id === j.id;
    set({
      queue: list,
      index: i,
      current: j,
      time: same ? audio.currentTime || 0 : 0,
      ...(!same ? { duration: j.timing?.audio_seconds || 0 } : {}),
    });
    if (!same || audio.error) {
      loadSong(j);
    }
    if (same && audio.ended) audio.currentTime = 0;
    safePlay();
    persist();
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: titleOf(j),
        artist: "AI乐之城",
        album: j.take?.project_name || "我的作品",
      });
    }
  },
  toggle: () => {
    if (!get().current) return;
    if (audio.paused) {
      if (audio.ended) audio.currentTime = 0;
      safePlay();
    } else audio.pause();
  },
  pause: () => audio.pause(),
  seek: (n) => {
    const current = get().current;
    if (!current || !Number.isFinite(n)) return;
    const seconds = Math.max(0, n);
    if (metadataReady()) {
      pendingSeek = null;
      audio.currentTime = Math.min(seconds, audio.duration);
      set({ time: audio.currentTime });
    } else {
      pendingSeek = { id: current.id, sourceVersion, seconds };
      set({ time: seconds });
    }
    persist();
  },
  seekTo: (job, seconds) => {
    if (
      !Number.isFinite(seconds) ||
      job.status !== "done" ||
      !job.artifacts?.audio
    )
      return;
    if (get().current?.id !== job.id) {
      const queue = get().queue;
      const index = queue.findIndex((entry) => entry.id === job.id);
      get().play(index >= 0 ? queue : [job], index >= 0 ? index : 0);
    }
    get().seek(seconds);
  },
  setVolume: (n) => {
    audio.volume = Math.max(0, Math.min(1, n));
    set({ volume: audio.volume });
    writeStore("player.volume", audio.volume);
  },
  next: () => {
    const s = get();
    if (s.shuffle && s.queue.length > 1) {
      const choices = s.queue.map((_, i) => i).filter((i) => i !== s.index);
      s.play(s.queue, choices[Math.floor(Math.random() * choices.length)]);
    } else if (s.index + 1 < s.queue.length) s.play(s.queue, s.index + 1);
    else if (s.repeat === "all") s.play(s.queue, 0);
  },
  prev: () => {
    const s = get();
    if (audio.currentTime > 3 || s.index <= 0) s.seek(0);
    else s.play(s.queue, s.index - 1);
  },
  remove: (id) => {
    selectionVersion += 1;
    const s = get();
    if (s.current?.id === id) {
      sourceVersion += 1;
      pendingSeek = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      set({ current: null, index: -1, queue: [], time: 0, duration: 0 });
    } else {
      const q = s.queue.filter((j) => j.id !== id);
      set({ queue: q, index: q.findIndex((j) => j.id === s.current?.id) });
    }
    persist();
  },
  setRepeat: () =>
    set((s) => ({
      repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off",
    })),
  setShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
}));
audio.addEventListener("timeupdate", () => {
  if (!pendingSeek) usePlayer.setState({ time: audio.currentTime || 0 });
});
audio.addEventListener("loadedmetadata", () => {
  if (!usePlayer.getState().current || !metadataReady()) return;
  usePlayer.setState({ duration: audio.duration });
  const pending = pendingSeek;
  if (
    pending &&
    pending.sourceVersion === sourceVersion &&
    pending.id === usePlayer.getState().current?.id
  ) {
    pendingSeek = null;
    audio.currentTime = Math.min(pending.seconds, audio.duration);
    usePlayer.setState({ time: audio.currentTime });
    persist();
  }
});
audio.addEventListener("play", () => usePlayer.setState({ playing: true }));
audio.addEventListener("pause", () => {
  usePlayer.setState({ playing: false });
  persist();
});
audio.addEventListener("ended", () => {
  const s = usePlayer.getState();
  if (s.repeat === "one") {
    audio.currentTime = 0;
    safePlay();
  } else {
    s.next();
    usePlayer.setState({ playing: !audio.paused && !audio.ended });
  }
});
audio.addEventListener("error", () => {
  audio.pause();
  if (usePlayer.getState().current)
    useApp.getState().toast("音频暂时不可播放，请确认文件仍存在。", "error");
});
if ("mediaSession" in navigator) {
  for (const [action, fn] of Object.entries({
    play: () => safePlay(),
    pause: () => audio.pause(),
    previoustrack: () => usePlayer.getState().prev(),
    nexttrack: () => usePlayer.getState().next(),
  })) {
    try {
      navigator.mediaSession.setActionHandler(action as MediaSessionAction, fn);
    } catch {}
  }
}
export async function restorePlayer() {
  const version = selectionVersion;
  const saved =
    readStore<any>("player.v2", null) ||
    (() => {
      const o = readStore<any>("player", null);
      return o
        ? { ids: o.queue?.map((j) => j.id), index: o.idx, time: o.time }
        : null;
    })();
  if (!saved?.ids?.length) return;
  const result = await Promise.allSettled(saved.ids.map((id) => api.job(id)));
  if (usePlayer.getState().current || version !== selectionVersion) return;
  const q: Job[] = result
    .filter((r) => r.status === "fulfilled")
    .map((r: any) => r.value.job)
    .filter((j) => j.status === "done" && j.artifacts.audio);
  if (!q.length) return;
  const wanted = saved.ids[saved.index || 0],
    found = q.findIndex((j) => j.id === wanted),
    index = found >= 0 ? found : 0,
    j = q[index];
  usePlayer.setState({
    current: j,
    queue: q,
    index,
    duration: j.timing?.audio_seconds || 0,
  });
  selectionVersion += 1;
  loadSong(j);
  usePlayer.getState().seek(Number.isFinite(saved.time) ? saved.time : 0);
}
