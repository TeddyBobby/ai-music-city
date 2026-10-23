"""Account boundary tests run against an isolated app and temporary credential DB."""

from __future__ import annotations

import asyncio
import hashlib
import sqlite3
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient

from yue2_studio import auth_api
from yue2_studio.api import install_error_handlers

PASSWORD = "a-private-password-2026"


def auth_app(tmp_path):
    app = FastAPI()
    app.state.paths = SimpleNamespace(data_dir=tmp_path)
    install_error_handlers(app)
    auth_api.install(app)
    app.state.tenants = SimpleNamespace(for_user=lambda user: SimpleNamespace(owner=user["id"]))

    @app.get("/api/private")
    def private(request: Request):
        return {"user": request.state.user, "owner": request.state.runtime.owner}

    @app.get("/api/songs/{song_id}/audio.flac")
    def media(song_id: str):
        return {"song_id": song_id}

    @app.post("/api/private")
    def private_write():
        return {"ok": True}

    @app.get("/api/admin")
    def admin(request: Request):
        auth_api.require_admin(request)
        return {"ok": True}

    return app


def client_for(app, *, peer="127.0.0.1", base_url="http://127.0.0.1"):
    return AsyncClient(transport=ASGITransport(app=app, client=(peer, 49152)), base_url=base_url)


async def register(client, email="owner@example.com"):
    return await client.post("/api/auth/register", json={"email": email, "password": PASSWORD})


@pytest.mark.asyncio
async def test_account_setup_session_logout_and_login(tmp_path):
    app = auth_app(tmp_path)
    async with client_for(app) as client:
        assert (await client.get("/api/auth/status")).json() == {"user": None, "setup_required": True}
        for path in ("/api/private", "/api/songs/known/audio.flac", "/openapi.json"):
            response = await client.get(path)
            assert response.status_code == 401
            assert response.headers["cache-control"] == "no-store"
        response = await register(client, "OWNER@example.com")
        assert response.status_code == 201
        assert response.headers["clear-site-data"] == '"cache"'
        owner = response.json()["user"]
        assert owner["email"] == "owner@example.com"
        assert owner["is_admin"] and owner["legacy_owner"]
        cookie = response.headers["set-cookie"]
        assert "HttpOnly" in cookie and "SameSite=lax" in cookie and "Path=/" in cookie
        assert "Secure" not in cookie
        token = client.cookies.get(auth_api.COOKIE)
        assert (await client.get("/api/private")).json() == {"user": owner, "owner": owner["id"]}
        assert (await client.get("/api/admin")).status_code == 200
        assert (await client.get("/api/auth/status")).json()["setup_required"] is False
        with app.state.auth.db() as db:
            stored = db.execute("SELECT * FROM users").fetchone()
            assert stored["password_hash"].startswith("scrypt$") and PASSWORD not in stored["password_hash"]
            assert db.execute("SELECT token_hash FROM sessions").fetchone()["token_hash"] != token
        logout = await client.post("/api/auth/logout")
        assert logout.status_code == 200
        assert logout.headers["clear-site-data"] == '"cache"'
        assert (await client.get("/api/private")).status_code == 401
        client.cookies.set(auth_api.COOKIE, token)
        assert (await client.get("/api/private")).status_code == 401
        client.cookies.clear()
        login = await client.post(
            "/api/auth/login", json={"email": "owner@example.com", "password": PASSWORD}
        )
        assert login.status_code == 200
        assert login.headers["clear-site-data"] == '"cache"'
        assert client.cookies.get(auth_api.COOKIE) != token
        assert app.state.auth.users() == [owner]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "peer,base_url,headers",
    [
        ("198.51.100.2", "http://127.0.0.1", {}),
        ("127.0.0.1", "http://music.example.com", {}),
        ("127.0.0.1", "http://127.0.0.1.evil.example", {}),
        ("127.0.0.1", "http://127.0.0.1", {"Forwarded": "for=127.0.0.1"}),
        ("127.0.0.1", "http://127.0.0.1", {"X-Forwarded-For": "127.0.0.1"}),
        ("127.0.0.1", "http://127.0.0.1", {"X-Forwarded-Proto": "https"}),
    ],
)
async def test_workspace_cannot_be_claimed_remotely_or_through_proxy(tmp_path, peer, base_url, headers):
    app = auth_app(tmp_path)
    async with client_for(app, peer=peer, base_url=base_url) as client:
        response = await client.post(
            "/api/auth/register", headers=headers, json={"email": "owner@example.com", "password": PASSWORD}
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "local_setup_required"
        assert app.state.auth.setup_required()
        assert app.state.auth.users() == []


@pytest.mark.asyncio
async def test_subsequent_remote_account_is_independent_nonadmin(tmp_path):
    app = auth_app(tmp_path)
    async with (
        client_for(app) as owner,
        client_for(app, peer="198.51.100.2", base_url="http://music.example.com") as guest,
    ):
        first = (await register(owner)).json()["user"]
        response = await register(guest, "guest@example.com")
        assert response.status_code == 201
        second = response.json()["user"]
        assert not second["is_admin"] and not second["legacy_owner"]
        assert second["id"] != first["id"]
        assert (await guest.get("/api/private")).json()["owner"] == second["id"]
        assert (await owner.get("/api/private")).json()["owner"] == first["id"]
        assert (await guest.get("/api/admin")).status_code == 403
        assert (await register(guest, "owner@example.com")).status_code == 409


@pytest.mark.asyncio
async def test_concurrent_setup_assigns_exactly_one_legacy_owner(tmp_path):
    app = auth_app(tmp_path)
    async with client_for(app) as first, client_for(app) as second:
        responses = await asyncio.gather(
            register(first, "one@example.com"), register(second, "two@example.com")
        )
        assert [response.status_code for response in responses] == [201, 201]
        users = app.state.auth.users()
        assert sum(user["legacy_owner"] for user in users) == 1
        assert sum(user["is_admin"] for user in users) == 1


@pytest.mark.asyncio
async def test_demo_sessions_revoked_and_local_owner_can_reclaim_old_email(tmp_path):
    root = tmp_path / "auth"
    root.mkdir()
    token = "old-demo-session"
    with sqlite3.connect(root / "auth.db") as db:
        db.executescript("""
            CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
                created_at INTEGER NOT NULL, last_login INTEGER);
            CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
        """)
        db.execute("INSERT INTO users VALUES ('legacy','owner@example.com',1,1)")
        db.execute(
            "INSERT INTO sessions VALUES (?,?,?,?)",
            (hashlib.sha256(token.encode()).hexdigest(), "legacy", 1, auth_api.now() + 1000),
        )
    app = auth_app(tmp_path)
    async with client_for(app) as client:
        client.cookies.set(auth_api.COOKIE, token)
        assert (await client.get("/api/private")).status_code == 401
        assert (await client.post("/api/auth/code", json={"email": "owner@example.com"})).status_code == 410
        assert (
            await client.post("/api/auth/login", json={"email": "owner@example.com", "code": "123456"})
        ).status_code == 400
        login = await client.post(
            "/api/auth/login", json={"email": "owner@example.com", "password": PASSWORD}
        )
        assert login.status_code == 401
        assert app.state.auth.users() == []
        client.cookies.clear()
        user = (await register(client)).json()["user"]
        assert user["id"] == "legacy" and user["legacy_owner"]
        # Startup must retain real password sessions after the one-time migration.
        auth_api.Service(tmp_path)
        assert (await client.get("/api/private")).status_code == 200


@pytest.mark.asyncio
async def test_generic_login_failure_persists_rate_limit_across_service_restart(tmp_path):
    app = auth_app(tmp_path)
    async with client_for(app) as client:
        await register(client)
        await client.post("/api/auth/logout")
        wrong = {"email": "owner@example.com", "password": "wrong-password-value"}
        missing = {"email": "nobody@example.com", "password": "wrong-password-value"}
        known_response = await client.post("/api/auth/login", json=wrong)
        unknown_response = await client.post("/api/auth/login", json=missing)
        assert known_response.status_code == unknown_response.status_code == 401
        assert known_response.json() == unknown_response.json()
        for _ in range(9):
            assert (await client.post("/api/auth/login", json=wrong)).status_code == 401
        assert (await client.post("/api/auth/login", json=wrong)).status_code == 429
    reloaded = auth_app(tmp_path)
    async with client_for(reloaded) as client:
        assert (await client.post("/api/auth/login", json=wrong)).status_code == 429


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://evil.example"},
        {"Origin": "http://127.0.0.1:9000"},
        {"Origin": "null"},
        {"Sec-Fetch-Site": "cross-site"},
        {"Sec-Fetch-Site": "same-site"},
        {"Referer": "https://evil.example/attack"},
    ],
)
async def test_cross_origin_writes_are_denied_even_on_public_auth_routes(tmp_path, headers):
    app = auth_app(tmp_path)
    async with client_for(app) as client:
        response = await client.post(
            "/api/auth/register", headers=headers, json={"email": "owner@example.com", "password": PASSWORD}
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "cross_origin_request"
        await register(client)
        assert (await client.post("/api/private", headers=headers)).status_code == 403
        assert (await client.post("/api/auth/logout", headers=headers)).status_code == 403
        assert (await client.get("/api/private")).status_code == 200
        assert (await client.post("/api/private", headers={"Origin": "http://127.0.0.1"})).status_code == 200


@pytest.mark.asyncio
async def test_https_cookies_and_expired_or_tampered_sessions(tmp_path):
    app = auth_app(tmp_path)
    async with client_for(app, base_url="https://localhost") as client:
        response = await register(client)
        assert "Secure" in response.headers["set-cookie"]
        token = client.cookies.get(auth_api.COOKIE)
        with app.state.auth.db() as db:
            db.execute("UPDATE sessions SET expires_at=?", (auth_api.now(),))
        assert (await client.get("/api/private")).status_code == 401
        client.cookies.clear()
        client.cookies.set(auth_api.COOKIE, token + "tamper")
        assert (await client.get("/api/private")).status_code == 401
        logout = await client.post("/api/auth/logout")
        assert "Secure" in logout.headers["set-cookie"]
        assert "max-age=0" in logout.headers["set-cookie"].lower()


@pytest.mark.asyncio
@pytest.mark.parametrize("password", ["123456", "x" * 129])
async def test_password_length_bounds(tmp_path, password):
    app = auth_app(tmp_path)
    async with client_for(app) as client:
        response = await client.post(
            "/api/auth/register", json={"email": "owner@example.com", "password": password}
        )
        assert response.status_code == 400
        assert app.state.auth.setup_required()


def test_password_hashes_are_salted_and_verify_without_plaintext():
    first, second = auth_api.password_hash(PASSWORD), auth_api.password_hash(PASSWORD)
    assert first != second
    assert auth_api.password_matches(PASSWORD, first)
    assert not auth_api.password_matches("incorrect", first)
    assert not auth_api.password_matches(PASSWORD, "invalid-hash")


@pytest.mark.asyncio
async def test_stale_tab_account_binding_rejects_reads_and_writes(tmp_path):
    app = auth_app(tmp_path)
    async with client_for(app) as client:
        original = (await register(client)).json()["user"]
        second = (await register(client, "second@example.com")).json()["user"]
        stale_headers = {"X-Account-ID": original["id"]}
        for method in ("GET", "POST"):
            response = await client.request(method, "/api/private", headers=stale_headers)
            assert response.status_code == 409
            assert response.json()["error"]["code"] == "account_changed"
            assert response.headers["cache-control"] == "no-store"
        current = await client.get("/api/private", headers={"X-Account-ID": second["id"]})
        assert current.status_code == 200
        assert current.json()["owner"] == second["id"]
        # Authentication requests still need to discover a changed cookie identity.
        status = await client.get("/api/auth/status", headers=stale_headers)
        assert status.status_code == 200 and status.json()["user"]["id"] == second["id"]
