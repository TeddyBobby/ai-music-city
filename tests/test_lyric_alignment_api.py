"""Alignment lifecycle tests with synthetic audio and a tiny subprocess, no model."""
import asyncio
import sys
import threading
from types import SimpleNamespace

import httpx
import numpy as np
import pytest
import soundfile as sf
from fastapi import FastAPI

from yue2_studio.api import install_error_handlers
from yue2_studio.jobs import NotFound
from yue2_studio.lyric_alignment_api import router
from yue2_studio.lyric_alignment_service import (
    LyricAlignmentService,
    validate_result,
)


class Songs:
    lyrics = "[Verse]\n第一句\n第二句"

    def get(self, job_id):
        if job_id == "missing":
            raise NotFound(job_id)
        return SimpleNamespace(id=job_id, status="running" if job_id == "running" else "done",
                               params={"lyrics": "[Intro]" if job_id == "instrumental" else self.lyrics})


class Maintenance:
    def __init__(self):
        self.tasks = {}

    def submit_maintenance(self, key, callback):
        if key in self.tasks:
            return False
        self.tasks[key] = (callback, threading.Event())
        return True

    def cancel_maintenance(self, key):
        if key in self.tasks:
            self.tasks[key][1].set()

    def run(self, job_id="song"):
        callback, cancelled = self.tasks["lyrics:" + job_id]
        try:
            callback(cancelled.is_set)
        finally:
            self.tasks.pop("lyrics:" + job_id, None)


@pytest.fixture
async def setup(tmp_path, monkeypatch):
    monkeypatch.setattr("yue2_studio.lyric_alignment_service.psutil.virtual_memory",
                        lambda: SimpleNamespace(available=4 * 1024**3))
    paths = SimpleNamespace(songs_dir=tmp_path / "songs")
    for job_id in ("song", "running", "instrumental"):
        directory = paths.songs_dir / job_id / "song"
        directory.mkdir(parents=True)
        sf.write(directory / "audio.flac", np.zeros(8000 * 4), 8000)
    script = tmp_path / "aligner.py"
    script.write_text('''import argparse, json
p=argparse.ArgumentParser()
p.add_argument('--audio'); p.add_argument('--lyrics'); p.add_argument('--output')
a=p.parse_args()
assert json.load(open(a.lyrics))['lyrics']
json.dump({'status':'ready','source':'audio','lines':[
  {'text':'第一句','at':0.4,'end':1.1}, {'text':'第二句','at':2.1,'end':3.5}]},open(a.output,'w'))
''', encoding="utf-8")
    app = FastAPI()
    app.state.store, app.state.worker, app.state.paths = Songs(), Maintenance(), paths
    service = LyricAlignmentService(paths, app.state.store, app.state.worker,
                                    command=[sys.executable, str(script)])
    app.state.lyric_alignment = service
    install_error_handlers(app)
    app.include_router(router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://127.0.0.1:8765") as client:
        yield service, client, app, script
    service.close()


async def test_get_is_read_only_and_post_deduplicates_and_persists(setup):
    service, client, app, _ = setup
    url = "/api/jobs/song/lyrics-alignment"
    assert (await client.get(url)).json()["status"] == "idle"
    assert not app.state.worker.tasks
    for _ in range(2):
        response = await client.post(url)
        assert response.status_code == 202
        assert response.json()["status"] == "queued"
    assert len(app.state.worker.tasks) == 1
    await asyncio.to_thread(app.state.worker.run)
    result = (await client.get(url)).json()
    assert result["status"] == "ready"
    assert result["lines"][0] == {"text": "第一句", "at": 0.4, "end": 1.1}
    assert result["matched_lines"] == result["total_lines"] == 2
    assert "fingerprint" not in result
    assert (app.state.paths.songs_dir / "song/alignment/lyrics.json").is_file()
    recreated = LyricAlignmentService(app.state.paths, app.state.store, app.state.worker)
    assert recreated.get("song") == result
    assert (await client.post(url)).json()["status"] == "ready"
    assert not app.state.worker.tasks


async def test_changed_lyrics_and_audio_never_reuse_old_lines(setup):
    service, _, app, _ = setup
    service.start("song")
    await asyncio.to_thread(app.state.worker.run)
    old = app.state.store.lyrics
    app.state.store.lyrics += "\n第三句"
    assert service.get("song")["status"] == "idle"
    assert service.get("song")["lines"] == []
    app.state.store.lyrics = old
    audio = app.state.paths.songs_dir / "song/song/audio.flac"
    sf.write(audio, np.zeros(8000 * 5), 8000)
    assert service.get("song")["lines"] == []


@pytest.mark.parametrize("job_id,status", [("missing", 404), ("running", 409),
                                          ("no_audio", 409), ("instrumental", 400)])
async def test_invalid_source_rejected(setup, job_id, status):
    _, client, _, _ = setup
    for method in (client.get, client.post):
        assert (await method(f"/api/jobs/{job_id}/lyrics-alignment")).status_code == status


async def test_origin_and_symlink_guard(setup, tmp_path):
    _, client, app, _ = setup
    url = "/api/jobs/song/lyrics-alignment"
    assert (await client.post(url, headers={"origin": "https://example.com"})).status_code == 403
    assert (await client.get(url, headers={"host": "example.com"})).status_code == 403
    path = app.state.paths.songs_dir / "song/song/audio.flac"
    external = tmp_path / "external.flac"
    path.replace(external)
    path.symlink_to(external)
    assert (await client.post(url)).status_code == 404


async def test_recovery_and_close_leave_no_running_state(setup):
    service, _, app, _ = setup
    service.start("song")
    recreated = LyricAlignmentService(app.state.paths, app.state.store, app.state.worker)
    assert recreated.get("song")["status"] == "idle"
    service.close()
    assert service.get("song")["status"] == "idle"
    assert app.state.worker.tasks["lyrics:song"][1].is_set()


async def test_close_terminates_subprocess_without_model(setup):
    service, _, app, script = setup
    script.write_text("import time\ntime.sleep(60)\n")
    service.start("song")
    task = asyncio.create_task(asyncio.to_thread(app.state.worker.run))
    for _ in range(100):
        if service._process is not None:
            break
        await asyncio.sleep(.01)
    process = service._process
    assert process is not None
    await asyncio.to_thread(service.close)
    await asyncio.wait_for(task, 4)
    assert process.poll() is not None
    assert service.get("song")["status"] == "idle"


async def test_deleted_song_not_resurrected(setup):
    import shutil
    service, _, app, _ = setup
    service.start("song")
    shutil.rmtree(app.state.paths.songs_dir / "song")
    await asyncio.to_thread(app.state.worker.run)
    assert not (app.state.paths.songs_dir / "song").exists()


async def test_low_memory_refuses_model_load(setup, monkeypatch):
    service, _, app, _ = setup
    monkeypatch.setattr("yue2_studio.lyric_alignment_service.psutil.virtual_memory",
                        lambda: SimpleNamespace(available=512 * 1024**2))
    service.start("song")
    await asyncio.to_thread(app.state.worker.run)
    assert service.get("song")["status"] == "failed"
    assert service._process is None


async def test_unavailable_never_schedules_or_unloads_generation(setup, monkeypatch):
    service, client, app, _ = setup
    monkeypatch.setattr(service, "_available", lambda: False)
    url = "/api/jobs/song/lyrics-alignment"
    assert (await client.get(url)).json()["status"] == "unavailable"
    assert (await client.post(url)).json()["status"] == "unavailable"
    assert not app.state.worker.tasks


def test_result_validation_preserves_unmatched_lines_and_rejects_fake_timestamps():
    result = validate_result({"status": "ready", "lines": [
        {"text": "第一句", "at": .3, "end": .8}, {"text": "没有唱", "at": None}]}, 2)
    assert result["matched_lines"] == 1 and result["lines"][1]["at"] is None
    for value in (float("nan"), float("inf"), -1, 8, True):
        with pytest.raises(ValueError):
            validate_result({"status": "ready", "lines": [{"text": "一句", "at": value}]}, 2)
    with pytest.raises(ValueError):
        validate_result({"status": "ready", "lines": [
            {"text": "先", "at": 1}, {"text": "后", "at": .5}]}, 2)


async def test_factory_mounts_alignment_before_static(client):
    response = await client.get("/api/jobs/missing/lyrics-alignment")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
