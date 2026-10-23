"""A refinement is a new job: preserve the source, hum input, and version family."""

import pytest

from yue2_studio import jobs

BASE = {"title": "First idea", "style": "soft piano", "lyrics": "[Verse]\nMorning light", "seed": 42}


@pytest.fixture
def store(tmp_path):
    value = jobs.JobStore(tmp_path / "app.db", tmp_path / "songs")
    yield value
    value.close()


def create(store, *, parent=None, **params):
    return jobs.submit(store, {"kind": "create", "params": {**BASE, **params},
                               "parent_id": parent}).jobs[0]


@pytest.mark.parametrize("status", ["done", "failed", "cancelled"])
def test_revision_preserves_source_and_inherits_options(store, monkeypatch, status):
    parent = jobs.submit(store, {
        "kind": "create", "params": BASE, "preset": "custom", "precision": "4bit", "ode_steps": 12,
        "loras": [{"name": "piano", "scale": 0.7}],
    }, lora_lookup=lambda name: True).jobs[0]
    store.update_status(parent.id, status)
    song_dir = store.songs_dir / parent.id
    song_dir.mkdir(parents=True)
    audio = song_dir / "audio.flac"
    audio.write_bytes(b"original audio")
    before = store.get(parent.id).to_api()
    monkeypatch.setattr(jobs, "random_seed", lambda: 9001)

    revised = jobs.submit(store, {
        "kind": "create", "parent_id": parent.id,
        "params": {**BASE, "title": "Warmer idea", "style": "warm acoustic guitar", "seed": None},
    }, lora_lookup=lambda name: True).jobs[0]

    assert revised.id != parent.id and revised.parent_id == parent.id
    assert revised.kind == "create" and revised.status == "queued"
    assert (revised.preset, revised.precision, revised.ode_steps) == ("custom", "4bit", 12)
    assert revised.loras == parent.loras and revised.seed == 9001
    assert revised.params["style"] == "warm acoustic guitar"
    assert store.get(parent.id).to_api() == before
    assert audio.read_bytes() == b"original audio"


def test_hum_revision_retains_original_upload_and_melody_controls(store):
    params = {**BASE, "upload_id": "my-hum", "melody": "continue", "adapter": "my-adapter",
              "hum_influence": 0.8, "offset_s": 1.5, "cfg_scale": 2.5}
    lookups = []

    def lookup(upload_id):
        lookups.append(upload_id)
        return {"filename": "my-hum.wav"}

    options = {"upload_lookup": lookup, "hum_adapter_lookup": lambda name: name == "my-adapter"}
    parent = jobs.submit(store, {"kind": "hum", "params": params}, **options).jobs[0]
    store.update_status(parent.id, "done")
    child = jobs.submit(store, {"kind": "hum", "parent_id": parent.id,
                               "params": {**params, "style": "gentle piano", "seed": None}},
                        **options).jobs[0]

    assert child.parent_id == parent.id and child.kind == "hum"
    assert lookups == ["my-hum", "my-hum"]
    for field in ("upload_id", "melody", "adapter", "hum_influence", "offset_s", "cfg_scale"):
        assert child.params[field] == parent.params[field]
    assert jobs.hum_options(child) == jobs.hum_options(parent)
    assert jobs.engine_request(child)["cot"] == "melody"


@pytest.mark.parametrize("change", ["kind", "upload"])
def test_hum_revision_cannot_drop_or_replace_source(store, change):
    params = {**BASE, "upload_id": "my-hum"}
    lookup = lambda uid: {"filename": "hum.wav"}  # noqa: E731
    parent = jobs.submit(store, {"kind": "hum", "params": params}, upload_lookup=lookup).jobs[0]
    store.update_status(parent.id, "done")
    body = {"kind": "hum", "parent_id": parent.id, "params": dict(params)}
    if change == "kind":
        body["kind"] = "create"
    else:
        body["params"]["upload_id"] = "another-hum"
    with pytest.raises(jobs.ValidationFailure):
        jobs.submit(store, body, upload_lookup=lookup)
    assert store.list()[1] == 1


@pytest.mark.parametrize("status", ["queued", "running"])
def test_active_parent_cannot_be_refined(store, status):
    parent = create(store)
    store.update_status(parent.id, status)
    with pytest.raises(jobs.Conflict):
        create(store, parent=parent.id)
    assert store.list()[1] == 1


def test_missing_parent_and_invalid_parent_contract_create_nothing(store):
    with pytest.raises(jobs.NotFound):
        create(store, parent="missing")
    for parent in ("", "   ", 12):
        with pytest.raises(jobs.ValidationFailure):
            create(store, parent=parent)
    with pytest.raises(jobs.ValidationFailure):
        jobs.validate_submit({"kind": "regenerate", "parent_id": "unsupported",
                              "params": {"parent_id": "legacy", "abc": "X:1\nK:C\nC|"}})
    assert store.list()[1] == 0


def test_versions_include_legacy_and_branches_in_creation_order(store):
    original = create(store)
    store.update_status(original.id, "done")
    first = create(store, parent=original.id)
    store.update_status(first.id, "failed")
    second = create(store, parent=first.id)
    legacy = jobs.submit(store, {"kind": "regenerate", "params": {
        "parent_id": original.id, "abc": "X:1\nK:C\nC|"}}).jobs[0]
    create(store, title="Unrelated song")
    expected = [original.id, first.id, second.id, legacy.id]
    for current in expected:
        versions, total = store.versions(current)
        assert total == 4 and [job.id for job in versions] == expected
    versions, total = store.versions(second.id, limit=2, offset=1)
    assert total == 4 and [job.id for job in versions] == expected[1:3]


def test_deleted_original_keeps_surviving_siblings_connected(store):
    original = create(store)
    store.update_status(original.id, "done")
    first = create(store, parent=original.id)
    second = create(store, parent=original.id)
    store.delete(original.id)
    versions, total = store.versions(first.id)
    assert total == 2 and [job.id for job in versions] == [first.id, second.id]
    with pytest.raises(jobs.NotFound):
        store.versions(original.id)


async def test_versions_http_contract_and_refinement_submission(client, api):
    parent = await api.create()
    await api.wait(parent["id"])
    response = await client.post("/api/jobs", json={
        "kind": "create", "parent_id": parent["id"], "params": {**BASE, "style": "warm piano"},
    })
    assert response.status_code == 201
    child = response.json()["job"]
    assert child["parent_id"] == parent["id"] and child["kind"] == "create"
    response = await client.get(f"/api/jobs/{child['id']}/versions")
    assert response.status_code == 200
    assert response.json()["total"] == 2
    assert [job["id"] for job in response.json()["jobs"]] == [parent["id"], child["id"]]
    assert (await client.get("/api/jobs/missing/versions")).status_code == 404
    for query in ("limit=0", "limit=501", "offset=-1"):
        assert (await client.get(f"/api/jobs/{parent['id']}/versions?{query}")).status_code == 400
    await api.wait(child["id"])
