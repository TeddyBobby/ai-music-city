import type { RefObject } from "react";
import { UnstyledButton } from "@mantine/core";
import { MUSIC_PROMPT_LABELS, insertMusicPromptLabel } from "../lib/musicPrompt";
import "./MusicPromptShortcuts.css";

export function MusicPromptShortcuts({
  value,
  onChange,
  inputRef,
  disabled = false,
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  maxLength?: number;
}) {
  return (
    <div className="music-prompt-shortcuts" role="group" aria-label="快捷输入">
      {MUSIC_PROMPT_LABELS.map((label) => {
        const next = insertMusicPromptLabel(value, label, maxLength);
        const noRoom = next.value === value && insertMusicPromptLabel(value, label).value !== value;
        return (
          <UnstyledButton
            key={label}
            type="button"
            className="music-prompt-shortcut"
            disabled={disabled || noRoom}
            onClick={() => {
              if (disabled || noRoom) return;
              onChange(next.value);
              // Focus during the tap so mobile browsers can open the keyboard.
              inputRef.current?.focus({ preventScroll: true });
              requestAnimationFrame(() => {
                inputRef.current?.setSelectionRange(next.cursor, next.cursor);
              });
            }}
          >
            {label}
          </UnstyledButton>
        );
      })}
    </div>
  );
}
