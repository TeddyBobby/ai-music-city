import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Table, Text } from "@mantine/core";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";
import "./Workspace.css";

interface Overview {
  users_total: number;
  sessions_active: number;
  users_active_1d: number;
  users_active_7d: number;
  engine: string;
  fake: boolean;
}
interface UserRow {
  id: string;
  email: string;
  is_admin: number;
  legacy_owner: number;
  created_at: number;
  last_login: number | null;
  active: number;
}

const fmt = (ts: number | null) =>
  ts ? new Date(ts * 1000).toLocaleString("zh-CN") : "—";

export function AdminPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [jobs, setJobs] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user === null) return;
    api.get("/api/admin/overview").then(setOverview).catch((e: any) => setError(e?.message || "加载失败"));
    api.get("/api/admin/users").then((d: any) => setUsers(d.users || [])).catch(() => {});
    api.get("/api/admin/jobs").then(setJobs).catch(() => {});
  }, [user]);

  if (user === null) {
    void nav("/login");
    return null;
  }
  if (error && !overview)
    return (
      <div className="wk-page">
        <div className="card wk-error" role="alert">
          <span>{error}（需要管理员账号登录）</span>
        </div>
      </div>
    );

  return (
    <div className="wk-page">
      <h2>管理控制台</h2>
      <div className="row" style={{ gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div className="card wk-status-card" style={{ minWidth: 150 }}>
          <Text size="sm" c="dimmed">注册用户</Text>
          <strong style={{ fontSize: 26 }}>{overview?.users_total ?? "—"}</strong>
        </div>
        <div className="card wk-status-card" style={{ minWidth: 150 }}>
          <Text size="sm" c="dimmed">24 小时活跃</Text>
          <strong style={{ fontSize: 26 }}>{overview?.users_active_1d ?? "—"}</strong>
        </div>
        <div className="card wk-status-card" style={{ minWidth: 150 }}>
          <Text size="sm" c="dimmed">7 天活跃</Text>
          <strong style={{ fontSize: 26 }}>{overview?.users_active_7d ?? "—"}</strong>
        </div>
        <div className="card wk-status-card" style={{ minWidth: 150 }}>
          <Text size="sm" c="dimmed">在线会话</Text>
          <strong style={{ fontSize: 26 }}>{overview?.sessions_active ?? "—"}</strong>
        </div>
        <div className="card wk-status-card" style={{ minWidth: 200 }}>
          <Text size="sm" c="dimmed">生成引擎</Text>
          <strong style={{ fontSize: 16, lineHeight: 2.4 }}>
            {overview?.engine || "—"}
            {overview?.fake ? "（演示）" : ""}
          </strong>
        </div>
      </div>

      {jobs?.totals && (
        <div className="card wk-status-card" style={{ marginBottom: 20 }}>
          <h3>生成任务统计</h3>
          <div className="row" style={{ gap: 20 }}>
            {Object.entries(jobs.totals).map(([k, v]) => (
              <div key={k}>
                <Text size="sm" c="dimmed">{k}</Text>
                <strong>{String(v)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <h3>用户列表</h3>
      <Table.ScrollContainer minWidth={600}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>邮箱</Table.Th>
              <Table.Th>角色</Table.Th>
              <Table.Th>在线</Table.Th>
              <Table.Th>注册时间</Table.Th>
              <Table.Th>最近登录</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>{u.email}</Table.Td>
                <Table.Td>
                  {u.is_admin ? "管理员" : u.legacy_owner ? "初始账号" : "用户"}
                </Table.Td>
                <Table.Td>{u.active ? "●" : "—"}</Table.Td>
                <Table.Td>{fmt(u.created_at)}</Table.Td>
                <Table.Td>{fmt(u.last_login)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </div>
  );
}
