import { api, songUrl } from "../api.js";
import { confirmDialog, fill, fmt, h, inlineEdit, jobTitle, loraLabel, qualityButton, loraPicker, presetPicker, projectPicker, projectTag, randomSeed, rememberGroup, renderScore, scorePlayer, seedField, STAGE_NAMES, takeControls, toast, toastError, coverArt, statusName, presetName, kindName, jobError } from "../ui.js";
import { playButton, player } from "../player.js";

export async function songView({ el, param, app }) {
  let job;
  try { ({ job } = await api.job(param)); }
  catch (e) { fill(el, h("div", { class: "empty" }, e.status === 404 ? "作品不存在，可能已被删除。" : e.message, " ", h("a", { href: "#/library" }, "返回我的作品"))); return {}; }
  if (job.status === "queued" || job.status === "running") { fill(el, h("div", { class: "empty" }, "任务仍在进行中：", job.status, ". ", h("a", { href: "#/queue" }, "前往任务队列查看"))); return {}; }
  const p = job.params, t = job.timing || {};
  const continued = job.kind === "cover" && p.mode === "continue"; // cover whose clip opened the song
  const clipLabel = p.clip_start_s != null ? `${fmt.dur(p.clip_start_s)} – ${p.clip_end_s != null ? fmt.dur(p.clip_end_s) : "end"}` : "whole recording";
  const [abc, transcription, humAbc] = await Promise.all([
    job.artifacts.score ? api.text(songUrl(job.id, "score.abc")).catch(() => "") : "",
    job.kind === "cover" && job.artifacts.transcription ? api.text(songUrl(job.id, "transcription/score.abc")).catch(() => "") : "",
    job.kind === "hum" && job.artifacts.hum ? api.text(songUrl(job.id, "hum/hum.abc")).catch(() => "") : "",
  ]);

  // Score editor + regenerate
  const scoreEl = h("div", { class: "score" });
  const abcArea = h("textarea", { id: "s-abc", class: "mono", rows: 14, spellcheck: false }, abc);
  let redraw;
  abcArea.addEventListener("input", () => { clearTimeout(redraw); redraw = setTimeout(() => renderScore(scoreEl, abcArea.value), 400); });
  if (abc) renderScore(scoreEl, abc);
  const midi = scorePlayer(() => scoreEl._visual); // page-local MIDI preview; songs go through the global player
  const styleIn = h("textarea", { id: "s-style", rows: 2 }, p.style || "");
  // Regenerate inherits the parent's seed when blank; the toggle (off by default) opts into a fresh random one.
  const seedIn = seedField({ id: "s-seed", seed: job.seed, random: false, randomLabel: "使用新的随机种子" });
  const presets = presetPicker({ preset: job.preset, precision: job.precision, ode_steps: job.ode_steps }, app.status && app.status.presets);
  const loras = loraPicker(job.loras || [], app.status && app.status.loras ? app.status.loras.adapters : []);
  const regenBtn = h("button", { class: "primary", onclick: regenerate }, "使用此乐谱再生成");
  const countIn = h("input", { id: "s-count", type: "number", min: 2, max: 16, value: 3, style: "width:70px" });
  const varBtn = h("button", { onclick: variations, disabled: job.kind === "cover" && !(continued ? abc : transcription), title: job.kind === "cover" ? (continued ? "Variations keep the continued score" : "Variations of a cover reuse its transcription") : "" }, "生成更多版本");

  async function regenerate() {
    const text = abcArea.value.trim();
    if (!text) return toast("请先填写 ABC 乐谱", "err");
    if (p.cot === "off") toast("原作品使用自由生成，本次将按旋律编谱方式再生成。", "info");
    regenBtn.disabled = true;
    try {
      // RegenerateParams: seed null = inherit parent, so a random seed must be rolled client-side.
      const style = styleIn.value.trim(), seed = seedIn.isRandom() ? randomSeed() : seedIn.value();
      await api.submit({ kind: "regenerate", ...presets.value(), loras: loras.value(), track_id: trackId(), params: { parent_id: job.id, abc: text, style: style && style !== p.style ? style : null, lyrics: null, seed: seed !== null && seed !== job.seed ? seed : null, title: null } });
      toast(`已将《${jobTitle(job)}》加入再生成队列`, "ok"); midi.stop(); location.hash = afterSubmit();
    } catch (e) { toastError(e); regenBtn.disabled = false; }
  }
  async function variations() {
    const count = Math.max(2, Math.min(16, Number(countIn.value) || 3));
    varBtn.disabled = true;
    try {
      // Covers: seed the variations from the transcription so the melody is kept (cot melody, as the cover flow does).
      const base = continued
        ? { style: p.style, lyrics: p.lyrics, cot: "melody", seed: randomSeed(), cfg_scale: p.cfg_scale ?? null, abc, title: p.title || null } // like hum: keep the continued score
        : job.kind === "cover"
        ? { style: p.style, lyrics: p.lyrics, cot: p.task === "full" ? "full" : "melody", seed: randomSeed(), cfg_scale: p.cfg_scale ?? null, abc: transcription, title: p.title || null }
        : job.kind === "hum"
          ? { style: p.style, lyrics: p.lyrics, cot: "melody", seed: randomSeed(), cfg_scale: p.cfg_scale ?? null, abc: abc || null, title: p.title || null } // variations keep the continued score
          : { style: p.style, lyrics: p.lyrics, cot: p.cot || "full", seed: randomSeed(), cfg_scale: p.cfg_scale ?? null, abc: p.abc || null, title: p.title || null };
      const r = await api.submit({ kind: "variations", preset: job.preset, precision: job.precision, ode_steps: job.ode_steps, loras: loras.value(), track_id: trackId(), params: { count, base, random_seeds: false, label: null } });
      rememberGroup(r.group, r.jobs);
      toast(`已加入 ${count} 个候选版本`, "ok"); location.hash = afterSubmit();
    } catch (e) { toastError(e); varBtn.disabled = false; }
  }
  async function remove() {
    if (!confirmDialog(`删除《${jobTitle(job)}》及音频和生成文件？此操作不可撤销。`)) return;
    try { await api.remove(job.id); player.remove(job.id); toast("已删除", "ok"); location.hash = "#/library"; } catch (e) { toastError(e); }
  }

  // -- project membership: new takes made from a take land in the same track; the panel attaches/rates/chooses/detaches.
  const trackId = () => (job.take ? job.take.track_id : null);
  const afterSubmit = () => (job.take ? `#/project/${job.take.project_id}` : "#/queue");
  const headTag = h("span", { class: "row", style: "gap:4px" });
  const projectPanel = h("div", { class: "panel stack", id: "s-project" });
  function paintProject() {
    fill(headTag, projectTag(job));
    const t = job.take;
    if (!t) {
      const picker = projectPicker({ onPick: () => { addBtn.disabled = !picker.value(); } });
      const addBtn = h("button", { class: "primary sm", disabled: true, onclick: () => attach(picker.value()) }, "收录为候选版本");
      fill(projectPanel, h("h3", {}, "收录到项目"), h("p", { class: "hint" }, "将作品收录到项目曲目，比较候选版本，选择最终定稿。"), picker, h("div", {}, addBtn));
      return;
    }
    const canChoose = job.status === "done" && job.artifacts.audio;
    const chooseBtn = t.chosen
      ? h("button", { class: "sm choose on", "aria-pressed": "true", title: "取消定稿", onclick: () => choose(null) }, "★ 已选为定稿")
      : h("button", { class: "sm choose", "aria-pressed": "false", disabled: !canChoose, title: canChoose ? "Use this take on the album" : "Only a finished take with audio can be chosen", onclick: () => choose(job.id) }, "☆ 设为定稿");
    fill(projectPanel, h("h3", {}, "收录到项目"),
      h("p", {}, h("a", { href: `#/project/${t.project_id}` }, t.project_name), h("span", { class: "muted" }, " › "), t.track_name, t.chosen ? h("span", { class: "tag ok", style: "margin-left:6px" }, "已定稿") : null),
      takeControls(job, { onChange: (j) => { job = j; } }),
      h("div", { class: "row" }, chooseBtn, h("span", { class: "spacer" }), h("button", { class: "ghost sm", onclick: detach }, "从项目移出")));
  }
  async function attach(target) {
    if (!target) return;
    try {
      try { await api.attachTakes(target.id, [job.id]); }
      catch (e) { if (e.status !== 409 || !confirmDialog(`${e.message}. Move it to “${target.name}”?`)) throw e; await api.attachTakes(target.id, [job.id], true); }
      await reloadJob(); toast(`Added to ${target.project_name} › ${target.name}`, "ok");
    } catch (e) { toastError(e); }
  }
  async function choose(id) {
    try { await api.patchTrack(job.take.track_id, { chosen_job_id: id }); await reloadJob(); } catch (e) { toastError(e); }
  }
  async function detach() {
    if (!confirmDialog(`将《${jobTitle(job)}》从“${job.take.track_name}”移出？作品会保留，版本评分将移除。`)) return;
    try { await api.detachTake(job.id); await reloadJob(); } catch (e) { toastError(e); }
  }
  async function reloadJob() { ({ job } = await api.job(job.id)); paintProject(); }

  const stageKeys = ["load", "transcribe", "hum", "plan", "semantic", "synthesize", "decode", "save", "e2e"].filter((k) => t[k] !== undefined && t[k] !== null);
  const timingTable = stageKeys.length ? h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, h("th", {}, "生成阶段"), h("th", { class: "num" }, "用时（秒）"), h("th", { class: "num" }, "占比"))),
    h("tbody", {}, stageKeys.map((k) => h("tr", { style: k === "e2e" ? "font-weight:600" : "" }, h("td", {}, STAGE_NAMES[k] || k), h("td", { class: "num" }, Number(t[k]).toFixed(1)), h("td", { class: "num" }, k === "e2e" || !t.e2e ? "" : `${Math.round(100 * t[k] / t.e2e)}%`)))))) : h("p", { class: "muted small" }, "没有记录生成耗时。");

  // Click-to-rename heading; clearing the title falls back to the style excerpt (shown as the placeholder).
  const untitled = jobTitle({ ...job, title: null, params: { ...p, title: null } });
  const titleEl = inlineEdit(job.title || "", async (title) => {
    const { job: renamed } = await api.patchJob(job.id, { title: title || null });
    Object.assign(job, renamed); // in place: the play button and take controls hold this object
    player.retitle(job.id, jobTitle(job));
  }, { tag: "h1", placeholder: untitled, allowEmpty: true, title: "点击重命名" });

  const planBox = h("pre", { class: "block mono" }, "正在读取…");
  const planDetails = h("details", { ontoggle: async () => { if (planDetails.open && !planDetails._loaded) { planDetails._loaded = true; try { planBox.textContent = JSON.stringify(JSON.parse(await api.text(songUrl(job.id, "plan.json"))), null, 2); } catch (e) { planBox.textContent = "plan.json not available: " + e.message; } } } },
    h("summary", {}, "plan.json"), planBox);

  const advancedBody=h("div",{class:"stack"});
  fill(advancedBody,
    h("div", { class: "view-head" }, titleEl, h("span", { class: "tag" }, kindName(job.kind)), h("span", { class: `tag ${job.status === "done" ? "ok" : "err"}` }, statusName(job.status)),
      job.group_id ? h("a", { class: "tag accent", href: `#/library?group=${job.group_id}` }, "版本组") : null, job.parent_id ? h("a", { class: "tag", href: `#/song/${job.parent_id}` }, "来源作品") : null, headTag,
      h("span", { class: "spacer" }), h("a", { class: "btn ghost sm", href: "#/library" }, "← 我的作品")),
    job.status === "failed" ? jobError(job.error) : null,
    job.truncated ? h("div", { class: "warnbox", style: "margin-bottom:14px" }, h("b", {}, "Truncated"), ` during ${job.truncated.phase}: ${job.truncated.reason}. The song may end early — try a shorter lyric or mode melody.`) : null,
    h("div", { class: "cols" },
      h("div", { class: "stack" },
        job.artifacts.audio ? h("div", { class: "panel stack" },
          h("div", { class: "row" }, playButton(job, { label: true, size: "" }), h("span", { class: "hint" }, "底部播放器试听的是已完成作品，不影响生成。")),
          h("div", { class: "row" }, h("a", { class: "btn sm", href: songUrl(job.id, "audio.flac"), download: true }, "下载 FLAC"), h("a", { class: "btn sm", href: songUrl(job.id, "audio.mp3"), download: true }, "MP3"), h("a", { class: "btn sm", href: songUrl(job.id, "artifacts.zip") }, "artifacts.zip"), qualityButton(job), h("span", { class: "spacer" }), h("button", { class: "ghost sm danger", onclick: remove }, "删除作品"))) : null,
        h("section", { class: "panel stack" }, h("h3", {}, "歌词与风格"),
          h("p", {}, h("span", { class: "muted small", style: "text-transform:uppercase;letter-spacing:.05em" }, "音乐风格 "), p.style || "—"),
          h("pre", { class: "block lyrics-block", "aria-label": "歌词" }, p.lyrics || "—")),
        h("section", { class: "stack" }, h("h3", {}, job.kind === "hum" ? (p.melody === "hum_only" ? "Score (from your hum)" : p.melody === "continue" ? "Continued score" : "乐谱") : continued ? "Continued score" : "乐谱"),
          abc ? [scoreEl, h("div", { class: "row" }, midi, h("span", { class: "hint" }, "修改下方 ABC，乐谱将实时更新。")), abcArea]
            : h("p", { class: "muted" }, "此作品没有乐谱（自由生成模式或编谱阶段未完成）。"),
          h("div", { class: "panel stack" },
            h("label", { class: "field" }, h("span", { class: "lbl" }, "音乐风格（可修改）"), styleIn),
            h("div", { class: "grid2 stack-narrow" }, h("div", { class: "field" }, h("span", { class: "lbl" }, "随机种子"), seedIn), h("div", { class: "field" }, h("span", { class: "lbl" }, "生成模式"), presets)),
            h("div", { class: "field" }, h("span", { class: "lbl" }, "风格适配器"), loras),
            h("div", { class: "row" }, regenBtn, h("span", { class: "spacer" }), h("label", { class: "row", style: "gap:6px" }, countIn, varBtn)),
            h("p", { class: "hint" }, "按乐谱再生成将保留歌词与编曲方式；生成更多版本将使用新的随机种子。 ", h("a", { href: `#/create?from=${job.id}` }, "修改参数后创作")))),
        transcription ? h("section", { class: "stack" }, h("h3", {}, continued ? "Source clip (the opening the planner continued)" : "Transcription (from the uploaded audio)"), (() => { const s = h("div", { class: "score" }); renderScore(s, transcription); return s; })(), h("details", {}, h("summary", {}, "transcription/score.abc"), h("pre", { class: "block mono" }, transcription))) : null,
        humAbc ? h("section", { class: "stack" }, h("h3", {}, p.melody === "continue" ? "Your hum (the open score the planner continued)" : "Your hum (transcribed)"), (() => { const s = h("div", { class: "score" }); renderScore(s, humAbc); return s; })(), h("details", {}, h("summary", {}, "hum/hum.abc"), h("pre", { class: "block mono" }, humAbc))) : null),
      h("div", { class: "stack" },
        projectPanel,
        h("div", { class: "panel stack" }, h("h3", {}, "生成参数"),
          h("dl", { class: "kv" },
            h("dt", {}, job.kind === "cover" ? "任务类型" : job.kind === "hum" ? "旋律" : "编曲方式"), h("dd", {}, job.kind === "hum" ? (p.melody || "continue").replace("_", " ") : (p.task || p.cot || "—")),
            job.kind === "cover" ? [h("dt", {}, "旋律"), h("dd", {}, continued ? "continue from the clip" : "cover the whole melody"), h("dt", {}, "源音频"), h("dd", {}, clipLabel)] : null,
            job.kind === "hum" ? [h("dt", {}, "Hum adapter"), h("dd", {}, p.adapter ? `${p.adapter} · influence ${p.hum_influence} · from ${p.offset_s}s` : "none (score only)")] : null,
            h("dt", {}, "生成模式"), h("dd", {}, `${job.preset} · ${job.precision} · ${job.ode_steps} steps`),
            job.loras && job.loras.length ? [h("dt", {}, "LoRA"), h("dd", {}, loraLabel(job.loras))] : null,
            h("dt", {}, "随机种子"), h("dd", {}, job.seed), p.cfg_scale != null ? [h("dt", {}, "CFG"), h("dd", {}, p.cfg_scale)] : null,
            h("dt", {}, "音频时长"), h("dd", {}, fmt.dur(t.audio_seconds)),
            h("dt", {}, "创建时间"), h("dd", { title: job.created_at }, fmt.when(job.created_at)), h("dt", {}, "任务 ID"), h("dd", { class: "mono" }, job.id))),
        h("div", { class: "panel stack" }, h("h3", {}, "生成耗时"), timingTable,
          t.abc_tps || t.semantic_tps ? h("p", { class: "hint num" }, `ABC ${fmt.tps(t.abc_tps)} · semantic ${fmt.tps(t.semantic_tps)}`) : null),
        job.artifacts.plan ? h("div", { class: "panel" }, planDetails) : null)));
  const advanced=h("details",{class:"song-advanced"},h("summary",{},"乐谱、参数与版本管理"),advancedBody);
  const createAgain=h("button",{class:"btn",disabled:job.status!=="done",onclick:async()=>{createAgain.disabled=true;try{await api.submit({kind:"create",preset:job.preset,precision:job.precision,ode_steps:job.ode_steps,loras:job.loras||[],track_id:trackId(),params:{title:job.title||p.title||null,style:p.style,lyrics:p.lyrics,cot:p.cot||"full",seed:job.seed,cfg_scale:p.cfg_scale??null,abc:p.abc||null}});toast("已按原参数加入生成队列。","ok");location.hash="#/queue";}catch(e){toastError(e);createAgain.disabled=false;}}},"按原参数再生成");
  const hero=h("section",{class:"panel song-hero"},h("div",{class:"song-hero-art"},coverArt(job,"hero")),h("div",{class:"song-hero-info"},h("span",{class:`tag ${job.status==="done"?"ok":"err"}`},statusName(job.status)),h("h2",{},jobTitle(job)),h("p",{class:"muted"},fmt.excerpt(p.style,65)),h("p",{class:"hint",style:"margin-top:16px"},`${fmt.dur(t.audio_seconds)} · ${fmt.when(job.created_at)} · ${presetName(job.preset)}`)),job.artifacts.audio?h("div",{class:"song-hero-actions"},playButton(job,{label:true,size:""}),h("a",{class:"btn",href:songUrl(job.id,"audio.mp3"),download:true},"下载 MP3"),h("details",{class:"menu"},h("summary",{class:"btn ghost"},"无损 FLAC / 全部素材 ▾"),h("div",{class:"menu-list"},h("a",{href:songUrl(job.id,"audio.flac"),download:true},"下载 FLAC"),h("a",{href:songUrl(job.id,"artifacts.zip"),download:true},"下载全部素材 ZIP")))):null);
  const lyricsPanel=h("section",{class:"panel stack lyrics-panel"},h("div",{class:"row between"},h("h3",{},"歌词"),h("button",{class:"ghost sm",onclick:async()=>{try{await navigator.clipboard.writeText(p.lyrics||"");toast("歌词已复制。","ok");}catch{toast("复制失败，请选中歌词手动复制。","err");}}},"复制歌词")),h("pre",{class:"block lyrics-block"},p.lyrics||"没有歌词"),h("hr",{style:"width:100%;border:0;border-top:1px solid var(--border)"}),h("h3",{},"音乐风格"),h("p",{class:"muted small"},p.style||"—"));
  const actions=h("aside",{class:"panel song-actions"},h("h2",{},"这首歌，还可以继续。"),h("p",{class:"muted"},"保留原版，尝试新的表达。"),h("a",{class:"btn primary",href:`#/assistant?mode=cover&song=${job.id}`},"AI 封面 · 生成与管理"),createAgain,h("button",{onclick:()=>{advanced.open=true;projectPanel.scrollIntoView({behavior:"smooth",block:"center"});}},"收录到项目"),h("a",{class:"btn ghost",href:`#/create?from=${job.id}`},"修改参数后创作"),h("hr",{style:"width:100%;border:0;border-top:1px solid var(--border)"}),h("h3",{},"乐谱与高级操作"),h("p",{class:"hint"},"查看乐谱、修改 ABC，或调整参数后重新生成。"),h("button",{class:"ghost",onclick:()=>{advanced.open=true;advanced.scrollIntoView({behavior:"smooth"});}},"查看乐谱与参数 →"));
  fill(el,h("div",{class:"view-head"},h("h1",{},jobTitle(job)),h("span",{class:"sub"},"让新的故事，从今天开篇。")),job.error?jobError(job.error):null,hero,h("div",{class:"cols song-main"},lyricsPanel,actions),advanced);
  paintProject();
  return { unmount: () => midi.stop() };
}
