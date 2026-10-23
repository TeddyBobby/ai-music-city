"""Real authenticated requests must never cross account storage boundaries."""

import asyncio
import base64
import json

import httpx
import pytest

from yue2_studio import jobs
from yue2_studio.assistant_service import AssistantService

BASE = {"style": "gentle piano", "lyrics": "[Instrumental]", "title": "Private melody", "seed": 42}
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
)


@pytest.fixture
async def other(app, client):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
    ) as second:
        response = await second.post(
            "/api/auth/register",
            json={"email": "another@example.test", "password": "another-account-password-42"},
        )
        assert response.status_code in (200, 201), response.text
        yield second


async def test_private_jobs_versions_events_artifacts_and_reviews(client, other, api, app):
    first = await api.create(BASE)
    await api.wait(first["id"])
    jid = first["id"]
    assert (await client.get(f"/api/songs/{jid}/audio.flac")).status_code == 200
    assert (await other.get("/api/jobs")).json()["total"] == 0
    paths = [
        f"/api/jobs/{jid}",
        f"/api/jobs/{jid}/versions",
        f"/api/jobs/{jid}/events",
        f"/api/jobs/{jid}/lyrics-alignment",
        f"/api/reviews/{jid}",
        f"/api/reviews?ids={jid}",
        f"/api/assistant/covers?job_id={jid}",
        f"/api/assistant/covers/applied/{jid}",
        f"/api/plaza/songs/{jid}",
    ]
    paths += [
        f"/api/songs/{jid}/{artifact}"
        for artifact in (
            "audio.flac",
            "audio.mp3",
            "score.abc",
            "plan.json",
            "artifacts.zip",
            "transcription/score.abc",
            "hum/hum.abc",
            "hum.json",
        )
    ]
    for path in paths:
        response = await other.get(path)
        assert response.status_code == 404, (path, response.text)
        assert "no-store" in response.headers["cache-control"]
    assert (await other.head(f"/api/songs/{jid}/audio.flac")).status_code == 404
    for method, path, body in [
        ("PATCH", f"/api/jobs/{jid}", {"title": "Intruder"}),
        ("DELETE", f"/api/jobs/{jid}", None),
        ("POST", f"/api/jobs/{jid}/cancel", None),
        ("POST", f"/api/jobs/{jid}/lyrics-alignment", None),
        ("PUT", f"/api/reviews/{jid}/manual", {"score": 1.0}),
        ("POST", "/api/jobs", {"kind": "create", "params": BASE, "parent_id": jid}),
        ("POST", "/api/jobs", {"kind": "regenerate", "params": {"parent_id": jid, "abc": "X:1\nK:C\nC|"}}),
        ("POST", "/api/assistant/sessions", {"job_id": jid}),
        ("POST", "/api/assistant/covers", {"job_id": jid, "prompt": "Forest"}),
    ]:
        response = await other.request(method, path, json=body)
        assert response.status_code == 404, (method, path, response.text)
    assert (await client.get(f"/api/jobs/{jid}")).json()["job"]["params"]["title"] == BASE["title"]
    assert app.state.paths.songs_dir.joinpath(jid).is_dir()


async def test_projects_takes_and_uploads_are_private(client, other, api, app):
    job = await api.create(BASE)
    await api.wait(job["id"])
    project = (await client.post("/api/projects", json={"name": "Owner album"})).json()["project"]
    track = (await client.post(f"/api/projects/{project['id']}/tracks", json={"name": "Owner track"})).json()[
        "track"
    ]
    assert (
        await client.post(f"/api/tracks/{track['id']}/takes", json={"job_ids": [job["id"]]})
    ).status_code == 200
    assert (await other.get("/api/projects")).json()["projects"] == []
    for method, path, body in [
        ("GET", f"/api/projects/{project['id']}", None),
        ("GET", f"/api/projects/{project['id']}/album.zip", None),
        ("PATCH", f"/api/projects/{project['id']}", {"name": "Changed"}),
        ("DELETE", f"/api/projects/{project['id']}", None),
        ("POST", f"/api/projects/{project['id']}/tracks", {"name": "Another"}),
        ("GET", f"/api/tracks/{track['id']}", None),
        ("PATCH", f"/api/tracks/{track['id']}", {"name": "Changed"}),
        ("DELETE", f"/api/tracks/{track['id']}", None),
        ("DELETE", f"/api/takes/{job['id']}", None),
        ("PATCH", f"/api/takes/{job['id']}", {"note": "Changed"}),
    ]:
        response = await other.request(method, path, json=body)
        assert response.status_code == 404, (method, path, response.text)
    own_project = (await other.post("/api/projects", json={"name": "Second album"})).json()["project"]
    own_track = (
        await other.post(f"/api/projects/{own_project['id']}/tracks", json={"name": "Second track"})
    ).json()["track"]
    assert (
        await other.post(f"/api/tracks/{own_track['id']}/takes", json={"job_ids": [job["id"]]})
    ).status_code == 404
    upload = (
        await client.post("/api/upload", files={"file": ("private.wav", b"private audio", "audio/wav")})
    ).json()
    uid = upload["upload_id"]
    assert (await other.get("/api/uploads")).json()["uploads"] == []
    assert (await other.delete(f"/api/uploads/{uid}")).status_code == 404
    assert (
        await other.post("/api/jobs", json={"kind": "hum", "params": {**BASE, "upload_id": uid}})
    ).status_code == 404
    assert (await other.post("/api/uploads/prune", json={})).json()["deleted"] == 0
    assert app.state.paths.uploads_dir.joinpath(uid + ".wav").is_file()


async def test_assistant_messages_voice_and_covers_are_private(client, other, app):
    session = (await client.post("/api/assistant/sessions", json={"title": "Owner conversation"})).json()
    sid = session["id"]
    app.state.assistant.save_message(sid, "user", "Only the owner should see this")
    cid = app.state.assistant.save_cover(PNG, "Private cover", "fixture")["id"]
    aid = "a" * 32
    voice = app.state.assistant.audio_dir
    (voice / (aid + ".wav")).write_bytes(b"private audio")
    (voice / (aid + ".json")).write_text(json.dumps({"id": aid, "ext": "wav", "transcript": "Private words"}))
    assert (await other.get("/api/assistant/sessions")).json()["sessions"] == []
    assert (await other.get("/api/assistant/covers")).json()["covers"] == []
    for method, path, body in [
        ("GET", f"/api/assistant/sessions/{sid}", None),
        ("POST", f"/api/assistant/sessions/{sid}/messages", {"content": "Read their context"}),
        ("POST", f"/api/assistant/sessions/{sid}/stop", None),
        ("GET", f"/api/assistant/audio/{aid}", None),
        ("GET", f"/api/assistant/covers/{cid}/image", None),
    ]:
        response = await other.request(method, path, json=body)
        assert response.status_code == 404, (method, path, response.text)
    assert (await client.get(f"/api/assistant/audio/{aid}")).status_code == 200
    assert (await client.get(f"/api/assistant/covers/{cid}/image")).status_code == 200
    assert (await other.get("/api/assistant/config")).status_code == 200
    owner_config = (await client.get("/api/assistant/config")).json()
    assert (await other.put("/api/assistant/config", json={
        "hermes_base_url": "https://personal.example/v1", "hermes_api_key": "personal-test-key"
    })).status_code == 200
    assert (await client.get("/api/assistant/config")).json() == owner_config
    assert (await client.get("/api/assistant/config")).status_code == 200


async def test_settings_and_concurrent_jobs_remain_with_each_account(client, other, api):
    first_settings = (await client.get("/api/settings")).json()
    assert (await other.put("/api/settings", json={"theme": "dark"})).status_code == 200
    assert (await client.get("/api/settings")).json()["theme"] == first_settings["theme"]
    results = await asyncio.gather(
        client.post("/api/jobs", json={"kind": "create", "params": BASE}),
        other.post("/api/jobs", json={"kind": "create", "params": {**BASE, "title": "Other melody"}}),
    )
    assert all(result.status_code == 201 for result in results)
    first, second = [result.json()["job"]["id"] for result in results]
    await api.wait(first)
    for _ in range(100):
        item = (await other.get(f"/api/jobs/{second}")).json()["job"]
        if item["status"] in jobs.TERMINAL:
            break
        await asyncio.sleep(0.02)
    assert item["status"] == "done"
    assert {job["id"] for job in (await client.get("/api/jobs")).json()["jobs"]} == {first}
    assert {job["id"] for job in (await other.get("/api/jobs")).json()["jobs"]} == {second}
    await client.post("/api/auth/logout")
    assert (await client.get(f"/api/songs/{first}/audio.flac")).status_code == 401
    assert (await other.get(f"/api/songs/{second}/audio.flac")).status_code == 200


def test_server_fallback_shared_but_personal_overrides_and_history_are_private(tmp_path, monkeypatch):
    for name in ("AMC_ASSISTANT_BASE_URL", "AMC_ASSISTANT_MODEL", "AMC_ASSISTANT_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    owner = AssistantService(tmp_path / "owner")
    assert owner.config()["hermes_api_key"] == ""
    owner._save_config({**owner.server_config(), "hermes_base_url": "https://provider.example/v1",
                        "hermes_api_key": "server-secret"})
    other = AssistantService(tmp_path / "other", config_source=owner)
    assert other.config()["hermes_api_key"] == "server-secret"
    assert not other.settings_path.exists()
    assert other.audio_slots is owner.audio_slots
    assert other.voice_model_dir == owner.voice_model_dir
    assert other.audio_dir != owner.audio_dir
    owner.create_session("private")
    assert other.sessions() == []
    owner.update_config({"hermes_base_url": "https://personal.example/v1", "hermes_api_key": "owner-secret"})
    assert other.config()["hermes_api_key"] == "server-secret"
    assert owner.config()["hermes_api_key"] == "owner-secret"
    owner._save_config({**owner.server_config(), "hermes_api_key": "rotated-secret"})
    assert other.config()["hermes_api_key"] == "rotated-secret"
    assert owner.config()["hermes_api_key"] == "owner-secret"
