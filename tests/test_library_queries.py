"""Library music-type filtering and duration summaries before pagination."""
import json

import httpx
import pytest

from yue2_studio import config, jobs
from yue2_studio.jobs import JobStore

ADAPTERS = ["ar_lora_inst_v3abc.bf16", "nar_lora_joint_v4.bf16"]


@pytest.fixture
def library_store(tmp_path):
    store = JobStore(tmp_path / "library.db", tmp_path / "songs")
    yield store
    store.close()


def add_song(store, *, instrumental=False, seconds=None, status="done", lyrics=None, style=None, loras=None):
    item = store.create(
        kind="create",
        params={"title": "Library fixture", "lyrics": lyrics if lyrics is not None else ("[Intro]" if instrumental else "[verse]\nTwo lines\nOf lyrics"),
                "style": style or ("温暖钢琴纯音乐" if instrumental else "warm pop vocal")},
        options=config.resolve_preset("fast", loras=tuple(loras or ())), seed=42,
    )
    store.update_status(item.id, status)
    store.set_timing(item.id, {"audio_seconds": seconds} if seconds is not None else None,
                     audio_seconds=seconds)
    return item.id


@pytest.mark.parametrize("style,lyrics,loras,expected", [
    ("gentle piano", "[Intro]", ADAPTERS, "instrumental"),
    ("gentle piano", "Words remain", [{"name": name} for name in ADAPTERS], "instrumental"),
    ("gentle piano", "[Intro]", [[name, 1] for name in ADAPTERS], "instrumental"),
    ("gentle piano", "[Intro]", [{"name": ADAPTERS[0], "scale": None}, {"name": ADAPTERS[1]}], "instrumental"),
    ("gentle piano", "[Intro]", [{"name": ADAPTERS[0], "scale": 0}, {"name": ADAPTERS[1]}], "vocal"),
    ("钢琴纯音乐", "[Intro]\n[Outro]", None, "instrumental"),
    ("轻柔，无人声", "", None, "instrumental"),
    ("piano INSTRUMENTAL", "[Intro]", None, "instrumental"),
    ("Piano, without vocals", "[Intro]", None, "instrumental"),
    ("不要做成纯音乐", "[Intro]", None, "vocal"),
    ("非纯音乐", "[Intro]", None, "vocal"),
    ("not an instrumental", "[Intro]", None, "vocal"),
    ("non-instrumental", "[Intro]", None, "vocal"),
    ("钢琴纯音乐", "[verse]\n风吹过海边", None, "vocal"),
    ("gentle piano", "[Intro]", None, "vocal"),
])
def test_stored_music_type_matches_existing_library_rules(style, lyrics, loras, expected):
    assert jobs.stored_music_kind(json.dumps({"style": style, "lyrics": lyrics}),
                                  json.dumps(loras) if loras is not None else None) == expected


def test_filter_and_summary_find_matches_beyond_first_page_without_hydrating_all_jobs(library_store, monkeypatch):
    store = library_store
    instrumentals = [add_song(store, instrumental=True, seconds=10 + index) for index in range(5)]
    for _ in range(45):
        add_song(store, seconds=2)
    add_song(store, instrumental=True, seconds=999, status="failed")
    hydrated = []
    original = store._row_to_job

    def hydrate(row):
        hydrated.append(row["id"])
        return original(row)

    monkeypatch.setattr(store, "_row_to_job", hydrate)
    page, total, summary = store.list(status="done", music_kind="instrumental", limit=2, offset=2, summary=True)
    assert [item.id for item in page] == list(reversed(instrumentals))[2:4]
    assert total == 5 and summary == {"audio_seconds": 60.0}
    assert hydrated == [item.id for item in page]
    page, total, summary = store.list(status="done", music_kind="instrumental", limit=2, offset=99, summary=True)
    assert page == [] and total == 5 and summary == {"audio_seconds": 60.0}
    page, total, summary = store.list(status="done", music_kind="vocal", limit=1, summary=True)
    assert len(page) == 1 and total == 45 and summary == {"audio_seconds": 90.0}
    assert len(store.list(status="done", limit=1)) == 2  # Existing callers retain the tuple contract.


def test_duration_summary_uses_legacy_timing_and_ignores_unknown_invalid_durations(library_store):
    store = library_store
    add_song(store, seconds=2.5)
    legacy = add_song(store)
    store.set_timing(legacy, {"audio_seconds": 4.25})
    add_song(store)
    add_song(store, seconds=-3)
    add_song(store, seconds=float("inf"))
    _, total, summary = store.list(status="done", summary=True)
    assert total == 5 and summary == {"audio_seconds": 6.75}
    assert store.list(status="failed", summary=True) == ([], 0, {"audio_seconds": 0.0})


def test_legacy_lora_json_and_missing_adapter_columns_remain_filterable(library_store):
    store = library_store
    old_pair = add_song(store, style="piano", lyrics="[Intro]", seconds=3)
    with store._lock:
        store._conn.execute("UPDATE jobs SET loras_json=? WHERE id=?", (json.dumps(ADAPTERS), old_pair))
    page, total, summary = store.list(music_kind="instrumental", summary=True)
    assert [item.id for item in page] == [old_pair]
    assert total == 1 and summary == {"audio_seconds": 3.0}
    legacy_prompt = add_song(store, instrumental=True, seconds=4)
    # Simulate an old database that predates adapter storage, then apply the existing migration.
    with store._lock:
        store._conn.execute("ALTER TABLE jobs DROP COLUMN loras_json")
    reopened = JobStore(store.db_path)
    try:
        page, total, summary = reopened.list(music_kind="instrumental", summary=True)
        assert [item.id for item in page] == [legacy_prompt]
        assert total == 1 and summary == {"audio_seconds": 4.0}
    finally:
        reopened.close()


async def test_jobs_api_optional_summary_and_combined_music_filter(app, client):
    store = app.state.store
    first = add_song(store, instrumental=True, seconds=12.5)
    second = add_song(store, instrumental=True, seconds=7.25)
    add_song(store, seconds=80)
    add_song(store, instrumental=True, seconds=200, status="failed")
    response = await client.get("/api/jobs", params={"status": "done", "music_kind": "instrumental", "summary": "true", "limit": 1, "offset": 1})
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"jobs", "total", "summary"}
    assert [item["id"] for item in body["jobs"]] == [first]
    assert body["total"] == 2 and body["summary"] == {"audio_seconds": 19.75}
    default = (await client.get("/api/jobs", params={"status": "done"})).json()
    assert set(default) == {"jobs", "total"} and default["total"] == 3
    assert (await client.get("/api/jobs?music_kind=invalid")).status_code == 400
    assert (await client.get("/api/jobs?music_kind=vocal,instrumental")).status_code == 400
    empty = (await client.get("/api/jobs?status=queued&summary=true&music_kind=vocal")).json()
    assert empty == {"jobs": [], "total": 0, "summary": {"audio_seconds": 0.0}}


async def test_jobs_filter_and_summary_do_not_include_another_accounts_rows(app, client):
    owner_id = add_song(app.state.store, instrumental=True, seconds=130)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1") as other:
        response = await other.post("/api/auth/register", json={"email": "library-other@example.test", "password": "library-test-password-42"})
        assert response.status_code == 201
        user = response.json()["user"]
        own_store = app.state.tenants.for_user(user).store
        other_id = add_song(own_store, instrumental=True, seconds=6)
        add_song(own_store, seconds=70)
        own = (await other.get("/api/jobs?status=done&music_kind=instrumental&summary=true")).json()
        assert own["total"] == 1 and own["summary"] == {"audio_seconds": 6.0}
        assert [item["id"] for item in own["jobs"]] == [other_id]
        owner = (await client.get("/api/jobs?status=done&music_kind=instrumental&summary=true")).json()
        assert owner["total"] == 1 and owner["summary"] == {"audio_seconds": 130.0}
        assert [item["id"] for item in owner["jobs"]] == [owner_id]
