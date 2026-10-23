"""Local-only review endpoints; personal opinions and AI references stay separate."""
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StrictFloat

from yue2_studio.api import ApiError
from yue2_studio.assistant_api import same_origin
from yue2_studio.tenancy import runtime
from yue2_studio.jobs import NotFound
from yue2_studio.review_service import ReviewService

router = APIRouter(prefix='/api/reviews', dependencies=[Depends(same_origin)])


def install(app):
    app.state.reviews = ReviewService(app.state.paths.data_dir, app.state.assistant, recover=True)
    app.include_router(router)


def completed_job(request, job_id):
    try:
        job = runtime(request).store.get(job_id)
    except NotFound:
        raise ApiError(404, 'not_found', '作品不存在') from None
    root = Path(runtime(request).paths.songs_dir).resolve()
    song_dir = (root / job.id).resolve()
    audio = (song_dir / 'song' / 'audio.flac').resolve()
    if not song_dir.is_relative_to(root) or not audio.is_relative_to(song_dir):
        raise ApiError(404, 'not_found', '作品音频不存在')
    if job.status != 'done' or not audio.is_file():
        raise ApiError(409, 'not_completed', '完成生成后才能评分和评论')
    return job, song_dir


class ManualBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    score: StrictFloat | None = None
    comment: str = Field(default='', max_length=4000, strict=True)


@router.get('')
async def list_summaries(request: Request, ids: str = Query(default='', max_length=8000)):
    job_ids = list(dict.fromkeys(value.strip() for value in ids.split(',') if value.strip()))
    if len(job_ids) > 60:
        raise ApiError(400, 'validation_error', '一次最多查询 60 首作品')
    for job_id in job_ids:
        try:
            runtime(request).store.get(job_id)
        except NotFound:
            raise ApiError(404, 'not_found', '作品不存在') from None
    return runtime(request).reviews.summaries(job_ids)


@router.get('/{job_id}')
async def get_review(request: Request, job_id: str):
    completed_job(request, job_id)
    return runtime(request).reviews.get(job_id)


@router.put('/{job_id}/manual')
async def save_manual(request: Request, job_id: str, body: ManualBody):
    completed_job(request, job_id)
    return runtime(request).reviews.save_manual(job_id, body.score, body.comment)


@router.delete('/{job_id}/manual')
async def delete_manual(request: Request, job_id: str):
    completed_job(request, job_id)
    return runtime(request).reviews.delete_manual(job_id)


@router.post('/{job_id}/ai', status_code=202)
async def generate_review(request: Request, job_id: str):
    job, song_dir = completed_job(request, job_id)
    return runtime(request).reviews.start(job, song_dir)
