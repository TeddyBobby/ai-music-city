import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  ImagePlus,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import {
  generateFromImage,
  validateImageFile,
  type ImageCreationPhase,
  type ImageMood,
} from "../lib/imageMusic";
import type { MusicKind } from "../lib/musicCreation";
import type { Job } from "../lib/types";
import "./ImageComposer.css";

type Props = {
  musicKind: MusicKind;
  onCreated: (job: Job) => void;
  onBusyChange?: (busy: boolean) => void;
};
export function ImageComposer({ musicKind, onCreated, onBusyChange }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [description, setDescription] = useState("");
  const [analysis, setAnalysis] = useState<ImageMood | null>(null);
  const [phase, setPhase] = useState<ImageCreationPhase | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
      busyCallback.current?.(false);
    };
  }, []);
  useEffect(() => {
    busyCallback.current?.(!!phase);
  }, [phase]);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function selectFile(next: File | null) {
    if (request.current) return;
    try {
      if (next) validateImageFile(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取图片");
      return;
    }
    setFile(next);
    setAnalysis(null);
    setError("");
  }
  async function generate() {
    if (!file || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setError("");
    setAnalysis(null);
    setPhase("analyzing");
    const current = () =>
      alive.current &&
      request.current === controller &&
      !controller.signal.aborted;
    try {
      const job = await generateFromImage(file, description, {
        musicKind,
        signal: controller.signal,
        onPhase: (next) => {
          if (current()) setPhase(next);
        },
        onAnalysis: (next) => {
          if (current()) setAnalysis(next);
        },
      });
      if (current()) onCreated(job);
    } catch (reason) {
      if (current())
        setError(
          reason instanceof Error ? reason.message : "生成失败，请重试。",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (alive.current) setPhase(null);
      }
    }
  }
  return (
    <form
      className="image-composer"
      aria-busy={!!phase}
      onSubmit={(event) => {
        event.preventDefault();
        void generate();
      }}
    >
      <input
        ref={input}
        className="image-file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="选择创作图片"
        disabled={!!phase}
        onChange={(event) => {
          const next = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (next) selectFile(next);
        }}
      />
      <div className="music-composer-body">
        {file && preview ? (
          <div className="image-music-preview">
            <img src={preview} alt="用于生成音乐的图片" />
            <div className="image-music-file-actions">
              <button
                type="button"
                aria-label="更换图片"
                disabled={!!phase}
                onClick={() => input.current?.click()}
              >
                <RefreshCw size={16} />
                更换
              </button>
              <button
                type="button"
                aria-label="移除图片"
                disabled={!!phase}
                onClick={() => selectFile(null)}
              >
                <X size={18} />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="image-music-upload"
            onClick={() => input.current?.click()}
            disabled={!!phase}
          >
            <span className="image-upload-icon">
              <ImagePlus size={30} strokeWidth={1.4} />
            </span>
            <strong>上传一张图片</strong>
            <small>JPG、PNG、WebP · 最大 8 MB</small>
          </button>
        )}
        <input
          className="image-music-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="音乐氛围（选填）"
          aria-label="图片音乐补充描述"
          disabled={!!phase}
          maxLength={1000}
        />
        {analysis && (
          <div className="image-mood-result" role="status">
            <strong>{analysis.mood}</strong>
            <p>{analysis.summary}</p>
          </div>
        )}
      </div>
      {error && (
        <p className="music-inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="image-composer-footer">
        {phase && phase !== "submitting" && (
          <button
            className="image-cancel"
            type="button"
            onClick={() => request.current?.abort()}
          >
            取消
          </button>
        )}
        <button
          className="generate-music-button"
          type="submit"
          disabled={!file || !!phase}
        >
          {phase ? (
            <LoaderCircle size={18} className="music-spinning" />
          ) : (
            <AudioLines size={18} />
          )}
          <span role="status">
            {phase === "analyzing"
              ? "正在读图"
              : phase === "writing"
                ? "正在写歌"
                : phase === "submitting"
                  ? "准备生成"
                  : "生成音乐"}
          </span>
        </button>
      </div>
    </form>
  );
}
