import { Checkbox } from "./ui";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { duration, errorMessage } from "../lib/utils";
import { useApp } from "../state/app";
import { Button, Dialog } from "./ui";

export function UploadsPanel() {
  const [uploads, setUploads] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useApp((s) => s.toast);
  const load = () => api.listUploads().then((d) => setUploads(d.uploads || []));
  useEffect(() => {
    load().catch(() => {});
  }, []);
  if (!uploads.length) return null;
  const unused = uploads.filter((u) => u.jobs.total === 0).length;
  async function remove() {
    setBusy(true);
    try {
      if (action === "prune") {
        const result = await api.pruneUploads();
        toast(`已清理 ${result.deleted} 个未使用素材。`, "ok");
      } else {
        const results = await Promise.allSettled(
          selected.map((id) => api.deleteUpload(id)),
        );
        const removed = results.filter((r) => r.status === "fulfilled").length;
        toast(
          `已删除 ${removed} 个素材${removed < selected.length ? "，部分素材被任务使用，未删除" : ""}。`,
          removed === selected.length ? "ok" : "err",
        );
      }
      setSelected([]);
      setAction("");
      await load();
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="library-history">
      <summary>上传的音频素材 · {uploads.length}</summary>
      <p className="muted small">
        删除源素材不会影响已完成作品；生成中任务使用的素材不能删除。
      </p>
      <div className="row" style={{ margin: "12px 0" }}>
        <Button
          disabled={!selected.length || busy}
          onClick={() => setAction("selected")}
        >
          <Trash2 size={13} />
          删除所选 {selected.length || ""}
        </Button>
        <Button
          variant="ghost"
          disabled={!unused || busy}
          onClick={() => setAction("prune")}
        >
          清理未使用素材 · {unused}
        </Button>
      </div>
      {uploads.map((u) => (
        <div
          key={u.upload_id}
          className="row between"
          style={{ padding: "9px 0" }}
        >
          <Checkbox
            label={u.filename}
            disabled={u.jobs.active > 0 || busy}
            checked={selected.includes(u.upload_id)}
            onChange={(e) =>
              setSelected((s) =>
                e.target.checked
                  ? [...s, u.upload_id]
                  : s.filter((id) => id !== u.upload_id),
              )
            }
          />
          <span className="muted small">
            {duration(u.seconds)} ·{" "}
            {u.jobs.active ? "生成任务使用中" : `${u.jobs.total} 个任务引用`}
          </span>
        </div>
      ))}
      {action && (
        <Dialog
          title="删除音频素材"
          onClose={() => {
            if (!busy) setAction("");
          }}
        >
          <p>
            删除 {action === "prune" ? unused : selected.length}{" "}
            个素材？已完成作品会保留，此操作不可撤销。
          </p>
          <div className="dialog-actions">
            <Button disabled={busy} onClick={() => setAction("")}>
              保留
            </Button>
            <Button variant="danger" disabled={busy} onClick={remove}>
              {busy ? "正在删除…" : "确认删除"}
            </Button>
          </div>
        </Dialog>
      )}
    </details>
  );
}
