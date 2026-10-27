import {
  ActionIcon,
  NumberInput,
  Select,
  Textarea,
  TextInput,
} from "@mantine/core";
import { ChevronDown, RotateCcw } from "lucide-react";
import type { SunoOptions } from "../lib/suno";

type Props = {
  value: SunoOptions;
  onChange: (patch: Partial<SunoOptions>) => void;
  enabled: boolean;
  disabled: boolean;
  vocal: boolean;
  hasAudio: boolean;
};

export function SunoAdvancedSettings({
  value,
  onChange,
  enabled,
  disabled,
  vocal,
  hasAudio,
}: Props) {
  const locked = disabled || !enabled;
  const percentage = (
    key: "styleWeight" | "weirdnessConstraint" | "audioWeight",
    label: string,
  ) => (
    <NumberInput
      label={label}
      value={value[key] === undefined ? "" : Math.round(value[key] * 100)}
      placeholder="自动"
      suffix="%"
      min={0}
      max={100}
      allowDecimal={false}
      allowNegative={false}
      clampBehavior="strict"
      disabled={locked}
      onChange={(next) =>
        onChange({ [key]: typeof next === "number" ? next / 100 : undefined })
      }
      rightSection={
        value[key] !== undefined ? (
          <ActionIcon
            variant="subtle"
            size="sm"
            type="button"
            disabled={locked}
            aria-label={`${label}恢复自动`}
            title="恢复自动"
            onClick={() => onChange({ [key]: undefined })}
          >
            <RotateCcw size={13} />
          </ActionIcon>
        ) : null
      }
    />
  );

  return (
    <details className="generation-advanced">
      <summary>
        高级设置
        <ChevronDown size={15} />
      </summary>
      {!enabled && (
        <p className="generation-advanced-note">
          当前生成引擎未启用 Suno
          {Object.values(value).some((item) => item !== undefined) && (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange(
                  Object.fromEntries(
                    Object.keys(value).map((key) => [key, undefined]),
                  ),
                )
              }
            >
              清除 Suno 设置
            </button>
          )}
        </p>
      )}
      <div className="generation-advanced-grid">
        <Select
          label="Suno 模型"
          value={value.model || "V6"}
          data={[
            { value: "V6", label: "V6" },
            { value: "V6_WILD", label: "V6 Wild" },
            { value: "V6_MINI", label: "V6 Mini" },
          ]}
          allowDeselect={false}
          disabled={locked}
          onChange={(next) => onChange({ model: next as SunoOptions["model"] })}
        />
        <NumberInput
          label="时长"
          value={value.duration ?? ""}
          placeholder="自动"
          suffix=" 秒"
          min={10}
          max={360}
          allowDecimal={false}
          allowNegative={false}
          disabled={locked}
          onChange={(next) =>
            onChange({ duration: typeof next === "number" ? next : undefined })
          }
        />
        <Textarea
          className="generation-advanced-wide"
          label="避免的风格"
          value={value.negativeTags || ""}
          maxLength={1000}
          rows={2}
          disabled={locked}
          onChange={(event) =>
            onChange({ negativeTags: event.currentTarget.value || undefined })
          }
        />
        {vocal && (
          <Select
            label="人声"
            value={value.vocalGender || "auto"}
            data={[
              { value: "auto", label: "自动" },
              { value: "m", label: "男声" },
              { value: "f", label: "女声" },
            ]}
            allowDeselect={false}
            disabled={locked}
            onChange={(next) =>
              onChange({
                vocalGender: next === "m" || next === "f" ? next : undefined,
              })
            }
          />
        )}
        <Select
          label="变化幅度"
          value={value.variety === undefined ? "auto" : String(value.variety)}
          data={[
            { value: "auto", label: "自动" },
            { value: "0", label: "关闭" },
            { value: "1", label: "普通" },
            { value: "2", label: "高" },
            { value: "3", label: "更高" },
            { value: "4", label: "最大" },
          ]}
          allowDeselect={false}
          disabled={locked}
          onChange={(next) =>
            onChange({
              variety: next && next !== "auto" ? Number(next) : undefined,
            })
          }
        />
        {percentage("styleWeight", "风格遵循")}
        {percentage("weirdnessConstraint", "创意强度")}
        {(hasAudio || vocal) && percentage("audioWeight", "音频影响")}
        <TextInput
          className="generation-advanced-wide"
          label="Persona ID"
          value={value.personaId || ""}
          disabled={locked}
          onChange={(event) =>
            onChange({ personaId: event.currentTarget.value || undefined })
          }
        />
        {value.personaId?.trim() && (
          <Select
            className="generation-advanced-wide"
            label="Persona 类型"
            value={value.personaModel || "style_persona"}
            data={[
              { value: "style_persona", label: "风格 Persona" },
              { value: "voice_persona", label: "声音 Persona" },
            ]}
            allowDeselect={false}
            disabled={locked}
            onChange={(next) =>
              onChange({ personaModel: next as SunoOptions["personaModel"] })
            }
          />
        )}
      </div>
    </details>
  );
}
