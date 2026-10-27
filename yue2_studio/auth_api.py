"""Password accounts, revocable cookie sessions, and the API authentication boundary.

The first account can only be provisioned directly on localhost. It owns the pre-account
workspace; later accounts receive their own storage namespace. Former demo-code sessions
are revoked during the schema migration and cannot authenticate a password account.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field
from starlette.datastructures import MutableHeaders

from yue2_studio.api import ApiError, error_response

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SESSION_TTL = 30 * 24 * 3600
COOKIE = "amc_session"
SCRYPT_N = 32768
SCRYPT_R = 8
SCRYPT_P = 1
PUBLIC_PATHS = frozenset(
    {
        "/api/auth/status",
        "/api/auth/register",
        "/api/auth/login",
        "/api/auth/logout",
        "/api/auth/code",
    }
)


def now() -> int:
    return int(time.time())


class AuthBody(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=10, max_length=128)


def _loopback(value: str | None) -> bool:
    if value is None:
        return False
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return value.lower() == "localhost"


def local_setup_request(request: Request) -> bool:
    """Never trust proxy headers to decide who may claim an existing local workspace."""
    if any(name == "forwarded" or name.startswith("x-forwarded-") for name in request.headers):
        return False
    return bool(request.client and _loopback(request.client.host) and _loopback(request.url.hostname))


def _origin(value: str) -> tuple[str, str | None, int | None] | None:
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
        ):
            return None
        return (
            parsed.scheme.lower(),
            parsed.hostname.lower(),
            parsed.port or (443 if parsed.scheme == "https" else 80),
        )
    except ValueError:
        return None


def same_origin(request: Request) -> bool:
    """Reject browser cross-origin writes, including a hostile same-site subdomain."""
    origin = request.headers.get("origin")
    if origin is not None:
        return _origin(origin) is not None and _origin(origin) == _origin(str(request.url))
    if request.headers.get("sec-fetch-site") in {"cross-site", "same-site"}:
        return False
    referer = request.headers.get("referer")
    return referer is None or (_origin(referer) is not None and _origin(referer) == _origin(str(request.url)))


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        maxmem=64 * 1024 * 1024,
        dklen=32,
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${derived.hex()}"


def password_matches(password: str, encoded: str) -> bool:
    try:
        scheme, n, r, p, salt, expected = encoded.split("$")
        if (scheme, int(n), int(r), int(p)) != ("scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P):
            return False
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt),
            n=SCRYPT_N,
            r=SCRYPT_R,
            p=SCRYPT_P,
            maxmem=64 * 1024 * 1024,
            dklen=32,
        )
        return hmac.compare_digest(derived, bytes.fromhex(expected))
    except (ValueError, TypeError):
        return False


class Service:
    def __init__(self, data_dir: Path, *, secret: str | None = None):
        # ``secret`` remains accepted for callers of the former implementation. Session
        # secrets are opaque random tokens now; only their SHA-256 digests are persisted.
        self.root = Path(data_dir) / "auth"
        self.root.mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / "auth.db"
        with self.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
                    created_at INTEGER NOT NULL, last_login INTEGER);
                CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS auth_rate_limits (kind TEXT NOT NULL, key TEXT NOT NULL,
                    window_start INTEGER NOT NULL, attempts INTEGER NOT NULL,
                    PRIMARY KEY (kind, key, window_start));
            """)
            db.execute("BEGIN IMMEDIATE")
            columns = {row["name"] for row in db.execute("PRAGMA table_info(users)")}
            for name, definition in (
                ("password_hash", "TEXT"),
                ("is_admin", "INTEGER NOT NULL DEFAULT 0"),
                ("legacy_owner", "INTEGER NOT NULL DEFAULT 0"),
            ):
                if name not in columns:
                    db.execute(f"ALTER TABLE users ADD COLUMN {name} {definition}")
            db.execute(
                "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE password_hash IS NULL)"
            )
            db.execute("DELETE FROM sessions WHERE expires_at<=?", (now(),))
        try:
            self.root.chmod(0o700)
            self.db_path.chmod(0o600)
        except OSError:
            pass
        # Equal password work for unknown and known accounts limits account enumeration.
        self._dummy_hash = password_hash(secrets.token_urlsafe(32))

    @contextmanager
    def db(self):
        connection = sqlite3.connect(self.db_path, timeout=15)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def _hash(value: str) -> str:
        return hashlib.sha256(value.encode()).hexdigest()

    @staticmethod
    def _user(row) -> dict:
        return {
            "id": row["id"],
            "email": row["email"],
            "is_admin": bool(row["is_admin"]),
            "legacy_owner": bool(row["legacy_owner"]),
        }

    def users(self) -> list[dict]:
        with self.db() as db:
            return [
                self._user(row)
                for row in db.execute(
                    "SELECT id,email,is_admin,legacy_owner FROM users "
                    "WHERE password_hash IS NOT NULL ORDER BY created_at,id"
                )
            ]

    def setup_required(self) -> bool:
        with self.db() as db:
            return (
                db.execute("SELECT 1 FROM users WHERE password_hash IS NOT NULL LIMIT 1").fetchone() is None
            )

    def _email(self, email: str) -> str:
        email = email.strip().lower()
        if not EMAIL_RE.fullmatch(email):
            raise ApiError(400, "validation_error", "邮箱格式不正确")
        return email

    def _rate_limit(self, kind: str, key: str, *, limit: int, window: int) -> None:
        timestamp = now()
        start = timestamp - timestamp % window
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM auth_rate_limits WHERE window_start<?", (timestamp - 24 * 3600,))
            db.execute(
                """INSERT INTO auth_rate_limits VALUES (?,?,?,1)
                       ON CONFLICT (kind,key,window_start) DO UPDATE SET attempts=attempts+1""",
                (kind, self._hash(key), start),
            )
            count = db.execute(
                "SELECT attempts FROM auth_rate_limits WHERE kind=? AND key=? AND window_start=?",
                (kind, self._hash(key), start),
            ).fetchone()["attempts"]
        # Raise after committing: rejected attempts must not roll back the counter.
        if count > limit:
            raise ApiError(429, "too_frequent", "尝试过于频繁，请稍后再试")

    def _session(self, db, user, old_token: str | None = None) -> dict:
        timestamp = now()
        if old_token:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (self._hash(old_token),))
        db.execute("DELETE FROM sessions WHERE expires_at<=?", (timestamp,))
        token = secrets.token_urlsafe(32)
        db.execute(
            "INSERT INTO sessions VALUES (?,?,?,?)",
            (self._hash(token), user["id"], timestamp, timestamp + SESSION_TTL),
        )
        db.execute("UPDATE users SET last_login=? WHERE id=?", (timestamp, user["id"]))
        return {"token": token, "user": self._user(user)}

    def register(self, email: str, password: str, request: Request) -> dict:
        email = self._email(email)
        peer = request.client.host if request.client else "unknown"
        self._rate_limit("register", peer, limit=10, window=3600)
        encoded = password_hash(password)
        with self.db() as db:
            # This lock makes selecting the sole legacy owner and inserting it atomic.
            db.execute("BEGIN IMMEDIATE")
            first = (
                db.execute("SELECT 1 FROM users WHERE password_hash IS NOT NULL LIMIT 1").fetchone() is None
            )
            if first and not local_setup_request(request):
                raise ApiError(
                    403, "local_setup_required", "请在运行服务的电脑上打开 localhost，创建首个账号"
                )
            existing = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            if existing and (not first or existing["password_hash"]):
                raise ApiError(409, "account_exists", "无法使用该邮箱注册，请登录或更换邮箱")
            if existing:
                # Old email codes did not establish a trustworthy identity. Only the
                # direct local workspace owner may replace such a demo identity.
                user_id = existing["id"]
                db.execute(
                    "UPDATE users SET password_hash=?,is_admin=1,legacy_owner=1 WHERE id=?",
                    (encoded, user_id),
                )
            else:
                user_id = secrets.token_hex(16)
                db.execute(
                    """INSERT INTO users (id,email,created_at,last_login,password_hash,is_admin,legacy_owner)
                           VALUES (?,?,?,?,?,?,?)""",
                    (user_id, email, now(), now(), encoded, int(first), int(first)),
                )
            user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
            return self._session(db, user, request.cookies.get(COOKIE))

    def login(self, email: str, password: str, request: Request) -> dict:
        email = self._email(email)
        peer = request.client.host if request.client else "unknown"
        self._rate_limit("login_ip", peer, limit=30, window=15 * 60)
        self._rate_limit("login_account", email, limit=10, window=15 * 60)
        with self.db() as db:
            user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        encoded = user["password_hash"] if user and user["password_hash"] else self._dummy_hash
        matches = password_matches(password, encoded)
        if not matches or not user or not user["password_hash"]:
            raise ApiError(401, "invalid_credentials", "邮箱或密码不正确")
        with self.db() as db:
            result = self._session(db, user, request.cookies.get(COOKIE))
            db.execute(
                "DELETE FROM auth_rate_limits WHERE kind='login_account' AND key=?", (self._hash(email),)
            )
            return result

    def current_user(self, request: Request):
        token = request.cookies.get(COOKIE)
        if not token or len(token) > 256:
            return None
        with self.db() as db:
            row = db.execute(
                """SELECT u.id,u.email,u.is_admin,u.legacy_owner,s.expires_at FROM sessions s
                              JOIN users u ON u.id=s.user_id
                              WHERE s.token_hash=? AND u.password_hash IS NOT NULL""",
                (self._hash(token),),
            ).fetchone()
        if not row or row["expires_at"] <= now():
            return None
        return self._user(row)

    def logout(self, token: str):
        with self.db() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (self._hash(token),))


class AuthenticationMiddleware:
    """Pure ASGI middleware preserves streaming/SSE and guards direct media URLs too."""

    def __init__(self, app, service: Service):
        self.app = app
        self.service = service

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        is_api = path == "/api" or path.startswith("/api/")
        is_docs = path in {"/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"}
        if not is_api and not is_docs:
            await self.app(scope, receive, send)
            return
        request = Request(scope)

        async def private_send(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["cache-control"] = "no-store"
                headers["pragma"] = "no-cache"
                headers.add_vary_header("Cookie")
            await send(message)

        if scope["method"] not in {"GET", "HEAD", "OPTIONS"} and not same_origin(request):
            await error_response(403, "cross_origin_request", "请从本站页面提交请求")(
                scope, receive, private_send
            )
            return
        user = self.service.current_user(request)
        state = scope.setdefault("state", {})
        state["user"] = user
        if path not in PUBLIC_PATHS and user is None:
            await error_response(401, "authentication_required", "请先登录")(scope, receive, private_send)
            return
        expected_account = request.headers.get("x-account-id")
        if (
            path not in PUBLIC_PATHS
            and user is not None
            and expected_account is not None
            and expected_account != user["id"]
        ):
            # Browser cookies change across all tabs before their storage events run.
            # A stale tab must not submit its previous account's draft into the new one.
            await error_response(409, "account_changed", "账号已切换，请重新打开页面")(
                scope, receive, private_send
            )
            return
        tenants = getattr(request.app.state, "tenants", None)
        admin_request = path == "/api/admin" or path.startswith("/api/admin/")
        if user is not None and tenants is not None and not admin_request:
            state["runtime"] = tenants.for_user(user)
        await self.app(scope, receive, private_send)


def require_admin(request: Request) -> dict | None:
    """Restrict platform administration and shared settings to administrators."""
    user = getattr(request.state, "user", None)
    # Small router-only unit apps have no authentication service. Production installs
    # this service before serving any route, so there is no unauthenticated bypass.
    if user is None and not hasattr(request.app.state, "auth"):
        return None
    if not user or not user.get("is_admin"):
        raise ApiError(403, "admin_required", "此设置仅限管理员访问")
    return user


def request_secure(request: Request) -> bool:
    return request.url.scheme == "https" or os.environ.get("AMC_FORCE_SECURE_COOKIE") == "1"


def _set_session(response: Response, request: Request, token: str) -> None:
    # Retire private media cached by the former single-user UI. Keep the new
    # session cookie and the frontend's explicit storage/account boundary intact.
    response.headers["Clear-Site-Data"] = '"cache"'
    response.set_cookie(
        COOKIE,
        token,
        max_age=SESSION_TTL,
        httponly=True,
        samesite="lax",
        secure=request_secure(request),
        path="/",
    )


def install(app):
    svc = Service(app.state.paths.data_dir)
    app.state.auth = svc
    app.add_middleware(AuthenticationMiddleware, service=svc)
    router = APIRouter(prefix="/api/auth")

    @router.get("/status")
    def auth_status(request: Request):
        return {"user": request.state.user, "setup_required": svc.setup_required()}

    @router.post("/code")
    def send_code():
        raise ApiError(410, "code_login_disabled", "验证码登录已停用，请使用邮箱和密码")

    @router.post("/register", status_code=201)
    def register(body: AuthBody, request: Request, response: Response):
        result = svc.register(body.email, body.password, request)
        _set_session(response, request, result["token"])
        return {"user": result["user"]}

    @router.post("/login")
    def login(body: AuthBody, request: Request, response: Response):
        result = svc.login(body.email, body.password, request)
        _set_session(response, request, result["token"])
        return {"user": result["user"]}

    @router.post("/logout")
    def logout(request: Request, response: Response):
        token = request.cookies.get(COOKIE)
        if token:
            svc.logout(token)
        response.delete_cookie(
            COOKIE, path="/", httponly=True, samesite="lax", secure=request_secure(request)
        )
        response.headers["Clear-Site-Data"] = '"cache"'
        return {"ok": True}

    app.include_router(router)
