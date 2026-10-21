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
const safePlay = () =>
  audio.play().catch((e) => {
    if (e.name !== "AbortError") {
      audio.pause();
      useApp.getState().toast("无法播放音频，请重试。", "error");
    }
  });
const persist = () => {
  const s = usePlayer.getState();
  writeStore("player.v2", {
    ids: s.queue.map((j) => j.id),
    index: s.index,
    time: audio.currentTime || 0,
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
    const requested = jobs[index]?.id,
      found = list.findIndex((j) => j.id === requested),
      i = found >= 0 ? found : 0,
      j = list[i],
      same = get().current?.id === j.id;
    set({
      queue: list,
      index: i,
      current: j,
      ...(!same ? { time: 0, duration: j.timing?.audio_seconds || 0 } : {}),
    });
    if (!same || audio.error) {
      audio.src = songUrl(j.id, "audio.flac");
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
    if (get().current && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.max(0, Math.min(n, audio.duration));
      set({ time: audio.currentTime });
      persist();
    }
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
    const s = get();
    if (s.current?.id === id) {
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
audio.addEventListener("timeupdate", () =>
  usePlayer.setState({ time: audio.currentTime || 0 }),
);
audio.addEventListener("loadedmetadata", () =>
  usePlayer.setState({
    duration: Number.isFinite(audio.duration) ? audio.duration : 0,
  }),
);
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
  if (usePlayer.getState().current) return;
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
  audio.src = songUrl(j.id, "audio.flac");
  audio.addEventListener(
    "loadedmetadata",
    () => {
      if (usePlayer.getState().current?.id === j.id)
        audio.currentTime = Math.max(
          0,
          Math.min(saved.time || 0, audio.duration || 0),
        );
    },
    { once: true },
  );
}
