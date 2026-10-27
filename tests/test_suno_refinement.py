"""Suno refinement controls survive validation, storage and the engine boundary."""

import pytest

from yue2_studio import engines, jobs

BASE = {"title": "夜里的光", "style": "warm jazz", "lyrics": "[Verse]\n灯还亮着"}
CONTROLS = {
    "model": "V6_MINI", "negativeTags": "heavy metal", "vocalGender": "f",
    "styleWeight": 0, "weirdnessConstraint": 0.45, "audioWeight": 1,
    "variety": 0, "duration": 120, "personaId": "persona-example", "personaModel": "voice_persona",
}


@pytest.fixture(autouse=True)
def isolated_engine_registry(monkeypatch):
    # App startup registers engines globally; do not leak it into other worker tests.
    monkeypatch.setattr(engines, "_ENGINES", {})
    monkeypatch.setattr(engines, "_ACTIVE", None)


@pytest.fixture
def store(tmp_path):
    value = jobs.JobStore(tmp_path / "app.db", tmp_path / "songs")
    yield value
    value.close()


@pytest.mark.parametrize("kind", ["create", "hum", "cover"])
def test_controls_and_music_kind_survive_database_and_cloud_request(store, kind):
    params = {**BASE, "music_kind": "vocal", "suno": CONTROLS}
    if kind != "create":
        params["upload_id"] = "source-recording"
    if kind == "hum":
        params["description"] = "保留哼唱的旋律"
    job = jobs.submit(store, {"kind": kind, "params": params},
                      upload_lookup=lambda _: {"filename": "humming.wav"}).jobs[0]
    stored = store.get(job.id)
    request = jobs.engine_request(stored, engine="suno")
    assert stored.params["suno"] == CONTROLS
    assert request["suno"] == CONTROLS
    assert request["title"] == BASE["title"]
    assert request["music_kind"] == "vocal"
    if kind == "hum":
        assert request["description"] == "保留哼唱的旋律"
        assert stored.params["upload_id"] == "source-recording"
    # The native YuE2 request rejects provider-specific keyword arguments.
    local = jobs.engine_request(stored)
    assert not {"suno", "title", "music_kind"} & local.keys()


def test_empty_explicit_settings_survive_for_custom_mode_without_invented_defaults(store):
    job = jobs.submit(store, {"kind": "create", "params": {
        **BASE, "suno": {"model": " ", "negativeTags": None, "styleWeight": ""},
    }}).jobs[0]
    assert store.get(job.id).params["suno"] == {}
    assert jobs.engine_request(job, engine="suno")["suno"] == {}


def test_custom_instrumental_can_use_empty_lyrics(store):
    job = jobs.submit(store, {"kind": "create", "params": {
        "title": "Rain", "style": "soft piano", "lyrics": "", "music_kind": "instrumental", "suno": {},
    }}).jobs[0]
    assert job.params["lyrics"] == ""
    assert jobs.engine_request(job, engine="suno")["music_kind"] == "instrumental"


def test_revision_keeps_source_immutable_and_records_changed_controls(store):
    parent = jobs.submit(store, {"kind": "create", "params": {**BASE, "suno": CONTROLS}}).jobs[0]
    store.update_status(parent.id, "done")
    before = store.get(parent.id).to_api()
    changed = {**CONTROLS, "styleWeight": 1, "weirdnessConstraint": 0}
    child = jobs.submit(store, {"kind": "create", "parent_id": parent.id,
                                "params": {**BASE, "suno": changed}}).jobs[0]
    assert child.parent_id == parent.id
    assert jobs.engine_request(store.get(child.id), engine="suno")["suno"] == changed
    assert store.get(parent.id).to_api() == before


def test_variations_and_legacy_regeneration_keep_cloud_controls(store):
    params = {**BASE, "music_kind": "vocal", "suno": CONTROLS}
    parent = jobs.submit(store, {"kind": "create", "params": params}).jobs[0]
    batch = jobs.submit(store, {"kind": "variations", "params": {"count": 2, "base": params}}).jobs
    revision = jobs.submit(store, {"kind": "regenerate", "params": {
        "parent_id": parent.id, "abc": "X:1\nK:C\nC|",
    }}).jobs[0]
    for job in [*batch, revision]:
        assert jobs.engine_request(job, engine="suno")["suno"] == CONTROLS
        assert job.params["music_kind"] == "vocal"
    cleared = jobs.submit(store, {"kind": "regenerate", "params": {
        "parent_id": parent.id, "abc": "X:1\nK:C\nC|", "suno": {},
    }}).jobs[0]
    assert cleared.params["suno"] == {}


@pytest.mark.parametrize("controls", [
    {"model": "invented"}, {"vocalGender": "anything"}, {"personaModel": "other"},
    {"styleWeight": -0.01}, {"styleWeight": 1.01}, {"styleWeight": 0.125},
    {"styleWeight": True}, {"weirdnessConstraint": float("nan")}, {"audioWeight": "0.5"},
    {"variety": -1}, {"variety": 5}, {"variety": 1.2}, {"variety": True},
    {"duration": 9}, {"duration": 361}, {"duration": 20.5},
    {"negativeTags": "a" * 1001}, {"misspelled": 1},
])
def test_invalid_controls_rejected_before_storage(store, controls):
    with pytest.raises(jobs.ValidationFailure):
        jobs.submit(store, {"kind": "create", "params": {**BASE, "suno": controls}})
    assert store.list()[1] == 0


@pytest.mark.parametrize("field,limit", [("title", 80), ("style", 1000), ("lyrics", 5000)])
def test_custom_text_limits_rejected_before_storage(store, field, limit):
    with pytest.raises(jobs.ValidationFailure):
        jobs.submit(store, {"kind": "create", "params": {**BASE, "suno": {}, field: "a" * (limit + 1)}})
    assert store.list()[1] == 0


async def test_status_exposes_active_generation_engine(client, monkeypatch):
    monkeypatch.setattr("yue2_studio.engines.current_id", lambda: "suno")
    response = await client.get("/api/status")
    assert response.status_code == 200
    assert response.json()["generation"] == {"engine": "suno"}
