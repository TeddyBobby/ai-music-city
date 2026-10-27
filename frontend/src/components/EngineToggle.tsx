import { useEffect, useState } from "react";
import { Cloud, LoaderCircle, Server } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/app";
import { useAuth } from "../state/auth";

type EngineInfo = {
  key: string;
  label: string;
  description: string;
  kind: "local" | "cloud";
};

/** 本地/云端生成引擎切换：管理员可切换，所有人可见当前引擎。 */
export function EngineToggle({ disabled }: { disabled?: boolean }) {
  const toast = useApp((s) => s.toast);
  const isAdmin = useAuth((s) => !!s.user?.is_admin);
  const [active, setActive] = useState<string>("");
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    api
      .engines()
      .then((info) => {
        if (!live) return;
        setActive(info.active || "local");
        setEngines(info.engines || []);
      })
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  async function choose(key: string) {
    if (loading || disabled || key === active) return;
    setLoading(true);
    try {
      const info = await api.switchEngine(key);
      setActive(info.active || key);
      const label =
        (info.engines || []).find((e: EngineInfo) => e.key === key)?.label ||
        key;
      toast(`已切换到${label}`, "ok");
    } catch (e: any) {
      toast(e?.message || "切换失败，请重试。", "error");
    } finally {
      setLoading(false);
    }
  }

  if (loading && !engines.length) return null;
  if (!engines.length) return null;

  const current = engines.find((engine) => engine.key === active);
  if (!isAdmin) {
    if (!current) return null;
    return (
      <span
        className="engine-current"
        aria-label={`生成引擎：${current.label}`}
      >
        {current.kind === "cloud" ? (
          <Cloud size={14} aria-hidden="true" />
        ) : (
          <Server size={14} aria-hidden="true" />
        )}
        <span>{current.label}</span>
      </span>
    );
  }

  return (
    <div className="engine-toggle" role="radiogroup" aria-label="生成引擎">
      {engines.map((e) => (
        <button
          key={e.key}
          type="button"
          role="radio"
          aria-checked={e.key === active}
          className={`engine-choice${e.key === active ? " is-active" : ""}`}
          onClick={() => void choose(e.key)}
          disabled={disabled || !isAdmin || loading}
          title={isAdmin ? e.description : `${e.description}（仅管理员可切换）`}
        >
          {e.kind === "cloud" ? <Cloud size={14} /> : <Server size={14} />}
          <span>{e.label}</span>
          {e.key === active && loading && (
            <LoaderCircle size={12} className="spin" />
          )}
        </button>
      ))}
    </div>
  );
}
