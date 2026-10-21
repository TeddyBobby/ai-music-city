import { albumUrl, api } from "../api.js";
import { confirmDialog, fill, fmt, h, inlineEdit, jobTitle, loraLabel, lyricsButton, modeLabel, qualityButton, presetName, store, takeControls, toast, toastError } from "../ui.js";
import { playButton, player, trackOf } from "../player.js";

const SORTS = [["added", "添加时间"], ["stars", "星级"], ["thumbs", "喜好"]];
const FILTERS = [["all", "全部"], ["up", "喜欢"], ["unrated", "未评价"]];
const isLive = (j) => j.status === "queued" || j.status === "running";
const playable = (t) => !!(t.chosen && t.chosen.artifacts && t.chosen.artifacts.audio);

/**
 * #/project/<id> — editable name/description, "Play album" (the chosen takes queued in the global player), ZIP export,
 * draggable tracklist (↑/↓ fallback) and per-track takes with thumbs/stars/note, Choose and 移除.
 */
export async function projectView({ el, param, app }) {
  let project = null, unmounted = false, selectedId = null;
  const prefs = { sort: "added", filter: "all", ...store.get("project.takes", {}) };
  const savePrefs = () => store.set("project.takes", { sort: prefs.sort, filter: prefs.filter });
  // Collapsed "Takes" sections, remembered per project by track id (repaints and reloads keep them).
  const closedKey = `project.takesClosed.${param}`;
  const closedTakes = new Set(store.get(closedKey, []));
  const saveClosed = () => store.set(closedKey, [...closedTakes]);

  // -- header ----------------------------------------------------------------------------------
  const nameEl = inlineEdit("", (name) => patchProject({ name }), { tag: "h2", title: "点击重命名" });
  const descEl = inlineEdit("", (description) => patchProject({ description }), { tag: "p", cls: "muted", placeholder: "添加项目简介…", multiline: true, allowEmpty: true, title: "点击编辑简介" });
  const counts = h("span", { class: "sub" });
  const exportable = () => !!project && project.tracks.some(playable);
  const exportLink = (label) => h("a", { class: "btn sm", href: "#", download: true, onclick: (e) => { if (!exportable()) { e.preventDefault(); toast("请先为至少一首曲目选定已完成的版本", "err"); } } }, label);
  const zipFlac = exportLink("导出专辑 FLAC");
  const zipMp3 = exportLink("导出专辑 MP3");
  const syncStatus = (s) => { zipMp3.hidden = !(s && s.ffmpeg); };
  const deleteBtn = h("button", { class: "ghost sm danger", onclick: () => project && removeProject() }, "删除项目");

  // -- album: the chosen takes, in tracklist order, queued in the global player ----------------------
  const playBtn = h("button", { class: "primary sm", id: "album-play", onclick: () => project && toggleAlbum() }, "播放专辑");
  const nowLabel = h("span", { class: "hint" });

  const albumTracks = () => project.tracks.filter(playable).map((t) => trackOf(t.chosen, t.name));
  let bar = { queue: [], playing: false }; // last player state (player.on)
  /** True only when the bar's queue IS this album (same chosen takes, tracklist order) — a chosen take
   *  played on its own from the Library is not the album: no ⏮/⏭, no advance, so no "Pause album". */
  const inAlbum = () => { const ids = project ? project.tracks.filter(playable).map((t) => t.chosen.id) : []; return ids.length > 0 && bar.queue.length === ids.length && bar.queue.every((q, i) => q.id === ids[i]); };
  /** The track whose chosen take the player currently holds (however it got there), or null. */
  const currentTrack = () => { const c = player.current(); return c && project ? project.tracks.find((t) => playable(t) && t.chosen.id === c.id) || null : null; };
  const playAt = (i) => player.play(albumTracks(), i);
  function toggleAlbum() {
    const c = player.current(), t = currentTrack();
    if (inAlbum() && c) player.toggle(c.id);
    else playAt(t ? project.tracks.filter(playable).indexOf(t) : 0); // same id keeps the position: a lone chosen take becomes the album from its track
  }
  function syncAlbum(state = null) {
    if (state) bar = state;
    if (unmounted) return;
    const album = inAlbum(), t = currentTrack(), playing = album && bar.playing;
    playBtn.textContent = playing ? "暂停专辑" : album ? "继续播放" : "播放专辑";
    playBtn.disabled = !project || !project.tracks.some(playable);
    const tracks = project ? project.tracks.filter(playable) : [];
    nowLabel.textContent = album && t ? `${tracks.indexOf(t) + 1}/${tracks.length} · ${t.name} — ${jobTitle(t.chosen)}` : tracks.length ? `${tracks.length} 首定稿，按曲目顺序播放` : "为曲目选定版本后，即可播放和导出专辑";
    list.querySelectorAll("li.track").forEach((li) => li.classList.toggle("playing", !!t && li.dataset.id === t.id));
  }

  // -- tracklist -------------------------------------------------------------------------------
  const list = h("ol", { class: "tracklist" });
  const newTrackIn = h("input", { id: "t-name", type: "text", placeholder: "新曲目名称", maxlength: 200, required: true, autocomplete: "off" });
  const newTrackBtn = h("button", { type: "submit", class: "primary", id: "t-add" }, "添加曲目");
  const newTrackForm = h("form", { class: "row nowrap", onsubmit: addTrack }, newTrackIn, newTrackBtn);
  const notFound = h("div", { class: "empty" }, "项目不存在或已被删除。", h("a", { href: "#/projects" }, "返回项目"));

  const trackNav = h("ol");
  const view = h("div", { class: "stack" },
    h("div", { class: "view-head" }, h("h1", {}, "项目"), h("span", { class: "sub" }, "整理曲目，比较版本，让每一首都有自己的位置。")),
    h("div", { class: "panel project-overview" }, h("img", { src: "/static/assets/0832d.svg", width: 80, height: 80, alt: "" }),
      h("div", { class: "project-info" }, nameEl, descEl, counts), h("div", { class: "album-actions" }, playBtn, h("div", { class: "row" }, zipFlac, zipMp3))),
    h("div", { class: "project-editor" }, h("aside", { class: "panel project-track-nav" }, h("h3", {}, "曲目列表"), trackNav, newTrackForm),
      h("div", { class: "project-detail" }, list)),
    h("div", { class: "project-footer" }, nowLabel, h("a", { class: "btn ghost sm", href: "#/projects" }, "所有项目"), deleteBtn));
  fill(el, view);
  const offPlayer = player.on(syncAlbum); // after `list` exists: on() paints right away

  function paint() {
    if (unmounted || !project) return;
    const trackIds = new Set(project.tracks.map((t) => t.id));
    if ([...closedTakes].some((id) => !trackIds.has(id))) { for (const id of closedTakes) if (!trackIds.has(id)) closedTakes.delete(id); saveClosed(); }
    nameEl.set(project.name); descEl.set(project.description);
    document.title = `${project.name} · 听见`;
    const n = project.tracks.length, m = project.tracks.filter((t) => t.chosen_job_id).length;
    counts.textContent = `${n} 首曲目 · ${m} 首已定稿`;
    zipFlac.href = albumUrl(project.id, "flac"); zipMp3.href = albumUrl(project.id, "mp3");
    zipFlac.classList.toggle("disabled", !exportable()); zipMp3.classList.toggle("disabled", !exportable());
    if (!project.tracks.some(t => t.id === selectedId)) selectedId = project.tracks[0]?.id || null;
    fill(trackNav, project.tracks.map((t, i) => h("li", {}, h("button", { class: "track-select", "aria-current": String(t.id === selectedId), onclick: () => { selectedId = t.id; paint(); } }, h("span", { class: "num" }, String(i + 1).padStart(2, "0")), h("span", {}, t.name, h("small", {}, `${t.takes.length} 个版本 · ${t.chosen_job_id ? "已定稿" : "待选择"}`))))));
    fill(list, n ? trackRow(project.tracks.find(t => t.id === selectedId), project.tracks.findIndex(t => t.id === selectedId)) : h("li", { class: "empty" }, "还没有曲目。先在左侧添加曲目，再从作品库加入版本。"));
    syncAlbum();
  }

  function trackRow(t, i) {
    const li = h("li", { class: "track", dataset: { id: t.id }, draggable: false });
    const handle = h("span", { class: "drag-handle", title: "拖动调整顺序", "aria-hidden": "true", onmousedown: () => { li.draggable = true; }, onmouseup: () => { li.draggable = false; } }, "⠿");
    const num = playable(t)
      ? h("button", { class: "track-n ghost", title: "从此曲目开始播放专辑", "aria-label": `从第 ${i + 1} 首开始播放`, onclick: () => playAt(project.tracks.filter(playable).indexOf(t)) }, String(i + 1).padStart(2, "0"))
      : h("span", { class: "track-n" }, String(i + 1).padStart(2, "0"));
    const name = inlineEdit(t.name, (v) => patchTrack(t, { name: v }), { cls: "track-name", title: "点击重命名" });
    const chosenBox = t.chosen
      ? h("div", { class: "chosen stack", style: "gap:4px" },
        h("div", { class: "row small" }, playable(t) ? playButton(t.chosen, { sub: t.name }) : null, h("span", { class: "tag ok" }, "已定稿"), h("a", { href: `#/song/${t.chosen.id}` }, jobTitle(t.chosen)), lyricsButton(t.chosen), h("span", { class: "muted num" }, fmt.dur(t.chosen.timing && t.chosen.timing.audio_seconds)),
          playable(t) ? null : h("span", { class: "hint" }, "音频文件缺失")))
      : h("div", { class: "chosen hint" }, t.takes.length ? "尚未定稿，请在下方选择一个版本。" : "还没有版本。可以创作新版本，或从作品库添加。");
    const menu = h("details", { class: "menu" }, h("summary", { class: "btn sm" }, "添加版本 ▾"),
      h("div", { class: "menu-list" },
        h("a", { href: `#/create?track=${t.id}` }, "创作新版本"), app.status?.cover.available ? h("a", { href: `#/cover?track=${t.id}` }, "从音频改编") : null, app.status?.hum?.available ? h("a", { href: `#/hum?track=${t.id}` }, "从哼唱创作") : null,
        h("a", { href: `#/library?attach=${t.id}` }, "从作品库添加")));
    const up = h("button", { class: "icon ghost sm", title: "上移", "aria-label": "上移", disabled: i === 0, onclick: () => act(() => patchTrack(t, { position: i - 1 })) }, "↑");
    const down = h("button", { class: "icon ghost sm", title: "下移", "aria-label": "下移", disabled: i === project.tracks.length - 1, onclick: () => act(() => patchTrack(t, { position: i + 1 })) }, "↓");
    const del = h("button", { class: "ghost sm danger", onclick: () => removeTrack(t) }, "删除曲目");
    li.append(
      h("div", { class: "track-head row nowrap" }, num, h("div", { class: "track-title" }, name), h("span", { class: "spacer" }), menu, up, down, del),
      chosenBox,
      takesPanel(t));
    // Native drag and drop: the handle arms `draggable` so text inside inputs can still be selected.
    li.addEventListener("dragstart", (e) => { if (e.target !== li || !li.draggable) return; dragId = t.id; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", t.id); } catch { /* Safari */ } });
    li.addEventListener("dragend", () => { dragId = null; li.draggable = false; li.classList.remove("dragging"); clearDrop(); });
    li.addEventListener("dragover", (e) => { if (!dragId || dragId === t.id) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; const r = li.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; li.classList.toggle("drop-before", !after); li.classList.toggle("drop-after", after); });
    li.addEventListener("dragleave", () => li.classList.remove("drop-before", "drop-after"));
    li.addEventListener("drop", (e) => { if (!dragId || dragId === t.id) return; e.preventDefault(); const after = li.classList.contains("drop-after"); clearDrop(); reorder(dragId, t.id, after); });
    return li;
  }
  let dragId = null;
  const clearDrop = () => list.querySelectorAll(".drop-before, .drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
  async function reorder(fromId, toId, after) {
    const ids = project.tracks.map((t) => t.id).filter((id) => id !== fromId);
    const at = ids.indexOf(toId) + (after ? 1 : 0);
    ids.splice(at, 0, fromId);
    if (ids.join() === project.tracks.map((t) => t.id).join()) return;
    try { ({ project } = await api.orderTracks(project.id, ids)); paint(); } catch (e) { toastError(e); load(); }
  }

  // -- takes -----------------------------------------------------------------------------------
  function sortTakes(takes) {
    const list = takes.slice();
    const added = (a, b) => (a.take.added_at || "").localeCompare(b.take.added_at || "") || (a.seq - b.seq);
    if (prefs.sort === "stars") list.sort((a, b) => ((b.take.stars || 0) - (a.take.stars || 0)) || added(a, b));
    else if (prefs.sort === "thumbs") list.sort((a, b) => ((b.take.thumb || 0) - (a.take.thumb || 0)) || added(a, b));
    else list.sort(added);
    return list;
  }
  const passes = (j) => prefs.filter === "up" ? j.take.thumb === 1 : prefs.filter === "unrated" ? !j.take.thumb && !j.take.stars : true;
  function takesPanel(t) {
    const body = h("div", { class: "stack", style: "gap:6px" });
    const sortSel = h("select", { class: "sm", "aria-label": "版本排序", onchange: (e) => { prefs.sort = e.target.value; savePrefs(); paint(); } }, SORTS.map(([v, l]) => h("option", { value: v, selected: v === prefs.sort }, `排序：${l}`)));
    const chips = h("div", { class: "chips", role: "group", "aria-label": "筛选版本" }, FILTERS.map(([v, l]) => h("button", { type: "button", class: "chip", "aria-pressed": String(v === prefs.filter), onclick: () => { prefs.filter = v; savePrefs(); paint(); } }, l)));
    const shown = sortTakes(t.takes).filter(passes);
    fill(body, shown.length ? shown.map((j) => takeRow(t, j)) : h("p", { class: "muted small" }, t.takes.length ? "没有符合筛选条件的版本。" : "还没有版本。"));
    const panel = h("details", { class: "takes", open: !closedTakes.has(t.id),
      ontoggle: () => { if (panel.open === !closedTakes.has(t.id)) return; if (panel.open) closedTakes.delete(t.id); else closedTakes.add(t.id); saveClosed(); } },
      h("summary", {}, `作品版本（${t.takes.length}）`),
      t.takes.length ? h("div", { class: "row between", style: "margin-bottom:6px" }, chips, sortSel) : null,
      body);
    return panel;
  }
  function takeRow(t, j) {
    const live = isLive(j);
    const stage = live && j.progress && j.progress.stage ? ` · ${j.progress.label || j.progress.stage}` : "";
    const canChoose = j.status === "done" && j.artifacts && j.artifacts.audio;
    const chosen = t.chosen_job_id === j.id;
    const chooseBtn = chosen
      ? h("button", { class: "sm choose on", title: "取消定稿", "aria-pressed": "true", onclick: () => act(() => patchTrack(t, { chosen_job_id: null })) }, "★ 已定稿")
      : h("button", { class: "sm choose", disabled: !canChoose, title: canChoose ? "将此版本选为专辑定稿" : "只有已完成且有音频的版本才能定稿", "aria-pressed": "false", onclick: () => act(() => patchTrack(t, { chosen_job_id: j.id })) }, "选为定稿");
    return h("div", { class: "take-row" + (chosen ? " chosen" : "") + (live ? " live" : ""), dataset: { id: j.id } },
      h("div", { class: "row between" },
        h("div", { class: "row", style: "gap:6px;min-width:0" },
          canChoose ? playButton(j, { sub: t.name }) : null,
          h("span", { class: `tag ${j.status === "done" ? "ok" : j.status === "failed" ? "err" : live ? "accent" : ""}` }, ({ done: "已完成", failed: "失败", queued: "排队中", running: "生成中", cancelled: "已取消" }[j.status] || j.status) + stage),
          live ? h("span", { class: "title" }, jobTitle(j)) : h("a", { class: "title", href: `#/song/${j.id}` }, jobTitle(j)),
          lyricsButton(j), h("span", { class: "tag" }, ({create:"歌词创作", cover:"音频改编", hum:"哼唱创作"})[j.kind] || j.kind)),
        h("div", { class: "row", style: "gap:4px" }, qualityButton(j, { onQueued: () => load({ quiet: true }) }), chooseBtn, h("button", { class: "ghost sm", title: "从曲目移除，保留音乐文件", onclick: () => detach(t, j) }, "移除"))),
      h("div", { class: "meta" },
        j.status === "done" ? h("span", {}, h("b", { class: "num" }, fmt.dur(j.timing && j.timing.audio_seconds))) : null,
        h("span", {}, "预设 ", h("b", {}, presetName(j.preset))), h("span", {}, "种子 ", h("b", { class: "num" }, j.seed)), h("span", {}, "模式 ", h("b", {}, modeLabel(j))),
        j.loras && j.loras.length ? h("span", {}, "lora ", h("b", {}, loraLabel(j.loras))) : null,
        h("span", { title: j.take.added_at }, "添加于 ", fmt.when(j.take.added_at)),
        j.error ? h("span", { class: "tag err", title: j.error }, "异常") : null),
      takeControls(j, { onChange: (nj) => { const k = t.takes.findIndex((x) => x.id === nj.id); if (k >= 0) t.takes[k] = nj; } }));
  }

  // -- actions ---------------------------------------------------------------------------------
  async function load({ quiet = false } = {}) {
    let next;
    try { ({ project: next } = await api.project(param)); }
    catch (e) {
      if (unmounted) return;
      if (e.status === 404) { fill(el, notFound); project = null; return; }
      if (!project) { fill(el, h("div", { class: "errbox row between" }, `项目加载失败：${e.message}`, h("button", { class: "sm", onclick: () => { fill(el, view); load(); } }, "重试"))); return; }
      if (!quiet) toastError(e);
      return;
    }
    if (unmounted) return;
    project = next; paint();
  }
  async function patchProject(patch) { ({ project } = await api.patchProject(project.id, patch)); paint(); }
  async function patchTrack(t, patch) { await api.patchTrack(t.id, patch); await load(); }
  const act = (fn) => fn().catch((e) => { toastError(e); if (e.status === 409) load({ quiet: true }); });
  async function addTrack(e) {
    e.preventDefault();
    const name = newTrackIn.value.trim();
    if (!name) return toast("请填写曲目名称", "err");
    newTrackBtn.disabled = true;
    try { await api.addTrack(project.id, name); newTrackIn.value = ""; await load(); selectedId = project.tracks.at(-1)?.id; paint(); toast(`已添加曲目「${name}」`, "ok", { timeout: 2500 }); }
    catch (err) { toastError(err); }
    newTrackBtn.disabled = false;
    newTrackIn.focus();
  }
  async function removeTrack(t) {
    if (!confirmDialog(`删除曲目「${t.name}」？将移除关联的 ${t.takes.length} 个版本，音乐文件仍然保留。`)) return;
    try { await api.removeTrack(t.id); await load(); toast("曲目已删除", "ok", { timeout: 2500 }); } catch (e) { toastError(e); }
  }
  async function detach(t, j) {
    if (!confirmDialog(`从「${t.name}」移除「${jobTitle(j)}」？音乐文件保留，此曲目中的评价会清除。`)) return;
    try { await api.detachTake(j.id); await load(); } catch (e) { toastError(e); }
  }
  async function removeProject() {
    if (!confirmDialog(`删除项目「${project.name}」？曲目会移除，音乐文件仍然保留。`)) return;
    try { await api.removeProject(project.id); toast("项目已删除", "ok"); location.hash = "#/projects"; } catch (e) { toastError(e); }
  }

  await load(); // 404 → notFound; other errors → errbox with Retry (the listener below guards on `project`)
  syncStatus(app.status);
  // While a take is still queued/running, refresh with the 5 s status poll (but never under the user's
  // cursor). Playback lives in the global bar, so a reload never interrupts it.
  const onStatus = (s) => {
    syncStatus(s);
    if (!project || !project.tracks.some((t) => t.takes.some(isLive))) return;
    const a = document.activeElement;
    if (a && el.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
    load({ quiet: true });
  };
  app.listeners.add(onStatus);
  return { unmount() { unmounted = true; app.listeners.delete(onStatus); offPlayer(); } };
}
