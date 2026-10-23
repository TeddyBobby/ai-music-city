"""Admin console API: platform usage, active users, job statistics."""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

from fastapi import APIRouter, Request

from yue2_studio.api import ApiError
from yue2_studio.auth_api import require_admin

router = APIRouter(prefix='/api/admin', dependencies=[])  # per-route admin guard


def install(app):
    app.state.auth  # ensure auth installed first
    app.include_router(router)

    def _admin(request: Request) -> dict:
        return require_admin(request)

    def _auth_db(request: Request) -> sqlite3.Connection:
        # 每次请求新建短命连接：uvicorn 在多线程处理请求，缓存的连接
        # 会被 sqlite3 的 check_same_thread 拒绝（ProgrammingError）。
        path = Path(app.state.paths.data_dir) / 'auth' / 'auth.db'
        conn = sqlite3.connect(path, timeout=15)
        conn.row_factory = sqlite3.Row
        return conn

    @router.get('/overview')
    def overview(request: Request):
        _admin(request)
        db = _auth_db(request)
        try:
            users_total = db.execute('SELECT count(*) c FROM users').fetchone()['c']
            sessions_active = db.execute(
                'SELECT count(*) c FROM sessions WHERE expires_at > ?', (int(time.time()),)).fetchone()['c']
            now_day = int(time.time()) - 86400
            users_active_1d = db.execute(
                'SELECT count(DISTINCT user_id) c FROM sessions WHERE created_at > ?', (now_day,)).fetchone()['c']
            users_7d = db.execute(
                'SELECT count(DISTINCT user_id) c FROM sessions WHERE created_at > ?', (int(time.time()) - 7 * 86400,)).fetchone()['c']
        finally:
            db.close()
        return {
            'users_total': users_total,
            'sessions_active': sessions_active,
            'users_active_1d': users_active_1d,
            'users_active_7d': users_7d,
            'engine': type(app.state.engine).__name__,
            'fake': bool(app.state.fake),
        }

    @router.get('/users')
    def users(request: Request, limit: int = 100, offset: int = 0):
        _admin(request)
        if not 1 <= limit <= 500 or offset < 0:
            raise ApiError(400, 'validation_error', 'limit must be 1..500')
        db = _auth_db(request)
        try:
            rows = db.execute(
                '''SELECT u.id, u.email, u.is_admin, u.legacy_owner, u.created_at, u.last_login,
                          (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS active
                   FROM users u ORDER BY u.created_at DESC LIMIT ? OFFSET ?''',
                (int(time.time()), limit, offset)).fetchall()
            total = db.execute('SELECT count(*) c FROM users').fetchone()['c']
        finally:
            db.close()
        return {'users': [dict(r) for r in rows], 'total': total}

    @router.get('/jobs')
    def jobs_stats(request: Request):
        _admin(request)
        # aggregate across tenant stores: the legacy store plus every user's db
        root = Path(app.state.paths.data_dir)
        totals = {'done': 0, 'failed': 0, 'running': 0, 'queued': 0, 'cancelled': 0}
        per_user = []
        candidates = [root] + list((root / 'users').glob('*')) if (root / 'users').exists() else [root]
        for base in candidates:
            db_path = base / 'app.db' if base.name != 'auth' else None
            if db_path is None or not db_path.is_file():
                continue
            try:
                conn = sqlite3.connect(db_path)
                conn.row_factory = sqlite3.Row
                rows = conn.execute('SELECT status, count(*) c FROM jobs GROUP BY status').fetchall()
                counts = {r['status']: r['c'] for r in rows}
                for k, v in counts.items():
                    totals[k] = totals.get(k, 0) + v
                if any(counts.values()):
                    per_user.append({'user': 'legacy' if base == root else base.name, **counts})
                conn.close()
            except sqlite3.Error:
                continue
        return {'totals': totals, 'per_user': per_user}
