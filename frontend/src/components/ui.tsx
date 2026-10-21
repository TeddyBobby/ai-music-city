import {
  Children,
  forwardRef,
  isValidElement,
  useEffect,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import {
  Button as MantineButton,
  ActionIcon,
  Badge as MantineBadge,
  Modal,
  Select as MantineSelect,
  MultiSelect,
  TextInput,
  Textarea as MantineTextarea,
  Checkbox as MantineCheckbox,
  Slider,
} from "@mantine/core";
import { Music2 } from "lucide-react";
import { request } from "../lib/api";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }
>(({ variant = "", className = "", ...props }, ref) => (
  <MantineButton
    ref={ref}
    type="button"
    variant={
      variant === "primary"
        ? "filled"
        : variant === "ghost"
          ? "subtle"
          : variant === "danger"
            ? "light"
            : "default"
    }
    color={variant === "danger" ? "red" : undefined}
    className={`btn ${variant} ${className}`}
    {...props}
  />
));
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(({ label, className = "", ...props }, ref) => (
  <ActionIcon
    ref={ref}
    type="button"
    variant="subtle"
    size={30}
    aria-label={label}
    title={label}
    className={`icon-btn ${className}`}
    {...props}
  />
));
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <MantineBadge variant="light" className={`badge ${tone}`} radius="sm">
      {children}
    </MantineBadge>
  );
}

// Adapters keep the existing business forms while using Mantine's actual controls.
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ type = "text", className = "", style, ...props }, ref) => {
  if (type === "checkbox")
    return (
      <MantineCheckbox
        ref={ref}
        className={`ui-checkbox ${className}`}
        style={style}
        {...(props as any)}
      />
    );
  if (type === "range") {
    const { value, defaultValue, min, max, step, onChange, onInput, ...rest } =
      props;
    return (
      <Slider
        className={`ui-range ${className}`}
        style={style}
        min={Number(min ?? 0)}
        max={Number(max ?? 100)}
        step={Number(step ?? 1)}
        value={value == null ? undefined : Number(value)}
        defaultValue={defaultValue == null ? undefined : Number(defaultValue)}
        label={null}
        thumbLabel={props["aria-label"]}
        onChange={(n) =>
          onChange?.({
            target: { value: String(n) },
            currentTarget: { value: String(n) },
          } as any)
        }
        {...(rest as any)}
      />
    );
  }
  return (
    <TextInput
      ref={ref}
      type={type}
      className={`ui-input ${className}`}
      style={style}
      {...(props as any)}
    />
  );
});
export const Checkbox = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }
>(({ type, ...props }, ref) => (
  <MantineCheckbox ref={ref} {...(props as any)} />
));
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className = "", ...props }, ref) => (
  <MantineTextarea
    ref={ref}
    className={`ui-textarea ${className}`}
    {...props}
  />
));
function optionText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(optionText).join("");
  if (isValidElement(node)) return optionText((node.props as any).children);
  return "";
}
function optionsOf(
  children: ReactNode,
): { value: string; label: string; disabled?: boolean }[] {
  const options: { value: string; label: string; disabled?: boolean }[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as any;
    if (child.type === "option")
      options.push({
        value: String(props.value ?? optionText(props.children)),
        label: optionText(props.children),
        disabled: props.disabled,
      });
    else if (props.children) options.push(...optionsOf(props.children));
  });
  return options;
}
export const Select = forwardRef<
  HTMLInputElement,
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
    searchable?: boolean;
  }
>(
  (
    {
      children,
      value,
      defaultValue,
      onChange,
      multiple,
      className = "",
      searchable,
      ...props
    },
    ref,
  ) => {
    const data = optionsOf(children);
    const change = (values: string | string[] | null) => {
      const selected = Array.isArray(values)
        ? values
        : values == null
          ? []
          : [values];
      const target = {
        value: selected[0] ?? "",
        selectedOptions: selected.map((value) => ({ value })),
      };
      onChange?.({ target, currentTarget: target } as any);
    };
    const common = {
      ...(props as any),
      ref,
      data,
      className: `ui-select ${className}`,
      onChange: change,
      searchable: searchable ?? data.length > 8,
      nothingFoundMessage: "没有匹配的选项",
      maxDropdownHeight: 240,
      comboboxProps: {
        withinPortal: true,
        zIndex: 650,
        transitionProps: { transition: "pop", duration: 140 },
      },
      checkIconPosition: "right" as const,
    };
    return multiple ? (
      <MultiSelect
        {...common}
        value={
          value == null
            ? undefined
            : Array.isArray(value)
              ? value.map(String)
              : [String(value)]
        }
        defaultValue={
          defaultValue == null
            ? undefined
            : Array.isArray(defaultValue)
              ? defaultValue.map(String)
              : [String(defaultValue)]
        }
      />
    ) : (
      <MantineSelect
        {...common}
        allowDeselect={false}
        value={value == null ? null : String(value)}
        defaultValue={defaultValue == null ? undefined : String(defaultValue)}
      />
    );
  },
);
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Music2 size={22} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
const covers = new Map<string, string>();
export function Artwork({
  job,
  size,
  className = "",
}: {
  job?: any;
  size?: number;
  className?: string;
}) {
  const [src, setSrc] = useState<string>(covers.get(job?.id) || "");
  useEffect(() => {
    let live = true;
    setSrc(covers.get(job?.id) || "");
    const load = () => {
      if (!job?.id) {
        setSrc("");
        return;
      }
      request("GET", `/api/assistant/covers/applied/${job.id}`)
        .then((d) => {
          covers.set(job.id, d.cover_url || "");
          if (live) setSrc(d.cover_url || "");
        })
        .catch(() => {});
    };
    load();
    const listener = (e: any) => {
      if (
        !e.detail?.jobId ||
        e.detail.jobId === job?.id ||
        e.detail.job_id === job?.id
      )
        load();
    };
    window.addEventListener("yue2:cover-updated", listener);
    return () => {
      live = false;
      window.removeEventListener("yue2:cover-updated", listener);
    };
  }, [job?.id]);
  return (
    <div
      className={`artwork ${className}`}
      style={size ? { width: size, height: size } : undefined}
    >
      {src ? (
        <img src={src} alt={`${job?.title || "作品"}封面`} />
      ) : (
        <div className="artwork-default">
          <svg viewBox="0 0 240 240" aria-hidden="true">
            <circle cx="120" cy="125" r="88" />
            <circle cx="120" cy="125" r="66" />
            <circle cx="120" cy="125" r="44" />
            <circle cx="120" cy="125" r="22" />
            <circle cx="154" cy="48" r="24" className="artwork-sun" />
            <path d="M33 184c34-18 63-16 89 0s51 21 84 3" />
          </svg>
          <span>
            AI MUSIC CITY
            <br />
            ORIGINAL SOUND
          </span>
        </div>
      )}
    </div>
  );
}
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      opened
      onClose={onClose}
      title={title}
      centered
      size={600}
      zIndex={500}
      closeButtonProps={{ "aria-label": "关闭" }}
      overlayProps={{ backgroundOpacity: 0.5, blur: 5 }}
      transitionProps={{ transition: "pop", duration: 180 }}
      classNames={{
        content: "ui-dialog",
        header: "ui-dialog-head",
        body: "ui-dialog-body",
        title: "ui-dialog-title",
      }}
    >
      {children}
    </Modal>
  );
}
