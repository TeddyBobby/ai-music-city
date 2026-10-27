"""Administrator reads stay inside registered accounts without creating tenant services."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from yue2_studio import admin_api, auth_api
from yue2_studio.api import install_error_handlers
from yue2_studio.jobs import SCHEMA

OWNER, MEMBER, EMPTY, ORPHAN = ("a" * 32, "b" * 32, "c" * 32, "d" * 32)
OWNER_TOKEN, MEMBER_TOKEN = "owner-private-session", "member-private-session"


def make_app(home):
    app = FastAPI()
    app.state.paths = SimpleNamespace(data_dir=home / "data")
    app.state.engine, app.state.fake = SimpleNamespace(), True
    install_error_handlers(app)
    auth_api.install(app)
    timestamp = int(time.time())
    with app.state.auth.db() as db:
        for index, (uid, email, admin, legacy) in enumerate(
            [
                (OWNER, "owner@example.com", 1, 1),
                (MEMBER, "member@example.com", 0, 0),
                (EMPTY, "empty@example.com", 0, 0),
            ]
        ):
            db.execute(
                """INSERT INTO users(id,email,created_at,last_login,password_hash,is_admin,legacy_owner)
                VALUES (?,?,?,?,?,?,?)""",
                (uid, email, timestamp + index, timestamp, "private-password-digest", admin, legacy),
            )
        # The abandoned pre-password identity is not a registered account.
        db.execute(
            "INSERT INTO users(id,email,created_at,password_hash) VALUES (?,?,?,NULL)",
            ("stale-demo", "stale@example.com", timestamp),
        )
        for token, uid in ((OWNER_TOKEN, OWNER), (MEMBER_TOKEN, MEMBER)):
            db.execute(
                "INSERT INTO sessions VALUES (?,?,?,?)",
                (hashlib.sha256(token.encode()).hexdigest(), uid, timestamp, timestamp + 3600),
            )

    def no_runtime(user):
        raise AssertionError("Admin reads must not construct any tenant runtime")

    app.state.tenants = SimpleNamespace(for_user=no_runtime)
    admin_api.install(app)
    return app


def client_for(app, token=OWNER_TOKEN):
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://127.0.0.1")
    if token:
        client.cookies.set(auth_api.COOKIE, token)
    return client


def put_job(
    base,
    job_id,
    *,
    title="测试音乐",
    status="done",
    seconds=None,
    timing=None,
    params=None,
    seq=1,
    payload=None,
    loras=None,
    error=None,
    progress=None,
):
    base.mkdir(parents=True, exist_ok=True)
    values = {"title": title, "style": "温暖民谣", "lyrics": "[verse]\n海风吹过", **(params or {})}
    with sqlite3.connect(base / "app.db") as db:
        db.executescript(SCHEMA)
        db.execute(
            """INSERT INTO jobs(id,kind,status,params_json,preset,precision,ode_steps,seed,
            created_at,started_at,finished_at,error,timing_json,audio_seconds,progress_json,seq,loras_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                job_id,
                "create",
                status,
                json.dumps(values),
                "fast",
                "4bit",
                8,
                42,
                f"2026-10-27T08:00:{seq:02d}Z",
                None,
                None,
                error,
                json.dumps(timing) if timing else None,
                seconds,
                json.dumps(progress) if progress else None,
                seq,
                json.dumps(loras) if loras else None,
            ),
        )
    if payload is not None:
        path = base / "songs" / job_id / "song" / "audio.flac"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)


@pytest.fixture
def setup(tmp_path):
    app = make_app(tmp_path)
    root = app.state.paths.data_dir
    put_job(root, "owner-done", seconds=10, payload=b"fLaC-owner-audio")
    put_job(root, "owner-failed", status="failed", seconds=999, seq=2)
    tenant = root / "users" / MEMBER
    put_job(
        tenant,
        "member-done",
        title="Forest Light",
        timing={"audio_seconds": 20.5},
        seq=3,
        params={"music_kind": "instrumental", "lyrics": "[Intro]"},
        payload=b"fLaC-member-audio",
    )
    put_job(tenant, "member-queued", status="queued", seq=4)
    put_job(tenant, "member-running", status="running", seq=5)
    put_job(tenant, "member-cancelled", status="cancelled", seq=6)
    put_job(root / "users" / ORPHAN, "orphan-song", seconds=500, payload=b"not-registered")
    # The owner is mapped to legacy data even when a same-id subdirectory exists.
    put_job(root / "users" / OWNER, "wrong-owner-folder", seconds=800)
    return app, root


async def test_admin_auth_guards_all_endpoints_and_does_not_create_runtime(setup):
    app, root = setup
    paths = [
        "/api/admin/overview",
        "/api/admin/users",
        "/api/admin/jobs",
        f"/api/admin/users/{MEMBER}",
        f"/api/admin/users/{MEMBER}/jobs",
        f"/api/admin/users/{MEMBER}/jobs/member-done/audio",
    ]
    async with (
        client_for(app, None) as anonymous,
        client_for(app, MEMBER_TOKEN) as member,
        client_for(app) as owner,
    ):
        for path in paths:
            assert (await anonymous.get(path)).status_code == 401
            assert (await member.get(path)).status_code == 403
            assert (await owner.get(path)).status_code == 200
        assert (await owner.get("/api/admin/overview", headers={"X-Account-Id": MEMBER})).status_code == 409
    assert not (root / "users" / EMPTY).exists()


async def test_overview_counts_registered_tenants_and_legacy_owner(setup):
    app, _ = setup
    async with client_for(app) as client:
        result = (await client.get("/api/admin/overview")).json()
        assert result["users_total"] == 3
        assert result["sessions_active"] == result["users_active_1d"] == result["users_active_7d"] == 2
        assert result["jobs_total"] == 6 and result["songs_total"] == 2
        assert result["audio_seconds"] == 30.5
        assert result["job_totals"] == {"done": 2, "failed": 1, "running": 1, "queued": 1, "cancelled": 1}
        assert result["fake"] and result["engine"] == "SimpleNamespace"
        old = (await client.get("/api/admin/jobs")).json()
        assert old["totals"] == result["job_totals"]
        assert {user["user"] for user in old["per_user"]} == {OWNER, MEMBER}


async def test_user_search_paging_detail_and_zero_record_account(setup):
    app, root = setup
    async with client_for(app) as client:
        page = (await client.get("/api/admin/users?limit=1&offset=1")).json()
        assert page["total"] == 3 and [user["id"] for user in page["users"]] == [MEMBER]
        search = (await client.get("/api/admin/users", params={"q": "MEMBER@"})).json()
        assert search["total"] == 1 and search["users"][0]["stats"]["jobs_total"] == 4
        assert (await client.get("/api/admin/users", params={"q": "%"})).json()["total"] == 0
        owner = (await client.get(f"/api/admin/users/{OWNER}")).json()["user"]
        assert owner["legacy_owner"] and owner["stats"]["done"] == 1 and owner["stats"]["failed"] == 1
        empty = (await client.get(f"/api/admin/users/{EMPTY}")).json()["user"]
        assert empty["stats"]["jobs_total"] == 0 and empty["stats"]["audio_seconds"] == 0
        assert empty["stats"]["last_created_at"] is None
        assert (await client.get(f"/api/admin/users/{EMPTY}/jobs")).json() == {"jobs": [], "total": 0}
        assert (await client.get(f"/api/admin/users/{ORPHAN}")).status_code == 404
        assert (await client.get("/api/admin/users?limit=0")).status_code == 400
        assert (await client.get("/api/admin/users?offset=-1")).status_code == 400
    assert not (root / "users" / EMPTY).exists()


async def test_job_filter_paging_and_safe_dto(setup):
    app, root = setup
    put_job(
        root / "users" / MEMBER,
        "private-metadata",
        status="failed",
        seq=7,
        params={
            "title": "Secret-free song",
            "api_key": "do-not-return-this-key",
            "session": "do-not-return-session",
            "nested": {"password": "hidden"},
            "language": "zh",
        },
        error="API_KEY=do-not-return-error-key authorization: Bearer do-not-return-token",
        progress={"stage": "synthesize", "completed": 4, "total": 8, "api_key": "progress-secret"},
    )
    async with client_for(app) as client:
        endpoint = f"/api/admin/users/{MEMBER}/jobs"
        page = (await client.get(endpoint, params={"limit": 2, "offset": 1})).json()
        assert page["total"] == 5 and [job["id"] for job in page["jobs"]] == [
            "member-cancelled",
            "member-running",
        ]
        filtered = (
            await client.get(endpoint, params={"q": "FOREST", "status": "done", "music_kind": "instrumental"})
        ).json()
        assert filtered["total"] == 1
        job = filtered["jobs"][0]
        assert job["timing"] == {"audio_seconds": 20.5} and job["music_kind"] == "instrumental"
        assert job["audio_url"] == f"{endpoint}/member-done/audio"
        assert job["download_url"] == job["audio_url"] + "?download=1"
        assert (await client.get(endpoint, params={"music_kind": "vocal", "status": "done"})).json()[
            "total"
        ] == 0
        result = await client.get(endpoint, params={"q": "Secret-free"})
        assert result.status_code == 200
        assert "do-not-return" not in result.text and "progress-secret" not in result.text
        private = result.json()["jobs"][0]
        assert private["params"]["language"] == "zh" and "api_key" not in private["params"]
        assert private["progress"] == {"stage": "synthesize", "completed": 4, "total": 8}
        assert private["audio_url"] is None and "[redacted]" in private["error"]
        assert (await client.get(endpoint, params={"status": "unknown"})).status_code == 400
        assert (await client.get(endpoint, params={"music_kind": "unknown"})).status_code == 400
        users = await client.get("/api/admin/users")
        assert "private-password-digest" not in users.text and OWNER_TOKEN not in users.text
        assert "password_hash" not in users.text and "token_hash" not in users.text


async def test_audio_is_owned_completed_and_supports_range_and_download(setup):
    app, root = setup
    put_job(root, "shared-id", payload=b"fLaC-owner-shared")
    put_job(root / "users" / MEMBER, "shared-id", payload=b"fLaC-member-shared")
    put_job(root / "users" / MEMBER, "unfinished", status="running", payload=b"fLaC-incomplete")
    async with client_for(app) as client:
        endpoint = f"/api/admin/users/{MEMBER}/jobs/shared-id/audio"
        assert (await client.get(endpoint)).content == b"fLaC-member-shared"
        assert (
            await client.get(f"/api/admin/users/{OWNER}/jobs/shared-id/audio")
        ).content == b"fLaC-owner-shared"
        response = await client.get(endpoint, headers={"Range": "bytes=0-3"})
        assert response.status_code == 206 and response.content == b"fLaC"
        assert response.headers["content-range"] == "bytes 0-3/18"
        assert response.headers["cache-control"] == "no-store"
        assert (await client.head(endpoint)).status_code == 200
        response = await client.get(endpoint + "?download=1")
        assert "attachment;" in response.headers["content-disposition"]
        assert (await client.get(f"/api/admin/users/{MEMBER}/jobs/owner-done/audio")).status_code == 404
        assert (await client.get(f"/api/admin/users/{MEMBER}/jobs/unfinished/audio")).status_code == 404
        assert (await client.get(f"/api/admin/users/{ORPHAN}/jobs/orphan-song/audio")).status_code == 404
        assert (
            await client.get(f"/api/admin/users/{MEMBER}/jobs/%2e%2e%2fowner-done/audio")
        ).status_code == 404


@pytest.mark.parametrize("link_kind", ["audio", "song", "songs", "tenant", "database"])
async def test_symlinks_cannot_escape_or_alias_another_account(tmp_path, link_kind):
    app = make_app(tmp_path)
    root = app.state.paths.data_dir
    tenant = root / "users" / MEMBER
    put_job(root, "shared-id", seconds=99, payload=b"legacy-private-audio")
    put_job(tenant, "shared-id", seconds=5)
    audio = tenant / "songs" / "shared-id" / "song" / "audio.flac"
    if link_kind == "audio":
        audio.parent.mkdir(parents=True)
        audio.symlink_to(root / "songs/shared-id/song/audio.flac")
    elif link_kind == "song":
        audio.parent.parent.mkdir(parents=True)
        audio.parent.symlink_to(root / "songs/shared-id/song", target_is_directory=True)
    elif link_kind == "songs":
        (tenant / "songs").symlink_to(root / "songs", target_is_directory=True)
    elif link_kind == "tenant":
        (tenant / "app.db").unlink()
        tenant.rmdir()
        tenant.symlink_to(root, target_is_directory=True)
    else:
        (tenant / "app.db").unlink()
        (tenant / "app.db").symlink_to(root / "app.db")
    async with client_for(app) as client:
        endpoint = f"/api/admin/users/{MEMBER}/jobs"
        result = (await client.get(endpoint)).json()
        assert all(job["audio_url"] is None for job in result["jobs"])
        assert (await client.get(endpoint + "/shared-id/audio")).status_code == 404
        if link_kind in ("tenant", "database"):
            assert result["total"] == 0


async def test_multiple_apps_do_not_reuse_first_apps_routes_or_data(tmp_path):
    first, second = make_app(tmp_path / "first"), make_app(tmp_path / "second")
    put_job(first.state.paths.data_dir, "first-song", seconds=7)
    put_job(second.state.paths.data_dir, "second-song", seconds=11)
    put_job(second.state.paths.data_dir, "another-song", seconds=13)
    async with client_for(first) as one, client_for(second) as two:
        assert (await one.get("/api/admin/overview")).json()["audio_seconds"] == 7
        assert (await two.get("/api/admin/overview")).json()["audio_seconds"] == 24
        assert (await one.get("/api/admin/overview")).json()["jobs_total"] == 1
        assert (await two.get("/api/admin/overview")).json()["jobs_total"] == 2


async def test_reads_do_not_create_files_or_follow_nonopaque_account_ids(setup):
    app, root = setup
    bad_id = "invalid-account-id"
    with app.state.auth.db() as db:
        db.execute(
            """INSERT INTO users(id,email,created_at,password_hash,is_admin,legacy_owner)
                      VALUES (?,?,1,?,0,0)""",
            (bad_id, "invalid@example.com", "password-digest"),
        )
    put_job(root / "users" / bad_id, "must-not-read", seconds=1000)

    def snapshot():
        return {
            str(path.relative_to(root)): (path.stat().st_size, path.stat().st_mtime_ns)
            for path in root.rglob("*")
            if path.is_file()
        }

    before = snapshot()
    async with client_for(app) as client:
        result = (await client.get("/api/admin/overview")).json()
        assert result["jobs_total"] == 6 and result["audio_seconds"] == 30.5
        assert (await client.get(f"/api/admin/users/{bad_id}/jobs")).json() == {"jobs": [], "total": 0}
        assert (await client.get(f"/api/admin/users/{EMPTY}/jobs")).json() == {"jobs": [], "total": 0}
        assert (await client.get("/api/admin/users")).status_code == 200
    assert snapshot() == before
