"""Review persistence, honest evidence, bounded measurements and background lifecycle."""
import asyncio
import copy
import json
from types import SimpleNamespace

import httpx
import numpy as np
import pytest
import soundfile as sf
from fastapi import FastAPI

from yue2_studio.api import install_error_handlers
from yue2_studio.assistant_service import AssistantService
from yue2_studio.jobs import NotFound
from yue2_studio.review_api import router
from yue2_studio.review_service import BASIS, DIMENSIONS, ReviewService, audio_metrics, validate_result

HTTP_CLIENT = httpx.AsyncClient


def result_payload():
    return {'score': 6.8, 'headline': '清晰的创作轮廓', 'summary': '从现有材料中可以辨认主题。',
            'body': '乐谱呈现了重复动机。\n\n实际听感仍需试听确认。',
            'dimensions': [{'name': name, 'score': 6.8, 'reason': '依据提供的数据进行有限判断。'}
                           for name in DIMENSIONS],
            'strengths': ['创作目标明确'], 'suggestions': ['试听并检查段落之间的衔接']}


class Songs:
    def get(self, job_id):
        if job_id == 'missing':
            raise NotFound(job_id)
        return SimpleNamespace(id=job_id, status='running' if job_id == 'running' else 'done',
                               params={'title': '林间微光', 'style': 'acoustic instrumental', 'lyrics': '[Intro]'})


@pytest.fixture
async def setup(tmp_path):
    app = FastAPI()
    app.state.paths = SimpleNamespace(songs_dir=tmp_path / 'songs', data_dir=tmp_path / 'data')
    for job_id in ('song', 'another', 'running'):
        song_dir = app.state.paths.songs_dir / job_id / 'song'
        song_dir.mkdir(parents=True)
        samples = .5 * np.sin(2 * np.pi * 440 * np.arange(8000) / 8000)
        sf.write(song_dir / 'audio.flac', samples, 8000)
        (song_dir / 'score.abc').write_text('X:1\nL:1/4\nK:C\nCDEF|G4|')
    app.state.store = Songs()
    assistant = AssistantService(tmp_path / 'data', hermes_home=tmp_path / 'hermes')
    app.state.reviews = ReviewService(tmp_path / 'data', assistant)
    install_error_handlers(app)
    app.include_router(router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8765') as client:
        yield app.state.reviews, client, app
    await app.state.reviews.close()


async def finish(svc):
    await asyncio.wait_for(asyncio.gather(*list(svc.active.values())), 3)


def upstream(monkeypatch, handler):
    monkeypatch.setattr('yue2_studio.review_service.httpx.AsyncClient',
                        lambda **kwargs: HTTP_CLIENT(transport=httpx.MockTransport(handler), timeout=30))


async def test_manual_zero_comment_persistence_and_clear(setup):
    svc, client, _ = setup
    initial = (await client.get('/api/reviews/song')).json()
    assert initial['manual'] is None and initial['ai']['status'] == 'idle'
    saved = await client.put('/api/reviews/song/manual', json={'score': 0, 'comment': '  还需改进  '})
    assert saved.status_code == 200
    assert saved.json()['manual']['score'] == 0
    assert saved.json()['manual']['comment'] == '还需改进'
    recreated = ReviewService(svc.root.parent, svc.assistant)
    assert recreated.get('song')['manual'] == saved.json()['manual']
    comment_only = await client.put('/api/reviews/song/manual', json={'score': None, 'comment': '不评分，只记录感受'})
    assert comment_only.json()['manual']['score'] is None
    assert (await client.delete('/api/reviews/song/manual')).json()['manual'] is None
    assert (await client.delete('/api/reviews/song/manual')).status_code == 200


@pytest.mark.parametrize('body', [
    {}, {'score': -0.1}, {'score': 10.1}, {'score': 7.25}, {'score': True}, {'score': '7.2'},
    {'score': None, 'comment': '  '}, {'comment': None}, {'comment': 'x' * 4001},
    {'score': 7, 'model': 'injected'},
])
async def test_manual_validation(setup, body):
    svc, client, _ = setup
    assert (await client.put('/api/reviews/song/manual', json=body)).status_code == 400
    assert svc.get('song')['manual'] is None


async def test_nonfinite_score_rejected_without_leak(setup):
    svc, client, _ = setup
    response = await client.put('/api/reviews/song/manual', content='{"score":NaN}',
                                headers={'content-type': 'application/json'})
    assert response.status_code == 400
    assert svc.get('song')['manual'] is None


@pytest.mark.parametrize('job_id,status', [('missing', 404), ('running', 409), ('no_audio', 409)])
async def test_requires_existing_completed_audio(setup, job_id, status):
    _, client, _ = setup
    assert (await client.get(f'/api/reviews/{job_id}')).status_code == status
    assert (await client.put(f'/api/reviews/{job_id}/manual', json={'score': 7})).status_code == status
    assert (await client.post(f'/api/reviews/{job_id}/ai')).status_code == status


async def test_rejects_cross_site_and_nonlocal_host(setup):
    _, client, _ = setup
    assert (await client.post('/api/reviews/song/ai', headers={'origin': 'https://evil.example'})).status_code == 403
    assert (await client.get('/api/reviews/song', headers={'host': 'evil.example'})).status_code == 403
    assert (await client.put('/api/reviews/song/manual', json={'score': 7},
                             headers={'origin': 'http://127.0.0.1:9999'})).status_code == 403


async def test_factory_mounts_review_routes_before_static(app):
    async with HTTP_CLIENT(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1') as client:
        response = await client.get('/api/reviews')
    assert response.status_code == 200
    assert response.json() == {'reviews': {}}
    assert app.state.reviews.assistant is app.state.assistant


async def test_audio_symlink_outside_song_is_rejected(setup, tmp_path):
    _, client, app = setup
    audio = app.state.paths.songs_dir / 'song/song/audio.flac'
    external = tmp_path / 'unrelated.flac'
    audio.replace(external)
    audio.symlink_to(external)
    assert (await client.post('/api/reviews/song/ai')).status_code == 404


async def test_provider_request_contains_honest_evidence_and_persists(setup, monkeypatch):
    svc, client, _ = setup
    monkeypatch.setattr(svc.assistant, 'model_info', lambda: ('configured-text-model', 'provider'))
    captured = []
    secret = svc.assistant.config()['hermes_api_key']
    def handler(request):
        captured.append(json.loads(request.content))
        assert request.headers['authorization'] == 'Bearer ' + secret
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(result_payload())}}]})
    upstream(monkeypatch, handler)
    started = await client.post('/api/reviews/song/ai')
    assert started.status_code == 202 and started.json()['ai']['status'] == 'running'
    await finish(svc)
    response = await client.get('/api/reviews/song')
    review = response.json()['ai']
    assert review['status'] == 'complete'
    assert review['result']['model'] == 'configured-text-model'
    assert review['result']['basis'] == [BASIS]
    assert review['result']['evidence']['direct_audio_listening'] is False
    assert review['result']['evidence']['lyrics_available'] is False
    assert review['result']['evidence']['score_available'] is True
    assert review['result']['evidence']['audio']['duration_seconds'] == 1
    assert '你没有听到音频' in captured[0]['messages'][0]['content']
    assert 'score_abc' in captured[0]['messages'][1]['content']
    assert secret not in response.text and str(svc.root) not in response.text
    assert not svc.active
    assert ReviewService(svc.root.parent, svc.assistant).get('song')['ai'] == review


async def test_duplicate_request_and_manual_edit_during_review(setup, monkeypatch):
    svc, client, _ = setup
    release = asyncio.Event()
    async def wait_request(context, evidence):
        await release.wait()
        return {**result_payload(), 'model': 'test', 'basis': [BASIS], 'evidence': evidence}
    monkeypatch.setattr(svc, '_request', wait_request)
    assert (await client.post('/api/reviews/song/ai')).status_code == 202
    assert (await client.post('/api/reviews/song/ai')).status_code == 409
    assert (await client.put('/api/reviews/song/manual', json={'score': 8.1})).status_code == 200
    release.set()
    await finish(svc)
    review = svc.get('song')
    assert review['manual']['score'] == 8.1
    assert review['ai']['status'] == 'complete'


async def test_failed_retry_keeps_success_and_private_errors(setup, monkeypatch):
    svc, client, _ = setup
    upstream(monkeypatch, lambda req: httpx.Response(200, json={
        'choices': [{'message': {'content': json.dumps(result_payload())}}]}))
    await client.post('/api/reviews/song/ai')
    await finish(svc)
    previous = svc.get('song')['ai']['result']
    upstream(monkeypatch, lambda req: httpx.Response(401, text='SECRET /private/path'))
    retry = (await client.post('/api/reviews/song/ai')).json()['ai']
    assert retry['result'] == previous and retry['status'] == 'running'
    await finish(svc)
    failed = (await client.get('/api/reviews/song')).json()['ai']
    assert failed['status'] == 'failed' and failed['result'] == previous
    assert 'SECRET' not in failed['error'] and '/private' not in failed['error']
    assert '鉴权失败' in failed['error']


@pytest.mark.parametrize('content', ['not JSON', '{}', '{"score": 9}', '```json\n{}\n```'])
async def test_bad_provider_output_never_fabricates_result(setup, monkeypatch, content):
    svc, client, _ = setup
    upstream(monkeypatch, lambda req: httpx.Response(200, json={'choices': [{'message': {'content': content}}]}))
    await client.post('/api/reviews/song/ai')
    await finish(svc)
    assert svc.get('song')['ai']['status'] == 'failed'
    assert svc.get('song')['ai']['result'] is None


async def test_oversized_provider_response_is_rejected(setup, monkeypatch):
    svc, client, _ = setup
    upstream(monkeypatch, lambda req: httpx.Response(200, text='x' * (100 * 1024)))
    await client.post('/api/reviews/song/ai')
    await finish(svc)
    assert svc.get('song')['ai']['status'] == 'failed'
    assert svc.get('song')['ai']['result'] is None


async def test_shutdown_and_startup_recover_interruption(setup, monkeypatch):
    svc, client, _ = setup
    async def pending(context, evidence):
        await asyncio.Event().wait()
    monkeypatch.setattr(svc, '_request', pending)
    await client.post('/api/reviews/song/ai')
    await svc.close()
    assert svc.get('song')['ai']['status'] == 'failed'
    assert not svc.active
    with svc.db() as db:
        db.execute("UPDATE reviews SET ai_status='running' WHERE job_id='song'")
    recovered = ReviewService(svc.root.parent, svc.assistant, recover=True)
    assert recovered.get('song')['ai']['status'] == 'failed'
    assert '重启' in recovered.get('song')['ai']['error']


async def test_batch_summary_handles_zero_comments_and_limits(setup):
    svc, client, _ = setup
    svc.save_manual('song', 0, '明确记录')
    summaries = (await client.get('/api/reviews?ids=song,another,song')).json()['reviews']
    assert len(summaries) == 2
    assert summaries['song'] == {'manual_score': 0, 'has_comment': True, 'ai_score': None, 'ai_status': 'idle'}
    assert summaries['another']['manual_score'] is None
    assert (await client.get('/api/reviews?ids=missing')).status_code == 404
    assert (await client.get('/api/reviews', params={'ids': ','.join(str(n) for n in range(61))})).status_code == 400
    assert (await client.get('/api/reviews')).json() == {'reviews': {}}


def test_metrics_are_real_finite_and_bounded(tmp_path):
    path = tmp_path / 'tone.wav'
    samples = .5 * np.sin(2 * np.pi * 440 * np.arange(8000) / 8000)
    sf.write(path, samples, 8000)
    measured = audio_metrics(path)
    assert measured['rms_dbfs'] == pytest.approx(-9.03, abs=.02)
    assert measured['peak_dbfs'] == pytest.approx(-6.02, abs=.02)
    assert measured['clipped_sample_ratio'] == 0
    assert measured['sampled'] is False
    sf.write(path, np.zeros(1000 * 240), 1000)
    measured = audio_metrics(path)
    assert measured['duration_seconds'] == 240
    assert measured['analysed_seconds'] <= 120
    assert measured['silence_sample_ratio'] == 1
    assert measured['rms_dbfs'] == -120 and measured['peak_dbfs'] == -120
    assert measured['sampled'] is True


def test_structured_score_and_dimensions_validated():
    original = result_payload()
    assert validate_result(json.dumps(original))['score'] == 6.8
    for value in (float('inf'), float('nan'), -1, 11, True, '8', 7.123):
        payload = copy.deepcopy(original)
        payload['score'] = value
        with pytest.raises(ValueError):
            validate_result(json.dumps(payload))
    payload = copy.deepcopy(original)
    payload['dimensions'][0]['name'] = '听感'
    with pytest.raises(ValueError):
        validate_result(json.dumps(payload))
