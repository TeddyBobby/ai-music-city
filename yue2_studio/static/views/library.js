import { api, songUrl } from "../api.js";
import { confirmDialog, fill, fmt, groupLabel, h, jobTitle, loraLabel, modeLabel, projectPicker, projectTag, STAGE_NAMES, store, toast, toastError, coverArt, statusName, presetName, kindName, jobError } from "../ui.js";
import { playButton, player } from "../player.js";

/** "made in 1m 34s" with the per-stage split and realtime factor as its tooltip; null without a recorded total. */
function genTime(t) {
  if (!t || !t.e2e) return null;
  const stages = ["transcribe", "plan", "semantic", "synthesize", "decode"].filter((k) => t[k])
    .map((k) => `${STAGE_NAMES[k]} ${fmt.secs(t[k])}`);
  const rtf = t.audio_seconds ? ` · ${(t.e2e / t.audio_seconds).toFixed(2)}× realtime` : "";
  return h("span", { title: `${stages.join(" · ")}${rtf}` }, "made in ", h("b", { class: "num" }, fmt.secs(t.e2e)));
}

/** Index of each job inside its group (API has no group endpoint). Order: the submit response's
 * job order if we remembered it, else Job.seq (submit order), then seed, then created_at. */
export function groupIndex(jobs) {
  const byGroup = {}, known = store.get("groups", {});
  for (const j of jobs) if (j.group_id) (byGroup[j.group_id] ||= []).push(j);
  const idx = {};
  const num = (v) => (typeof v === "number" ? v : Number.POSITIVE_INFINITY);
  for (const [gid, members] of Object.entries(byGroup)) {
    const ids = known[gid] && Array.isArray(known[gid].ids) ? known[gid].ids : [];
    const pos = (j) => { const i = ids.indexOf(j.id); return i < 0 ? Number.POSITIVE_INFINITY : i; };
    members.sort((a, b) => (pos(a) - pos(b)) || (num(a.seq) - num(b.seq)) || (a.seed - b.seed) || a.created_at.localeCompare(b.created_at));
    members.forEach((j, i) => { idx[j.id] = { n: i + 1, total: members.length, gid }; });
  }
  return idx;
}

export async function libraryView({ el, query }) {
  const filters = { kind: "", group: query.group || "", project: query.project || "", preset: "", q: "" };
  const f = {
    kind: h("select", { id: "l-kind", onchange: (e) => { filters.kind = e.target.value; load(); } }, [["", "全部作品"], ["create", "歌词创作"], ["regenerate", "乐谱再创作"], ["cover", "音频改编"], ["hum", "哼唱成歌"]].map(([v, t]) => h("option", { value: v }, t))),
    preset: h("select", { id: "l-preset", onchange: (e) => { filters.preset = e.target.value; paint(); } }, [["", "全部生成模式"], ["quality", "质量模式"], ["fast", "快速模式"], ["custom", "自定义"]].map(([v, t]) => h("option", { value: v }, t))),
    group: h("select", { id: "l-group", onchange: (e) => { filters.group = e.target.value; load(); } }),
    q: h("input", { id: "l-q", type: "search", placeholder: "搜索作品名称、风格或歌词", oninput: (e) => { filters.q = e.target.value.toLowerCase(); paint(); } }),
  };
  const grid = h("div", { class: "grid-cards" });
  const count = h("span", { class: "sub" });
  const failedList = h("div", { class: "stack" });
  const clearAllBtn = h("button", { class: "sm danger", onclick: clearAllFailed }, "清空未完成记录");
  const failedBar = h("div", { class: "row between", hidden: true }, h("span", { class: "hint" }), clearAllBtn);
  const failed = h("details", {open:query.history === "1",class:"panel"}, h("summary", {}, "未完成记录"), failedBar, failedList);
  const uploadsPanel = uploadsSection();
  const PAGE = 60;
  const more = h("button", { hidden: true, onclick: () => load(true) }, "加载更多");

  // Multi-select
  let selectMode = false;
  const selected = new Set();
  const selectBtn = h("button", { id: "l-select", "aria-pressed": "false", onclick: () => setSelectMode(!selectMode) }, "选择作品");
  const selCount = h("b", {}, "已选 0 首");
  const deleteSelBtn = h("button", { class: "danger", disabled: true, onclick: deleteSelected }, "删除所选");
  // "收录到项目…": a project → track picker inside the toolbar; attaching goes through POST /api/tracks/{id}/takes.
  const picker = projectPicker({ onPick: paintSelection });
  const attachBtn = h("button", { class: "primary sm", disabled: true, onclick: attachSelected }, "收录到曲目");
  const pickerRow = h("div", { class: "row", hidden: true, style: "flex-basis:100%" }, picker, attachBtn);
  const addToBtn = h("button", { class: "sm", "aria-pressed": "false", onclick: () => { pickerRow.hidden = !pickerRow.hidden; addToBtn.setAttribute("aria-pressed", String(!pickerRow.hidden)); paintSelection(); } }, "收录到项目…");
  const selBar = h("div", { class: "selbar", hidden: true, role: "toolbar", "aria-label": "作品选择" },
    selCount,
    h("button", { class: "sm", onclick: () => { visibleIds().forEach((id) => selected.add(id)); paintSelection(); } }, "选择本页全部"),
    h("button", { class: "sm", onclick: () => { selected.clear(); paintSelection(); } }, "取消选择"),
    h("span", { class: "spacer" }), addToBtn, deleteSelBtn, h("button", { class: "ghost sm", onclick: () => setSelectMode(false) }, "完成"),
    pickerRow);
  const projectNote = h("div", { class: "warnbox row between", hidden: true, style: "margin-bottom:14px" });
  fill(el,
    h("div", { class: "view-head" }, h("h1", {}, "我的作品"), count),
    h("div", { class: "library-tools" }, h("div", {}, f.q), f.kind, f.preset, f.group, selectBtn,h("a",{class:"btn primary",href:"#/create"},"＋ 新建作品")),
    projectNote,
    selBar,
    grid, h("div", { class: "row", style: "justify-content:center;margin-top:14px" }, more), h("div", { style: "height:20px" }), failed,
    h("div", { style: "height:20px" }), uploadsPanel.el);

  let jobs = [], gidx = {}, total = 0, knownGroups = new Set(), badJobs = [];
  const visibleIds = () => [...el.querySelectorAll("input.sel")].map((i) => i.dataset.id);
  function setSelectMode(on) {
    selectMode = on; selectBtn.setAttribute("aria-pressed", String(on)); selectBtn.textContent = on ? "正在选择" : "选择作品";
    selBar.hidden = !on; if (!on) { selected.clear(); pickerRow.hidden = true; addToBtn.setAttribute("aria-pressed", "false"); }
    if (on && badJobs.length) failed.open = true;
    paint(); paintBad();
  }
  function paintSelection() {
    el.querySelectorAll("input.sel").forEach((i) => { i.checked = selected.has(i.dataset.id); i.closest(".card").classList.toggle("selected", i.checked); });
    selCount.textContent = `已选择 ${selected.size} 首`; deleteSelBtn.disabled = selected.size === 0;
    const target = picker.value();
    attachBtn.disabled = selected.size === 0 || !target;
    attachBtn.textContent = target ? `收录 ${selected.size} 首到“${fmt.excerpt(target.name, 24)}”` : "收录到曲目";
  }
  /** Attach the selection to the picked track; a job that is a take elsewhere answers 409 → offer to move it. */
  async function attachSelected() {
    const ids = [...selected], target = picker.value();
    if (!ids.length || !target) return;
    attachBtn.disabled = true;
    try {
      try { await api.attachTakes(target.id, ids); }
      catch (e) {
        if (e.status !== 409) throw e;
        if (!confirmDialog(`${e.message}. Move it to “${target.name}” (its rating is kept)?`)) { attachBtn.disabled = false; return; }
        await api.attachTakes(target.id, ids, true);
      }
      toast(`已收录 ${ids.length} 首到 ${target.project_name} › ${target.name}`, "ok", { link: { href: `#/project/${target.project_id}`, label: "查看项目" } });
      setSelectMode(false);
      if (query.attach) location.hash = `#/project/${target.project_id}`; else load();
    } catch (e) { toastError(e); attachBtn.disabled = false; }
  }
  const selBox = (j) => selectMode ? h("input", { type: "checkbox", class: "sel", dataset: { id: j.id }, "aria-label": `选择 ${jobTitle(j)}`, checked: selected.has(j.id),
    onchange: (e) => { if (e.target.checked) selected.add(j.id); else selected.delete(j.id); paintSelection(); } }) : null;
  const onKey = (e) => { if (e.key === "Escape" && selectMode) { e.preventDefault(); setSelectMode(false); } };
  document.addEventListener("keydown", onKey);

  /** Delete jobs with a small concurrency limit; returns {ok, failed}. */
  async function deleteMany(ids, limit = 4) {
    const queue = ids.slice(); let ok = 0, bad = 0;
    await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) { const id = queue.shift(); try { await api.remove(id); player.remove(id); ok++; } catch (e) { bad++; console.warn("delete", id, e.message); } }
    }));
    return { ok, failed: bad };
  }
  async function deleteSelected() {
    const ids = [...selected]; if (!ids.length) return;
    if (!confirmDialog(`删除所选 ${ids.length} 个任务及其文件？此操作不可撤销。`)) return;
    deleteSelBtn.disabled = true; deleteSelBtn.textContent = "正在删除…";
    const r = await deleteMany(ids);
    deleteSelBtn.textContent = "删除所选";
    toast(r.failed ? `已删除 ${r.ok} 条，失败 ${r.failed} 条` : `已删除 ${r.ok} 条`, r.failed ? "err" : "ok");
    setSelectMode(false); load();
  }
  async function clearAllFailed() {
    const ids = badJobs.map((j) => j.id); if (!ids.length) return;
    if (!confirmDialog(`删除全部 ${ids.length} 条未完成记录？此操作不可撤销。`)) return;
    clearAllBtn.disabled = true;
    const r = await deleteMany(ids);
    clearAllBtn.disabled = false;
    toast(r.failed ? `已删除 ${r.ok} 条，失败 ${r.failed} 条` : `已清理 ${r.ok} 条未完成记录`, r.failed ? "err" : "ok");
    load();
  }
  function paintBad() {
    fill(failedList, badJobs.length ? badJobs.map(badRow) : h("p", { class: "muted small" }, "没有未完成记录。"));
    failed.querySelector("summary").textContent = `未完成记录（${badJobs.length}）`;
    failedBar.hidden = badJobs.length === 0;
    failedBar.firstChild.textContent = `${badJobs.length} 条记录`;
    paintSelection();
  }
  async function load(append = false) {
    more.disabled = true;
    try {
      const offset = append ? jobs.length : 0;
      const [done, bad] = await Promise.all([api.jobs({ status: "done", kind: filters.kind, group: filters.group, project: filters.project, limit: PAGE, offset }), append ? null : api.jobs({ status: "failed,cancelled", project: filters.project, limit: 100 })]);
      jobs = append ? jobs.concat(done.jobs) : done.jobs; total = done.total; gidx = groupIndex(jobs);
      if (!append) selected.clear(); // filter change / reload: selection no longer meaningful
      more.hidden = jobs.length >= total; more.disabled = false;
      more.textContent = `加载更多（${jobs.length} / ${total}）`;
      jobs.forEach((j) => j.group_id && knownGroups.add(j.group_id));
      const groups = [...knownGroups];
      fill(f.group, h("option", { value: "" }, "全部版本组"), groups.map((g) => h("option", { value: g, selected: g === filters.group }, groupLabel(g) ? fmt.excerpt(groupLabel(g), 30) : `group ${g.slice(0, 6)}`)));
      f.group.hidden = groups.length === 0;
      paint();
      if (bad) { badJobs = bad.jobs; paintBad(); }
      paintSelection();
    } catch (e) { toastError(e); }
    if (!append) uploadsPanel.load();
  }

  function paint() {
    const shown = jobs.filter((j) => (!filters.preset || j.preset === filters.preset)
      && (!filters.q || [jobTitle(j), j.params.style, j.params.lyrics].join("\n").toLowerCase().includes(filters.q)));
    count.textContent = `每一次尝试，都有值得留下的声音。共 ${total} 首，当前显示 ${shown.length} 首。`;
    fill(grid, shown.length ? shown.map(songCard) : h("div", { class: "empty", style: "grid-column:1/-1" }, jobs.length || filters.kind || filters.group || filters.project ? "没有匹配的作品。" : ["还没有完成的作品。", h("a", { href: "#/create" }, "开始创作")]));
    paintSelection();
  }

  function songCard(j) {
    const g=gidx[j.id];
    return h("div",{class:"card song-card"+(selected.has(j.id)?" selected":"")},h("a",{class:"card-art",href:`#/song/${j.id}`,"aria-label":`查看${jobTitle(j)}`},coverArt(j)),
      h("div",{class:"row between"},h("div",{class:"row nowrap"},selBox(j),h("a",{class:"title",href:`#/song/${j.id}`},jobTitle(j))),h("span",{class:"tag ok"},"完成")),
      h("p",{class:"small muted"},fmt.excerpt(j.params.style,65)),
      h("div",{class:"meta"},h("b",{class:"num"},fmt.dur(j.timing?.audio_seconds)),h("span",{},fmt.when(j.created_at)),g?h("span",{class:"tag"},`版本 ${g.n}/${g.total}`):null,j.truncated?h("span",{class:"tag warn",title:j.truncated.reason},"音频提前结束"):null),
      h("div",{class:"row"},playButton(j,{label:true}),h("a",{class:"btn sm",href:`#/song/${j.id}`},"查看作品")));
  }

  function badRow(j) {
    return h("div", { class: "card" + (selected.has(j.id) ? " selected" : "") },
      h("div", { class: "row between" }, h("div", { class: "row" }, selBox(j), h("span", { class: "title" }, jobTitle(j)), h("span", { class: `tag ${j.status === "failed" ? "err" : ""}` }, statusName(j.status)), h("span", { class: "tag" }, kindName(j.kind))),
        h("button", { class: "ghost sm danger", onclick: () => remove(j) }, "删除")),
      j.error ? jobError(j.error) : null,
      h("div", { class: "meta" }, h("span", {}, "模式 ", h("b", {}, presetName(j.preset))), j.loras && j.loras.length ? h("span", {}, "lora ", h("b", {}, loraLabel(j.loras))) : null, h("span", {}, "种子 ", h("b", { class: "num" }, j.seed)), h("span", {}, fmt.when(j.finished_at || j.created_at))),
      h("div", {class:"row"}, h("a", {class:"btn sm",href:`#/create?from=${j.id}`}, "重新创作"), h("a", {class:"btn ghost sm",href:`#/song/${j.id}`}, "查看详情")));
  }

  async function remove(j) {
    if (!confirmDialog(`删除《${jobTitle(j)}》及其音频和生成文件？此操作不可撤销。`)) return;
    try { await api.remove(j.id); player.remove(j.id); toast("已删除", "ok"); load(); } catch (e) { toastError(e); }
  }
  await load();
  if (filters.project) {
    // ?project=<id>: only that project's takes; the note names it and clears the filter.
    let name = filters.project.slice(0, 8);
    try { name = (await api.project(filters.project)).project.name; } catch { /* keep the id */ }
    fill(projectNote, h("span", {}, "正在查看项目版本：", h("a", { href: `#/project/${filters.project}` }, name)), h("button", { class: "ghost sm", onclick: () => { filters.project = ""; projectNote.hidden = true; load(); } }, "查看全部"));
    projectNote.hidden = false;
  }
  if (query.attach) {
    // ?attach=<track_id> (from a project's "Add from Library…"): select mode with the picker preset to that track.
    try {
      const { track } = await api.track(query.attach);
      setSelectMode(true); pickerRow.hidden = false; addToBtn.setAttribute("aria-pressed", "true");
      await picker.select(track.project_id, track.id);
      toast(`选择作品，收录到 ${track.project_name} › ${track.name}`, "info");
    } catch (e) { toastError(e); }
  }
  const coverUpdated=()=>load(); window.addEventListener("yue2:cover-updated",coverUpdated); return { unmount: () => {document.removeEventListener("keydown", onKey);window.removeEventListener("yue2:cover-updated",coverUpdated);} };
}

/**
 * Collapsible "上传的音频素材" table (data/uploads/): checkbox multi-select + "删除所选", and
 * "清理未使用素材" (prune everything no job references). Uploads a queued/running job still needs
 * cannot be selected; finished jobs keep their song without the upload.
 */
function uploadsSection() {
  let uploads = [];
  const selected = new Set();
  const list = h("div", { class: "table-wrap" });
  const info = h("span", { class: "hint" });
  const deleteBtn = h("button", { class: "sm danger", disabled: true, onclick: deleteSelected }, "删除所选");
  const pruneBtn = h("button", { class: "sm", onclick: clearUnused }, "清理未使用素材");
  const bar = h("div", { class: "row between", hidden: true }, info, h("div", { class: "row", style: "gap:6px" }, deleteBtn, pruneBtn));
  const summary = h("summary", {}, "上传的音频素材");
  const el = h("details", { id: "l-uploads" }, summary, h("p", { class: "hint" }, "用于音频改编与哼唱成歌的源素材。删除源素材不会影响已完成作品；排队或生成中任务需要的素材不能删除。"), bar, list);
  const mb = (n) => (n === null || n === undefined ? "—" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const inUse = (u) => u.jobs.active > 0;
  const result = (r, verb) => toast(r.failed ? `${r.ok} ${verb}, ${r.failed} failed` : `${r.ok} ${verb}`, r.failed ? "err" : "ok");

  function paintSelection() {
    for (const id of [...selected]) if (!uploads.some((u) => u.upload_id === id && !inUse(u))) selected.delete(id);
    list.querySelectorAll("input.usel").forEach((i) => { i.checked = selected.has(i.dataset.id); });
    deleteBtn.disabled = selected.size === 0;
    deleteBtn.textContent = selected.size ? `删除所选（${selected.size}）` : "删除所选";
    const all = list.querySelector("input.usel-all");
    if (all) { const free = uploads.filter((u) => !inUse(u)); all.checked = free.length > 0 && free.every((u) => selected.has(u.upload_id)); all.disabled = free.length === 0; }
  }
  function row(u) {
    const busy = inUse(u);
    const box = h("input", { type: "checkbox", class: "usel", dataset: { id: u.upload_id }, disabled: busy, title: busy ? "In use by a queued or running job" : "", "aria-label": `Select ${u.filename}`, checked: selected.has(u.upload_id),
      onchange: (e) => { if (e.target.checked) selected.add(u.upload_id); else selected.delete(u.upload_id); paintSelection(); } });
    return h("tr", { title: busy ? "In use by a queued or running job" : "" },
      h("td", {}, box),
      h("td", { style: "overflow-wrap:anywhere" }, h("span", { class: "mono small", title: u.upload_id }, u.filename), u.broken ? [" ", h("span", { class: "tag err", title: "Media file or sidecar is missing" }, "broken")] : null),
      h("td", { class: "num" }, fmt.dur(u.seconds)), h("td", { class: "num" }, mb(u.size)),
      h("td", { title: u.created_at }, fmt.when(u.created_at)),
      h("td", { class: "num" }, u.jobs.total, busy ? [" ", h("span", { class: "tag accent" }, `${u.jobs.active} active`)] : null));
  }
  function paint() {
    const n = uploads.length, bytes = uploads.reduce((a, u) => a + (u.size || 0), 0), unused = uploads.filter((u) => u.jobs.total === 0).length;
    summary.textContent = `上传的音频素材（${n}）`;
    bar.hidden = n === 0;
    info.textContent = n ? `${n} 个素材 · ${mb(bytes)} · ${unused} 个未使用` : "";
    pruneBtn.disabled = unused === 0;
    fill(list, n ? h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, h("input", { type: "checkbox", class: "usel-all", "aria-label": "Select all deletable uploads", onchange: (e) => { uploads.filter((u) => !inUse(u)).forEach((u) => (e.target.checked ? selected.add(u.upload_id) : selected.delete(u.upload_id))); paintSelection(); } })),
        h("th", {}, "File"), h("th", { class: "num" }, "Length"), h("th", { class: "num" }, "大小"), h("th", {}, "上传时间"), h("th", { class: "num" }, "关联任务"))),
      h("tbody", {}, uploads.map(row))) : h("p", { class: "muted small" }, "没有未完成记录。"));
    paintSelection();
  }
  async function load() {
    try { uploads = (await api.listUploads()).uploads; } catch (e) { toastError(e); uploads = []; }
    paint();
  }
  async function deleteSelected() {
    const ids = [...selected]; if (!ids.length) return;
    if (!confirmDialog(`删除 ${ids.length} 个上传素材？已完成作品会保留；此操作不可撤销。`)) return;
    deleteBtn.disabled = true; deleteBtn.textContent = "正在删除…";
    let ok = 0, failed = 0;
    for (const id of ids) { try { await api.deleteUpload(id); ok++; } catch (e) { failed++; console.warn("delete upload", id, e.message); } }
    selected.clear();
    result({ ok, failed }, "deleted");
    load();
  }
  async function clearUnused() {
    const unused = uploads.filter((u) => u.jobs.total === 0).length; if (!unused) return;
    if (!confirmDialog(`删除全部 ${unused} 个未被任务引用的素材？此操作不可撤销。`)) return;
    pruneBtn.disabled = true;
    try { const r = await api.pruneUploads({ unused: true }); toast(`Cleared ${r.deleted} unused upload${r.deleted === 1 ? "" : "s"}${r.skipped ? ` (${r.skipped} still referenced)` : ""}`, "ok"); }
    catch (e) { toastError(e); }
    load();
  }
  return { el, load };
}
