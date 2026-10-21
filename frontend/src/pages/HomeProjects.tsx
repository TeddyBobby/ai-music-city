import { useEffect, useState } from "react";
import { Paper, Skeleton, UnstyledButton } from "@mantine/core";
import { ArrowRight, ArrowUpRight, FolderOpen, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { errorMessage, when } from "../lib/utils";
import "./HomeProjects.css";

interface RecentProject {
  id: string;
  name: string;
  updated_at: string;
  track_count: number;
  chosen_count: number;
}

export function HomeProjects() {
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api
      .projects()
      .then((result) => {
        if (!Array.isArray(result?.projects))
          throw new Error("项目列表暂时无法读取，请重试。");
        if (live)
          setProjects(
            result.projects
              .slice()
              .sort((a: RecentProject, b: RecentProject) =>
                (b.updated_at || "").localeCompare(a.updated_at || ""),
              )
              .slice(0, 3),
          );
      })
      .catch((cause) => {
        if (live) setError(errorMessage(cause));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [revision]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("yue2:jobs-updated", refresh);
    return () => window.removeEventListener("yue2:jobs-updated", refresh);
  }, []);

  return (
    <section className="home-projects" aria-labelledby="home-projects-title">
      <div className="home-projects-heading">
        <h2 id="home-projects-title">最近项目</h2>
        <Link to="/projects" className="home-projects-all">
          全部项目 <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>
      {error && (
        <Paper className="home-projects-error" role="alert">
          <span>{error}</span>
          <UnstyledButton
            className="home-projects-retry"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={13} aria-hidden="true" />
            重新加载
          </UnstyledButton>
        </Paper>
      )}
      {loading && !projects.length ? (
        <div
          className="home-projects-grid"
          role="status"
          aria-label="正在读取最近项目"
        >
          {[0, 1, 2].map((index) => (
            <Paper
              className="home-project-card home-project-skeleton"
              key={index}
            >
              <Skeleton width={38} height={38} radius={10} />
              <div className="home-project-copy">
                <Skeleton width="65%" height={13} radius={4} />
                <Skeleton width="88%" height={10} radius={4} />
              </div>
            </Paper>
          ))}
        </div>
      ) : projects.length ? (
        <div className="home-projects-grid" aria-busy={loading}>
          {projects.map((project) => (
            <Paper
              key={project.id}
              component={Link}
              to={`/project/${project.id}`}
              className="home-project-card"
            >
              <span className="home-project-icon" aria-hidden="true">
                <FolderOpen size={19} strokeWidth={1.6} />
              </span>
              <div className="home-project-copy">
                <strong title={project.name}>{project.name}</strong>
                <span>
                  {project.track_count || 0} 首曲目
                  <i aria-hidden="true">·</i>
                  {project.chosen_count || 0} 首已选
                </span>
                {project.updated_at && (
                  <small>更新于 {when(project.updated_at)}</small>
                )}
              </div>
              <ArrowUpRight
                className="home-project-arrow"
                size={15}
                aria-hidden="true"
              />
            </Paper>
          ))}
        </div>
      ) : !error ? (
        <UnstyledButton
          component={Link}
          to="/projects"
          className="home-projects-empty"
        >
          <span className="home-project-icon" aria-hidden="true">
            <FolderOpen size={19} strokeWidth={1.6} />
          </span>
          <span>
            <strong>把作品收进一个项目</strong>
            <small>整理曲目，挑选喜欢的版本。</small>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
        </UnstyledButton>
      ) : null}
    </section>
  );
}
