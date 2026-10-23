import { useEffect, useState } from "react";
import { UnstyledButton } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { AlertCircle, Check, Copy } from "lucide-react";
import "./AssistantCopyButton.css";

export type AssistantCopyButtonProps = {
  value: string;
  label?: string;
};

export function AssistantCopyButton({
  value,
  label = "复制",
}: AssistantCopyButtonProps) {
  const clipboard = useClipboard({ timeout: 2000 });
  const [syncError, setSyncError] = useState(false);

  useEffect(() => {
    clipboard.reset();
    setSyncError(false);
  }, [value]);

  if (!value.trim()) return null;

  const failed = syncError || !!clipboard.error;
  const copied = clipboard.copied && !failed;
  const text = failed ? "复制失败，请手动复制" : copied ? "已复制" : label;

  function copy() {
    clipboard.reset();
    setSyncError(false);
    try {
      clipboard.copy(value);
    } catch {
      setSyncError(true);
    }
  }

  return (
    <UnstyledButton
      className="assistant-copy-button"
      type="button"
      onClick={copy}
      aria-label={text}
      title={text}
      data-copied={copied || undefined}
      data-failed={failed || undefined}
    >
      {failed ? (
        <AlertCircle size={14} aria-hidden="true" />
      ) : copied ? (
        <Check size={14} aria-hidden="true" />
      ) : (
        <Copy size={14} aria-hidden="true" />
      )}
      <span className="assistant-copy-feedback" aria-live="polite">
        {copied || failed ? text : ""}
      </span>
    </UnstyledButton>
  );
}
