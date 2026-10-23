import { assistantApi, streamMessage } from "./assistant";
import type { AssistantMessage, AssistantSession } from "./assistant";
import { errorMessage } from "./utils";

type ModelList = Awaited<ReturnType<typeof assistantApi.models>>;
type AudioAttachment = Awaited<ReturnType<typeof assistantApi.uploadAudio>>;
type ImageAttachment = Awaited<ReturnType<typeof assistantApi.uploadImage>>;
export type ConversationMode = "chat" | "lyrics";

export interface AssistantConversationState {
  sessions: AssistantSession[];
  current: AssistantSession | null;
  messages: AssistantMessage[];
  input: string;
  mode: ConversationMode;
  audio: File | null;
  uploadedAudio: AudioAttachment | null;
  image: File | null;
  uploadedImage: ImageAttachment | null;
  models: ModelList["models"];
  modelsLoading: boolean;
  modelsError: string;
  selectedModel: string;
  audioCapability: ModelList["audio"] | null;
  connected: boolean | null;
  busy: boolean;
  phase: "uploading" | "replying" | null;
  sessionLoading: boolean;
  error: string;
  lastPrompt: string;
  canRetry: boolean;
}

interface SubmittedDraft {
  content: string;
  audio: File | null;
  attachment: AudioAttachment | null;
  image: File | null;
  imageAttachment: ImageAttachment | null;
  model: string;
  mode: ConversationMode;
}

const storageKey = "music.assistant";
const isAbort = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

function restoredMessages(session: AssistantSession) {
  return (session.messages || []).map((message) => {
    if (message.role !== "assistant") return message;
    const legacyStructured =
      message.mode === "style" || message.mode === "cover_prompt";
    return {
      ...message,
      // Conversational replies are filtered by the server: show their readable
      // text immediately, and keep a separately parsed proposal in either mode.
      status:
        message.status === "streaming" && !session.active
          ? "interrupted"
          : message.status,
      pendingStructured:
        legacyStructured &&
        !message.suggestion &&
        message.status !== "complete",
    };
  });
}

/** Owns the request, independently of whether the assistant route is mounted. */
export function createAssistantConversation() {
  let saved: { session?: string; model?: string; mode?: ConversationMode } = {};
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
    if (value && typeof value === "object") saved = value;
  } catch {}
  let state: AssistantConversationState = {
    sessions: [],
    current: null,
    messages: [],
    input: "",
    mode: saved.mode === "lyrics" ? "lyrics" : "chat",
    audio: null,
    uploadedAudio: null,
    image: null,
    uploadedImage: null,
    models: [],
    modelsLoading: false,
    modelsError: "",
    selectedModel: saved.model || "",
    audioCapability: null,
    connected: null,
    busy: false,
    phase: null,
    sessionLoading: false,
    error: "",
    lastPrompt: "",
    canRetry: false,
  };
  const listeners = new Set<() => void>();
  let active: {
    controller: AbortController;
    session?: string;
    replyId: string;
    complete: boolean;
  } | null = null;
  let recovery: {
    session: string;
    controller: AbortController;
    timer?: ReturnType<typeof setTimeout>;
    fetching: boolean;
    stopping: boolean;
    onInterrupted?: () => void;
  } | null = null;
  let historyRequest: AbortController | null = null;
  let initialization: Promise<void> | null = null;
  let modelRevision = 0;
  let historyRevision = 0;
  let draftRevision = 0;
  let listRevision = 0;
  let lastRequest: SubmittedDraft | null = null;
  let disposed = false;

  const publish = (patch: Partial<AssistantConversationState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const persist = () => {
    if (disposed) return;
    saved = {
      session: state.current?.id,
      model: state.selectedModel,
      mode: state.mode,
    };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {}
  };
  const changeReply = (
    replyId: string,
    update: (message: AssistantMessage) => AssistantMessage,
  ) =>
    publish({
      messages: state.messages.map((message) =>
        message.id === replyId ? update(message) : message,
      ),
    });

  async function refreshSessions() {
    const revision = ++listRevision;
    try {
      const result = await assistantApi.sessions();
      if (revision === listRevision) publish({ sessions: result.sessions });
    } catch {
      // A history-list refresh must not replace a live conversation error.
    }
  }

  async function refreshModels() {
    const revision = ++modelRevision;
    publish({ modelsLoading: true, modelsError: "" });
    try {
      const result = await assistantApi.models();
      if (revision !== modelRevision) return;
      const selectedModel = result.models.some(
        (model) => model.id === state.selectedModel,
      )
        ? state.selectedModel
        : result.models.some((model) => model.id === result.default_model)
          ? result.default_model
          : result.models[0]?.id || "";
      publish({
        models: result.models,
        selectedModel,
        audioCapability: result.audio,
      });
      persist();
    } catch (reason) {
      if (revision === modelRevision) {
        publish({
          models: [],
          selectedModel: "",
          modelsError: errorMessage(reason),
        });
        persist();
      }
    } finally {
      if (revision === modelRevision) publish({ modelsLoading: false });
    }
  }

  // A full browser reload loses the delivery stream, but the backend keeps
  // generating. Read its checkpoints until completion instead of resending.
  async function pollRecoveredReply(request: NonNullable<typeof recovery>) {
    if (recovery !== request || request.fetching) return;
    if (request.timer) clearTimeout(request.timer);
    request.fetching = true;
    try {
      const session = await assistantApi.session(
        request.session,
        request.controller.signal,
      );
      if (recovery !== request || request.controller.signal.aborted) return;
      publish({
        current: session,
        messages: restoredMessages(session),
        error: "",
      });
      if (!session.active) {
        recovery = null;
        publish({ busy: false, phase: null });
        const finalReply = [...(session.messages || [])]
          .reverse()
          .find((message) => message.role === "assistant");
        if (finalReply?.status === "complete") {
          lastRequest = null;
          publish({ canRetry: false, lastPrompt: "", connected: true });
        } else {
          request.onInterrupted?.();
          if (finalReply?.status === "error" && state.canRetry)
            publish({ error: "回复未完成，请重试。" });
        }
        void refreshSessions();
        return;
      }
    } catch (reason) {
      if (
        recovery === request &&
        (reason as { status?: number })?.status === 404
      ) {
        recovery = null;
        publish({ busy: false, phase: null, error: errorMessage(reason) });
      } else if (recovery === request && !request.controller.signal.aborted)
        publish({
          error: `重新连接回复失败：${errorMessage(reason)}，正在重试。`,
        });
    } finally {
      request.fetching = false;
      if (recovery === request)
        request.timer = setTimeout(
          () => void pollRecoveredReply(request),
          1500,
        );
    }
  }

  function recoverReply(session: AssistantSession, onInterrupted?: () => void) {
    if (!session.active || recovery || active) return;
    const request = {
      session: session.id,
      controller: new AbortController(),
      fetching: false,
      stopping: false,
      onInterrupted,
    };
    recovery = request;
    publish({ busy: true, phase: "replying" });
    void pollRecoveredReply(request);
  }

  async function openSession(id: string) {
    if (active || recovery || !id || state.current?.id === id) return false;
    historyRequest?.abort();
    const controller = new AbortController();
    historyRequest = controller;
    const revision = ++historyRevision;
    publish({ sessionLoading: true, error: "" });
    try {
      const session = await assistantApi.session(id, controller.signal);
      if (controller.signal.aborted || revision !== historyRevision)
        return false;
      draftRevision++;
      lastRequest = null;
      publish({
        current: session,
        messages: restoredMessages(session),
        input: "",
        audio: null,
        uploadedAudio: null,
        image: null,
        uploadedImage: null,
        lastPrompt: "",
        canRetry: false,
      });
      persist();
      recoverReply(session);
      return true;
    } catch (reason) {
      if (
        !controller.signal.aborted &&
        revision === historyRevision &&
        !isAbort(reason)
      )
        publish({ error: errorMessage(reason) });
      return false;
    } finally {
      if (historyRequest === controller) {
        historyRequest = null;
        publish({ sessionLoading: false });
      }
    }
  }

  async function init(initialSession?: string) {
    if (!initialization) {
      const restore = initialSession || saved.session;
      const restoration =
        restore &&
        !state.current &&
        !active &&
        !recovery &&
        !historyRequest &&
        !state.input &&
        !state.audio &&
        !state.image
          ? openSession(restore)
          : Promise.resolve();
      initialization = Promise.allSettled([
        refreshSessions(),
        refreshModels(),
        assistantApi
          .status()
          .then((status) => publish({ connected: status.chat.available })),
        restoration,
      ]).then(() => {});
    } else if (
      initialSession &&
      initialSession !== state.current?.id &&
      !active &&
      !recovery
    ) {
      await openSession(initialSession);
    }
    await initialization;
  }

  function newConversation() {
    if (active || recovery) return false;
    historyRequest?.abort();
    historyRequest = null;
    historyRevision++;
    draftRevision++;
    lastRequest = null;
    publish({
      current: null,
      messages: [],
      input: "",
      audio: null,
      uploadedAudio: null,
      image: null,
      uploadedImage: null,
      error: "",
      lastPrompt: "",
      canRetry: false,
      sessionLoading: false,
    });
    persist();
    return true;
  }

  async function submit(draft: SubmittedDraft) {
    if (
      disposed ||
      (!draft.content && !draft.audio && !draft.image) ||
      active ||
      recovery ||
      state.sessionLoading
    )
      return;
    const request = {
      controller: new AbortController(),
      session: state.current?.id,
      replyId: crypto.randomUUID(),
      complete: false,
    };
    // Set synchronously before upload/session creation so rapid sends cannot race.
    active = request;
    lastRequest = draft;
    const initialDraftRevision = draftRevision;
    const consumesDraft =
      state.input.trim() === draft.content &&
      state.audio === draft.audio &&
      state.image === draft.image &&
      state.mode === draft.mode;
    let clearedDraftRevision: number | null = null;
    let resumedSession: AssistantSession | null = null;
    const restoreDraft = () => {
      if (
        clearedDraftRevision !== null &&
        draftRevision === clearedDraftRevision
      ) {
        draftRevision++;
        publish({
          input: draft.content,
          audio: draft.audio,
          uploadedAudio: draft.attachment,
          image: draft.image,
          uploadedImage: draft.imageAttachment,
        });
      }
      publish({ canRetry: true });
    };
    publish({
      busy: true,
      phase:
        (draft.audio && !draft.attachment) ||
        (draft.image && !draft.imageAttachment)
          ? "uploading"
          : "replying",
      error: "",
      lastPrompt: draft.content,
      canRetry: false,
    });
    const signal = request.controller.signal;
    try {
      if (draft.audio && !draft.attachment) {
        draft.attachment = await assistantApi.uploadAudio(draft.audio, signal);
        if (signal.aborted) return;
        if (state.audio === draft.audio)
          publish({ uploadedAudio: draft.attachment });
      }
      if (draft.image && !draft.imageAttachment) {
        draft.imageAttachment = await assistantApi.uploadImage(
          draft.image,
          signal,
        );
        if (signal.aborted) return;
        if (state.image === draft.image)
          publish({ uploadedImage: draft.imageAttachment });
      }
      publish({ phase: "replying" });
      const session =
        state.current ||
        (await assistantApi.newSession(
          {
            title: (
              draft.content ||
              (draft.image ? "图片灵感" : draft.audio?.name || "音乐灵感")
            ).slice(0, 40),
          },
          signal,
        ));
      request.session = session.id;
      if (signal.aborted) {
        void assistantApi.stop(session.id).catch(() => {});
        return;
      }
      const previousDraft = [...state.messages]
        .reverse()
        .find((message) => message.suggestion)?.suggestion;
      const userMessage: AssistantMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: draft.content,
        mode: draft.mode,
        ...(draft.attachment ? { audio: draft.attachment } : {}),
        ...(draft.imageAttachment ? { image: draft.imageAttachment } : {}),
        ...(draft.model ? { model: draft.model } : {}),
      };
      publish({
        current: session,
        messages: [
          ...state.messages,
          userMessage,
          {
            id: request.replyId,
            role: "assistant",
            content: "",
            status: "streaming",
            pendingStructured: false,
            model: draft.model,
            mode: draft.mode,
          },
        ],
      });
      persist();
      if (consumesDraft && draftRevision === initialDraftRevision) {
        clearedDraftRevision = ++draftRevision;
        publish({
          input: "",
          audio: null,
          uploadedAudio: null,
          image: null,
          uploadedImage: null,
        });
      }
      await streamMessage(
        session.id,
        {
          content: draft.content,
          mode: draft.mode,
          ...(draft.model ? { model: draft.model } : {}),
          ...(draft.attachment ? { audio_id: draft.attachment.id } : {}),
          ...(draft.imageAttachment
            ? { image_id: draft.imageAttachment.id }
            : {}),
          context: previousDraft
            ? {
                title: previousDraft.title,
                lyrics: previousDraft.lyrics,
                description: previousDraft.description || previousDraft.style,
              }
            : {},
        },
        {
          signal,
          onEvent: (event) => {
            if (signal.aborted || active !== request || request.complete)
              return;
            if (event.type === "delta")
              changeReply(request.replyId, (message) => ({
                ...message,
                content: message.content + event.text,
              }));
            if (event.type === "done") {
              request.complete = true;
              lastRequest = null;
              // The model has finished, even if the transport has not reached EOF.
              // Keep busy until cleanup so another submission cannot race this request.
              publish({
                connected: true,
                lastPrompt: "",
                canRetry: false,
                phase: null,
              });
              changeReply(request.replyId, () => ({
                ...event.message,
                id: request.replyId,
                model: event.message.model || draft.model,
                mode: draft.mode,
                pendingStructured: false,
              }));
            }
          },
        },
      );
      if (!signal.aborted) {
        lastRequest = null;
        publish({ connected: true, lastPrompt: "", canRetry: false });
      }
    } catch (reason) {
      if (
        !signal.aborted &&
        !isAbort(reason) &&
        request.session &&
        !request.complete
      ) {
        try {
          const session = await assistantApi.session(request.session, signal);
          if (session.active && !signal.aborted) {
            resumedSession = session;
            publish({
              current: session,
              messages: restoredMessages(session),
              error: "",
              canRetry: false,
            });
          }
        } catch {
          // If the backend cannot be reached, retain the draft and original error.
        }
      }
      if (resumedSession) return;
      if (!request.complete && !signal.aborted && !isAbort(reason))
        publish({ error: errorMessage(reason) });
      if (!request.complete)
        changeReply(request.replyId, (message) => ({
          ...message,
          status: signal.aborted || isAbort(reason) ? "stopped" : "error",
        }));
    } finally {
      if (!request.complete && !resumedSession) restoreDraft();
      if (active === request) {
        active = null;
        if (resumedSession) recoverReply(resumedSession, restoreDraft);
        else publish({ busy: false, phase: null });
      }
      void refreshSessions();
    }
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    init,
    openSession,
    newConversation,
    refreshModels,
    dispose() {
      // Detach this browser only. Server work remains available when the same
      // account signs in again; logging out is not a generation cancellation.
      publish({
        sessions: [],
        current: null,
        messages: [],
        input: "",
        audio: null,
        uploadedAudio: null,
        image: null,
        uploadedImage: null,
        models: [],
        selectedModel: "",
        mode: "chat",
        audioCapability: null,
        connected: null,
        busy: false,
        phase: null,
        sessionLoading: false,
        modelsLoading: false,
        modelsError: "",
        error: "",
        lastPrompt: "",
        canRetry: false,
      });
      disposed = true;
      active?.controller.abort();
      historyRequest?.abort();
      if (recovery?.timer) clearTimeout(recovery.timer);
      recovery?.controller.abort();
      active = null;
      recovery = null;
      modelRevision++;
      historyRevision++;
      listRevision++;
      lastRequest = null;
      listeners.clear();
    },
    setInput(value: string) {
      draftRevision++;
      publish({ input: value });
    },
    setMode(value: ConversationMode) {
      if (value !== "chat" && value !== "lyrics") return;
      draftRevision++;
      publish({ mode: value });
      persist();
    },
    setModel(value: string) {
      if (!state.models.some((model) => model.id === value)) return;
      publish({ selectedModel: value });
      persist();
    },
    setImage(file: File | null) {
      draftRevision++;
      publish({ image: file, uploadedImage: null, error: "" });
    },
    setAudio(file: File | null) {
      draftRevision++;
      publish({ audio: file, uploadedAudio: null, error: "" });
    },
    setConnected(value: boolean) {
      publish({ connected: value });
    },
    clearError() {
      publish({ error: "" });
    },
    send() {
      return submit({
        content: state.input.trim(),
        audio: state.audio,
        attachment: state.uploadedAudio,
        image: state.image,
        imageAttachment: state.uploadedImage,
        model: state.selectedModel,
        mode: state.mode,
      });
    },
    retry() {
      return lastRequest ? submit({ ...lastRequest }) : Promise.resolve();
    },
    stop() {
      const request = active;
      if (!request) {
        const resumed = recovery;
        if (!resumed || resumed.stopping) return;
        resumed.stopping = true;
        void assistantApi
          .stop(resumed.session)
          .then(() => {
            if (recovery === resumed) void pollRecoveredReply(resumed);
          })
          .catch((reason) => {
            if (recovery === resumed) publish({ error: errorMessage(reason) });
          })
          .finally(() => {
            resumed.stopping = false;
          });
        return;
      }
      request.controller.abort();
      if (request.session)
        void assistantApi.stop(request.session).catch(() => {});
      if (!request.complete)
        changeReply(request.replyId, (message) => ({
          ...message,
          status: "stopped",
        }));
    },
  };
}

export const assistantConversation = createAssistantConversation();
