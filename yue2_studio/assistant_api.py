"""HTTP contract for the Chinese music assistant. Mounted before static routes."""
from __future__ import annotations

import asyncio
import json
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Form, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from yue2_studio.api import ApiError
from yue2_studio.assistant_service import AssistantService
from yue2_studio import assistant_images
from yue2_studio.image_music import analyze_image
from yue2_studio.tenancy import runtime
from yue2_studio.jobs import NotFound


def same_origin(request: Request):
    """Keep browser cross-site forms away from local credentials and paid operations."""
    allowed_hosts = {'localhost', '127.0.0.1', '::1', 'myzai.top', 'www.myzai.top', 'music.myzai.top'}
    if request.url.hostname not in allowed_hosts:
        raise ApiError(403, 'host_rejected', '助手仅接受授权域名访问')
    origin = request.headers.get('origin')
    if origin and urlsplit(origin).netloc != request.url.netloc:
        raise ApiError(403, 'origin_rejected', '只能从本机工作台访问助手接口')


router = APIRouter(prefix='/api/assistant', dependencies=[Depends(same_origin)])


def install(app):
    app.state.assistant = AssistantService(app.state.paths.data_dir, recover=True)
    app.include_router(router)


def service(request: Request) -> AssistantService:
    return runtime(request).assistant


def validate_job(request, job_id, *, completed=False):
    if not job_id:
        return
    try:
        job = runtime(request).store.get(job_id)
    except NotFound:
        raise ApiError(404, 'not_found', '关联作品不存在') from None
    if completed and job.status != 'done':
        raise ApiError(409, 'not_completed', '只能为已完成作品应用封面')


class SessionBody(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    job_id: str | None = Field(default=None, max_length=128)


class MessageBody(BaseModel):
    content: str = Field(default='', max_length=12000)
    mode: Literal['chat', 'lyrics', 'style', 'cover_prompt'] = 'chat'
    context: dict[str, str] | None = None
    model: str | None = Field(default=None, max_length=300)
    audio_id: str | None = Field(default=None, max_length=32)
    image_id: str | None = Field(default=None, max_length=32)


class CoverBody(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    job_id: str | None = Field(default=None, max_length=128)


class JobBody(BaseModel):
    job_id: str = Field(min_length=1, max_length=128)


@router.get('/status')
async def status(request: Request):
    return await service(request).status()


@router.post('/check')
async def check(request: Request, body: dict | None = None):
    return await service(request).status(refresh=True, draft=body or None)


@router.get('/config')
async def config(request: Request):
    return service(request).public_config()


@router.get('/models')
async def models(request: Request):
    return await service(request).models()


@router.post('/audio', status_code=201)
async def upload_audio(request: Request, file: UploadFile | None = None):
    if file is None:
        raise ApiError(400, 'validation_error', '请选择或录制语音')
    task = asyncio.create_task(service(request).receive_audio(file))

    async def watch_disconnect():
        while not task.done():
            await asyncio.sleep(.25)
            if await request.is_disconnected():
                task.cancel()
                return

    watcher = asyncio.create_task(watch_disconnect())
    try:
        return await task
    finally:
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await file.close()


@router.get('/audio/{audio_id}')
async def play_audio(request: Request, audio_id: str):
    svc = service(request)
    record = svc.audio_attachment(audio_id)
    return FileResponse(svc.audio_path(record), headers={'Cache-Control': 'private, max-age=86400',
                                                       'X-Content-Type-Options': 'nosniff'})


@router.post('/image-mood')
async def image_mood(request: Request, file: UploadFile | None = None,
                     description: str = Form(default=''), model: str | None = Form(default=None)):
    if file is None:
        raise ApiError(400, 'invalid_image', '请选择一张图片')
    task = asyncio.create_task(analyze_image(service(request), file, description, model))

    async def watch_disconnect():
        while not task.done():
            await asyncio.sleep(.25)
            if await request.is_disconnected():
                task.cancel()
                return

    watcher = asyncio.create_task(watch_disconnect())
    try:
        return await task
    finally:
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await file.close()


@router.post('/images', status_code=201)
async def upload_image(request: Request, file: UploadFile | None = None):
    if file is None:
        raise ApiError(400, 'invalid_image', '请选择一张图片')
    try:
        return await assistant_images.receive_image(service(request).root, file)
    finally:
        await file.close()


@router.get('/images/{image_id}')
async def read_image(request: Request, image_id: str):
    root = service(request).root
    record = assistant_images.image_attachment(root, image_id)
    return FileResponse(assistant_images.image_path(root, record), media_type='image/jpeg',
                        headers={'Cache-Control': 'private, max-age=86400',
                                 'X-Content-Type-Options': 'nosniff'})


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
    if not body.content.strip() and not body.audio_id and not body.image_id:
        raise ApiError(400, 'validation_error', '请输入消息')
    if body.context and (set(body.context) - {'title', 'lyrics', 'description'} or
                         sum(len(v) for v in body.context.values()) > 30000):
        raise ApiError(400, 'validation_error', '作品上下文过长或字段无效')
    svc = service(request)
    svc.session(session_id)
    attachment = svc.public_audio(svc.audio_attachment(body.audio_id)) if body.audio_id else None
    image_attachment = assistant_images.image_attachment(svc.root, body.image_id) if body.image_id else None
    model = await svc.request_model(body.model)
    run = svc.reserve(session_id)
    queue = asyncio.Queue()

    async def produce():
        run['started'] = True
        try:
            async for event, data in svc.stream(session_id, body.content, body.mode, body.context, run,
                                                model=model, attachment=attachment, selected_model=body.model,
                                                image_attachment=image_attachment):
                if not run.get('disconnected'):
                    await queue.put((event, data))
        finally:
            await queue.put(None)

    task = asyncio.create_task(produce())
    run['task'] = task
    svc.chat_tasks.add(task)

    def completed(task):
        svc.chat_tasks.discard(task)
        if not task.cancelled():
            task.exception()
    task.add_done_callback(completed)

    async def events():
        try:
            while item := await queue.get():
                event, data = item
                yield f'event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n'
        finally:
            # Navigating away closes only this delivery stream. Explicit /stop owns cancellation;
            # the producer continues checkpointing its reply for the next session read.
            run['disconnected'] = True

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
