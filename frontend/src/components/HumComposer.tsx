import { useEffect, useId, useRef, useState } from "react";
import { ArrowUp, LoaderCircle, Mic, Square, Upload, X } from "lucide-react";
import { api } from "../lib/api";
import { accountFetch } from "../lib/accountBoundary";
import {
  defaultMusicOptions,
  type MusicKind,
} from "../lib/musicCreation";
import type { Job } from "../lib/types";
import "./HumComposer.css";

type Phase =
  | "idle"
  | "permission"
  | "recording"
  | "stopping"
  | "checking"
  | "uploading"
  | "writing"
  | "submitting";
type Props = {
  onCreated: (job: Job) => void;
  onBusyChange?: (busy: boolean) => void;
  musicKind?: MusicKind;
};
const ACCEPT = ".mp3,.wav,.flac,.m4a,.ogg,.webm,.mp4";
const MAX_RECORD_SECONDS = 120;

/** One recording, one optional idea, one song. Device and model details stay here. */
export function HumComposer({
  onCreated,
  onBusyChange,
  musicKind = "vocal",
}: Props) {
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const action = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  const media = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pending = useRef<AbortController | null>(null);
  const previewRef = useRef<string | null>(null);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [idea, setIdea] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const busy = phase !== "idle";
  const recordingSupported =
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  function changePhase(value: Phase) {
    phaseRef.current = value;
    if (alive.current) setPhase(value);
  }

  function releaseMicrophone() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    media.current = null;
  }

  function finishRecording() {
    const recorder = media.current;
    if (recorder?.state !== "recording") return;
    changePhase("stopping");
    recorder.stop();
  }

  function selectFile(next: File | null) {
    if (
      next &&
      (!/\.(mp3|wav|flac|m4a|ogg|webm|mp4)$/i.test(next.name) ||
        next.size === 0)
    ) {
      setError("请选择可播放的音频文件。");
      return;
    }
    if (next && next.size > 200 * 1024 * 1024) {
      setError("音频太大了，请选择小于 200 MB 的文件。");
      return;
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = next ? URL.createObjectURL(next) : null;
    previewRef.current = url;
    setPreview(url);
    setFile(next);
    setError("");
  }

  useEffect(() => {
    alive.current = true;
    let current = true;
    api
      .status()
      .then((status) => {
        if (current) setAvailable(!!status.hum?.available);
      })
      .catch(() => {});
    return () => {
      current = false;
      alive.current = false;
      action.current += 1;
      pending.current?.abort();
      if (media.current && media.current.state !== "inactive") {
        media.current.onstop = null;
        media.current.ondataavailable = null;
        media.current.stop();
      }
      releaseMicrophone();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
      busyCallback.current?.(false);
    };
  }, []);

  useEffect(() => {
    busyCallback.current?.(busy);
  }, [busy]);

  async function startRecording() {
    if (phaseRef.current !== "idle") return;
    if (!recordingSupported) {
      setError("当前浏览器无法录音，请上传一段音频。");
      return;
    }
    setError("");
    changePhase("permission");
    const requestId = ++action.current;
    let nextStream: MediaStream | null = null;
    try {
      nextStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (!alive.current || requestId !== action.current) {
        nextStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = nextStream;
      const mimeType = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(
        nextStream,
        mimeType ? { mimeType } : undefined,
      );
      media.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (!alive.current || requestId !== action.current) return;
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
        releaseMicrophone();
        if (alive.current) {
          setError("录音中断了，请再试一次。");
          changePhase("idle");
        }
      };
      recorder.onstop = () => {
        if (!alive.current || requestId !== action.current) return;
        releaseMicrophone();
        const type = recorder.mimeType || mimeType || "audio/webm";
        const ext = type.includes("mp4")
          ? "m4a"
          : type.includes("ogg")
            ? "ogg"
            : "webm";
        const blob = new Blob(chunks, { type });
        if (blob.size)
          selectFile(new File([blob], `我的哼唱.${ext}`, { type }));
        else setError("没有录到声音，请再试一次。");
        changePhase("idle");
      };
      recorder.start(250);
      setSeconds(0);
      changePhase("recording");
      const started = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_RECORD_SECONDS && recorder.state === "recording")
          finishRecording();
      }, 250);
    } catch (cause) {
      nextStream?.getTracks().forEach((track) => track.stop());
      if (!alive.current || requestId !== action.current) return;
      releaseMicrophone();
      const name = cause instanceof Error ? cause.name : "";
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "请允许麦克风权限，或上传一段音频。"
          : name === "NotFoundError"
            ? "没有找到麦克风，请上传一段音频。"
            : "麦克风暂不可用，请重试或上传音频。",
      );
      changePhase("idle");
    }
  }

  function cancel() {
    // Once the job is being submitted, let the response resolve its identity.
    if (phaseRef.current === "submitting") return;
    action.current += 1;
    pending.current?.abort();
    if (media.current && media.current.state !== "inactive") {
      media.current.onstop = null;
      media.current.stop();
    }
    releaseMicrophone();
    changePhase("idle");
    setError("");
  }

  async function generate() {
    if (!file || phaseRef.current !== "idle") return;
    const requestId = ++action.current;
    const controller = new AbortController();
    pending.current = controller;
    const current = () =>
      alive.current &&
      requestId === action.current &&
      !controller.signal.aborted;
    changePhase("checking");
    setError("");
    try {
      const status = await api.status();
      if (!current()) return;
      setAvailable(!!status.hum?.available);
      if (status.models?.present === false)
        throw new Error("音乐模型尚未就绪，请先完成模型配置后重试。");
      if (!status.hum?.available)
        throw new Error("哼唱生成暂未启用，录音和试听可用。");
      changePhase("uploading");
      const body = new FormData();
      body.append("file", file, file.name);
      const response = await accountFetch("/api/upload", {
        method: "POST",
        body,
        signal: controller.signal,
      });
      const uploaded = await response.json().catch(() => null);
      if (!current()) return;
      if (!response.ok || !uploaded?.upload_id)
        throw new Error("音频上传失败，请检查文件后重试。");
      if (typeof uploaded.seconds === "number" && uploaded.seconds < 1)
        throw new Error("这段哼唱太短了，请至少录制 1 秒。");
      if (!current()) return;
      changePhase("submitting");
      // 服务端写词：只传描述（description），任务创建后 worker 先 AI 写词再生成，
      // 生命周期页会展示“AI 写词”阶段。
      const result = await api.submit({
        kind: "hum",
        ...defaultMusicOptions(status),
        loras: [],
        params: {
          title: null,
          style: "",
          lyrics: "",
          description:
            idea.trim() ||
            (musicKind === "instrumental"
              ? "围绕哼唱旋律，创作一段温暖明亮的纯音乐配乐，无人声"
              : "围绕哼唱旋律，创作一首温暖的中文流行歌曲，轻快明亮"),
          music_kind: musicKind,
          upload_id: uploaded.upload_id,
          melody: "continue",
          adapter: status.hum.adapters?.[0] || null,
          hum_influence: 1,
          offset_s: 0,
          seed: null,
        },
      });
      if (!result?.job?.id)
        throw new Error(
          "未收到生成结果，请先到「我的音乐」查看，避免重复生成。",
        );
      if (current()) onCreated(result.job);
    } catch (cause) {
      if (current())
        setError(
          cause instanceof Error ? cause.message : "生成失败了，请重试。",
        );
    } finally {
      if (alive.current && requestId === action.current) changePhase("idle");
      if (pending.current === controller) pending.current = null;
    }
  }

  const phaseText =
    phase === "checking"
      ? "准备中…"
      : phase === "uploading"
        ? "上传中…"
        : phase === "writing"
          ? "AI 正在写歌…"
          : "开始生成…";

  return (
    <div className="hum-composer" data-has-audio={!!file}>
      <div className="music-composer-body">
        <div
          className="hum-recording-area"
          data-recording={phase === "recording" || undefined}
        >
          <button
            type="button"
            className="hum-record-button"
            disabled={phase !== "idle" && phase !== "recording"}
            aria-label={
              phase === "recording"
                ? "结束录音"
                : file
                  ? "重新录音"
                  : "开始录音"
            }
            aria-pressed={phase === "recording"}
            onClick={() =>
              phase === "recording" ? finishRecording() : void startRecording()
            }
          >
            {phase === "recording" ? (
              <Square size={24} fill="currentColor" />
            ) : phase === "permission" ? (
              <LoaderCircle size={28} className="hum-spinner" />
            ) : (
              <Mic size={30} />
            )}
          </button>
          <div className="hum-record-caption">
            {phase === "recording"
              ? `录音中 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
              : phase === "permission"
                ? "请允许麦克风权限"
                : phase === "stopping"
                  ? "保存录音…"
                  : file
                    ? "再哼一段"
                    : "哼唱 10–30 秒"}
          </div>
          <input
            ref={fileInput}
            id={inputId}
            className="hum-file-input"
            type="file"
            accept={ACCEPT}
            disabled={busy}
            onChange={(event) => {
              const selected = event.currentTarget.files?.[0];
              if (selected) selectFile(selected);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            className="hum-upload-button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={16} />
            上传音频
          </button>
          {!recordingSupported && (
            <p className="hum-note">当前浏览器无法录音，可上传音频。</p>
          )}
        </div>
        {file && preview && (
          <div className="hum-preview">
            <div className="hum-file-row">
              <span title={file.name}>{file.name}</span>
              <button
                type="button"
                className="hum-remove"
                aria-label="移除这段音频"
                disabled={busy}
                onClick={() => selectFile(null)}
              >
                <X size={18} />
              </button>
            </div>
            <audio
              controls
              preload="metadata"
              src={preview}
              aria-label="试听哼唱录音"
            />
          </div>
        )}
        <input
          className="hum-idea"
          aria-label="想要的音乐风格"
          placeholder="音乐风格（选填）"
          maxLength={300}
          value={idea}
          disabled={busy}
          onChange={(event) => setIdea(event.currentTarget.value)}
        />
        {!error && available === false && (
          <p className="hum-note">哼唱生成暂未启用，录音和试听可用。</p>
        )}
      </div>
      {error && (
        <p className="hum-error" role="alert">
          {error}
        </p>
      )}
      <div className="hum-composer-footer">
        {busy && phase !== "submitting" && (
          <button type="button" className="hum-cancel" onClick={cancel}>
            取消
          </button>
        )}
        <button
          type="button"
          className="hum-generate"
          disabled={!file || busy}
          onClick={() => void generate()}
        >
          {busy &&
          phase !== "permission" &&
          phase !== "recording" &&
          phase !== "stopping" ? (
            <>
              <LoaderCircle size={18} className="hum-spinner" />
              {phaseText}
            </>
          ) : (
            <>
              <ArrowUp size={18} />
              生成音乐
            </>
          )}
        </button>
      </div>
    </div>
  );
}
