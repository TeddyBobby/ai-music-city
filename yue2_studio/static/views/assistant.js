import { api } from "../api.js";
import { h, fill, jobTitle, toast } from "../ui.js";
import { assistantApi, streamMessage } from "../assistant-client.js";

const settingsHref = "#/assistant?mode=settings";
const badge = (text, kind = "") => h("span", { class: `assistant-badge ${kind}` }, text);
const muted = (text) => h("p", { class: "assistant-muted" }, text);
const button = (text, click, cls = "", attrs = {}) => h("button", { type: "button", class: cls, onclick: click, ...attrs }, text);
const field = (text, input, hint) => h("label", { class: "assistant-field" }, h("span", {}, text), input, hint ? muted(hint) : null);
const row = (...children) => h("div", { class: "assistant-row" }, children);
const panel = (...children) => h("section", { class: "assistant-panel" }, children);
const date = (value) => value ? new Date(value).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) : "刚刚";
const contextFor = (job) => job ? { title: jobTitle(job), lyrics: job.params?.lyrics || "", description: job.params?.style || "" } : {};
const statusLabel = (s) => s?.available ? s.verified === false ? "待验证" : "已连接" : s?.configured ? "待连接" : "未配置";

export function assistantView({ el, query = {}, app }) {
  let disposed = false, activeStream = null, activeSession = null, associatedJob = query.song || "";
  const lifetime = new AbortController(), dialogs = new Set();
  const signal = lifetime.signal;
  const isAlive = () => !disposed && el.isConnected;
  const mode = ["cover", "settings"].includes(query.mode) ? query.mode : "chat";
  const headline = mode === "settings" ? ["连接你的 Hermes", "沿用本机的 AI 配置，让对话、歌词和封面在同一个地方完成。"] : mode === "cover" ? ["给这首歌，一个画面。", "从歌词和情绪出发，生成候选封面，再挑选最贴合的一张。"] : ["有个想法？和助手聊聊。", "写词、聊曲风、构思封面。把想法慢慢打磨成作品。"];
  el.classList.add("assistant");
  const body = h("div", { class: "assistant-body" });
  fill(el, h("div", { class: "assistant-head" }, h("div", {}, h("h1", {}, headline[0]), h("p", {}, headline[1])),
    h("nav", { class: "assistant-nav", "aria-label": "助手功能" }, [["chat", "创作对话", "#/assistant"], ["cover", "封面工作室", `#/assistant?mode=cover${query.song ? `&song=${encodeURIComponent(query.song)}` : ""}`], ["settings", "连接设置", settingsHref]].map(([id, label, href]) => h("a", { href, "aria-current": mode === id ? "page" : null }, label)))), body);

  function showError(container, error) {
    if (!isAlive() || error?.name === "AbortError") return;
    fill(container, h("div", { class: "assistant-error", role: "alert" }, error?.message || String(error)));
  }
  function dialog(title, content, actions = []) {
    const node = h("dialog", { class: "assistant-modal", "aria-label": title });
    const close = () => { node.close(); node.remove(); dialogs.delete(node); };
    fill(node, h("div", { class: "assistant-stack" }, h("h2", {}, title), content,
      h("div", { class: "assistant-row" }, ...actions.map((a) => button(a.label, () => a.action(close), a.primary ? "primary" : "", a.attrs || {})), button("关闭", close, "ghost"))));
    node.addEventListener("close", () => { node.remove(); dialogs.delete(node); });
    document.body.append(node); dialogs.add(node); node.showModal();
    return node;
  }
  const confirm = (title, text) => new Promise((resolve) => {
    const node = dialog(title, h("p", {}, text), [{ label: "确认", primary: true, action: (close) => { resolve(true); close(); } }]);
    node.addEventListener("close", () => resolve(false), { once: true });
  });
  async function stopStream() {
    if (!activeStream) return;
    const stream = activeStream;
    try { if (activeSession) await assistantApi.stop(activeSession); }
    finally { stream.abort(); }
  }
  function previewDraft(suggestion) {
    const values = { title: suggestion.title || "", lyrics: suggestion.lyrics || "", style: suggestion.description || suggestion.style || "" };
    const names = { title: "作品名称", lyrics: "歌词", style: "曲风描述" };
    const chosen = Object.fromEntries(Object.entries(values).filter(([, v]) => v).map(([k]) => [k, true]));
    const content = h("div", { class: "assistant-stack" }, muted("勾选要填入的字段。确认后进入创作页，你可以继续修改或撤销本次填入。"));
    for (const key of Object.keys(chosen)) content.append(h("section", { class: "assistant-note" },
      h("label", { class: "assistant-check" }, h("input", { type: "checkbox", checked: true, onchange: (e) => { chosen[key] = e.target.checked; } }), names[key]), h("pre", {}, values[key])));
    dialog("预览并填入创作", content, [{ label: "确认填入创作", primary: true, action: (close) => {
      const draft = Object.fromEntries(Object.entries(values).filter(([key]) => chosen[key]));
      if (!Object.keys(draft).length) return toast("请至少选择一个字段。", "warn");
      try { localStorage.setItem("yue2-assistant-draft", JSON.stringify({ ...draft, origin: "assistant", createdAt: new Date().toISOString() })); }
      catch { return toast("浏览器无法保存草稿，请复制内容后手动填入。", "err"); }
      close(); location.hash = "#/create?assistantDraft=1";
    } }]);
  }
  function suggestionCard(suggestion) {
    const box = h("div", { class: "assistant-suggestion" });
    if (suggestion.lyrics || suggestion.description || suggestion.style || suggestion.title) {
      fill(box, row(h("h3", { class: "assistant-grow" }, suggestion.lyrics ? "歌词草稿" : "创作建议"), badge("尚未填入")),
        suggestion.title ? h("strong", {}, suggestion.title) : null,
        h("pre", {}, suggestion.lyrics || suggestion.description || suggestion.style || ""),
        row(button("预览并填入创作", () => previewDraft(suggestion), "primary"), button("复制内容", async () => {
          try { await navigator.clipboard.writeText(suggestion.lyrics || suggestion.description || suggestion.style || suggestion.title); toast("已复制。", "ok"); }
          catch { toast("复制失败，请选中文字手动复制。", "err"); }
        }, "ghost")));
    }
    if (suggestion.cover_prompt) box.append(h("h3", {}, "封面方向"), h("p", { class: "assistant-message-content" }, suggestion.cover_prompt),
      button("去生成封面 →", () => {
        try { sessionStorage.setItem("yue2-assistant-cover-prompt", suggestion.cover_prompt); } catch { /* URL navigation still works */ }
        location.hash = `#/assistant?mode=cover${associatedJob ? `&song=${encodeURIComponent(associatedJob)}` : ""}`;
      }));
    return box;
  }

  async function chat() {
    let status = null, sessions = [], jobs = [], current = null, messages = [], busy = false, stopping = false, loadingSession = 0, sessionLoading = false;
    let selectedJob = "", contextChecks = { title: true, lyrics: true, description: true };
    const sessionList = h("div", { class: "assistant-sessions", "aria-label": "最近对话" });
    const contextBox = h("div", { class: "assistant-context" });
    const errors = h("div", {}), connection = h("div", {}), modelLabel = muted("正在检查连接…");
    const newButton = button("＋ 新建对话", () => newConversation(), "assistant-wide");
    const jobSelect = h("select", { "aria-label": "关联作品", onchange: async (e) => {
      const next = e.target.value;
      if (messages.length && !await confirm("切换关联作品", "将为新作品建立独立对话，当前对话会保留在左侧。")) { e.target.value = selectedJob; return; }
      selectedJob = next; current = null; activeSession = null; messages = []; contextChecks = { title: true, lyrics: true, description: true }; paintContext(); paintMessages(); paintSessions(); sync();
    } });
    const messageList = h("div", { class: "assistant-messages", role: "log", "aria-label": "对话记录", "aria-live": "polite", "aria-relevant": "additions text" });
    const text = h("textarea", { rows: 2, placeholder: "继续聊聊，或者描述你想要的封面…", "aria-label": "输入消息", maxlength: 12000, oninput: () => sync(), onkeydown: (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) send(); }
    } });
    const taskMode = h("select", { "aria-label": "助手模式" }, [["chat", "自由对话"], ["lyrics", "写歌词"], ["style", "聊曲风"], ["cover_prompt", "构思封面"]].map(([value, label]) => h("option", { value }, label)));
    const contextBadge = badge("未关联作品");
    const sendButton = button("发送 ↑", send, "primary", { disabled: true });
    const stopButton = button("停止回复", async () => {
      if (stopping) return; stopping = true; sync();
      try { await stopStream(); } catch (e) { showError(errors, e); stopping = false; sync(); }
    }, "", { hidden: true });
    const sidebar = h("aside", { class: "assistant-panel assistant-sidebar" }, newButton, muted("最近对话"), sessionList, h("hr", { class: "assistant-divider" }), h("h3", {}, "本次对话的上下文"), jobSelect, contextBox, h("div", { class: "assistant-grow" }), muted("仅引用你勾选的标题、歌词与曲风，不发送音频文件。"), h("a", { class: "assistant-button", href: settingsHref }, "Hermes 连接设置"));
    const conversation = h("section", { class: "assistant-panel assistant-conversation" },
      h("div", { class: "assistant-row assistant-conversation-top" }, h("img", { class: "assistant-spark", src: "/static/assets/assistant-spark.svg", alt: "" }), h("strong", {}, "Hermes"), h("div", { class: "assistant-grow" }, modelLabel), connection),
      errors, messageList, h("div", { class: "assistant-composer" }, text, h("div", { class: "assistant-row" }, contextBadge, taskMode, h("span", { class: "assistant-muted assistant-grow assistant-compose-hint" }, "Enter 发送 · Shift + Enter 换行"), stopButton, sendButton)));
    fill(body, h("div", { class: "assistant-workspace" }, sidebar, conversation));
    function sync() {
      sendButton.disabled = busy || sessionLoading || !status?.chat?.available || !text.value.trim();
      sendButton.hidden = busy; stopButton.hidden = !busy; stopButton.disabled = stopping;
      stopButton.textContent = stopping ? "正在停止…" : "停止回复";
      newButton.disabled = busy || sessionLoading; jobSelect.disabled = busy || sessionLoading; taskMode.disabled = busy || sessionLoading;
      contextBox.querySelectorAll("input").forEach((i) => { i.disabled = busy; });
      sessionList.querySelectorAll("button").forEach((b) => { b.disabled = busy || sessionLoading; });
    }
    function paintContext() {
      const job = jobs.find((j) => j.id === selectedJob);
      associatedJob = job?.id || "";
      contextBadge.textContent = job ? `关联：${jobTitle(job)}` : "未关联作品";
      if (!job) { fill(contextBox, muted("选择一首作品后，可把歌词和曲风带入对话。")); return; }
      const values = contextFor(job);
      fill(contextBox, h("p", { class: "assistant-context-name" }, values.title),
        Object.entries({ title: "标题", lyrics: "歌词", description: "曲风" }).map(([key, label]) => h("label", { class: "assistant-check" }, h("input", { type: "checkbox", checked: contextChecks[key], onchange: (e) => { contextChecks[key] = e.target.checked; } }), `${label}${!values[key] ? "（暂无）" : ""}`)), muted("— 未发送音频文件"));
    }
    function paintSessions() {
      fill(sessionList, sessions.length ? sessions.map((session) => button("", () => openSession(session.id), "assistant-session", { "aria-current": String(current?.id === session.id), disabled: busy })) : muted("还没有对话，第一句就从你的想法开始。"));
      [...sessionList.querySelectorAll("button")].forEach((b, index) => fill(b, h("strong", {}, sessions[index].title || "新对话"), h("span", { class: "assistant-muted" }, `${date(sessions[index].updated_at)}${sessions[index].job_id ? " · 已关联作品" : ""}`)));
    }
    function paintMessages() {
      fill(messageList);
      if (!messages.length) {
        const empty = h("div", { class: "assistant-empty" }, h("h2", {}, "从一句灵感开始。"), h("p", { class: "assistant-muted" }, "聊一个画面、一段情绪，或选一首作品继续打磨。"));
        empty.append(h("div", { class: "assistant-starters" }, [["lyrics", "帮我写一段有希望感的副歌"], ["style", "聊聊这首歌适合的曲风"], ["cover_prompt", "构思一个没有文字的唱片封面"]].map(([m, prompt]) => button(prompt, () => { taskMode.value = m; text.value = prompt; text.focus(); sync(); }))));
        if (status && !status.chat?.available) empty.append(h("div", { class: "assistant-note" }, status.chat?.message || "Hermes 尚未连接。", " ", h("a", { href: settingsHref }, "前往连接设置 →")));
        messageList.append(empty); return;
      }
      for (const message of messages) {
        const article = h("article", { class: `assistant-message ${message.role === "user" ? "user" : "assistant-reply"}` },
          h("div", { class: "assistant-message-label" }, message.role === "user" ? "你" : "Hermes"), h("p", { class: "assistant-message-content" }, message.pendingStructured ? "正在整理创作建议…" : message.suggestion ? "这份建议尚未修改你的作品，确认后再使用。" : message.content || (busy ? "正在思考…" : "")));
        if (message.suggestion) article.append(suggestionCard(message.suggestion));
        if (["cancelled", "stopped"].includes(message.status)) article.append(muted("回复已停止，已生成的内容保留。"));
        if (message.status === "error") article.append(muted("这条回复未完成。"));
        messageList.append(article);
      }
      messageList.scrollTop = messageList.scrollHeight;
    }
    async function refreshSessions() {
      const data = await assistantApi.sessions(signal);
      if (isAlive()) { sessions = data.sessions || []; paintSessions(); }
    }
    async function openSession(id) {
      if (busy) return;
      const revision = ++loadingSession;
      sessionLoading = true; sync();
      try {
        const session = await assistantApi.session(id, signal);
        if (!isAlive() || revision !== loadingSession) return;
        if (session.job_id && !jobs.some((j) => j.id === session.job_id)) {
          try { jobs.push(await api.job(session.job_id)); } catch { /* A deleted source is shown without context. */ }
          if (!isAlive() || revision !== loadingSession) return;
          paintJobOptions();
        }
        current = session; activeSession = session.id; selectedJob = session.job_id || ""; jobSelect.value = selectedJob;
        messages = session.messages || []; contextChecks = { title: true, lyrics: true, description: true };
        fill(errors); paintContext(); paintMessages(); paintSessions(); sync();
      } catch (e) { showError(errors, e); }
      finally { if (revision === loadingSession && isAlive()) { sessionLoading = false; sync(); } }
    }
    function newConversation() {
      if (busy) return;
      ++loadingSession; current = null; activeSession = null; messages = []; text.value = "";
      fill(errors); paintMessages(); paintSessions(); sync(); text.focus();
    }
    function paintJobOptions() {
      fill(jobSelect, h("option", { value: "" }, "不关联作品"), jobs.map((j) => h("option", { value: j.id }, jobTitle(j))));
      jobSelect.value = selectedJob;
    }
    async function send() {
      const content = text.value.trim();
      if (!content || busy || sessionLoading || !status?.chat?.available) return;
      busy = true; stopping = false; fill(errors); sync();
      const controller = new AbortController(); activeStream = controller;
      const reply = { role: "assistant", content: "", status: "streaming", pendingStructured: taskMode.value !== "chat" };
      try {
        if (!current) current = await assistantApi.newSession({ title: content.slice(0, 40), job_id: selectedJob || null }, controller.signal);
        if (!isAlive()) return;
        activeSession = current.id;
        const values = contextFor(jobs.find((j) => j.id === selectedJob));
        const context = Object.fromEntries(Object.entries(values).filter(([key]) => contextChecks[key]));
        messages.push({ role: "user", content }, reply); text.value = ""; paintMessages(); sync();
        await streamMessage(current.id, { content, mode: taskMode.value, context }, { signal: controller.signal, onEvent: (name, value) => {
          if (!isAlive()) return;
          if (name === "delta") { reply.content += value.text || ""; const last = messageList.lastElementChild?.querySelector(".assistant-message-content"); if (last && !reply.pendingStructured) last.textContent = reply.content; messageList.scrollTop = messageList.scrollHeight; }
          if (name === "done") { Object.assign(reply, value.message || {}); reply.pendingStructured = false; reply.status = value.message?.status || "done"; paintMessages(); }
        } });
      } catch (e) {
        reply.pendingStructured = false;
        reply.status = e.name === "AbortError" ? "stopped" : "error";
        if (isAlive()) { showError(errors, e); if (!messages.includes(reply)) text.value = content; }
      } finally {
        if (activeStream === controller) activeStream = null;
        busy = false; stopping = false;
        if (isAlive()) { paintMessages(); sync(); refreshSessions().catch((e) => showError(errors, e)); }
      }
    }
    paintJobOptions(); paintContext(); paintMessages();
    const result = await Promise.allSettled([assistantApi.status(signal), assistantApi.sessions(signal), api.jobs({ status: "done", limit: 500 })]);
    if (!isAlive()) return;
    if (result[0].status === "fulfilled") status = result[0].value; else showError(errors, result[0].reason);
    if (result[1].status === "fulfilled") sessions = result[1].value.sessions || [];
    if (result[2].status === "fulfilled") jobs = result[2].value.jobs || [];
    selectedJob = query.song && jobs.some((j) => j.id === query.song) ? query.song : "";
    fill(connection, badge(statusLabel(status?.chat), status?.chat?.available ? "ready" : ""));
    modelLabel.textContent = status?.chat?.model ? `${status.chat.model} · ${status.chat.provider || "Hermes"}` : "本机 Hermes · 等待连接";
    paintJobOptions(); paintContext(); paintSessions(); paintMessages(); sync();
    if (query.session) await openSession(query.session);
  }

  async function covers() {
    let status = null, jobs = [], jobId = query.song || "", candidates = [], selected = null, appliedId = null, canRestore = false, working = false, applying = false, improving = false;
    let coverLoad = 0, elapsedTimer = null, backgroundTimer = null;
    lifetime.signal.addEventListener("abort", () => { clearInterval(elapsedTimer); clearTimeout(backgroundTimer); }, { once: true });
    let initialPrompt = "";
    try { initialPrompt = sessionStorage.getItem("yue2-assistant-cover-prompt") || ""; sessionStorage.removeItem("yue2-assistant-cover-prompt"); } catch { /* optional session storage */ }
    const errors = h("div", {}), currentInfo = h("div", {}), capability = h("div", {}), grid = h("div", { class: "assistant-candidates" }), preview = h("div", { class: "assistant-cover-canvas" }), caption = muted("");
    const selection = h("select", { "aria-label": "选择封面关联作品", onchange: () => { jobId = selection.value; paintJob(); loadCovers().catch((e) => showError(errors, e)); } });
    const prompt = h("textarea", { rows: 6, placeholder: "描述画面、色彩和情绪。例如：晨光穿过薄雾，安静的城市，细腻胶片颗粒，不要文字。", maxlength: 7900, "aria-label": "画面描述", oninput: sync }, initialPrompt.slice(0, 7900));
    const prefs = new Set(["无文字"]);
    const tags = h("div", { class: "assistant-tags" }, ["胶片感", "治愈", "无文字", "极简"].map((label) => button(label, (e) => {
      prefs.has(label) ? prefs.delete(label) : prefs.add(label); e.currentTarget.setAttribute("aria-pressed", String(prefs.has(label)));
    }, "", { "aria-pressed": String(prefs.has(label)) })));
    const generate = button("生成封面", generateImage, "primary assistant-wide", { disabled: true });
    const improve = button("根据歌词完善描述", improvePrompt, "assistant-wide", { disabled: true });
    const enlarge = button("放大查看", () => { if (selected) dialog("候选封面", h("img", { class: "assistant-cover-image", src: selected.url, alt: "候选封面大图" })).classList.add("image"); }, "ghost", { disabled: true });
    const apply = button("应用为作品封面", applyImage, "primary", { disabled: true });
    const restore = button("恢复原封面", restoreImage, "", { disabled: true });
    const pending = h("div", { hidden: true, class: "assistant-stack", role: "status" }), pendingText = muted("");
    fill(pending, h("div", { class: "assistant-inline-progress", "aria-label": "正在生成封面" }), pendingText);
    const controls = h("section", { class: "assistant-panel assistant-cover-controls" }, field("关联作品", selection), currentInfo, h("hr", { class: "assistant-divider" }), field("画面描述", prompt), improve, h("h3", {}, "画面偏好"), tags, row(h("span", { class: "assistant-muted assistant-grow" }, "封面比例"), badge("1 : 1 · 正方形")), capability, h("div", { class: "assistant-grow" }), pending, generate, muted("新的候选不会自动替换当前封面。"));
    fill(body, errors, h("div", { class: "assistant-cover-layout" }, controls, h("div", { class: "assistant-stack" }, h("section", { class: "assistant-panel assistant-cover-preview" }, row(h("h2", { class: "assistant-grow" }, "候选封面"), enlarge), preview, caption), grid, row(restore, h("span", { class: "assistant-grow" }), apply), muted("应用后保留原封面，可随时恢复。只改变封面，不会改动音乐。"))));
    function sync() {
      generate.disabled = working || improving || !status?.image?.available || !prompt.value.trim();
      generate.textContent = working ? "正在生成…" : "生成封面";
      improve.disabled = working || improving || !status?.chat?.available || !jobId;
      selection.disabled = working || applying || improving;
      apply.disabled = working || applying || !selected || !jobId || selected.id === appliedId;
      apply.textContent = selected?.id === appliedId ? "已应用为作品封面" : applying ? "正在更新…" : "应用为作品封面";
      restore.disabled = working || applying || !jobId || !canRestore;
      enlarge.disabled = !selected;
    }
    function paintJob() {
      const job = jobs.find((j) => j.id === jobId);
      fill(currentInfo, job ? h("div", { class: "assistant-stack" }, h("strong", {}, jobTitle(job)), muted(job.params?.style || "封面单独保存")) : muted("可以先生成候选，再选择作品应用封面。"));
      sync();
    }
    function paintPreview() {
      fill(preview, selected ? h("img", { class: "assistant-cover-image", src: selected.url, alt: selected.prompt ? `封面：${selected.prompt}` : "生成的封面", onerror: () => { caption.textContent = "图片暂时无法加载，请刷新页面后重试。"; } }) : h("div", { class: "assistant-cover-placeholder" }, h("h2", {}, working ? "画面正在形成" : "还没有候选封面"), muted(working ? "生成完成后会出现在这里。" : "写下画面描述，生成第一张封面。")));
      caption.textContent = selected ? `${selected.id === appliedId ? "当前作品封面 · " : "候选封面 · "}${date(selected.created_at)}` : "候选生成后，确认应用才会替换作品封面。";
      fill(grid, candidates.map((candidate, i) => button("", () => { selected = candidate; paintPreview(); }, "assistant-candidate", { "aria-pressed": String(selected?.id === candidate.id) })));
      [...grid.children].forEach((b, i) => fill(b, h("img", { src: candidates[i].url, alt: "", loading: "lazy" }), h("span", {}, `候选 ${String(i + 1).padStart(2, "0")}${candidates[i].id === appliedId ? " · 已应用" : ""}`)));
      sync();
    }
    async function loadCovers() {
      const revision = ++coverLoad;
      if (!working) { selected = null; appliedId = null; canRestore = false; paintPreview(); }
      const data = await assistantApi.covers(jobId, signal);
      if (!isAlive() || revision !== coverLoad) return;
      candidates = data.covers || []; appliedId = data.applied_id || null; canRestore = data.can_restore ?? Boolean(appliedId);
      selected = candidates.find((c) => c.id === appliedId) || candidates[0] || null;
      const relevantTask = data.task && (!data.task.job_id || data.task.job_id === jobId) ? data.task : null;
      if (!prompt.value.trim()) prompt.value = (relevantTask?.prompt || selected?.prompt || "").slice(0, 7900);
      if (relevantTask && ["error", "interrupted"].includes(relevantTask.status)) showError(errors, new Error(relevantTask.error || "上次封面生成已中断，画面描述已保留，可以重试。"));
      paintPreview();
      clearTimeout(backgroundTimer);
      if (data.generating) {
        working = true; pending.hidden = false; pendingText.textContent = "有一张封面正在生成，完成后自动显示。"; sync();
        backgroundTimer = setTimeout(() => loadCovers().catch((e) => { working = false; pending.hidden = true; sync(); showError(errors, e); }), 3000);
      } else if (!elapsedTimer) { working = false; pending.hidden = true; sync(); }
    }
    async function generateImage() {
      if (generate.disabled) return;
      working = true; fill(errors); pending.hidden = false; sync();
      const started = Date.now();
      const tick = () => { pendingText.textContent = `正在生成 · 已用 ${Math.floor((Date.now() - started) / 1000)} 秒。完成后保存到候选列表。`; };
      tick(); elapsedTimer = setInterval(tick, 1000);
      try {
        const result = await assistantApi.generateCover({ prompt: [prompt.value.trim(), ...prefs].join("\n"), job_id: jobId || null }, signal);
        if (!isAlive()) return;
        const candidate = result.cover || result;
        candidates = [candidate, ...candidates.filter((c) => c.id !== candidate.id)]; selected = candidate;
        toast("封面已生成，选择应用后才会更新作品。", "ok");
      } catch (e) { showError(errors, e); }
      finally { clearInterval(elapsedTimer); elapsedTimer = null; working = false; if (isAlive()) { pending.hidden = true; paintPreview(); } }
    }
    async function improvePrompt() {
      if (improve.disabled) return;
      improving = true; improve.textContent = "正在构思…"; sync(); fill(errors);
      const controller = new AbortController(); activeStream = controller;
      try {
        const session = await assistantApi.newSession({ title: "封面画面描述", job_id: jobId }, controller.signal);
        activeSession = session.id; let suggestion = "";
        await streamMessage(session.id, { content: `请根据这首歌完善封面画面描述。${prompt.value ? `已有想法：${prompt.value}` : "不需要文字，1:1 正方形。"}`, mode: "cover_prompt", context: contextFor(jobs.find((j) => j.id === jobId)) }, { signal: controller.signal, onEvent: (name, value) => {
          if (name === "done") suggestion = value.message?.suggestion?.cover_prompt || "";
        } });
        if (!isAlive()) return;
        if (!suggestion) throw new Error("助手没有返回可用的画面描述。请在创作对话中调整后重试。");
        dialog("预览画面描述", h("p", { class: "assistant-message-content" }, suggestion), [{ label: "使用这段描述", primary: true, action: (close) => { prompt.value = suggestion; sync(); close(); } }]);
      } catch (e) { showError(errors, e); }
      finally { improving = false; if (activeStream === controller) activeStream = null; if (isAlive()) { improve.textContent = "根据歌词完善描述"; sync(); } }
    }
    async function applyImage() {
      if (apply.disabled) return;
      applying = true; sync(); fill(errors);
      try { const result = await assistantApi.applyCover(selected.id, jobId, signal); if (isAlive()) { appliedId = result.cover_id || selected.id; canRestore = result.can_restore ?? true; toast("作品封面已更新。", "ok"); window.dispatchEvent(new CustomEvent("yue2:cover-updated", { detail: { job_id: jobId } })); } }
      catch (e) { showError(errors, e); }
      finally { applying = false; if (isAlive()) paintPreview(); }
    }
    async function restoreImage() {
      if (restore.disabled || !await confirm("恢复原封面", "恢复应用候选前的封面；生成的候选仍保留。")) return;
      applying = true; sync(); fill(errors);
      try { const result = await assistantApi.restoreCover(jobId, signal); if (isAlive()) { appliedId = result.cover_id || null; canRestore = result.can_restore ?? false; toast("已恢复原封面。", "ok"); window.dispatchEvent(new CustomEvent("yue2:cover-updated", { detail: { job_id: jobId } })); } }
      catch (e) { showError(errors, e); }
      finally { applying = false; if (isAlive()) paintPreview(); }
    }
    paintPreview();
    const result = await Promise.allSettled([assistantApi.status(signal), api.jobs({ status: "done", limit: 500 })]);
    if (!isAlive()) return;
    if (result[0].status === "fulfilled") status = result[0].value; else showError(errors, result[0].reason);
    if (result[1].status === "fulfilled") jobs = result[1].value.jobs || [];
    if (!jobs.some((j) => j.id === jobId)) jobId = "";
    fill(selection, h("option", { value: "" }, "暂不关联作品"), jobs.map((j) => h("option", { value: j.id, selected: j.id === jobId }, jobTitle(j))));
    fill(capability, status?.image?.available ? muted(`${status.image.model || "图片模型"} · ${status.image.provider || ""}`) : h("div", { class: "assistant-note" }, muted(status?.image?.message || "封面生成尚未配置。可以先写好描述。"), h("a", { href: settingsHref }, "前往连接设置 →")));
    paintJob(); await loadCovers();
  }

  async function settings() {
    let config = null, status = null, saving = false;
    const errors = h("div", {}), found = h("div", { class: "assistant-note accent" }), capabilities = h("div", { class: "assistant-stack" }), stateText = muted("正在读取本机配置…");
    const inputs = {
      hermes_base_url: h("input", { type: "url", placeholder: "http://127.0.0.1:8642", autocomplete: "off", "aria-label": "Hermes 服务地址" }),
      hermes_model: h("input", { placeholder: "沿用 Hermes 当前模型", autocomplete: "off", "aria-label": "对话模型" }),
      hermes_api_key: h("input", { type: "password", autocomplete: "new-password", placeholder: "留空沿用本机凭证", "aria-label": "Hermes 访问凭证" }),
      image_provider: h("select", { "aria-label": "封面模型服务", onchange: () => paintImageFields() }, [["hermes-codex", "Hermes · ChatGPT 图片能力"], ["openai-compatible", "自定义图片服务"], ["disabled", "暂不启用"]].map(([value, text]) => h("option", { value }, text))),
      image_base_url: h("input", { type: "url", placeholder: "图片服务 API 地址", autocomplete: "off", "aria-label": "图片服务地址" }),
      image_model: h("input", { placeholder: "图片模型名称", autocomplete: "off", "aria-label": "图片模型" }),
      image_api_key: h("input", { type: "password", autocomplete: "new-password", placeholder: "留空保持现有凭证", "aria-label": "图片服务访问凭证" }),
    };
    const imageFields = h("div", { class: "assistant-stack" });
    const save = button("保存并检测连接", saveAndCheck, "primary", { disabled: true });
    const retest = button("重新检测", testConnection, "", { disabled: true });
    const info = panel(h("h2", {}, "连接信息"), field("Hermes 服务地址", inputs.hermes_base_url), field("对话模型", inputs.hermes_model, "留空时跟随 Hermes 的当前配置。"), field("访问凭证", inputs.hermes_api_key, "凭证由本机服务保管，不回显，不写入对话和作品。"), row(save, retest), stateText);
    const images = panel(h("h2", {}, "封面生成"), field("图片服务", inputs.image_provider), imageFields);
    const right = h("aside", { class: "assistant-panel assistant-capabilities" }, h("h2", {}, "分别检查两种能力"), capabilities, h("hr", { class: "assistant-divider" }), h("h3", {}, "关于本地与联网"), muted("Hermes 在本机运行。对话与图片是否联网，取决于所选模型服务。"), h("div", { class: "assistant-grow" }), h("a", { class: "assistant-button", href: "#/assistant" }, "返回创作对话 →"));
    fill(body, errors, h("div", { class: "assistant-settings-layout" }, h("div", { class: "assistant-stack" }, found, info, images, h("div", { class: "assistant-note" }, h("h3", {}, "围绕当前作品的独立对话"), muted("每次发送前显示关联作品，可以移除歌词与曲风上下文。工作台会话独立保存，不导入其他 Hermes 对话。"))), right));
    function paintImageFields() {
      const provider = inputs.image_provider.value;
      fill(imageFields, provider === "disabled" ? muted("封面生成已关闭；仍可通过对话构思封面描述。") : provider === "hermes-codex" ? [field("图片模型", inputs.image_model), muted("复用这台电脑 Hermes 的 ChatGPT 登录。需要有效的登录状态，无需在这里填写密钥。")]
        : [field("服务地址", inputs.image_base_url), field("图片模型", inputs.image_model), field("访问凭证", inputs.image_api_key, "留空保持已保存凭证。")]);
      if (provider === "hermes-codex" && !inputs.image_model.value) inputs.image_model.value = "gpt-image-2-low";
    }
    function paintStatus() {
      const chat = status?.chat, imageStatus = status?.image;
      fill(found, h("div", { class: "assistant-row between" }, h("h2", {}, chat?.available ? "Hermes 已连接" : "本机 Hermes 连接"), badge(statusLabel(chat), chat?.available ? "ready" : "")), h("p", {}, chat?.message || "保存配置后测试连接状态。"));
      fill(capabilities, [["对话与创作建议", chat, "聊天、歌词润色、曲风建议。"], ["封面生成", imageStatus, "根据画面描述生成封面候选。"]].map(([name, s, desc]) => h("div", { class: "assistant-capability" }, row(h("h3", { class: "assistant-grow" }, name), badge(statusLabel(s), s?.available ? "ready" : "")), muted(desc), s?.model ? h("p", {}, s.model) : null, muted(s?.message || "等待检测"))));
    }
    function busy(on) { saving = on; save.disabled = on || !config; retest.disabled = on || !config; save.textContent = on ? "正在检测…" : "保存并检测连接"; Object.values(inputs).forEach((input) => { input.disabled = on; }); }
    async function testConnection() {
      if (saving) return;
      busy(true); fill(errors); stateText.textContent = "正在分别检测对话和图片能力…";
      try { status = await assistantApi.check(signal); if (isAlive()) { paintStatus(); stateText.textContent = "检测完成；能力状态如右侧所示。"; } }
      catch (e) { showError(errors, e); stateText.textContent = "检测失败，配置已保留。"; }
      finally { if (isAlive()) busy(false); }
    }
    async function saveAndCheck() {
      if (saving || !config) return;
      if (!inputs.hermes_base_url.value.trim()) { inputs.hermes_base_url.focus(); return showError(errors, new Error("请填写 Hermes 服务地址。")); }
      busy(true); fill(errors); stateText.textContent = "正在保存连接配置…";
      const data = {};
      for (const [key, input] of Object.entries(inputs)) if (!key.endsWith("api_key") || input.value.trim()) data[key] = input.value.trim();
      data.hermes_model ||= "hermes-agent";
      try {
        config = await assistantApi.saveConfig(data, signal);
        if (!isAlive()) return;
        inputs.hermes_api_key.value = ""; inputs.image_api_key.value = "";
        stateText.textContent = "配置已保存，正在检测…";
        status = await assistantApi.check(signal);
        if (isAlive()) { paintStatus(); stateText.textContent = "配置已保存，检测完成。"; toast("连接配置已保存。", "ok"); app?.refreshStatus?.(); }
      } catch (e) { showError(errors, e); stateText.textContent = "请根据错误信息检查连接配置。"; }
      finally { if (isAlive()) busy(false); }
    }
    paintStatus(); paintImageFields();
    const result = await Promise.allSettled([assistantApi.config(signal), assistantApi.status(signal)]);
    if (!isAlive()) return;
    if (result[0].status === "fulfilled") {
      config = result[0].value;
      for (const [key, input] of Object.entries(inputs)) if (!key.endsWith("api_key")) input.value = config[key] || (key === "image_provider" ? "disabled" : "");
      inputs.hermes_api_key.placeholder = config.has_hermes_api_key ? "已保存凭证 · 留空保持不变" : "未设置 · 留空沿用本机凭证";
      inputs.image_api_key.placeholder = config.has_image_api_key ? "已保存凭证 · 留空保持不变" : "填写图片服务凭证";
      stateText.textContent = "凭证不会回显。修改后点击保存并检测。";
    } else { showError(errors, result[0].reason); stateText.textContent = "连接配置未能加载，请刷新后重试。"; }
    if (result[1].status === "fulfilled") status = result[1].value;
    paintImageFields(); paintStatus(); busy(false);
  }

  (mode === "settings" ? settings() : mode === "cover" ? covers() : chat()).catch((error) => {
    if (isAlive() && error.name !== "AbortError") body.prepend(h("div", { class: "assistant-error", role: "alert" }, error.message || String(error)));
  });
  return { unmount() {
    disposed = true;
    if (activeStream) { if (activeSession) assistantApi.stop(activeSession).catch(() => {}); activeStream.abort(); }
    lifetime.abort(); dialogs.forEach((node) => { node.close(); node.remove(); }); dialogs.clear();
  } };
}
