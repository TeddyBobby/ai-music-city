// Global player: one <audio> in a fixed bottom bar outside #view, so no route change or re-render ever
// touches it. Views never own a player — they render playButton() widgets carrying data-play-id, and the
// bar repaints every such button in the document on each state change (re-created buttons pick the state
// up without subscriptions that would leak across re-renders). The queue is [track] for a single song and
// [tracks...] for an album; prev/next and auto-advance only matter when it holds more than one.
import { songUrl } from "./api.js";
import { h, jobTitle, store, toast, fmt, fill, updateArtwork } from "./ui.js";

let queue = [], idx = -1, restoring = false; // restoring: src set from storage, never played yet
const listeners = new Set();

const audio = h("audio", { preload: "metadata", "aria-label": "正在试听的作品" });
const prevBtn = h("button", {type:"button",class:"icon ghost sm player-prev",title:"上一首","aria-label":"上一首",onclick:()=>player.prev()},h("img",{src:"/static/assets/eaf28.svg",alt:""}));
const nextBtn = h("button", {type:"button",class:"icon ghost sm player-next",title:"下一首","aria-label":"下一首",onclick:()=>player.next()},h("img",{src:"/static/assets/88755.svg",alt:""}));
const nowTitle=h("span",{class:"title"}),nowSub=h("span",{class:"sub"});
const now=h("a",{class:"now",href:"#/library",title:"查看正在试听的作品"},nowTitle,nowSub);
const pos=h("span",{class:"pos num",hidden:true});
const toggleBtn=h("button",{type:"button",class:"primary player-toggle",onclick:()=>audio.paused?player.resume():player.pause()},"播放");
const elapsed=h("span",{class:"player-time"},"00:00"),duration=h("span",{class:"player-time end"},"00:00");
const seek=h("input",{class:"player-seek",type:"range",min:0,max:100,step:.1,value:0,"aria-label":"试听进度",oninput:()=>{if(Number.isFinite(audio.duration))audio.currentTime=audio.duration*Number(seek.value)/100;}});
const volume=h("input",{class:"player-volume",type:"range",min:0,max:1,step:.01,value:store.get("player.volume",.8),"aria-label":"音量",oninput:()=>{audio.volume=Number(volume.value);store.set("player.volume",audio.volume);}});audio.volume=Number(volume.value);
const playlist=h("div",{class:"player-playlist",hidden:true,"aria-label":"播放队列"});
const queueBtn=h("button",{type:"button",class:"ghost player-queue-toggle","aria-expanded":"false",onclick:()=>{playlist.hidden=!playlist.hidden;queueBtn.setAttribute("aria-expanded",String(!playlist.hidden));paintPlaylist();}},"播放队列");
const cover=h("img",{class:"player-cover",src:"/static/assets/ed355.svg",alt:"听见唱片"});
const bar=h("footer",{class:"player-bar","aria-label":"试听播放器"},h("div",{class:"player-inner"},cover,now,prevBtn,toggleBtn,nextBtn,pos,elapsed,seek,duration,h("img",{class:"player-volume-icon",src:"/static/assets/ef08b.svg",alt:""}),volume,queueBtn,audio),playlist);
function paintPlaylist(){fill(playlist,h("div",{class:"row between"},h("b",{},"播放队列"),h("button",{class:"ghost sm",onclick:()=>{playlist.hidden=true;queueBtn.setAttribute("aria-expanded","false");}},"关闭")),queue.length?queue.map((t,i)=>h("button",{class:i===idx?"primary":"ghost",onclick:()=>player.play(queue,i)},t.title,h("small",{},i===idx?"当前试听":"播放"))):h("p",{class:"hint"},"从「我的作品」选择一首歌试听。"));}
function paintTime(){elapsed.textContent=fmt.dur(audio.currentTime||0);duration.textContent=fmt.dur(Number.isFinite(audio.duration)?audio.duration:0);seek.value=audio.duration?audio.currentTime/audio.duration*100:0;seek.disabled=!current();}
for(const event of["timeupdate","loadedmetadata","durationchange"])audio.addEventListener(event,paintTime);

const current = () => queue[idx] || null;
const state = () => ({ track: current(), idx, queue: queue.slice(), playing: !!current() && !audio.paused });

/** Track descriptor for a done job; `sub` is a second line (the project track name on album plays). */
export function trackOf(job, sub = null) {
  return { id: job.id, title: jobTitle(job), sub, href: `#/song/${job.id}`, src: songUrl(job.id, "audio.flac") };
}

/** Point the element at `t` unless it already is (same id keeps the position for toggle/resume; the
 *  sub line may still differ when the same song is replayed from another context, so re-announce). */
function setTrack(t) {
  updateArtwork(cover, t.id, "player");
  if (audio.dataset.id === t.id && audio.getAttribute("src") && !audio.error) { announce(t); return; }
  audio.dataset.id = t.id; audio.src = t.src;
  announce(t); persist();
}
// AbortError: the src was swapped while a play() was pending (fast next/prev). NotSupportedError: a
// missing/broken file — the `error` listener owns that toast.
const fail = (e) => { if (e && (e.name === "AbortError" || e.name === "NotSupportedError")) return; const t = current(); toast(`Could not play ${t ? t.title : "this song"}${e && e.message ? `: ${e.message}` : ""}`, "err"); };
function start() {
  const t = current(); if (!t) return;
  restoring = false;
  setTrack(t);
  audio.play().catch(fail);
  document.body.classList.add("has-player");
  paint();
}

export const player = {
  /** Play `tracks[i]` with the rest queued after it. The same track keeps its position. */
  play(tracks, i = 0) {
    if (!tracks || !tracks.length) return;
    queue = tracks.slice(); idx = Math.max(0, Math.min(i, queue.length - 1));
    start();
  },
  /** Pause/resume when `id` is the current track; false otherwise (callers then play() it). */
  toggle(id) {
    const t = current(); if (!t || t.id !== id) return false;
    if (audio.paused) player.resume(); else player.pause();
    return true;
  },
  pause() { audio.pause(); },
  /** Resume the current track; after a load error (or a forgotten id) reload it through start() instead. */
  resume() {
    const t = current(); if (!t) return;
    if (audio.dataset.id !== t.id || audio.error) { start(); return; }
    restoring = false; audio.play().catch(fail);
  },
  /** Stop, forget the queue and hide the bar (also drops the remembered state). */
  stop() {
    queue = []; idx = -1; restoring = false;
    audio.pause(); audio.removeAttribute("src"); delete audio.dataset.id; audio.load();
    document.body.classList.remove("has-player");
    store.remove("player");
    paint();
  },
  /** Advance; at the end of the queue stay on the last track (paused). */
  next() { if (idx + 1 < queue.length) { idx++; start(); } else paint(); },
  /** Back one track when near the start of this one, else restart it (the usual ⏮ behaviour). */
  prev() { if (idx > 0 && audio.currentTime < 3) { idx--; start(); } else { audio.currentTime = 0; paint(); } },
  /** Drop a deleted song from the queue; stops when it is the one playing. */
  remove(id) {
    const i = queue.findIndex((t) => t.id === id); if (i < 0) return;
    if (i === idx) { player.stop(); return; }
    queue.splice(i, 1); if (i < idx) idx--;
    persist(); paint();
  },
  /** A renamed song: update its queue entries (bar, remembered state, media session) and play buttons. */
  retitle(id, title) {
    for (const b of document.querySelectorAll("[data-play-id]")) if (b.dataset.playId === id) b.dataset.playTitle = title;
    const hits = queue.filter((t) => t.id === id); if (!hits.length) { paint(); return; }
    for (const t of hits) t.title = title;
    const t = current(); if (t && t.id === id) announce(t);
    persist(); paint();
  },
  current,
  isPlaying: (id) => { const t = current(); return !!t && t.id === id && !audio.paused; },
  /** Subscribe to state changes ({track, idx, queue, playing}); called once right away. Returns off(). */
  on(fn) { listeners.add(fn); try { fn(state()); } catch (e) { console.error(e); } return () => listeners.delete(fn); },
};

/** ▶/⏸ button bound to a job (disabled without audio). Painted on creation and on every state change. */
export function playButton(job, { sub = null, size = "sm", label = false } = {}) {
  const ok = job.status === "done" && !!(job.artifacts && job.artifacts.audio);
  const btn = h("button", { type: "button", class: `play${size ? " " + size : ""}`, dataset: { playId: job.id, playTitle: jobTitle(job), playLabel: label ? "1" : "" }, disabled: !ok, title: ok ? null : "这个任务还没有可试听的音频",
    onclick: () => { if (!player.toggle(job.id)) player.play([trackOf(job, sub)]); } });
  paintButton(btn);
  return btn;
}
function paintButton(btn) {
  const on = player.isPlaying(btn.dataset.playId), label = btn.dataset.playLabel === "1";
  btn.textContent = on ? (label ? "暂停试听" : "⏸") : (label ? "试听" : "▶");
  btn.classList.toggle("playing", on);
  btn.setAttribute("aria-label", `${on ? "暂停试听" : "试听"} ${btn.dataset.playTitle}`);
}

function paint() {
  const t = current(), s = state();
  if (cover.dataset.coverJob !== (t?.id || "")) updateArtwork(cover, t?.id, "player");
  nowTitle.textContent=t?`试听：${t.title}`:"还没有选择试听作品"; nowSub.textContent=t?"已完成作品 · 不影响生成":"生成完成后即可试听"; nowSub.hidden=false; toggleBtn.disabled=!t; toggleBtn.textContent=s.playing?"暂停":"播放"; paintTime(); if(!playlist.hidden)paintPlaylist();
  now.href = t ? t.href : "#";
  const multi = queue.length > 1;
  prevBtn.hidden=false;nextBtn.hidden=false;prevBtn.disabled=!multi;pos.hidden=!multi;
  nextBtn.disabled = idx >= queue.length - 1;
  pos.textContent = multi ? `${idx + 1}/${queue.length}` : "";
  for (const b of document.querySelectorAll("[data-play-id]")) paintButton(b);
  if ("mediaSession" in navigator) { try { navigator.mediaSession.playbackState = t ? (s.playing ? "playing" : "paused") : "none"; } catch { /* not supported */ } }
  for (const fn of listeners) { try { fn(s); } catch (e) { console.error(e); } }
}

function persist() {
  const t = current();
  if (t) store.set("player", { queue, idx, time: audio.currentTime || 0 }); else store.remove("player");
}

function announce(t) {
  if (!("mediaSession" in navigator)) return;
  try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.sub || "", album: "听见" }); } catch { /* not supported */ }
}

audio.addEventListener("play", () => { restoring = false; paint(); });
audio.addEventListener("pause", () => { persist(); paint(); });
audio.addEventListener("emptied", paint);
audio.addEventListener("ended", () => player.next());
audio.addEventListener("error", () => {
  const t = current(); if (!t || !audio.getAttribute("src")) return; // stop() empties the element; not an error
  if (restoring) { player.stop(); return; } // the remembered song is gone: hide quietly
  toast(`无法播放《${t.title}》`, "err");
  // `paused` stays false after a load error: pause so buttons do not stick at ⏸, and forget the id so a
  // retry of this track reloads it instead of hitting setTrack's same-id short-circuit.
  audio.pause(); delete audio.dataset.id;
  player.next();
});
window.addEventListener("pagehide", persist);

if ("mediaSession" in navigator) {
  try {
    for (const [action, fn] of [["play", () => player.resume()], ["pause", () => player.pause()], ["previoustrack", () => player.prev()], ["nexttrack", () => player.next()]]) navigator.mediaSession.setActionHandler(action, fn);
  } catch { /* not supported */ }
}

/** Bring back the last queue/position from a previous session, paused (autoplay is blocked anyway). */
function restore() {
  const s = store.get("player", null);
  if (!s || !Array.isArray(s.queue) || !s.queue.length || !s.queue[s.idx]) return;
  queue = s.queue; idx = s.idx; restoring = true;
  const t = current();
  audio.dataset.id = t.id; audio.src = t.src;
  // Seek once metadata is in, unless the user already moved on (other track) or started playing from 0.
  audio.addEventListener("loadedmetadata", () => { if (audio.dataset.id === t.id && audio.currentTime === 0 && s.time > 0 && s.time < (audio.duration || Infinity)) audio.currentTime = s.time; }, { once: true });
  announce(t);
  document.body.classList.add("has-player");
  paint();
}

document.body.append(bar);
restore();
paint();
