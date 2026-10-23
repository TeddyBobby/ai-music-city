import { useId } from "react";
import { AudioLines, Mic2 } from "lucide-react";
import type { MusicKind } from "../lib/musicCreation";
import "./MusicKindToggle.css";

export type { MusicKind } from "../lib/musicCreation";

export function MusicKindToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: MusicKind;
  onChange: (value: MusicKind) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <div className="music-kind-toggle" role="radiogroup" aria-label="音乐类型">
      {[
        { value: "instrumental" as const, label: "纯音乐", icon: AudioLines },
        { value: "vocal" as const, label: "带歌词", icon: Mic2 },
      ].map(({ value: option, label, icon: Icon }) => (
        <label className="music-kind-option" key={option}>
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            disabled={disabled}
            onChange={() => onChange(option)}
          />
          <span>
            <Icon size={15} aria-hidden="true" />
            {label}
          </span>
        </label>
      ))}
    </div>
  );
}
