"""HTTP + SSE routes implementing ``docs/API.md``.

Handlers never touch the engine: they read/write the ``JobStore``, hand job ids to the ``Worker``
and stream events from the ``EventBus``. Shared objects live on ``app.state`` (``store``,
``worker``, ``bus``, ``paths``, ``fake``) and are installed by ``yue2_studio.main.create_app``.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse
from sse_starlette.sse import EventSourceResponse, ServerSentEvent
from starlette.background import BackgroundTask
from starlette.exceptions import HTTPException as StarletteHTTPException

from yue2_studio import __version__, assist, audio, config, jobs, lora, projects, uploads
from yue2_studio.assist import AssistError, AssistUnavailable
from yue2_studio.tenancy import runtime
from yue2_studio.jobs import Conflict, Job, JobStore, NotFound, ValidationFailure
from yue2_studio.worker import Worker

router = APIRouter(prefix="/api")

SSE_KEEPALIVE_SECONDS = 15
PLACEHOLDER_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>YuE2 Studio</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui, sans-serif; margin: 2rem; color: #333">
<h1>YuE2 Studio</h1>
<p>The web UI has not been built yet (<code>yue2_studio/static/index.html</code> is missing).</p>
<p>The API is available: <a href="/api/status">/api/status</a>.</p>
</body></html>
"""


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status_code)


_STATUS_CODES = {400: "validation_error", 404: "not_found", 405: "method_not_allowed", 409: "conflict",
                 413: "too_large", 503: "engine_unavailable"}


def install_error_handlers(app) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError):
        return error_response(exc.status_code, exc.code, exc.message)

    @app.exception_handler(ValidationFailure)
    async def _validation(request: Request, exc: ValidationFailure):
        return error_response(400, "validation_error", str(exc))

    @app.exception_handler(NotFound)
    async def _not_found(request: Request, exc: NotFound):
        return error_response(404, "not_found", str(exc))

    @app.exception_handler(Conflict)
    async def _conflict(request: Request, exc: Conflict):
        return error_response(409, "conflict", str(exc))

    @app.exception_handler(AssistUnavailable)
    async def _assist_unavailable(request: Request, exc: AssistUnavailable):
        return error_response(503, "assist_unavailable", "; ".join(exc.reasons))

    @app.exception_handler(AssistError)
    async def _assist_failed(request: Request, exc: AssistError):
        return error_response(502, "assist_failed", str(exc))

    @app.exception_handler(RequestValidationError)
    async def _request_validation(request: Request, exc: RequestValidationError):
        return error_response(400, "validation_error", _fmt(exc))

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        code = _STATUS_CODES.get(exc.status_code, "internal_error" if exc.status_code >= 500 else "error")
        detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail)
        return error_response(exc.status_code, code, detail)

    @app.exception_handler(Exception)
    async def _any(request: Request, exc: Exception):
        return error_response(500, "internal_error", f"{type(exc).__name__}: {exc}")


def _fmt(exc: RequestValidationError) -> str:
    parts = []
    for item in exc.errors():
        loc = ".".join(str(x) for x in item.get("loc", ())) or "body"
        parts.append(f"{loc}: {item.get('msg')}")
    return "; ".join(parts) or "invalid request"


# ---------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------


def _state(request: Request):
    return runtime(request)


def _store(request: Request) -> JobStore:
    return runtime(request).store


def _worker(request: Request) -> Worker:
    return runtime(request).worker


def describe(request: Request, job: Job) -> dict:
    """Job JSON with the latest real stage overlaid when no persisted progress exists."""
    if job.progress is None:
        bus = _worker(request).bus
        job.progress = bus.last_stage(job.id) or bus.last(job.id)
    return job.to_api()


def _get_job(request: Request, job_id: str) -> Job:
    try:
        return _store(request).get(job_id)
    except NotFound:
        raise ApiError(404, "not_found", f"job {job_id!r} not found") from None


def _song_dir(request: Request, job_id: str) -> Path:
    return Path(_state(request).paths.songs_dir) / job_id


upload_lookup = uploads.lookup  # (paths, upload_id) -> sidecar info | None


async def _json_body(request: Request) -> Any:
    try:
        return await request.json()
    except ValueError:
        raise ApiError(400, "validation_error", "request body must be valid JSON") from None


def _models_present(request: Request) -> bool:
    state = _state(request)
    if state.fake:
        return True
    engine_name = type(getattr(state, "engine", None)).__name__
    if engine_name == "ACEStepEngine":
        import os as _os

        from pathlib import Path as _Path

        checkpoint = _os.environ.get("AMC_ACESTEP_CHECKPOINTS") or "/home/teddy/projects/ACE-Step/checkpoints"
        return (_Path(checkpoint) / "ace_step_transformer" / "diffusion_pytorch_model.safetensors").is_file()
    if engine_name == "ACEStep15Engine":
        from pathlib import Path as _Path

        return (_Path("/home/teddy/projects/ACE-Step-1.5/checkpoints/acestep-v15-turbo")
                / "model.safetensors").is_file()
    if engine_name == "SunoEngine":
        return True  # cloud engine: presence checked at submit time via api key
    models = config.models_available(state.paths)
    return bool(models["converted"] and models["vae"])


def _cover_status(request: Request) -> dict:
    state = _state(request)
    if state.fake:
        return {"available": True, "reasons": []}
    info = config.cover_available(state.paths)
    reasons = []
    if not info["ffmpeg"]:
        reasons.append("ffmpeg not found on PATH")
    if not info["sheetsage2"]:
        reasons.append("SheetSage2 not downloaded")
    if not info["mert"]:
        reasons.append("MERT-v2-FullSong not downloaded")
    return {"available": info["available"], "reasons": reasons}


def _loras(request: Request) -> dict:
    return lora.summary(_state(request).paths.loras_dir)


def _hum_status(request: Request) -> dict:
    """Whether hum-to-song can run. Local engines need cover prerequisites + librosa;
    the Suno cloud engine only needs the API key (recording is uploaded as a reference)."""
    state = _state(request)
    adapters = [a.name for a in lora.list_hum_adapters(state.paths.loras_dir)]
    if state.fake:
        return {"available": True, "reasons": [], "adapters": adapters}
    # Cloud engine: hum runs as an audioUrls reference — no local models required.
    try:
        import yue2_studio.engines as _engines
        active = _engines.current_id()
    except Exception:
        active = None
    if active == "suno":
        ok = bool(os.environ.get("AMC_SUNO_API_KEY"))
        return {"available": ok, "reasons": [] if ok else ["Suno API key not configured"],
                "adapters": adapters, "engine": "suno"}
    info = config.hum_available(state.paths)
    reasons = []
    if not info["ffmpeg"]:
        reasons.append("ffmpeg not found on PATH")
    if not info["sheetsage2"]:
        reasons.append("SheetSage2 not downloaded")
    if not info["mert"]:
        reasons.append("MERT-v2-FullSong not downloaded")
    if not info["librosa"]:
        reasons.append("librosa not installed (run uv sync)")
    return {"available": info["available"], "reasons": reasons, "adapters": adapters}


def _hum_adapter_usable(request: Request, name: str) -> bool:
    try:
        lora.find_hum_adapter(_state(request).paths.loras_dir, name)
    except (OSError, ValueError):
        return False
    return True


def _lora_usable(request: Request, name: str) -> bool:
    try:
        lora.find_adapter(_state(request).paths.loras_dir, name)
    except (OSError, ValueError):
        return False
    return True


# ---------------------------------------------------------------------------------------------
# status / settings
# ---------------------------------------------------------------------------------------------


@router.get("/status")
async def get_status(request: Request):
    from yue2_studio.engines import current_id

    state = _state(request)
    store, worker = state.store, state.worker
    counts = store.counts()
    models = config.models_available(state.paths)
    settings = store.get_settings()
    return {
        "engine": worker.engine_status(),
        "generation": {"engine": current_id() or "local"},
        "memory": jobs.memory_info(settings),
        "queue": {"queued": counts.get("queued", 0), "running": store.running_id()},
        "presets": config.presets_summary(),
        "models": {"converted_dir": str(state.paths.converted_dir), "vae_dir": str(state.paths.vae_dir),
                   "present": _models_present(request), "precisions": models["precisions"],
                   "name": "YuE2-3B", "repository": config.MODEL_REPO,
                   "runtime": "fake" if state.fake else "MLX / Apple GPU",
                   "location": "local", "quantization_scope": "autoregressive",
                   "audio_decoder": config.VAE_REPO},
        "cover": _cover_status(request),
        "hum": _hum_status(request),
        "loras": _loras(request),
        "assist": assist.status(settings),
        "ffmpeg": audio.ffmpeg_path() is not None,
        "fake": bool(state.fake),
        "version": __version__,
    }


@router.get("/loras")
async def get_loras(request: Request):
    """Rescan ``models/loras`` (``.safetensors`` files and PEFT directories); never 503."""
    return _loras(request)


_SETTINGS_MEMORY_FIELDS = ("machine_ram_gib", "min_memory_budget_gib", "max_memory_budget_gib",
                           "low_memory_effective")


def _public_settings(settings: dict) -> dict:
    """``Settings`` as the API returns it: the API key never leaves the server, only whether one is
    stored (``status.assist.api_key`` is the one that also counts ``ANTHROPIC_API_KEY``). The read-only
    machine fields (RAM, budget range, resolved low-memory mode) are added for the Settings form."""
    public = {k: v for k, v in settings.items() if k != "anthropic_api_key"}
    public["has_api_key"] = bool(settings.get("anthropic_api_key"))
    memory = jobs.memory_info(settings)
    public.update({k: memory[k] for k in _SETTINGS_MEMORY_FIELDS})
    return public


@router.get("/settings")
async def get_settings(request: Request):
    return _public_settings(_store(request).get_settings())


@router.put("/settings")
async def put_settings(request: Request):
    """Partial update; ``anthropic_api_key`` absent = unchanged, ``""`` = cleared, text = saved."""
    body = await _json_body(request)
    if not isinstance(body, dict):
        raise ApiError(400, "validation_error", "settings body must be a JSON object")
    return _public_settings(_store(request).update_settings(body))


@router.get("/engines")
async def get_engines(request: Request):
    """Engine list + active engine. Every user may read (frontend selector)."""
    import yue2_studio.engines as engines
    info = engines.available()
    info["engine_status"] = _state(request).worker.engine_status()
    return info


@router.put("/engines")
async def put_engine(request: Request):
    """Switch the active engine (admin only)."""
    from yue2_studio.auth_api import require_admin
    require_admin(request)
    body = await _json_body(request)
    key = body.get("engine") if isinstance(body, dict) else None
    if not key:
        raise ApiError(400, "validation_error", "body must be {\"engine\": \"local\"|\"suno\"}")
    import yue2_studio.engines as engines
    try:
        engines.switch(key)
    except KeyError:
        raise ApiError(400, "validation_error", f"unknown engine: {key}") from None
    return engines.available()


# ---------------------------------------------------------------------------------------------
# assist ("Ask Claude")
# ---------------------------------------------------------------------------------------------


@router.post("/assist")
async def post_assist(request: Request):
    """Run the prompt through the resolved provider (blocking subprocess/HTTP, so off the loop);
    503 ``assist_unavailable`` / 502 ``assist_failed`` come from the exception handlers."""
    body = await _body(request, jobs.AssistBody)
    settings = _store(request).get_settings()
    result = await asyncio.to_thread(assist.assist, settings, prompt=body.prompt, page=body.page,
                                     context=body.context)
    return result.to_api()


@router.post("/assist/test")
async def post_assist_test(request: Request):
    settings = _store(request).get_settings()
    result = await asyncio.to_thread(assist.test, settings)
    return result.to_api()


# ---------------------------------------------------------------------------------------------
# jobs
# ---------------------------------------------------------------------------------------------


@router.post("/jobs", status_code=201)
async def post_jobs(request: Request):
    body = await _json_body(request)
    if not isinstance(body, dict):
        raise ApiError(400, "validation_error", "body must be a JSON object")
    jobs.validate_submit(body)  # 400 for malformed bodies before any availability check
    if not _models_present(request):
        raise ApiError(503, "engine_unavailable", "models are missing; run scripts/setup.py")
    if body.get("kind") == "cover":
        cover = _cover_status(request)
        if not cover["available"]:
            raise ApiError(409, "conflict", "cover is unavailable: " + "; ".join(cover["reasons"]))
    if body.get("kind") == "hum":
        hum_status = _hum_status(request)
        if not hum_status["available"]:
            raise ApiError(409, "conflict", "hum is unavailable: " + "; ".join(hum_status["reasons"]))
    state = _state(request)
    submission = jobs.submit(state.store, body, upload_lookup=lambda uid: upload_lookup(state.paths, uid),
                             lora_lookup=lambda name: _lora_usable(request, name),
                             hum_adapter_lookup=lambda name: _hum_adapter_usable(request, name))
    for job in submission.jobs:
        state.worker.submit(job.id)
    if submission.group is not None:
        # one query so queue positions are consistent across members; keep seed order
        rows, _ = state.store.list(group=submission.group["id"], limit=500)
        by_id = {j.id: j for j in rows}
        members = [describe(request, by_id[jid]) for jid in submission.group["job_ids"] if jid in by_id]
        return JSONResponse({"group": submission.group, "jobs": members}, status_code=201)
    return JSONResponse({"job": describe(request, state.store.get(submission.jobs[0].id))}, status_code=201)


def _csv(value: str | None, allowed: tuple[str, ...], name: str) -> list[str] | None:
    if not value:
        return None
    items = [v.strip() for v in value.split(",") if v.strip()]
    bad = [v for v in items if v not in allowed]
    if bad:
        raise ApiError(400, "validation_error", f"{name} must be one of {', '.join(allowed)}")
    return items or None


@router.get("/jobs")
async def list_jobs(request: Request, status: str | None = None, group: str | None = None,
                    kind: str | None = None, track: str | None = None, project: str | None = None,
                    limit: int = 50, offset: int = 0, music_kind: str | None = None,
                    summary: bool = False):
    statuses = _csv(status, jobs.STATUSES, "status")
    kinds = _csv(kind, jobs.KINDS, "kind")
    if limit < 1 or limit > 500 or offset < 0:
        raise ApiError(400, "validation_error", "limit must be 1..500 and offset >= 0")
    if music_kind and music_kind not in jobs.MUSIC_KINDS:
        raise ApiError(400, "validation_error", f"music_kind must be one of {', '.join(jobs.MUSIC_KINDS)}")
    result = _store(request).list(status=statuses, kind=kinds, group=group or None, track=track or None,
                                 project=project or None, limit=limit, offset=offset,
                                 music_kind=music_kind or None, summary=summary)
    items, total = result[:2]
    response = {"jobs": [describe(request, j) for j in items], "total": total}
    if summary:
        response["summary"] = result[2]
    return response


@router.get("/jobs/{job_id}")
async def get_job(request: Request, job_id: str):
    return {"job": describe(request, _get_job(request, job_id))}


@router.get("/jobs/{job_id}/versions")
async def job_versions(request: Request, job_id: str, limit: int = 100, offset: int = 0):
    if limit < 1 or limit > 500 or offset < 0:
        raise ApiError(400, "validation_error", "limit must be 1..500 and offset >= 0")
    items, total = _store(request).versions(job_id, limit=limit, offset=offset)
    return {"jobs": [describe(request, job) for job in items], "total": total}


@router.patch("/jobs/{job_id}")
async def patch_job(request: Request, job_id: str):
    body = await _body(request, jobs.JobPatch)
    if "title" not in body.model_fields_set:
        return {"job": describe(request, _get_job(request, job_id))}
    job = _store(request).set_title(job_id, body.title)
    await asyncio.to_thread(_retitle_job_json, _song_dir(request, job_id), body.title)
    return {"job": describe(request, job)}


def _retitle_job_json(song_dir: Path, title: str | None) -> None:
    """Keep the song folder's ``job.json`` (it ships in ``artifacts.zip``) in step with a rename."""
    path = song_dir / "job.json"
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return
    if isinstance(data, dict) and isinstance(data.get("params"), dict):
        data["params"]["title"] = title
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2))


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(request: Request, job_id: str):
    job = _get_job(request, job_id)
    worker = _worker(request)
    if job.status == "running":
        raise ApiError(409, "conflict", "cannot delete a running job; cancel it first")
    if job.status == "queued":
        worker.cancel(job_id)
        job = _get_job(request, job_id)
        if job.status == "running":
            raise ApiError(409, "conflict", "job started before it could be deleted; cancel it first")
    _store(request).delete(job_id)
    await asyncio.to_thread(worker.delete_song_dir, job_id)
    return Response(status_code=204)


@router.post("/jobs/batch-delete")
async def batch_delete_jobs(request: Request, body: dict):
    """删除多首歌曲：已完成/失败/取消的任务可删，运行中自动跳过（不报错）。"""
    ids = body.get("ids") or []
    if not isinstance(ids, list) or not ids or len(ids) > 200 or \
            any(not isinstance(i, str) or len(i) > 64 for i in ids):
        raise ApiError(400, "validation_error", "无效的任务 ID 列表")
    store = _store(request)
    worker = _worker(request)
    deleted, skipped = [], []
    for job_id in ids:
        try:
            job = store.get(job_id)
        except Exception:
            continue
        if job is None:
            continue
        if job.status == "running":
            skipped.append(job_id)
            continue
        if job.status == "queued":
            try:
                worker.cancel(job_id)
                job = store.get(job_id)
                if job and job.status == "running":
                    skipped.append(job_id)
                    continue
            except Exception:
                pass
        store.delete(job_id)
        await asyncio.to_thread(worker.delete_song_dir, job_id)
        deleted.append(job_id)
    return {"deleted": deleted, "skipped": skipped}


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(request: Request, job_id: str):
    job = _get_job(request, job_id)
    if job.terminal:
        raise ApiError(409, "conflict", f"job is already {job.status}")
    outcome = _worker(request).cancel(job_id)
    job = _get_job(request, job_id)
    if outcome is None:
        raise ApiError(409, "conflict", f"job is already {job.status}")
    code = 200 if outcome == "cancelled" else 202
    return JSONResponse({"job": describe(request, job)}, status_code=code)


def _sse_json(payload: dict) -> str:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def _frame(event: str, payload: dict) -> ServerSentEvent:
    return ServerSentEvent(data=_sse_json(payload), event=event, sep="\n")


@router.get("/jobs/{job_id}/events")
async def job_events(request: Request, job_id: str):
    store, worker = _store(request), _worker(request)
    _get_job(request, job_id)  # 404 before the stream starts
    bus = worker.bus

    async def stream():
        q = bus.subscribe(job_id)
        try:
            job = store.get(job_id)
            stage = None if job.terminal else bus.last_stage(job_id)
            last = job.progress if job.terminal else bus.last(job_id) or job.progress
            if stage is not None and stage != last:
                yield _frame("progress", stage)
            if last is not None:
                yield _frame("progress", last)
            if job.terminal:
                yield _frame("done", {"job": job.to_api()})
                return
            while True:
                kind, payload = await q.get()
                if kind == "progress":
                    yield _frame("progress", payload)
                else:
                    yield _frame("done", {"job": payload})
                    return
        except NotFound:
            return
        finally:
            bus.unsubscribe(job_id, q)

    return EventSourceResponse(
        stream(), ping=SSE_KEEPALIVE_SECONDS, sep="\n",
        ping_message_factory=lambda: ServerSentEvent(comment="keepalive", sep="\n"),
        headers={"Cache-Control": "no-cache"},
    )


# ---------------------------------------------------------------------------------------------
# song artifacts
# ---------------------------------------------------------------------------------------------


def _artifact(request: Request, job_id: str, *candidates: str) -> Path:
    _get_job(request, job_id)
    base = _song_dir(request, job_id)
    for rel in candidates:
        path = base / rel
        if path.is_file():
            return path
    raise ApiError(404, "not_found", f"{candidates[0]} is not available for job {job_id!r}")


@router.api_route("/songs/{job_id}/audio.flac", methods=["GET", "HEAD"])
async def song_audio_flac(request: Request, job_id: str):
    path = _artifact(request, job_id, "song/audio.flac")
    return FileResponse(path, media_type="audio/flac", filename=f"{job_id}.flac",
                        content_disposition_type="inline")


@router.api_route("/songs/{job_id}/audio.mp3", methods=["GET", "HEAD"])
async def song_audio_mp3(request: Request, job_id: str):
    flac = _artifact(request, job_id, "song/audio.flac")
    if audio.ffmpeg_path() is None:
        raise ApiError(503, "engine_unavailable", "ffmpeg is not installed; MP3 export unavailable")
    try:
        mp3 = await asyncio.to_thread(audio.transcode_mp3, flac)
    except audio.FfmpegMissing as error:
        raise ApiError(503, "engine_unavailable", str(error)) from None
    return FileResponse(mp3, media_type="audio/mpeg", filename=f"{job_id}.mp3",
                        content_disposition_type="inline")


@router.api_route("/songs/{job_id}/score.abc", methods=["GET", "HEAD"])
async def song_score(request: Request, job_id: str):
    path = _artifact(request, job_id, "song/score.abc", "plan/score.abc")
    return PlainTextResponse(path.read_text(encoding="utf-8"), media_type="text/plain; charset=utf-8")


@router.api_route("/songs/{job_id}/plan.json", methods=["GET", "HEAD"])
async def song_plan(request: Request, job_id: str):
    path = _artifact(request, job_id, "plan/plan.json", "song/plan.json")
    return Response(path.read_bytes(), media_type="application/json")


@router.api_route("/songs/{job_id}/transcription/score.abc", methods=["GET", "HEAD"])
async def song_transcription_score(request: Request, job_id: str):
    path = _artifact(request, job_id, "transcription/score.abc")
    return PlainTextResponse(path.read_text(encoding="utf-8"), media_type="text/plain; charset=utf-8")


@router.api_route("/songs/{job_id}/hum/hum.abc", methods=["GET", "HEAD"])
async def song_hum_score(request: Request, job_id: str):
    path = _artifact(request, job_id, "hum/hum.abc")
    return PlainTextResponse(path.read_text(encoding="utf-8"), media_type="text/plain; charset=utf-8")


@router.api_route("/songs/{job_id}/hum.json", methods=["GET", "HEAD"])
async def song_hum_json(request: Request, job_id: str):
    path = _artifact(request, job_id, "hum.json")
    return Response(path.read_bytes(), media_type="application/json")


@router.api_route("/songs/{job_id}/artifacts.zip", methods=["GET", "HEAD"])
async def song_artifacts_zip(request: Request, job_id: str):
    _get_job(request, job_id)
    song_dir = _song_dir(request, job_id)
    if not song_dir.is_dir() or not any(p.is_file() for p in song_dir.rglob("*")):
        raise ApiError(404, "not_found", f"no artifacts for job {job_id!r}")
    path = await asyncio.to_thread(audio.build_zip, song_dir)
    return FileResponse(path, media_type="application/zip", filename=f"{job_id}.zip",
                        content_disposition_type="attachment")


# ---------------------------------------------------------------------------------------------
# projects / tracks / takes
# ---------------------------------------------------------------------------------------------


def _track_json(request: Request, track: dict) -> dict:
    """Track dict from the store with its takes (and chosen take) as live Job JSON."""
    out = dict(track)
    out["takes"] = [describe(request, j) for j in track["takes"]]
    out["chosen"] = None if track["chosen"] is None else describe(request, track["chosen"])
    return out


def _project_json(request: Request, project: dict) -> dict:
    out = dict(project)
    out["tracks"] = [_track_json(request, t) for t in project["tracks"]]
    return out


async def _body(request: Request, model):
    body = await _json_body(request)
    if not isinstance(body, dict):
        raise ApiError(400, "validation_error", "body must be a JSON object")
    return jobs.parse(model, body)


@router.get("/projects")
async def list_projects(request: Request):
    return {"projects": _store(request).list_projects()}


@router.post("/projects", status_code=201)
async def post_project(request: Request):
    body = await _body(request, jobs.ProjectBody)
    project = _store(request).create_project(body.name, body.description)
    return JSONResponse({"project": _project_json(request, project)}, status_code=201)


@router.get("/projects/{project_id}")
async def get_project(request: Request, project_id: str):
    return {"project": _project_json(request, _store(request).get_project(project_id))}


@router.patch("/projects/{project_id}")
async def patch_project(request: Request, project_id: str):
    body = await _body(request, jobs.ProjectPatch)
    fields = {k: getattr(body, k) for k in body.model_fields_set if k in ("name", "description")}
    project = _store(request).update_project(project_id, **fields)
    return {"project": _project_json(request, project)}


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(request: Request, project_id: str):
    _store(request).delete_project(project_id)
    return Response(status_code=204)


@router.post("/projects/{project_id}/tracks", status_code=201)
async def post_track(request: Request, project_id: str):
    body = await _body(request, jobs.TrackBody)
    track = _store(request).create_track(project_id, body.name)
    return JSONResponse({"track": _track_json(request, track)}, status_code=201)


@router.put("/projects/{project_id}/order")
async def put_order(request: Request, project_id: str):
    body = await _body(request, jobs.OrderBody)
    project = _store(request).order_tracks(project_id, body.track_ids)
    return {"project": _project_json(request, project)}


@router.get("/projects/{project_id}/album.zip")
async def project_album_zip(request: Request, project_id: str, format: str = "flac"):
    """The chosen takes as ``<slug>/NN Name.<format>`` + ``tracklist.json``/``.md``, built fresh
    into a temp file that is removed once sent."""
    if format not in projects.FORMATS:
        raise ApiError(400, "validation_error", f"format must be one of {', '.join(projects.FORMATS)}")
    state = _state(request)
    project = state.store.get_project(project_id)
    if format == "mp3" and audio.ffmpeg_path() is None:
        raise ApiError(503, "engine_unavailable", "ffmpeg is not installed; MP3 export unavailable")
    try:
        path = await asyncio.to_thread(projects.build_album_zip, project, state.paths.songs_dir, fmt=format,
                                       dest_dir=state.paths.data_dir)
    except ValueError as error:
        raise ApiError(409, "conflict", str(error)) from None
    except audio.FfmpegMissing as error:
        raise ApiError(503, "engine_unavailable", str(error)) from None
    slug = projects.safe_name(project["name"], fallback="album")
    return FileResponse(path, media_type="application/zip", filename=f"{slug}.zip",
                        content_disposition_type="attachment", background=BackgroundTask(os.unlink, path))


@router.get("/tracks/{track_id}")
async def get_track(request: Request, track_id: str):
    track = _store(request).get_track(track_id)
    return {"track": _track_json(request, track),
            "project": {"id": track["project_id"], "name": track["project_name"]}}


@router.patch("/tracks/{track_id}")
async def patch_track(request: Request, track_id: str):
    body = await _body(request, jobs.TrackPatch)
    keys = ("name", "chosen_job_id", "position")
    fields = {k: getattr(body, k) for k in body.model_fields_set if k in keys}
    track = _store(request).update_track(track_id, **fields)
    return {"track": _track_json(request, track)}


@router.delete("/tracks/{track_id}", status_code=204)
async def delete_track(request: Request, track_id: str):
    _store(request).delete_track(track_id)
    return Response(status_code=204)


@router.post("/tracks/{track_id}/takes")
async def post_takes(request: Request, track_id: str):
    body = await _body(request, jobs.AttachBody)
    track = _store(request).attach_takes(track_id, body.job_ids, move=body.move)
    return {"track": _track_json(request, track)}


@router.delete("/takes/{job_id}", status_code=204)
async def delete_take(request: Request, job_id: str):
    _store(request).detach_take(job_id)
    return Response(status_code=204)


@router.patch("/takes/{job_id}")
async def patch_take(request: Request, job_id: str):
    body = await _body(request, jobs.TakePatch)
    fields = {k: getattr(body, k) for k in body.model_fields_set if k in ("thumb", "stars", "note")}
    job = _store(request).update_take(job_id, **fields)
    return {"job": describe(request, job)}


# ---------------------------------------------------------------------------------------------
# upload
# ---------------------------------------------------------------------------------------------


@router.post("/upload", status_code=201)
async def post_upload(request: Request, file: UploadFile | None = None):
    if file is None:
        raise ApiError(400, "validation_error", "multipart field 'file' is required")
    try:
        ext = audio.validate_upload_name(file.filename)
    except audio.BadUploadType as error:
        raise ApiError(400, "validation_error", str(error)) from None
    # Browsers always send Content-Length for FormData bodies, so oversize uploads are rejected up
    # front; a chunked request without it is only capped while being copied to data/uploads/ (see
    # API.md), after the multipart parser has spooled it to a temp file.
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > audio.UPLOAD_MAX_BYTES + 4096:
        raise ApiError(413, "too_large", "upload exceeds 200 MB")
    paths: config.Paths = _state(request).paths
    upload_id = uuid.uuid4().hex
    destination = paths.uploads_dir / f"{upload_id}.{ext}"
    try:
        size = await asyncio.to_thread(audio.save_upload, file.file, destination)
    except audio.UploadTooLarge as error:
        raise ApiError(413, "too_large", str(error)) from None
    finally:
        await file.close()
    if size == 0:
        destination.unlink(missing_ok=True)
        raise ApiError(400, "validation_error", "The uploaded file is empty (0 bytes) — if it lives in "
                       "iCloud/Dropbox, download it first")
    seconds = await asyncio.to_thread(audio.probe_duration, destination)
    # Without ffprobe the duration is simply unknown; with it, an unreadable file would only fail later
    # in the worker with an opaque ffmpeg exit status, so reject it here.
    if seconds is None and audio.ffprobe_path() is not None:
        destination.unlink(missing_ok=True)
        raise ApiError(400, "validation_error",
                       "ffmpeg could not read the uploaded audio (unsupported or corrupt file)")
    info = {"upload_id": upload_id, "filename": Path(file.filename or f"upload.{ext}").name, "ext": ext,
            "seconds": seconds, "size": size, "created_at": jobs.now_iso()}
    uploads.sidecar(paths, upload_id).write_text(json.dumps(info))
    return JSONResponse({"upload_id": upload_id, "filename": info["filename"], "seconds": seconds,
                         "path_hint": f"data/uploads/{upload_id}.{ext}"}, status_code=201)


@router.get("/uploads")
async def list_uploads(request: Request, unused: bool = False):
    """Every upload with its job counts, newest first; ``?unused=true`` keeps only unreferenced ones."""
    state = _state(request)
    items = await asyncio.to_thread(uploads.scan, state.paths, state.store)
    if unused:
        items = [u for u in items if u["jobs"]["total"] == 0]
    return {"uploads": items}


@router.delete("/uploads/{upload_id}", status_code=204)
async def delete_upload(request: Request, upload_id: str):
    state = _state(request)
    entry = await asyncio.to_thread(uploads.find, state.paths, state.store, upload_id)
    if entry is None:
        raise ApiError(404, "not_found", f"upload {upload_id!r} not found")
    if entry["jobs"]["active"]:
        raise ApiError(409, "in_use", f"upload {upload_id!r} is used by a queued or running job")
    await asyncio.to_thread(uploads.delete, state.paths, upload_id)
    return Response(status_code=204)


@router.post("/uploads/prune")
async def prune_uploads(request: Request):
    """Body ``{"unused": true, "older_than_days": N|null}``; in-use uploads are always skipped."""
    body = await _json_body(request)
    if not isinstance(body, dict):
        raise ApiError(400, "validation_error", "body must be a JSON object")
    unused = body.get("unused", True)
    days = body.get("older_than_days")
    if not isinstance(unused, bool):
        raise ApiError(400, "validation_error", "unused must be a boolean")
    if days is not None and (isinstance(days, bool) or not isinstance(days, int) or days < 1):
        raise ApiError(400, "validation_error", "older_than_days must be a positive integer or null")
    state = _state(request)
    return await asyncio.to_thread(uploads.prune, state.paths, state.store, unused=unused,
                                   older_than_days=days)


# ---------------------------------------------------------------------------------------------
# static / SPA fallback (registered last by create_app)
# ---------------------------------------------------------------------------------------------


def spa_response(static_dir: Path) -> HTMLResponse:
    index = Path(static_dir) / "dist" / "index.html"
    if not index.is_file():
        index = Path(static_dir) / "index.html"
    if index.is_file():
        # 入口 HTML 禁止缓存：JS/CSS 文件名带 hash 可以长缓存，但 HTML 必须每次
        # 与源站校验，否则发新版后边缘缓存的旧 HTML 会引用已删除的旧 bundle（404 白屏）。
        return HTMLResponse(index.read_text(encoding="utf-8"),
                            headers={"Cache-Control": "no-cache, must-revalidate"})
    return HTMLResponse(PLACEHOLDER_HTML)


class _LenientStaticFiles:
    """``StaticFiles`` that answers 404 (instead of raising) while the directory does not exist yet.

    Every response carries ``Cache-Control: no-cache`` so browsers revalidate the ES modules against
    their ETag on each load (cheap, local) instead of heuristically caching them for hours; without
    it a restarted server keeps serving a stale UI to tabs that already visited it.
    """

    def __new__(cls, directory: Path):
        from starlette.staticfiles import StaticFiles

        class Lenient(StaticFiles):
            async def check_config(self) -> None:
                if not Path(directory).is_dir():
                    return
                await super().check_config()

            async def get_response(self, path: str, scope):
                if not Path(directory).is_dir():
                    raise StarletteHTTPException(status_code=404)
                response = await super().get_response(path, scope)
                # Vite 产物带内容 hash（index-Ab12Cd.js）：文件名即指纹，可永久缓存。
                # 入口 HTML 由 spa_response 下发 no-cache，保证发版后 hash 更新立刻可见。
                # s-maxage 让 Cloudflare 边缘也缓存（家宽回源仅 ~80KB/s，880KB JS 走 CDN 后秒开）。
                if "/assets/" in path:
                    response.headers["Cache-Control"] = (
                        "public, max-age=31536000, s-maxage=2592000, immutable"
                    )
                else:
                    response.headers["Cache-Control"] = "no-cache"
                return response

        return Lenient(directory=str(directory), check_dir=False)


def install_static(app, static_dir: Path) -> None:
    static_dir = Path(static_dir)
    app.mount("/static", _LenientStaticFiles(static_dir), name="static")

    def _share_html(job) -> str:
        """OpenGraph 卡片页：微信/QQ/Telegram 等抓取链接时渲染为卡片。"""
        from html import escape
        title = (job.params.get("title") or job.params.get("style", "")[:40] or "未命名作品")
        style = (job.params.get("style") or "").strip()
        lyrics = (job.params.get("lyrics") or "").strip()
        summary = style if style and "纯音乐" not in style and "inst" not in style.lower() \
            else (style or "AI 生成的音乐作品")
        preview = lyrics.replace("\n", " / ")[:60] if lyrics and "纯音乐" not in lyrics else ""
        description = f"{summary}" + (f" · {preview}…" if preview else "")
        return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)} · AI乐之城</title>
<meta property="og:type" content="music.song">
<meta property="og:site_name" content="AI乐之城">
<meta property="og:title" content="{escape(title)}">
<meta property="og:description" content="{escape(description)}">
<meta property="og:url" content="/s/{job.id}">
<meta name="twitter:card" content="summary">
<style>
body {{ margin:0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
       background:#0b0e14; color:#e8ecf1; display:flex; min-height:100vh;
       align-items:center; justify-content:center; }}
.card {{ text-align:center; padding:40px 24px; max-width:420px; }}
.logo {{ color:#22d3ee; font-size:22px; font-weight:700; letter-spacing:2px; margin-bottom:28px; }}
.note {{ font-size:15px; margin:18px 0 30px; color:#c5cdd8; line-height:1.7; }}
.btn {{ display:inline-block; background:#22d3ee; color:#0b0e14; font-weight:600;
        padding:13px 34px; border-radius:12px; text-decoration:none; font-size:15px; }}
</style>
<script>
// 人类浏览器访问时跳到应用内播放页（爬虫不带 JS，留在卡片页）
var isBot = /bot|crawl|spider|slurp|twitterbot|facebookexternalhit|whatsapp|telegram/i
  .test(navigator.userAgent);
if (!isBot) location.replace("/#/generation/{job.id}");
</script>
</head>
<body>
<div class="card">
  <div class="logo">AI乐之城</div>
  <div class="note">{escape(title)}<br><small style="color:#8b96a5">{escape(style[:60])}</small></div>
  <a class="btn" href="/#/generation/{job.id}">播放这首歌</a>
</div>
</body>
</html>"""

    @app.get("/s/{job_id}", include_in_schema=False)
    async def song_share(job_id: str, request: Request):
        # 分享卡片页：免登录（爬虫无 cookie），只暴露标题/风格
        try:
            job = app.state.store.get(job_id)
        except Exception:
            return HTMLResponse("<h1>作品不存在或已删除</h1>", status_code=404)
        if job.status != "done":
            return HTMLResponse("<h1>作品尚未完成，稍后再试</h1>", status_code=404)
        return HTMLResponse(_share_html(job), headers={"Cache-Control": "no-cache"})

    @app.get("/", include_in_schema=False)
    async def index():
        return spa_response(static_dir)

    @app.get("/{path:path}", include_in_schema=False)
    async def spa_fallback(path: str):
        if path == "api" or path.startswith("api/"):
            raise ApiError(404, "not_found", f"no such API route: /{path}")
        last = path.rsplit("/", 1)[-1]
        if "." in last:
            raise ApiError(404, "not_found", f"/{path} not found")
        return spa_response(static_dir)
