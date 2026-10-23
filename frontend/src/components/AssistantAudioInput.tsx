import { useEffect, useId, useRef, useState } from "react";
import {
  AudioLines,
  LoaderCircle,
  Mic,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import "./AssistantAudioInput.css";

type RecordingPhase = "idle" | "permission" | "recording" | "stopping";

export type AssistantAudioInputProps = {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  compact?: boolean;
  onRecordingChange?: (recording: boolean) => void;
};

const ACCEPT = ".mp3,.wav,.flac,.m4a,.ogg,.webm,.mp4";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_RECORD_SECONDS = 120;

/** Collect an audio attachment. Sending it with the description belongs to the composer. */
export function AssistantAudioInput({
  file,
  onChange,
  disabled = false,
  compact = false,
  onRecordingChange,
}: AssistantAudioInputProps) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const session = useRef(0);
  const phaseRef = useRef<RecordingPhase>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callbacks = useRef({ onChange, onRecordingChange });
  callbacks.current = { onChange, onRecordingChange };
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const active = phase !== "idle";

  function changePhase(next: RecordingPhase) {
    phaseRef.current = next;
    if (!mounted.current) return;
    setPhase(next);
    callbacks.current.onRecordingChange?.(next !== "idle");
  }

  function releaseMicrophone() {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  function discardRecorder() {
    session.current += 1;
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    releaseMicrophone();
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      discardRecorder();
      callbacks.current.onRecordingChange?.(false);
    };
  }, []);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function selectFile(next: File | null) {
    if (
      next &&
      (!/\.(mp3|wav|flac|m4a|ogg|webm|mp4)$/i.test(next.name) ||
        next.size === 0)
    ) {
      setError("请选择可播放的音频文件。支持 MP3、WAV、M4A 等格式。");
      return;
    }
    if (next && next.size > MAX_BYTES) {
      setError("音频太大了，请选择不超过 20 MB 的文件。");
      return;
    }
    setError("");
    callbacks.current.onChange(next);
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (phaseRef.current !== "recording" || recorder?.state !== "recording")
      return;
    changePhase("stopping");
    recorder.stop();
  }

  function cancelRecording() {
    discardRecorder();
    changePhase("idle");
    setError("");
  }

  async function startRecording() {
    if (disabled || phaseRef.current !== "idle") return;
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setError("当前浏览器无法录音，请使用上传音频，或在 HTTPS 页面重试。");
      return;
    }
    setError("");
    changePhase("permission");
    const id = ++session.current;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (!mounted.current || session.current !== id) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (!mounted.current || session.current !== id) return;
        discardRecorder();
        setError("录音中断了，请重试或上传音频。");
        changePhase("idle");
      };
      recorder.onstop = () => {
        if (!mounted.current || session.current !== id) return;
        releaseMicrophone();
        const type = recorder.mimeType || mimeType || "audio/webm";
        const extension = type.includes("mp4")
          ? "m4a"
          : type.includes("ogg")
            ? "ogg"
            : "webm";
        const blob = new Blob(chunks, { type });
        if (blob.size) {
          selectFile(new File([blob], `我的录音.${extension}`, { type }));
        } else {
          setError("没有录到声音，请再试一次。");
        }
        changePhase("idle");
      };
      recorder.start(250);
      setSeconds(0);
      changePhase("recording");
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        if (!mounted.current || session.current !== id) return;
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(Math.min(elapsed, MAX_RECORD_SECONDS));
        if (elapsed >= MAX_RECORD_SECONDS) stopRecording();
      }, 250);
    } catch (cause) {
      // A superseded permission request must not release a newer microphone.
      if (!mounted.current || session.current !== id) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }
      if (streamRef.current !== stream)
        stream?.getTracks().forEach((track) => track.stop());
      releaseMicrophone();
      const name = cause instanceof Error ? cause.name : "";
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "请在浏览器中允许麦克风权限，或上传一段音频。"
          : name === "NotFoundError"
            ? "没有找到麦克风，请上传一段音频。"
            : "麦克风暂不可用，请重试或上传音频。",
      );
      changePhase("idle");
    }
  }

  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div
      className={`assistant-audio-input${compact ? " is-compact" : ""}`}
      data-has-file={!!file || undefined}
      data-recording={active || undefined}
    >
      {file && preview && (
        <div className="assistant-audio-preview">
          <div className="assistant-audio-file">
            <AudioLines size={18} aria-hidden="true" />
            <span title={file.name}>{file.name}</span>
            <button
              className="assistant-audio-remove"
              type="button"
              aria-label="移除音频"
              disabled={disabled || active}
              onClick={() => selectFile(null)}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          <audio
            key={preview}
            src={preview}
            controls
            preload="metadata"
            aria-label="录音试听"
          />
        </div>
      )}
      <div className="assistant-audio-toolbar">
        <button
          className="assistant-audio-record"
          type="button"
          aria-label={phase === "recording" ? "结束录音" : "开始录音"}
          title={phase === "recording" ? "结束录音" : "开始录音"}
          aria-pressed={phase === "recording"}
          disabled={
            phase === "permission" ||
            phase === "stopping" ||
            (disabled && !active)
          }
          onClick={phase === "recording" ? stopRecording : startRecording}
        >
          {phase === "permission" || phase === "stopping" ? (
            <LoaderCircle
              size={17}
              className="assistant-audio-spinner"
              aria-hidden="true"
            />
          ) : phase === "recording" ? (
            <Square size={14} fill="currentColor" aria-hidden="true" />
          ) : (
            <Mic size={17} aria-hidden="true" />
          )}
          <span>{phase === "recording" ? "完成录音" : "录音"}</span>
        </button>
        {!active && (
          <button
            className="assistant-audio-upload"
            type="button"
            aria-label="上传音频"
            title="上传音频"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            <Paperclip size={17} aria-hidden="true" />
            <span>上传音频</span>
          </button>
        )}
        <input
          id={inputId}
          ref={input}
          className="assistant-audio-file-input"
          type="file"
          accept={ACCEPT}
          aria-label="选择音频文件"
          disabled={disabled || active}
          onChange={(event) => {
            const next = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (next) selectFile(next);
          }}
        />
        {active && (
          <>
            <span className="assistant-audio-status" role="status">
              {phase === "permission"
                ? "等待麦克风权限"
                : phase === "stopping"
                  ? "正在保存…"
                  : `${time} / 2:00`}
            </span>
            <button
              className="assistant-audio-cancel"
              type="button"
              onClick={cancelRecording}
            >
              取消
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="assistant-audio-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
