"""Verify Suno's actual HTTP payloads without submitting paid generations."""

import json

import httpx
import pytest

from yue2_studio import config, jobs
from yue2_studio.fake import FakeEngine
from yue2_studio.suno_engine import SunoEngine
from yue2_studio.worker import Worker

BASE = {"title": "夜里的光", "style": "warm jazz", "lyrics": "[Verse]\n灯还亮着", "music_kind": "vocal"}
OPTIONS = config.resolve_preset("fast")


@pytest.fixture
def cloud(monkeypatch, tmp_path):
    requests = []

    def receive(request):
        requests.append((request.url.path, json.loads(request.content)))
        if request.url.path == "/api/file-base64-upload":
            return httpx.Response(200, json={"code": 200, "data": {"downloadUrl": "https://files.test/hum.wav"}})
        if request.url.path in {"/api/v1/generate", "/api/v1/generate/upload-cover"}:
            assert request.headers["authorization"] == "Bearer test-suno-key"
            return httpx.Response(200, json={"code": 200, "data": {"taskId": "task-example"}})
        pytest.fail(f"Unexpected HTTP call: {request.method} {request.url}")

    real_client = httpx.Client
    transport = httpx.MockTransport(receive)
    monkeypatch.setattr("yue2_studio.suno_engine.httpx.Client",
                        lambda **kwargs: real_client(transport=transport, **kwargs))
    engine = SunoEngine(api_key="test-suno-key", base_url="https://suno.test")

    def finish_download(client, task_id, song_dir, cancelled, emit):
        assert task_id == "task-example"
        song_dir.mkdir(parents=True, exist_ok=True)
        audio = song_dir / "audio.flac"
        audio.write_bytes(b"mock generated audio")
        return audio

    monkeypatch.setattr(engine, "_poll_and_save", finish_download)
    monkeypatch.setattr(engine, "_finish_summary", lambda path, folder, options, request: {
        "audio_path": str(path), "sample_rate": 44100, "seconds": 30, "identity": "suno",
    })
    return engine, requests


def generated_request(requests):
    return [entry for entry in requests if entry[0].startswith("/api/v1/generate")][-1]


def test_custom_create_sends_lyrics_style_title_and_selected_controls(cloud, tmp_path):
    engine, calls = cloud
    controls = {"model": "V6_WILD", "negativeTags": "metal", "vocalGender": "f",
                "styleWeight": 0, "weirdnessConstraint": 1, "audioWeight": 0.5,
                "variety": 0, "duration": 120, "personaId": "p-example", "personaModel": "voice_persona"}
    engine.create_song({**BASE, "suno": controls}, tmp_path, options=OPTIONS)
    path, payload = generated_request(calls)
    assert path == "/api/v1/generate"
    assert payload == {"customMode": True, "instrumental": False, "callBackUrl": "https://music.myzai.top/s/ping",
                       "style": BASE["style"], "lyrics": BASE["lyrics"], "title": BASE["title"],
                       **controls}
    assert not {"prompt", "tags"} & payload.keys()


@pytest.mark.parametrize("controls", [{}, {"model": None, "styleWeight": None, "negativeTags": " "}])
def test_default_v6_and_unset_controls_are_omitted(cloud, tmp_path, controls):
    engine, calls = cloud
    engine.create_song({**BASE, "suno": controls}, tmp_path, options=OPTIONS)
    _, payload = generated_request(calls)
    assert payload["model"] == "V6"
    assert not {"styleWeight", "weirdnessConstraint", "audioWeight", "variety", "duration", "negativeTags"} & payload.keys()


@pytest.mark.parametrize("lyrics", ["[Intro]", "纯音乐", "actually old vocal lyrics"])
def test_instrumental_selection_overrides_stale_lyrics_and_vocal_controls(cloud, tmp_path, lyrics):
    engine, calls = cloud
    engine.create_song({**BASE, "music_kind": "instrumental", "lyrics": lyrics,
                        "suno": {"vocalGender": "m", "audioWeight": 0.5, "styleWeight": 0}},
                       tmp_path, options=OPTIONS)
    _, payload = generated_request(calls)
    assert payload["customMode"] is True and payload["instrumental"] is True
    assert payload["styleWeight"] == 0
    assert not {"lyrics", "prompt", "vocalGender", "audioWeight"} & payload.keys()


def test_legacy_intro_marker_is_instrumental(cloud, tmp_path):
    engine, calls = cloud
    engine.create_song({"style": "piano", "lyrics": "[Intro]"}, tmp_path, options=OPTIONS)
    assert generated_request(calls)[1]["instrumental"] is True


def test_image_reference_without_settings_keeps_existing_reference_mode(cloud, tmp_path):
    engine, calls = cloud
    engine.create_song({**BASE, "ref_image_url": "https://files.test/forest.png", "description": "林间光影"},
                       tmp_path, options=OPTIONS)
    _, payload = generated_request(calls)
    assert payload["customMode"] is False
    assert payload["imageUrls"] == ["https://files.test/forest.png"]
    assert payload["prompt"] == "林间光影"


def test_image_revision_custom_mode_uses_analyzed_style(cloud, tmp_path):
    engine, calls = cloud
    engine.create_song({**BASE, "suno": {}, "ref_image_url": "https://files.test/forest.png"},
                       tmp_path, options=OPTIONS)
    _, payload = generated_request(calls)
    assert payload["customMode"] is True
    assert payload["style"] == BASE["style"]
    assert "imageUrls" not in payload


@pytest.mark.parametrize("settings", [{}, {"audioWeight": 0, "styleWeight": 0.75, "variety": 0}])
def test_hum_revision_uploads_original_audio_and_uses_custom_cover(cloud, tmp_path, settings):
    engine, calls = cloud
    source = tmp_path / "my-hum.wav"
    source.write_bytes(b"original humming")
    engine.hum_song(source, tmp_path / "output", request={**BASE, "suno": settings}, hum=None, options=OPTIONS)
    assert calls[0][0] == "/api/file-base64-upload"
    assert calls[0][1]["fileName"] == "my-hum.wav"
    path, payload = generated_request(calls)
    assert path == "/api/v1/generate/upload-cover"
    assert payload["uploadUrl"] == "https://files.test/hum.wav"
    assert payload["lyrics"] == BASE["lyrics"]
    assert payload["style"] == BASE["style"]
    assert not {"customMode", "audioUrls", "prompt"} & payload.keys()
    for key, value in settings.items():
        assert payload[key] == value


def test_hum_without_custom_settings_keeps_reference_generation(cloud, tmp_path):
    engine, calls = cloud
    source = tmp_path / "original.wav"
    source.write_bytes(b"original")
    engine.hum_song(source, tmp_path / "output", request={**BASE, "description": "沿旋律编成爵士"},
                    hum=None, options=OPTIONS)
    path, payload = generated_request(calls)
    assert path == "/api/v1/generate"
    assert payload["customMode"] is False
    assert payload["audioUrls"] == ["https://files.test/hum.wav"]
    assert payload["prompt"] == "沿旋律编成爵士"


def test_instrumental_cover_keeps_audio_influence_and_uses_correct_endpoint(cloud, tmp_path):
    engine, calls = cloud
    source = tmp_path / "original.wav"
    source.write_bytes(b"original")
    engine.cover_song(source, tmp_path / "output", request={**BASE, "music_kind": "instrumental",
                      "suno": {"audioWeight": 0.7, "vocalGender": "f"}}, options=OPTIONS)
    path, payload = generated_request(calls)
    assert path == "/api/v1/generate/upload-cover"
    assert payload["instrumental"] is True
    assert payload["audioWeight"] == 0.7
    assert "vocalGender" not in payload and "lyrics" not in payload


@pytest.mark.parametrize("field,limit", [("title", 80), ("style", 1000), ("lyrics", 5000)])
def test_overlong_custom_text_is_not_silently_truncated_or_submitted(cloud, tmp_path, field, limit):
    engine, calls = cloud
    with pytest.raises(ValueError, match=str(limit)):
        engine.create_song({**BASE, field: "a" * (limit + 1), "suno": {}}, tmp_path, options=OPTIONS)
    assert calls == []


def test_persona_model_without_persona_is_not_sent(cloud, tmp_path):
    engine, calls = cloud
    engine.create_song({**BASE, "suno": {"personaModel": "voice_persona"}}, tmp_path, options=OPTIONS)
    assert "personaModel" not in generated_request(calls)[1]


def test_worker_passes_stored_controls_and_title_to_cloud_http_request(cloud, tmp_path, monkeypatch):
    engine, calls = cloud
    paths = config.paths_for(tmp_path / "workspace")
    paths.ensure_dirs()
    store = jobs.JobStore(paths.db_path, paths.songs_dir)
    monkeypatch.setattr("yue2_studio.engines.current", lambda: None)
    try:
        job = jobs.submit(store, {"kind": "create", "params": {**BASE, "suno": {"styleWeight": 0.25}}}).jobs[0]
        worker = Worker(store, engine, paths, fake=True)
        worker._run_job(job)
        assert store.get(job.id).status == "done", store.get(job.id).error
        payload = generated_request(calls)[1]
        assert payload["styleWeight"] == 0.25
        assert payload["title"] == BASE["title"]
        assert payload["lyrics"] == BASE["lyrics"]
    finally:
        store.close()


def test_queued_cloud_job_cannot_silently_run_on_a_changed_local_engine(tmp_path, monkeypatch):
    paths = config.paths_for(tmp_path / "workspace")
    paths.ensure_dirs()
    store = jobs.JobStore(paths.db_path, paths.songs_dir)
    engine = FakeEngine(delay=0)
    monkeypatch.setattr("yue2_studio.engines.current", lambda: None)
    try:
        job = jobs.submit(store, {"kind": "create", "params": {**BASE, "suno": {}}}).jobs[0]
        Worker(store, engine, paths, fake=True)._run_job(job)
        result = store.get(job.id)
        assert result.status == "failed"
        assert "需要 Suno" in result.error
        assert engine.state == "cold"
        assert not result.artifacts["audio"]
    finally:
        store.close()
