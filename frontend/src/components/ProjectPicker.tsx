import { Input, Select } from "./ui";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../state/app";
import { Button } from "./ui";
import { errorMessage } from "../lib/utils";
export function ProjectPicker({
  onPick,
  initialTrack,
}: {
  onPick: (target: any) => void;
  initialTrack?: string;
}) {
  const [projects, setProjects] = useState<any[]>([]),
    [project, setProject] = useState(""),
    [tracks, setTracks] = useState<any[]>([]),
    [track, setTrack] = useState(""),
    [creating, setCreating] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false);
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    let live = true;
    api
      .projects()
      .then((d) => {
        if (live) setProjects(d.projects);
      })
      .catch((e) => toast(errorMessage(e), "err"));
    if (initialTrack)
      api
        .track(initialTrack)
        .then((d) => {
          if (live) {
            setProject(d.track.project_id);
            setTrack(d.track.id);
          }
        })
        .catch((e) => toast(errorMessage(e), "err"));
    return () => {
      live = false;
    };
  }, [initialTrack]);
  useEffect(() => {
    let live = true;
    if (project)
      api
        .project(project)
        .then((d) => {
          if (live) setTracks(d.project.tracks);
        })
        .catch((e) => toast(errorMessage(e), "err"));
    else setTracks([]);
    return () => {
      live = false;
    };
  }, [project]);
  useEffect(() => {
    const t = tracks.find((t) => t.id === track),
      p = projects.find((p) => p.id === project);
    onPick(t ? { ...t, project_id: project, project_name: p?.name } : null);
  }, [track, tracks, project, projects]);
  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (creating === "project") {
        const d = await api.createProject({ name: name.trim() });
        setProjects((ps) => [d.project, ...ps]);
        setProject(d.project.id);
        setTrack("");
        setCreating("track");
      } else {
        const d = await api.addTrack(project, name.trim());
        setTracks((ts) => [...ts, d.track]);
        setTrack(d.track.id);
        setCreating("");
      }
      setName("");
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="grid2">
        <label className="field">
          项目
          <Select
            aria-label="选择项目"
            value={project}
            onChange={(e) => {
              if (e.target.value === "+") setCreating("project");
              else {
                setProject(e.target.value);
                setTrack("");
                setCreating("");
              }
            }}
          >
            <option value="">选择项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="+">＋ 新建项目</option>
          </Select>
        </label>
        <label className="field">
          曲目
          <Select
            aria-label="选择曲目"
            disabled={!project}
            value={track}
            onChange={(e) => {
              if (e.target.value === "+") setCreating("track");
              else {
                setTrack(e.target.value);
                setCreating("");
              }
            }}
          >
            <option value="">选择曲目</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value="+">＋ 新建曲目</option>
          </Select>
        </label>
      </div>
      {creating && (
        <div className="row">
          <Input
            aria-label={creating === "project" ? "新项目名称" : "新曲目名称"}
            placeholder={creating === "project" ? "项目名称" : "曲目名称"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
          <Button disabled={busy || !name.trim()} onClick={create}>
            创建
          </Button>
          <Button variant="ghost" onClick={() => setCreating("")}>
            取消
          </Button>
        </div>
      )}
    </div>
  );
}
