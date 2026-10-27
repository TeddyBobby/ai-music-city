"""Read-only administrator views over registered accounts and their music."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse

from yue2_studio.admin_service import AdminReader
from yue2_studio.auth_api import require_admin

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


def install(app):
    if getattr(app.state, "auth", None) is None:
        raise RuntimeError("Authentication must be installed before the admin API")
    app.include_router(router)


def reader(request: Request) -> AdminReader:
    return AdminReader(request.app.state.paths.data_dir)


@router.get("/overview")
def overview(request: Request):
    return {
        **reader(request).overview(),
        "engine": type(request.app.state.engine).__name__,
        "fake": bool(request.app.state.fake),
    }


@router.get("/users")
def users(request: Request, q: str = "", limit: int = 20, offset: int = 0):
    return reader(request).users(q=q, limit=limit, offset=offset)


@router.get("/users/{user_id}")
def user(request: Request, user_id: str):
    return {"user": reader(request).user(user_id)}


@router.get("/users/{user_id}/jobs")
def user_jobs(
    request: Request,
    user_id: str,
    q: str = "",
    status: str | None = None,
    music_kind: str | None = None,
    limit: int = 20,
    offset: int = 0,
):
    return reader(request).jobs(
        user_id, q=q, status=status, music_kind=music_kind, limit=limit, offset=offset
    )


@router.api_route("/users/{user_id}/jobs/{job_id}/audio", methods=["GET", "HEAD"])
def user_audio(request: Request, user_id: str, job_id: str, download: bool = False):
    path = reader(request).audio(user_id, job_id)
    return FileResponse(
        path,
        media_type="audio/flac",
        filename=f"{job_id}.flac" if download else None,
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/jobs")
def jobs_stats(request: Request):
    # Compatibility for the former overview; enumerate auth accounts, never arbitrary folders.
    return reader(request).job_totals()
