"""Email code login/registration for the public-facing product.

Sessions use a signed HttpOnly cookie; codes are single-use and expire quickly.
SMTP sending is a pluggable function so deployment can choose a transport later.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from yue2_studio.api import ApiError

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
CODE_TTL = 10 * 60          # seconds
CODE_RESEND_COOLDOWN = 60   # seconds
SESSION_TTL = 30 * 24 * 3600
COOKIE = 'amc_session'


def now() -> int:
    return int(time.time())


class AuthBody(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    code: str | None = Field(default=None, min_length=4, max_length=8)


class Service:
    def __init__(self, data_dir: Path, *, secret: str | None = None):
        self.root = Path(data_dir) / 'auth'
        self.root.mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / 'auth.db'
        self.secret_path = self.root / 'secret.key'
        self.secret = secret or self._load_secret()
        self._sending: list = []  # outbound email hooks for future SMTP wiring
        with self.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
                created_at INTEGER NOT NULL, last_login INTEGER);
            CREATE TABLE IF NOT EXISTS codes (email TEXT PRIMARY KEY, hash TEXT NOT NULL,
                created_at INTEGER NOT NULL, attempts INTEGER DEFAULT 0, used INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
            ''')

    def _load_secret(self) -> str:
        if self.secret_path.exists():
            return self.secret_path.read_text().strip()
        value = secrets.token_hex(32)
        self.secret_path.write_text(value)
        try:
            self.secret_path.chmod(0o600)
        except OSError:
            pass
        return value

    # ---- db ----
    def db(self):
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    # ---- helpers ----
    @staticmethod
    def _hash(value: str) -> str:
        return hashlib.sha256(value.encode()).hexdigest()

    def _sign(self, payload: str) -> str:
        return hmac.new(self.secret.encode(), payload.encode(), hashlib.sha256).hexdigest()

    def on_send(self, fn):
        self._sending.append(fn)
        return fn

    def _emit_code(self, email: str, code: str):
        # default transport: print to server log (deployment replaces this)
        print(f'[auth] login code for {email}: {code}', flush=True)
        for fn in self._sending:
            try:
                fn(email, code)
            except Exception:
                pass

    # ---- flow ----
    def request_code(self, email: str) -> dict:
        email = email.strip().lower()
        if not EMAIL_RE.match(email):
            raise ApiError(400, 'validation_error', '邮箱格式不正确')
        with self.db() as db:
            row = db.execute('SELECT created_at FROM codes WHERE email=?', (email,)).fetchone()
            if row and now() - row['created_at'] < CODE_RESEND_COOLDOWN:
                raise ApiError(429, 'too_frequent', '验证码发送过于频繁，请稍后再试')
            code = '123456'  # 通用演示验证码（上线前替换为随机码+邮件发送）
            db.execute('INSERT OR REPLACE INTO codes VALUES (?,?,?,0,0)',
                       (email, self._hash(code), now()))
        self._emit_code(email, code)
        return {'sent': True, 'email': email, 'ttl': CODE_TTL}

    def verify_code(self, email: str, code: str) -> dict:
        email = email.strip().lower()
        with self.db() as db:
            row = db.execute('SELECT * FROM codes WHERE email=?', (email,)).fetchone()
            if not row or row['used']:
                raise ApiError(400, 'invalid_code', '请先获取验证码')
            if now() - row['created_at'] > CODE_TTL:
                raise ApiError(400, 'invalid_code', '验证码已过期，请重新获取')
            if row['attempts'] >= 5:
                raise ApiError(429, 'too_frequent', '尝试次数过多，请重新获取验证码')
            if not hmac.compare_digest(row['hash'], self._hash(code.strip())):
                db.execute('UPDATE codes SET attempts=attempts+1 WHERE email=?', (email,))
                raise ApiError(400, 'invalid_code', '验证码不正确')
            db.execute('UPDATE codes SET used=1 WHERE email=?', (email,))
            user = db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
            if user:
                db.execute('UPDATE users SET last_login=? WHERE id=?', (now(), user['id']))
                user_id, created = user['id'], False
            else:
                user_id, created = secrets.token_hex(8), True
                db.execute('INSERT INTO users VALUES (?,?,?,?)', (user_id, email, now(), now()))
            token = secrets.token_urlsafe(32)
            db.execute('INSERT INTO sessions VALUES (?,?,?,?)',
                       (self._hash(token), user_id, now(), now() + SESSION_TTL))
        return {'token': token, 'user': {'id': user_id, 'email': email}, 'created': created}

    def current_user(self, request: Request):
        token = request.cookies.get(COOKIE)
        if not token:
            return None
        with self.db() as db:
            row = db.execute('''SELECT u.id, u.email, s.expires_at FROM sessions s
                                JOIN users u ON u.id = s.user_id WHERE s.token_hash=?''',
                             (self._hash(token),)).fetchone()
        if not row or row['expires_at'] < now():
            return None
        return {'id': row['id'], 'email': row['email']}

    def logout(self, token: str):
        with self.db() as db:
            db.execute('DELETE FROM sessions WHERE token_hash=?', (self._hash(token),))


def install(app):
    svc = Service(app.state.paths.data_dir)
    app.state.auth = svc
    router = APIRouter(prefix='/api/auth')

    @router.get('/status')
    async def auth_status(request: Request):
        user = svc.current_user(request)
        return {'user': user}

    @router.post('/code', status_code=201)
    async def send_code(body: AuthBody):
        return svc.request_code(body.email)

    @router.post('/login', status_code=201)
    async def login(body: AuthBody, response: Response):
        if not body.code:
            raise ApiError(400, 'validation_error', '请输入验证码')
        result = svc.verify_code(body.email, body.code)
        response.set_cookie(COOKIE, result['token'], max_age=SESSION_TTL, httponly=True,
                            samesite='lax', secure=request_secure())
        return {'user': result['user'], 'created': result['created']}

    @router.post('/logout')
    async def logout(request: Request, response: Response):
        token = request.cookies.get(COOKIE)
        if token:
            svc.logout(token)
        response.delete_cookie(COOKIE)
        return {'ok': True}

    app.include_router(router)


def request_secure() -> bool:
    return os.environ.get('AMC_FORCE_SECURE_COOKIE') == '1'
