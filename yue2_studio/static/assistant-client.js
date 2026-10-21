// Same-origin assistant API. Credentials are submitted only to the local server.
import { ApiError } from "./api.js";

const base = "/api/assistant";
async function response(path, { method = "GET", body, signal } = {}) {
  let res;
  try {
    res = await fetch(base + path, { method, signal, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError(0, "network_error", "无法连接本地工作台，请确认服务仍在运行。");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.code || "assistant_error", data?.error?.message || `请求失败（${res.status}）`);
  }
  return res;
}
async function request(path, options) {
  const res = await response(path, options);
  return res.status === 204 ? null : res.json();
}

/** Read SSE from a POST, including events split across UTF-8/network chunks. */
export async function streamMessage(sessionId, body, { signal, onEvent } = {}) {
  const res = await response(`/sessions/${encodeURIComponent(sessionId)}/messages`, { method: "POST", body, signal });
  if (!res.body) throw new Error("浏览器无法读取流式回复，请更新浏览器后重试。");
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buffer = "", ended = false;
  const consume = (block) => {
    let name = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    let value;
    try { value = JSON.parse(data.join("\n")); } catch { throw new Error("收到无法解析的助手回复，请重试。"); }
    onEvent?.(name, value);
    if (name === "done" || name === "error") ended = true;
    if (name === "error") throw new Error(value.message || value.error?.message || "回复中断，请稍后重试。");
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) { consume(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!ended && !signal?.aborted) throw new Error("连接已中断。已有回复已保留，可以重新发送。");
  } finally { reader.releaseLock(); }
}

export const assistantApi = {
  status: (signal) => request("/status", { signal }),
  config: (signal) => request("/config", { signal }),
  saveConfig: (body, signal) => request("/config", { method: "PUT", body, signal }),
  check: (signal) => request("/check", { method: "POST", signal }),
  sessions: (signal) => request("/sessions", { signal }),
  newSession: (body, signal) => request("/sessions", { method: "POST", body, signal }),
  session: (id, signal) => request(`/sessions/${encodeURIComponent(id)}`, { signal }),
  stop: (id) => request(`/sessions/${encodeURIComponent(id)}/stop`, { method: "POST" }),
  covers: (jobId, signal) => request("/covers" + (jobId ? `?job_id=${encodeURIComponent(jobId)}` : ""), { signal }),
  generateCover: (body, signal) => request("/covers", { method: "POST", body, signal }),
  applyCover: (id, jobId, signal) => request(`/covers/${encodeURIComponent(id)}/apply`, { method: "POST", body: { job_id: jobId }, signal }),
  restoreCover: (jobId, signal) => request("/covers/restore", { method: "POST", body: { job_id: jobId }, signal }),
};
