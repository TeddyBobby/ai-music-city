"""HTTP contract for the Chinese music assistant. Mounted before static routes."""
from __future__ import annotations

import asyncio
import json
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from yue2_studio.api import ApiError
from yue2_studio.assistant_service import AssistantService
from yue2_studio.jobs import NotFound


def same_origin(request: Request):
    """Keep browser cross-site forms away from local credentials and paid operations."""
    if request.url.hostname not in {'localhost', '127.0.0.1', '::1'}:
        raise ApiError(403, 'host_rejected', '助手仅接受本机地址访问')
    origin = request.headers.get('origin')
    if origin and urlsplit(origin).netloc != request.url.netloc:
        raise ApiError(403, 'origin_rejected', '只能从本机工作台访问助手接口')


router = APIRouter(prefix='/api/assistant', dependencies=[Depends(same_origin)])


def install(app):
    app.state.assistant = AssistantService(app.state.paths.data_dir, recover=True)
    app.include_router(router)


def service(request: Request) -> AssistantService:
    return request.app.state.assistant


def validate_job(request, job_id, *, completed=False):
    if not job_id:
        return
    try:
        job = request.app.state.store.get(job_id)
    except NotFound:
        raise ApiError(404, 'not_found', '关联作品不存在') from None
    if completed and job.status != 'done':
        raise ApiError(409, 'not_completed', '只能为已完成作品应用封面')


class SessionBody(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    job_id: str | None = Field(default=None, max_length=128)


class MessageBody(BaseModel):
    content: str = Field(min_length=1, max_length=12000)
    mode: Literal['chat', 'lyrics', 'style', 'cover_prompt'] = 'chat'
    context: dict[str, str] | None = None


class CoverBody(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    job_id: str | None = Field(default=None, max_length=128)


class JobBody(BaseModel):
    job_id: str = Field(min_length=1, max_length=128)


@router.get('/status')
async def status(request: Request):
    return await service(request).status()


@router.post('/check')
async def check(request: Request):
    return await service(request).status(refresh=True)


@router.get('/config')
async def config(request: Request):
    return service(request).public_config()


@router.put('/config')
async def update_config(request: Request, body: dict):
    return service(request).update_config(body)


@router.get('/sessions')
async def sessions(request: Request):
    return {'sessions': service(request).sessions()}


@router.post('/sessions', status_code=201)
async def create_session(request: Request, body: SessionBody):
    validate_job(request, body.job_id)
    return service(request).create_session(body.title, body.job_id)


@router.get('/sessions/{session_id}')
async def get_session(request: Request, session_id: str):
    return service(request).session(session_id)


@router.post('/sessions/{session_id}/messages')
async def send(request: Request, session_id: str, body: MessageBody):
    if not body.content.strip():
        raise ApiError(400, 'validation_error', '请输入消息')
    if body.context and (set(body.context) - {'title', 'lyrics', 'description'} or
                         sum(len(v) for v in body.context.values()) > 30000):
        raise ApiError(400, 'validation_error', '作品上下文过长或字段无效')
    svc = service(request)
    run = svc.reserve(session_id)

    async def events():
        try:
            async for event, data in svc.stream(session_id, body.content, body.mode, body.context, run):
                yield f'event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n'
        finally:
            svc.active.pop(session_id, None)

    return StreamingResponse(events(), media_type='text/event-stream',
                             headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


@router.post('/sessions/{session_id}/stop')
async def stop(request: Request, session_id: str):
    return await service(request).stop(session_id)


@router.get('/covers')
async def covers(request: Request, job_id: str | None = None):
    if job_id:
        validate_job(request, job_id)
    return service(request).covers(job_id)


@router.post('/covers', status_code=201)
async def generate_cover(request: Request, body: CoverBody):
    validate_job(request, body.job_id)
    if not body.prompt.strip():
        raise ApiError(400, 'validation_error', '请输入封面描述')
    # Keep the generation task alive across browser navigation; results remain in the library.
    svc = service(request)
    if svc.image_busy:
        raise ApiError(409, 'busy', '正在生成封面，请等待当前任务完成')
    task = asyncio.create_task(svc.make_cover(body.prompt, body.job_id))
    if not hasattr(svc, 'image_tasks'):
        svc.image_tasks = set()
    svc.image_tasks.add(task)
    def finished(t):
        svc.image_tasks.discard(t)
        if not t.cancelled():
            t.exception()  # retrieve a detached task's failure without logging credentials
    task.add_done_callback(finished)
    return await asyncio.shield(task)


@router.get('/covers/applied/{job_id}')
async def applied(request: Request, job_id: str):
    validate_job(request, job_id)
    return service(request).applied(job_id)


@router.post('/covers/restore')
async def restore(request: Request, body: JobBody):
    validate_job(request, body.job_id, completed=True)
    return service(request).restore(body.job_id)


@router.get('/covers/{cover_id}/image')
async def image(request: Request, cover_id: str):
    svc = service(request)
    cover = svc.cover(cover_id)
    return FileResponse(svc.images / cover['filename'], media_type='image/png',
                        headers={'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff'})


@router.post('/covers/{cover_id}/apply')
async def apply(request: Request, cover_id: str, body: JobBody):
    validate_job(request, body.job_id, completed=True)
    return service(request).apply(cover_id, body.job_id)
