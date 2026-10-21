"""A local plaza preview, not a public multi-user publication/authentication API."""
from pathlib import Path
import math
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from yue2_studio.api import ApiError, describe
from yue2_studio.assistant_api import same_origin
from yue2_studio.jobs import NotFound
from yue2_studio.plaza_service import PlazaService

router = APIRouter(prefix='/api/plaza', dependencies=[Depends(same_origin)])


def install(app):
    app.state.plaza = PlazaService(app.state.paths.data_dir)
    app.include_router(router)


def existing_job(request: Request, job_id: str):
    try:
        return request.app.state.store.get(job_id)
    except NotFound:
        raise ApiError(404, 'not_found', '作品不存在') from None


def playable_job(request: Request, job_id: str):
    job = existing_job(request, job_id)
    root = Path(request.app.state.paths.songs_dir).resolve()
    song_dir = (root / job.id).resolve()
    audio = (song_dir / 'song' / 'audio.flac').resolve()
    if not song_dir.is_relative_to(root) or not audio.is_relative_to(song_dir):
        raise ApiError(404, 'not_found', '作品音频不存在')
    if job.status != 'done' or not audio.is_file():
        raise ApiError(409, 'not_completed', '只有已完成且音频可播放的作品才能发布')
    return job


def post(request: Request, record: dict, job) -> dict:
    # This full Job shape is confined to the local workspace. An eventual hosted
    # product must use authenticated ownership and a separate public song DTO.
    return {'id': job.id, 'job_id': job.id, 'caption': record['caption'],
            'author': {'id': 'local', 'name': '本机创作者'},
            'published_at': record['published_at'], 'updated_at': record['updated_at'],
            'can_manage': True, 'job': describe(request, job)}


def matches_song(record: dict, job, needle: str) -> bool:
    params = job.params or {}
    haystack = '\n'.join(str(value or '') for value in
                         (job.title, params.get('style'), record['caption'])).casefold()
    return not needle or needle in haystack


def published_songs(request: Request) -> list[tuple]:
    songs = []
    for record in request.app.state.plaza.records():
        try:
            songs.append((record, playable_job(request, record['job_id'])))
        except ApiError as exc:
            if exc.status_code not in (404, 409):
                raise
    return songs


def album(request: Request, record: dict) -> dict:
    tracks = []
    duration = 0
    for job_id in record['job_ids']:
        try:
            job = playable_job(request, job_id)
            tracks.append(describe(request, job))
            seconds = job.audio_seconds
            if seconds is None:
                seconds = (job.timing or {}).get('audio_seconds')
            if isinstance(seconds, (int, float)) and math.isfinite(seconds):
                duration += max(0, seconds)
        except ApiError as exc:
            if exc.status_code not in (404, 409):
                raise
    return {**record, 'tracks': tracks, 'track_count': len(tracks),
            'unavailable_count': len(record['job_ids']) - len(tracks),
            'duration_seconds': duration,
            'author': {'id': 'local', 'name': '本机创作者'}, 'can_manage': True}


def existing_album(request: Request, album_id: str) -> dict:
    record = request.app.state.plaza.get_album(album_id)
    if record is None:
        raise ApiError(404, 'not_found', '专辑不存在')
    return record


class PublicationBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    caption: str = Field(max_length=600, strict=True)


class AlbumBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=80)]
    caption: str = Field(max_length=600, strict=True)
    job_ids: list[Annotated[str, StringConstraints(strict=True, min_length=1, max_length=128)]] = Field(
        min_length=2, max_length=50)

    @field_validator('job_ids')
    @classmethod
    def unique_tracks(cls, values):
        if len(set(values)) != len(values):
            raise ValueError('专辑曲目不能重复')
        return values


@router.get('')
async def list_posts(request: Request, query: str = Query(default='', max_length=200),
                     offset: int = Query(default=0, ge=0), limit: int = Query(default=30, ge=1, le=100)):
    needle = query.strip().casefold()
    matches = [(record, job) for record, job in published_songs(request) if matches_song(record, job, needle)]
    return {'posts': [post(request, record, job) for record, job in matches[offset:offset + limit]],
            'total': len(matches), 'scope': 'local'}


@router.get('/albums')
async def list_albums(request: Request, query: str = Query(default='', max_length=200),
                      offset: int = Query(default=0, ge=0), limit: int = Query(default=24, ge=1, le=100)):
    needle = query.strip().casefold()
    albums = []
    for record in request.app.state.plaza.album_records():
        item = album(request, record)
        haystack = '\n'.join([record['title'], record['caption']] +
                             [str(value or '') for track in item['tracks']
                              for value in (track.get('title'), (track.get('params') or {}).get('style'))])
        if not needle or needle in haystack.casefold():
            albums.append(item)
    return {'albums': albums[offset:offset + limit], 'total': len(albums), 'scope': 'local'}


@router.post('/albums', status_code=201)
async def create_album(request: Request, body: AlbumBody):
    for job_id in body.job_ids:
        playable_job(request, job_id)
    record = request.app.state.plaza.publish_album(body.title, body.caption, body.job_ids)
    return {'album': album(request, record), 'scope': 'local'}


@router.get('/albums/{album_id}')
async def get_album(request: Request, album_id: str):
    return {'album': album(request, existing_album(request, album_id)), 'scope': 'local'}


@router.put('/albums/{album_id}')
async def update_album(request: Request, album_id: str, body: AlbumBody):
    existing_album(request, album_id)
    for job_id in body.job_ids:
        playable_job(request, job_id)
    record = request.app.state.plaza.publish_album(body.title, body.caption, body.job_ids, album_id)
    return {'album': album(request, record), 'scope': 'local'}


@router.delete('/albums/{album_id}', status_code=204)
async def withdraw_album(request: Request, album_id: str):
    request.app.state.plaza.withdraw_album(album_id)
    return Response(status_code=204)


@router.get('/rankings')
async def rankings(request: Request, query: str = Query(default='', max_length=200)):
    songs = published_songs(request)
    # Chunk reads to stay below SQLite's parameter limit as the library grows.
    reviews = {}
    for start in range(0, len(songs), 500):
        ids = [job.id for _, job in songs[start:start + 500]]
        reviews.update(request.app.state.reviews.summaries(ids)['reviews'])
    needle = query.strip().casefold()

    def ranked(source: str):
        scored = []
        for record, job in songs:
            review = reviews.get(job.id, {})
            if source == 'ai' and review.get('ai_status') != 'complete':
                continue
            score = review.get(f'{source}_score')
            if isinstance(score, bool) or not isinstance(score, (int, float)):
                continue
            if not math.isfinite(score) or not 0 <= score <= 10:
                continue
            scored.append((score, record, job))
        # Stable ties: higher score, newer publication, then ascending song ID.
        scored.sort(key=lambda row: row[2].id)
        scored.sort(key=lambda row: row[1]['published_at'], reverse=True)
        scored.sort(key=lambda row: row[0], reverse=True)
        return [{'rank': position, 'score': score, 'post': post(request, record, job)}
                for position, (score, record, job) in enumerate(scored, 1)
                if matches_song(record, job, needle)][:100]

    return {'manual': ranked('manual'), 'ai': ranked('ai'), 'scope': 'local'}


@router.get('/{job_id}')
async def get_post(request: Request, job_id: str):
    job = playable_job(request, job_id)
    record = request.app.state.plaza.get(job_id)
    return {'post': post(request, record, job) if record else None, 'scope': 'local'}


@router.put('/{job_id}')
async def publish(request: Request, job_id: str, body: PublicationBody):
    job = playable_job(request, job_id)
    record = request.app.state.plaza.publish(job_id, body.caption)
    return {'post': post(request, record, job), 'scope': 'local'}


@router.delete('/{job_id}', status_code=204)
async def withdraw(request: Request, job_id: str):
    # Withdrawal remains available if the audio is subsequently missing.
    existing_job(request, job_id)
    request.app.state.plaza.withdraw(job_id)
    return Response(status_code=204)
