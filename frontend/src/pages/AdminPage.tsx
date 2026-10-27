import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Drawer,
  Loader,
  Pagination,
  Select,
  Table,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Download,
  Music2,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  WandSparkles,
} from "lucide-react";
import { useAuth } from "../state/auth";
import { usePlayer } from "../state/player";
import {
  ADMIN_PAGE_SIZE,
  adminApi,
  adminDate,
  adminDuration,
  adminStatusLabels,
  type AdminJob,
  type AdminJobStatus,
  type AdminUser,
} from "../lib/admin";
import "./AdminPage.css";

type Resource<T> = {
  key: string;
  data: T | null;
  error: string;
  loading: boolean;
};
function useAdminResource<T>(key: string, load: () => Promise<T>) {
  const [resource, setResource] = useState<Resource<T>>({
    key,
    data: null,
    error: "",
    loading: true,
  });
  useEffect(() => {
    let live = true;
    setResource({ key, data: null, error: "", loading: true });
    load()
      .then((data) => {
        if (live) setResource({ key, data, error: "", loading: false });
      })
      .catch((error) => {
        if (live)
          setResource({
            key,
            data: null,
            error:
              error instanceof Error ? error.message : "暂时无法读取，请重试。",
            loading: false,
          });
      });
    return () => {
      live = false;
    };
  }, [key]);
  // Hide the previous user's or filter's result on the very first new render,
  // before the effect cleanup runs and before the new request completes.
  return resource.key === key
    ? resource
    : { key, data: null, error: "", loading: true };
}

function Feedback({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading?: boolean;
  error?: string;
  empty?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className={`admin-feedback ${error ? "has-error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {loading ? (
        <>
          <Loader size={23} />
          <span>正在读取…</span>
        </>
      ) : error ? (
        <>
          <span>{error}</span>
          <Button variant="light" size="xs" onClick={onRetry}>
            重新加载
          </Button>
        </>
      ) : (
        <>
          <Music2 size={24} strokeWidth={1.4} />
          <span>{empty}</span>
        </>
      )}
    </div>
  );
}
function StatusBadge({ status }: { status: AdminJobStatus }) {
  return (
    <Badge variant="light" className={`admin-status status-${status}`}>
      {adminStatusLabels[status] || status}
    </Badge>
  );
}
function AccountIdentity({
  user,
  fullId = false,
}: {
  user: AdminUser;
  fullId?: boolean;
}) {
  return (
    <div className="admin-account-identity">
      <Avatar radius="xl" size={38} className="admin-avatar">
        {user.email.charAt(0).toUpperCase()}
      </Avatar>
      <div>
        <strong>{user.email}</strong>
        <span title={user.id}>
          {fullId || user.id.length <= 12
            ? user.id
            : `${user.id.slice(0, 12)}…`}
        </span>
      </div>
    </div>
  );
}
function RoleBadge({ user }: { user: AdminUser }) {
  return (
    <Badge
      variant="light"
      className={user.is_admin ? "admin-role is-admin" : "admin-role"}
    >
      {user.is_admin ? "管理员" : "用户"}
    </Badge>
  );
}
function Pager({
  total,
  page,
  onChange,
  label,
}: {
  total: number;
  page: number;
  onChange: (page: number) => void;
  label: string;
}) {
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  useEffect(() => {
    if (page > pages) onChange(pages);
  }, [pages, page, onChange]);
  return (
    <div className="admin-pagination">
      <span>
        共 {total.toLocaleString("zh-CN")} {label}
      </span>
      {pages > 1 && (
        <Pagination
          total={pages}
          value={page}
          onChange={onChange}
          size="sm"
          siblings={0}
          boundaries={1}
          getControlProps={(control) => ({
            "aria-label":
              control === "next"
                ? "下一页"
                : control === "previous"
                  ? "上一页"
                  : control === "first"
                    ? "第一页"
                    : "最后一页",
          })}
        />
      )}
    </div>
  );
}
const printable = (value: unknown): string =>
  value === null || value === undefined || value === ""
    ? "—"
    : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);
const sourceLabel = (kind: string) =>
  ({
    hum: "哼唱",
    create: "创作",
    regenerate: "重新生成",
    cover: "音频改编",
    image: "图片",
    text: "文字",
    generate: "文字",
    continue: "续写",
  })[kind] ||
  kind ||
  "文字";

function JobDetail({ job }: { job: AdminJob }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [audioError, setAudioError] = useState(false);
  useEffect(() => {
    const element = audio.current;
    return () => {
      element?.pause();
      element?.removeAttribute("src");
      element?.load();
    };
  }, [job.id, job.audio_url]);
  const fields: Array<[string, unknown]> = [
    ["任务 ID", job.id],
    ["任务类型", sourceLabel(job.kind)],
    ["创建时间", adminDate(job.created_at)],
    ["开始时间", adminDate(job.started_at)],
    ["完成时间", adminDate(job.finished_at)],
    ["时长", adminDuration(job.timing?.audio_seconds)],
    [
      "生成预设",
      (
        { fast: "快速", quality: "高质量", custom: "自定义" } as Record<
          string,
          string
        >
      )[job.preset || ""] || job.preset,
    ],
    ["推理精度", job.precision],
    ["生成步数", job.ode_steps],
    ["随机种子", job.seed],
  ];
  return (
    <div className="admin-job-detail">
      {(job.audio_url || job.download_url) && (
        <div className="admin-audio">
          {job.audio_url && (
            <audio
              ref={audio}
              controls
              preload="none"
              src={job.audio_url}
              aria-label={`试听 ${job.title || "未命名音乐"}`}
              onError={() => setAudioError(true)}
              onPlay={() => usePlayer.getState().pause()}
            />
          )}
          {job.download_url && (
            <Button
              component="a"
              href={job.download_url}
              download
              variant="light"
              size="sm"
              leftSection={<Download size={15} />}
            >
              下载音频
            </Button>
          )}
          {audioError && (
            <span className="admin-audio-error" role="alert">
              音频暂时无法播放，可尝试下载。
            </span>
          )}
        </div>
      )}
      <dl className="admin-job-fields">
        {fields.map(([name, value]) => (
          <div key={String(name)}>
            <dt>{name}</dt>
            <dd>{printable(value)}</dd>
          </div>
        ))}
      </dl>
      {job.error && (
        <div className="admin-job-error">
          <strong>失败原因</strong>
          <pre>{job.error}</pre>
        </div>
      )}
      <div className="admin-creative-details">
        <section>
          <h4>音乐描述</h4>
          <p>{printable(job.params?.style || job.params?.description)}</p>
        </section>
        <section>
          <h4>歌词</h4>
          <pre>
            {typeof job.params?.lyrics === "string" && job.params.lyrics.trim()
              ? job.params.lyrics
              : job.music_kind === "instrumental"
                ? "纯音乐，无歌词"
                : "未提供歌词"}
          </pre>
        </section>
      </div>
      <details className="admin-raw-params">
        <summary>生成参数</summary>
        <pre>
          {JSON.stringify(
            {
              kind: job.kind,
              music_kind: job.music_kind,
              preset: job.preset,
              precision: job.precision,
              ode_steps: job.ode_steps,
              seed: job.seed,
              progress: job.progress,
              params: job.params,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}

function UserDetail({ userId, reload }: { userId: string; reload: number }) {
  const [revision, setRevision] = useState(0);
  const [q, setQ] = useState("");
  const [search] = useDebouncedValue(q.trim(), 300);
  const [status, setStatus] = useState("");
  const [musicKind, setMusicKind] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [jobsRevision, setJobsRevision] = useState(0);
  const userKey = `${userId}:${reload}:${revision}`;
  const user = useAdminResource(userKey, () => adminApi.user(userId));
  const jobsKey = JSON.stringify([
    userId,
    search,
    status,
    musicKind,
    page,
    reload,
    jobsRevision,
  ]);
  const jobs = useAdminResource(jobsKey, () =>
    adminApi.jobs(userId, { q: search, status, music_kind: musicKind, page }),
  );
  const retry = () => {
    setRevision((n) => n + 1);
    setJobsRevision((n) => n + 1);
  };
  useEffect(() => {
    setExpanded(null);
  }, [jobsKey]);
  const record = user.data?.user;
  return (
    <div className="admin-user-detail">
      {user.loading || user.error ? (
        <Feedback loading={user.loading} error={user.error} onRetry={retry} />
      ) : (
        record && (
          <>
            <div className="admin-detail-identity">
              <AccountIdentity user={record} fullId />
              <RoleBadge user={record} />
            </div>
            <dl className="admin-user-facts">
              <div>
                <dt>注册时间</dt>
                <dd>{adminDate(record.created_at)}</dd>
              </div>
              <div>
                <dt>最近登录</dt>
                <dd>{adminDate(record.last_login)}</dd>
              </div>
              <div>
                <dt>有效登录会话</dt>
                <dd>{record.active ?? 0}</dd>
              </div>
              <div>
                <dt>账号类型</dt>
                <dd>{record.legacy_owner ? "初始账号" : "独立账号"}</dd>
              </div>
            </dl>
            <div className="admin-user-statistics">
              {[
                ["已生成", record.stats?.done ?? 0],
                [
                  "生成中",
                  (record.stats?.running ?? 0) + (record.stats?.queued ?? 0),
                ],
                ["失败", record.stats?.failed ?? 0],
                ["音乐时长", adminDuration(record.stats?.audio_seconds)],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </>
        )
      )}
      <section className="admin-user-jobs" aria-label="用户生成记录">
        <div className="admin-section-heading">
          <h3>生成记录</h3>
          <Button
            variant="subtle"
            size="xs"
            leftSection={<RefreshCw size={14} />}
            onClick={retry}
            loading={jobs.loading}
          >
            刷新
          </Button>
        </div>
        <div className="admin-job-filters">
          <TextInput
            aria-label="搜索用户的歌曲"
            placeholder="搜索歌名或任务 ID"
            leftSection={<Search size={16} />}
            value={q}
            onChange={(event) => {
              setQ(event.currentTarget.value);
              setPage(1);
              setExpanded(null);
            }}
          />
          <Select
            aria-label="筛选生成状态"
            value={status}
            allowDeselect={false}
            onChange={(value) => {
              setStatus(value || "");
              setPage(1);
            }}
            data={[
              { value: "", label: "全部状态" },
              ...Object.entries(adminStatusLabels).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
          <Select
            aria-label="筛选音乐类型"
            value={musicKind}
            allowDeselect={false}
            onChange={(value) => {
              setMusicKind(value || "");
              setPage(1);
            }}
            data={[
              { value: "", label: "全部类型" },
              { value: "instrumental", label: "纯音乐" },
              { value: "vocal", label: "带歌词" },
            ]}
          />
        </div>
        {jobs.loading || jobs.error ? (
          <Feedback
            loading={jobs.loading}
            error={jobs.error}
            onRetry={() => setJobsRevision((n) => n + 1)}
          />
        ) : !jobs.data?.jobs.length ? (
          <Feedback
            empty={
              search || status || musicKind
                ? "没有符合条件的生成记录"
                : "这个账号还没有生成音乐"
            }
          />
        ) : (
          <div className="admin-job-list">
            {jobs.data.jobs.map((job) => (
              <article
                className={`admin-job ${expanded === job.id ? "is-expanded" : ""}`}
                key={job.id}
              >
                <UnstyledButton
                  className="admin-job-toggle"
                  aria-expanded={expanded === job.id}
                  aria-controls={`admin-job-${job.id}`}
                  onClick={() =>
                    setExpanded(expanded === job.id ? null : job.id)
                  }
                >
                  <span className="admin-job-icon">
                    <Music2 size={19} />
                  </span>
                  <span className="admin-job-name">
                    <strong>{job.title || "未命名音乐"}</strong>
                    <span>
                      {job.music_kind === "instrumental" ? "纯音乐" : "带歌词"}
                      <i>·</i>
                      {adminDate(job.created_at)}
                    </span>
                  </span>
                  <StatusBadge status={job.status} />
                  <ChevronDown size={17} className="admin-job-chevron" />
                </UnstyledButton>
                {expanded === job.id && (
                  <div id={`admin-job-${job.id}`}>
                    <JobDetail job={job} />
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        {!jobs.loading && !jobs.error && jobs.data && (
          <Pager
            total={jobs.data.total}
            page={page}
            onChange={setPage}
            label="条记录"
          />
        )}
      </section>
    </div>
  );
}

function AdminConsole() {
  const compact = useMediaQuery("(max-width: 900px)");
  const [q, setQ] = useState("");
  const [search] = useDebouncedValue(q.trim(), 300);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const overview = useAdminResource(String(revision), adminApi.overview);
  const users = useAdminResource(JSON.stringify([search, page, revision]), () =>
    adminApi.users(search, page),
  );
  const selectedLabel =
    users.data?.users.find((user) => user.id === selected)?.email || selected;
  const refresh = () => setRevision((n) => n + 1);
  const summary = [
    { label: "注册用户", value: overview.data?.users_total, Icon: Users },
    {
      label: "24 小时登录用户",
      value: overview.data?.users_active_1d,
      Icon: Activity,
    },
    { label: "已生成音乐", value: overview.data?.songs_total, Icon: Music2 },
    {
      label: "生成中",
      value: overview.data
        ? (overview.data.job_totals?.running || 0) +
          (overview.data.job_totals?.queued || 0)
        : undefined,
      Icon: WandSparkles,
    },
  ];
  return (
    <div className="admin-page">
      <header className="admin-heading">
        <div>
          <span className="admin-eyebrow">
            <ShieldCheck size={15} /> 管理员
          </span>
          <h1>管理控制台</h1>
        </div>
        <Button
          variant="light"
          leftSection={<RefreshCw size={16} />}
          onClick={refresh}
          loading={overview.loading || users.loading}
        >
          刷新
        </Button>
      </header>
      <section className="admin-overview" aria-label="平台统计">
        {summary.map(({ label, value, Icon }) => (
          <div className="admin-stat-card" key={label}>
            <div>
              <span>{label}</span>
              <Icon size={18} strokeWidth={1.5} />
            </div>
            <strong>{value?.toLocaleString("zh-CN") ?? "—"}</strong>
          </div>
        ))}
      </section>
      {overview.error && (
        <div className="admin-inline-error" role="alert">
          <span>统计暂时无法读取：{overview.error}</span>
          <Button variant="subtle" size="xs" onClick={refresh}>
            重试
          </Button>
        </div>
      )}
      <section className="admin-users" aria-label="用户列表">
        <div className="admin-users-toolbar">
          <h2>用户</h2>
          <TextInput
            aria-label="搜索用户"
            placeholder="搜索邮箱或用户 ID"
            leftSection={<Search size={17} />}
            value={q}
            onChange={(event) => {
              setQ(event.currentTarget.value);
              setPage(1);
            }}
          />
        </div>
        {users.loading || users.error ? (
          <Feedback
            loading={users.loading}
            error={users.error}
            onRetry={refresh}
          />
        ) : !users.data?.users.length ? (
          <Feedback empty={search ? "没有找到这个用户" : "还没有注册用户"} />
        ) : compact ? (
          <div className="admin-user-cards">
            {users.data.users.map((user) => (
              <UnstyledButton
                className="admin-user-card"
                key={user.id}
                onClick={() => setSelected(user.id)}
                aria-label={`查看 ${user.email} 的详情`}
              >
                <div className="admin-user-card-top">
                  <AccountIdentity user={user} />
                  <ChevronRight size={17} />
                </div>
                <div className="admin-user-card-meta">
                  <RoleBadge user={user} />
                  <span>
                    已生成 <strong>{user.stats?.done ?? 0}</strong>
                  </span>
                  <span>
                    失败 <strong>{user.stats?.failed ?? 0}</strong>
                  </span>
                </div>
                <span className="admin-user-last-login">
                  最近登录 {adminDate(user.last_login)}
                </span>
              </UnstyledButton>
            ))}
          </div>
        ) : (
          <Table
            className="admin-user-table"
            verticalSpacing="md"
            highlightOnHover
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>账号</Table.Th>
                <Table.Th>角色</Table.Th>
                <Table.Th>已生成</Table.Th>
                <Table.Th>失败</Table.Th>
                <Table.Th>最近登录</Table.Th>
                <Table.Th>
                  <span className="sr-only">操作</span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {users.data.users.map((user) => (
                <Table.Tr key={user.id}>
                  <Table.Td>
                    <AccountIdentity user={user} />
                  </Table.Td>
                  <Table.Td>
                    <RoleBadge user={user} />
                  </Table.Td>
                  <Table.Td>{user.stats?.done ?? 0}</Table.Td>
                  <Table.Td>
                    <span
                      className={user.stats?.failed ? "admin-failed-count" : ""}
                    >
                      {user.stats?.failed ?? 0}
                    </span>
                  </Table.Td>
                  <Table.Td className="admin-table-date">
                    {adminDate(user.last_login)}
                  </Table.Td>
                  <Table.Td>
                    <Button
                      variant="subtle"
                      size="xs"
                      rightSection={<ChevronRight size={14} />}
                      onClick={() => setSelected(user.id)}
                      aria-label={`查看 ${user.email} 的详情`}
                    >
                      查看详情
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        {!users.loading && !users.error && users.data && (
          <Pager
            total={users.data.total}
            page={page}
            onChange={setPage}
            label="位用户"
          />
        )}
      </section>
      <Drawer
        opened={!!selected}
        onClose={() => setSelected(null)}
        title={
          <span className="admin-drawer-heading">
            <span>用户详情</span>
            <small title={selectedLabel || undefined}>{selectedLabel}</small>
          </span>
        }
        position="right"
        size={compact ? "100%" : 960}
        padding={compact ? 20 : 32}
        className="admin-user-drawer"
        closeButtonProps={{ "aria-label": "关闭用户详情" }}
      >
        {selected && (
          <UserDetail key={selected} userId={selected} reload={revision} />
        )}
      </Drawer>
    </div>
  );
}

export function AdminPage() {
  const user = useAuth((state) => state.user);
  if (!user?.is_admin)
    return (
      <div className="admin-access-denied" role="alert">
        <ShieldCheck size={30} strokeWidth={1.4} />
        <h2>仅管理员可访问</h2>
        <p>请使用管理员账号登录后查看用户与生成记录。</p>
      </div>
    );
  return <AdminConsole key={user.id} />;
}
