"""Read-only lyric timing retrieval and explicit local calibration requests."""
from fastapi import APIRouter, Depends, Request

from yue2_studio.assistant_api import same_origin
from yue2_studio.tenancy import runtime
from yue2_studio.lyric_alignment_service import LyricAlignmentService

router = APIRouter(prefix="/api/jobs", dependencies=[Depends(same_origin)])


def install(app):
    app.state.lyric_alignment = LyricAlignmentService(app.state.paths, app.state.store, app.state.worker)
    app.include_router(router)


@router.get("/{job_id}/lyrics-alignment")
async def get_alignment(request: Request, job_id: str):
    return runtime(request).lyric_alignment.get(job_id)


@router.post("/{job_id}/lyrics-alignment", status_code=202)
async def start_alignment(request: Request, job_id: str):
    return runtime(request).lyric_alignment.start(job_id)
