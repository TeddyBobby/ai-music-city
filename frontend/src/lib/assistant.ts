export interface AssistantCapability {
  configured: boolean;
  available: boolean;
  verified?: boolean;
  model: string;
  provider: string;
  message: string;
  base_url?: string;
}
export interface AssistantStatus {
  chat: AssistantCapability;
  image: AssistantCapability;
}
export interface AssistantConfig {
  hermes_base_url: string;
  hermes_model: string;
  has_hermes_api_key: boolean;
  image_provider: "disabled" | "hermes-codex" | "openai-compatible";
  image_base_url: string;
  image_model: string;
  has_image_api_key: boolean;
}
export type AssistantConfigPatch = Omit<
  AssistantConfig,
  "has_hermes_api_key" | "has_image_api_key"
> & { hermes_api_key?: string; image_api_key?: string };
export type AssistantMode = "chat" | "lyrics" | "style" | "cover_prompt";
export interface Suggestion {
  title?: string;
  lyrics?: string;
  description?: string;
  style?: string;
  cover_prompt?: string;
}
export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  status?: string;
  suggestion?: Suggestion;
  pendingStructured?: boolean;
}
export interface AssistantSession {
  id: string;
  title: string;
  job_id: string | null;
  created_at: string;
  updated_at: string;
  message_count?: number;
  messages?: AssistantMessage[];
}
export interface CoverCandidate {
  id: string;
  prompt: string;
  url: string;
  created_at: string;
  job_id?: string | null;
}
export interface CoverTask {
  id: string;
  status: "running" | "complete" | "error" | "interrupted";
  prompt: string;
  job_id: string | null;
  created_at: string;
  updated_at: string;
  cover_id?: string;
  error?: string;
}
export interface AppliedCover {
  job_id: string;
  cover_url: string | null;
  cover_id: string | null;
  can_restore: boolean;
}
export interface CoverList {
  covers: CoverCandidate[];
  applied_id: string | null;
  can_restore: boolean;
  generating: boolean;
  task?: CoverTask;
}
export interface MessageBody {
  content: string;
  mode: AssistantMode;
  context?: { title?: string; lyrics?: string; description?: string };
}
export type StreamEvent =
  | { type: "meta"; run_id: string; session_id: string }
  | { type: "delta"; text: string }
  | { type: "done"; message: AssistantMessage };

export class AssistantError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AssistantError";
  }
}
const base = "/api/assistant";
type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };
async function response(
  path: string,
  { method = "GET", body, signal }: RequestOptions = {},
) {
  let result: Response;
  try {
    result = await fetch(base + path, {
      method,
      signal,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new AssistantError(
      0,
      "network_error",
      "无法连接本地工作台，请确认服务仍在运行。",
    );
  }
  if (!result.ok) {
    const data = await result.json().catch(() => null);
    throw new AssistantError(
      result.status,
      data?.error?.code || "assistant_error",
      data?.error?.message || `请求失败（${result.status}）`,
    );
  }
  return result;
}
async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const result = await response(path, options);
  return result.status === 204 ? (null as T) : result.json();
}

/** A POST SSE stream; handles arbitrary UTF-8 and CRLF chunk boundaries. */
export async function streamMessage(
  sessionId: string,
  body: MessageBody,
  options: {
    signal?: AbortSignal;
    onEvent?: (event: StreamEvent) => void;
  } = {},
) {
  const res = await response(
    `/sessions/${encodeURIComponent(sessionId)}/messages`,
    { method: "POST", body, signal: options.signal },
  );
  if (!res.body)
    throw new Error("浏览器无法读取流式回复，请更新浏览器后重试。");
  const reader = res.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    ended = false;
  const consume = (block: string) => {
    let name = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    let value;
    try {
      value = JSON.parse(data.join("\n"));
    } catch {
      throw new Error("收到无法解析的助手回复，请重试。");
    }
    if (name === "error") {
      ended = true;
      throw new Error(
        value.message || value.error?.message || "回复中断，请稍后重试。",
      );
    }
    if (name === "done") ended = true;
    if (["meta", "delta", "done"].includes(name))
      options.onEvent?.({ ...value, type: name } as StreamEvent);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!ended && !options.signal?.aborted)
      throw new Error("连接已中断。已有回复已保留，可以重新发送。");
  } finally {
    reader.releaseLock();
  }
}

export const assistantApi = {
  status: (signal?: AbortSignal) =>
    request<AssistantStatus>("/status", { signal }),
  config: (signal?: AbortSignal) =>
    request<AssistantConfig>("/config", { signal }),
  saveConfig: (body: AssistantConfigPatch, signal?: AbortSignal) =>
    request<AssistantConfig>("/config", { method: "PUT", body, signal }),
  check: (signal?: AbortSignal) =>
    request<AssistantStatus>("/check", { method: "POST", signal }),
  sessions: (signal?: AbortSignal) =>
    request<{ sessions: AssistantSession[] }>("/sessions", { signal }),
  newSession: (
    body: { title?: string; job_id?: string | null },
    signal?: AbortSignal,
  ) => request<AssistantSession>("/sessions", { method: "POST", body, signal }),
  session: (id: string, signal?: AbortSignal) =>
    request<AssistantSession>(`/sessions/${encodeURIComponent(id)}`, {
      signal,
    }),
  stop: (id: string) =>
    request<{ status: string }>(`/sessions/${encodeURIComponent(id)}/stop`, {
      method: "POST",
    }),
  covers: (jobId?: string, signal?: AbortSignal) =>
    request<CoverList>(
      "/covers" + (jobId ? `?job_id=${encodeURIComponent(jobId)}` : ""),
      { signal },
    ),
  generateCover: (
    body: { prompt: string; job_id?: string | null },
    signal?: AbortSignal,
  ) => request<CoverCandidate>("/covers", { method: "POST", body, signal }),
  applyCover: (id: string, jobId: string, signal?: AbortSignal) =>
    request<AppliedCover>(`/covers/${encodeURIComponent(id)}/apply`, {
      method: "POST",
      body: { job_id: jobId },
      signal,
    }),
  restoreCover: (jobId: string, signal?: AbortSignal) =>
    request<AppliedCover>("/covers/restore", {
      method: "POST",
      body: { job_id: jobId },
      signal,
    }),
};
