import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { validateImageFile } from "../lib/imageMusic";
import "./AssistantImageInput.css";

export type AssistantImageInputProps = {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  compact?: boolean;
};

/** Collect a picture locally; the composer sends it together with the user's words. */
export function AssistantImageInput({
  file,
  onChange,
  disabled = false,
  compact = false,
}: AssistantImageInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

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
    if (disabled) return;
    try {
      if (next) validateImageFile(next);
      setError("");
      onChange(next);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "无法读取图片，请重新选择。",
      );
    }
  }

  return (
    <div
      className={`assistant-image-input${compact ? " is-compact" : ""}`}
      data-has-file={!!file}
    >
      {file && preview && (
        <div className="assistant-image-preview">
          <img
            src={preview}
            alt="待发送的图片"
            onError={() =>
              setError("无法预览这张图片，请重新选择 JPG、PNG 或 WebP 图片。")
            }
          />
          <span title={file.name}>{file.name}</span>
          <button
            className="assistant-image-remove"
            type="button"
            aria-label="移除图片"
            title="移除图片"
            disabled={disabled}
            onClick={() => selectFile(null)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <button
        className="assistant-image-pick"
        type="button"
        aria-label={file ? "更换图片" : "上传图片"}
        title={file ? "更换图片" : "上传图片"}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <ImagePlus size={17} aria-hidden="true" />
        <span>{file ? "更换图片" : "上传图片"}</span>
      </button>
      <input
        ref={input}
        className="assistant-image-file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="选择助手图片"
        disabled={disabled}
        onChange={(event) => {
          const next = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (next) selectFile(next);
        }}
      />
      {error && (
        <p className="assistant-image-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
