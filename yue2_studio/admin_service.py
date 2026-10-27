"""Bounded, read-only account reporting without constructing tenant runtimes."""

from __future__ import annotations

import json
import math
import re
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote

from yue2_studio.api import ApiError
from yue2_studio.jobs import stored_audio_seconds, stored_music_kind

STATUSES = ("done", "failed", "running", "queued", "cancelled")
OPAQUE_ID = re.compile(r"[a-f0-9]{16,64}")
JOB_ID = re.compile(r"[a-zA-Z0-9_-]{1,128}")
PARAM_FIELDS = {
    "title",
    "description",
    "style",
    "lyrics",
    "language",
    "music_kind",
    "cot",
    "cfg_scale",
    "mode",
    "task",
    "melody",
    "hum_influence",
    "offset_s",
    "clip_start",
    "clip_end",
    "seed",
}
PROGRESS_FIELDS = {
    "type",
    "stage",
    "label",
    "completed",
    "total",
    "unit",
    "status",
    "phase",
    "tokens",
    "tps",
    "seconds",
}


def _object(raw):
    try:
        value = json.loads(raw) if raw else {}
    except (ValueError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def _redact(value: str) -> str:
    value = re.sub(r"\bsk-[A-Za-z0-9_-]{8,}", "[redacted]", value)
    value = re.sub(
        r"(?i)\b((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|"
        r'authorization)["\']?\s*[:=]\s*["\']?(?:bearer\s+)?)[^\s,;"\']+',
        r"\1[redacted]",
        value,
    )
    value = re.sub(r"(?i)(https?://)[^\s/@]+:[^\s/@]+@", r"\1[redacted]@", value)
    return value


def _safe_fields(value, allowed):
    result = {}
    for key in allowed & value.keys():
        item = value[key]
        if isinstance(item, str):
            result[key] = _redact(item[:30000])
        elif item is None or isinstance(item, bool | int):
            result[key] = item
        elif isinstance(item, float) and math.isfinite(item):
            result[key] = item
    return result


def _music_kind(params, loras):
    explicit = _object(params).get("music_kind")
    if explicit in ("instrumental", "vocal"):
        return explicit
    try:
        return stored_music_kind(params, loras)
    except (ValueError, TypeError, KeyError, AttributeError):
        return "vocal"


def _seconds(seconds, timing):
    try:
        return stored_audio_seconds(seconds, timing)
    except (ValueError, TypeError):
        return 0.0


def _search(params):
    values = _object(params)
    return "\n".join(
        values[key] for key in ("title", "description", "style", "lyrics") if isinstance(values.get(key), str)
    ).casefold()


def _safe_path(base: Path, *parts: str) -> Path | None:
    """Reject symlinks as well as lexical escapes, including links to sibling accounts."""
    path = base
    for part in parts:
        path = path / part
        if path.is_symlink():
            return None
    try:
        resolved = path.resolve()
        resolved.relative_to(base.resolve())
    except (OSError, ValueError, RuntimeError):
        return None
    return resolved


def _paging(q, limit, offset):
    if not 1 <= limit <= 500 or offset < 0 or len(q) > 200:
        raise ApiError(400, "validation_error", "分页或搜索参数无效")
    return q.strip().casefold()


class AdminReader:
    def __init__(self, data_dir):
        self.root = Path(data_dir).resolve()

    @contextmanager
    def _db(self, path):
        connection = None
        try:
            connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA query_only=ON")
            connection.create_function("admin_music_kind", 2, _music_kind, deterministic=True)
            connection.create_function("admin_audio_seconds", 2, _seconds, deterministic=True)
            connection.create_function("admin_search", 1, _search, deterministic=True)
            yield connection
        except sqlite3.Error:
            raise ApiError(503, "admin_data_unavailable", "暂时无法读取统计数据，请稍后重试") from None
        finally:
            if connection is not None:
                connection.close()

    def _accounts(self, *, user_id=None, q="", limit=None, offset=0):
        path = _safe_path(self.root, "auth", "auth.db")
        if path is None or not path.is_file():
            raise ApiError(503, "admin_data_unavailable", "账号数据暂时不可用")
        conditions, args = ["u.password_hash IS NOT NULL"], []
        if user_id is not None:
            conditions.append("u.id=?")
            args.append(user_id)
        if q:
            conditions.append("(instr(lower(u.email),?)>0 OR instr(lower(u.id),?)>0)")
            args.extend((q, q))
        where = " WHERE " + " AND ".join(conditions)
        with self._db(path) as db:
            total = db.execute("SELECT count(*) FROM users u" + where, args).fetchone()[0]
            query = (
                """SELECT u.id,u.email,u.is_admin,u.legacy_owner,u.created_at,u.last_login,
                (SELECT count(*) FROM sessions s WHERE s.user_id=u.id AND s.expires_at>?) AS active
                FROM users u"""
                + where
                + " ORDER BY u.created_at DESC,u.id"
            )
            parameters = [int(time.time()), *args]
            if limit is not None:
                query += " LIMIT ? OFFSET ?"
                parameters += [limit, offset]
            rows = [dict(row) for row in db.execute(query, parameters)]
        for row in rows:
            row["is_admin"], row["legacy_owner"] = bool(row["is_admin"]), bool(row["legacy_owner"])
        return rows, total

    def _account(self, user_id):
        users, _ = self._accounts(user_id=user_id)
        if not users:
            raise ApiError(404, "not_found", "用户不存在")
        return users[0]

    def _tenant(self, user):
        if user["legacy_owner"]:
            return self.root
        if not OPAQUE_ID.fullmatch(user["id"]):
            return None
        return _safe_path(self.root, "users", user["id"])

    @contextmanager
    def _jobs_db(self, user):
        base = self._tenant(user)
        path = _safe_path(base, "app.db") if base is not None else None
        if path is None or not path.is_file():
            yield None
            return
        with self._db(path) as db:
            yield db

    def _stats(self, user):
        result = {
            "jobs_total": 0,
            **dict.fromkeys(STATUSES, 0),
            "audio_seconds": 0.0,
            "last_created_at": None,
        }
        with self._jobs_db(user) as db:
            if db is None:
                return result
            for row in db.execute("SELECT status,count(*) AS n FROM jobs GROUP BY status"):
                result["jobs_total"] += row["n"]
                if row["status"] in STATUSES:
                    result[row["status"]] = row["n"]
            summary = db.execute("""SELECT max(created_at) AS last_created_at,
                coalesce(sum(CASE WHEN status='done' THEN admin_audio_seconds(audio_seconds,timing_json)
                ELSE 0 END),0) AS audio_seconds FROM jobs""").fetchone()
            result.update(dict(summary))
        return result

    def users(self, *, q="", limit=20, offset=0):
        q = _paging(q, limit, offset)
        users, total = self._accounts(q=q, limit=limit, offset=offset)
        return {"users": [{**user, "stats": self._stats(user)} for user in users], "total": total}

    def user(self, user_id):
        user = self._account(user_id)
        return {**user, "stats": self._stats(user)}

    def job_totals(self):
        users, _ = self._accounts()
        totals, per_user = dict.fromkeys(STATUSES, 0), []
        for user in users:
            stats = self._stats(user)
            for key in STATUSES:
                totals[key] += stats[key]
            if stats["jobs_total"]:
                per_user.append({"user": user["id"], **{key: stats[key] for key in STATUSES}})
        return {"totals": totals, "per_user": per_user}

    def overview(self):
        users, total = self._accounts()
        totals, count, seconds = dict.fromkeys(STATUSES, 0), 0, 0.0
        for user in users:
            stats = self._stats(user)
            count += stats["jobs_total"]
            seconds += stats["audio_seconds"]
            for key in STATUSES:
                totals[key] += stats[key]
        with self._db(_safe_path(self.root, "auth", "auth.db")) as db:
            now = int(time.time())
            sessions = db.execute(
                """SELECT
                count(CASE WHEN s.expires_at>? THEN 1 END) AS sessions_active,
                count(DISTINCT CASE WHEN s.created_at>? THEN s.user_id END) AS users_active_1d,
                count(DISTINCT CASE WHEN s.created_at>? THEN s.user_id END) AS users_active_7d
                FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.password_hash IS NOT NULL""",
                (now, now - 86400, now - 7 * 86400),
            ).fetchone()
        return {
            "users_total": total,
            **dict(sessions),
            "jobs_total": count,
            "songs_total": totals["done"],
            "audio_seconds": seconds,
            "job_totals": totals,
        }

    def _audio_path(self, user, row):
        if row["status"] != "done" or not JOB_ID.fullmatch(row["id"]):
            return None
        base = self._tenant(user)
        path = _safe_path(base, "songs", row["id"], "song", "audio.flac") if base is not None else None
        return path if path is not None and path.is_file() else None

    def _job(self, user, row):
        row = dict(row)
        params = _safe_fields(_object(row["params_json"]), PARAM_FIELDS)
        url = (
            f"/api/admin/users/{quote(user['id'], safe='')}/jobs/{quote(row['id'], safe='')}/audio"
            if self._audio_path(user, row) is not None
            else None
        )
        return {
            **{
                key: row.get(key)
                for key in (
                    "id",
                    "kind",
                    "status",
                    "preset",
                    "precision",
                    "ode_steps",
                    "seed",
                    "created_at",
                    "started_at",
                    "finished_at",
                )
            },
            "title": params.get("title") or None,
            "params": params,
            "timing": {"audio_seconds": _seconds(row.get("audio_seconds"), row.get("timing_json"))},
            "progress": _safe_fields(_object(row.get("progress_json")), PROGRESS_FIELDS) or None,
            "error": _redact(str(row["error"])[:2000]) if row.get("error") else None,
            "music_kind": _music_kind(row["params_json"], row.get("loras_json")),
            "audio_url": url,
            "download_url": url + "?download=1" if url else None,
        }

    def jobs(self, user_id, *, q="", status=None, music_kind=None, limit=20, offset=0):
        q = _paging(q, limit, offset)
        if status is not None and status not in STATUSES:
            raise ApiError(400, "validation_error", "任务状态无效")
        if music_kind is not None and music_kind not in ("instrumental", "vocal"):
            raise ApiError(400, "validation_error", "音乐类型无效")
        user = self._account(user_id)
        conditions, args = [], []
        with self._jobs_db(user) as db:
            if db is None:
                return {"jobs": [], "total": 0}
            columns = {row["name"] for row in db.execute("PRAGMA table_info(jobs)")}
            if status is not None:
                conditions.append("status=?")
                args.append(status)
            if music_kind is not None:
                loras = "loras_json" if "loras_json" in columns else "NULL"
                conditions.append(f"admin_music_kind(params_json,{loras})=?")
                args.append(music_kind)
            if q:
                conditions.append("(instr(lower(id),?)>0 OR instr(admin_search(params_json),?)>0)")
                args.extend((q, q))
            where = " WHERE " + " AND ".join(conditions) if conditions else ""
            total = db.execute("SELECT count(*) FROM jobs" + where, args).fetchone()[0]
            rows = db.execute(
                "SELECT * FROM jobs" + where + " ORDER BY created_at DESC,seq DESC,id LIMIT ? OFFSET ?",
                [*args, limit, offset],
            ).fetchall()
        return {"jobs": [self._job(user, row) for row in rows], "total": total}

    def audio(self, user_id, job_id):
        user = self._account(user_id)
        if not JOB_ID.fullmatch(job_id):
            raise ApiError(404, "not_found", "作品不存在")
        with self._jobs_db(user) as db:
            row = db.execute("SELECT id,status FROM jobs WHERE id=?", (job_id,)).fetchone() if db else None
        path = self._audio_path(user, row) if row is not None else None
        if path is None:
            raise ApiError(404, "not_found", "已完成的音频不存在")
        return path
