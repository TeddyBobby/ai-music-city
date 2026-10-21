"""Persistence, network-stream, cancellation and artwork ownership contracts."""
import asyncio
import base64
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from yue2_studio.api import ApiError, install_error_handlers
from yue2_studio.assistant_api import router
from yue2_studio.assistant_service import AssistantService
from yue2_studio.jobs import NotFound

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')


class Songs:
    def get(self, job_id):
        if job_id == 'missing':
            raise NotFound(job_id)
        return SimpleNamespace(id=job_id, status='running' if job_id == 'running' else 'done')


@pytest.fixture
async def setup(tmp_path):
    app = FastAPI()
    app.state.assistant = AssistantService(tmp_path / 'data', hermes_home=tmp_path / 'hermes')
    app.state.store = Songs()
    install_error_handlers(app)
    app.include_router(router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8765') as client:
        yield app.state.assistant, client


async def test_credentials_private_and_config_validation(setup):
    svc, client = setup
    secret = svc.config()['hermes_api_key']
    response = await client.get('/api/assistant/config')
    assert secret not in response.text
    assert response.json()['has_hermes_api_key']
    assert svc.settings_path.stat().st_mode & 0o777 == 0o600
    response = await client.put('/api/assistant/config', json={'hermes_base_url': 'http://example.com'})
    assert response.status_code == 400
    response = await client.put('/api/assistant/config', json={'hermes_api_key': 'new-secret'})
    assert response.status_code == 200 and 'new-secret' not in response.text
    assert svc.config()['hermes_api_key'] == 'new-secret'
    response = await client.put('/api/assistant/config', json={'image_base_url': 'https://example.com', 'image_provider': 'openai-compatible'})
    assert response.status_code == 200


async def test_reject_cross_origin_mutations(setup):
    _, client = setup
    response = await client.post('/api/assistant/sessions', json={}, headers={'Origin': 'https://evil.example'})
    assert response.status_code == 403


async def test_sessions_persist_and_validate_song(setup):
    svc, client = setup
    bad = await client.post('/api/assistant/sessions', json={'job_id': 'missing'})
    assert bad.status_code == 404
    response = await client.post('/api/assistant/sessions', json={'title': '晨光创作', 'job_id': 'song'})
    sid = response.json()['id']
    svc.save_message(sid, 'user', '写一段歌词')
    recreated = AssistantService(svc.root.parent, hermes_home=svc.hermes_home)
    assert recreated.session(sid)['messages'][0]['content'] == '写一段歌词'
    listing = (await client.get('/api/assistant/sessions')).json()['sessions']
    assert listing[0]['message_count'] == 1
    assert listing[0]['job_id'] == 'song'


def upstream(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr('yue2_studio.assistant_service.httpx.AsyncClient',
                        lambda **kwargs: original(transport=httpx.MockTransport(handler), timeout=30))


async def test_real_sse_parse_structure_and_multiturn(setup, monkeypatch):
    svc, client = setup
    sid = svc.create_session()['id']
    svc.save_message(sid, 'user', '这首歌叫晨光')
    svc.save_message(sid, 'assistant', '好的，作品叫晨光')
    suggestion = {'title': '晨光', 'lyrics': '[verse]\n清晨的风', 'description': '温暖流行'}
    encoded = json.dumps(suggestion, ensure_ascii=False)
    captured = []
    def handler(request):
        captured.append(json.loads(request.content))
        chunks = [encoded[:10], encoded[10:]]
        body = ''.join('data: ' + json.dumps({'choices': [{'delta': {'content': chunk}}]}) + '\n\n' for chunk in chunks)
        return httpx.Response(200, text=body + 'data: [DONE]\n\n', headers={'content-type': 'text/event-stream'})
    upstream(monkeypatch, handler)
    response = await client.post(f'/api/assistant/sessions/{sid}/messages', json={'content': '写歌词', 'mode': 'lyrics', 'context': {'title': '晨光'}})
    assert response.status_code == 200
    assert 'event: delta' in response.text and 'event: done' in response.text
    saved = svc.session(sid)['messages'][-1]
    assert saved['suggestion'] == suggestion
    assert saved['status'] == 'complete'
    assert any('这首歌叫晨光' == m['content'] for m in captured[0]['messages'])
    assert '作品上下文' in captured[0]['messages'][-1]['content']
    assert not svc.active


async def test_upstream_auth_error_not_leaked(setup, monkeypatch):
    svc, client = setup
    sid = svc.create_session()['id']
    upstream(monkeypatch, lambda request: httpx.Response(401, text='SECRET API KEY diagnostic'))
    response = await client.post(f'/api/assistant/sessions/{sid}/messages', json={'content': '你好'})
    assert 'event: error' in response.text
    assert 'SECRET' not in response.text
    assert svc.session(sid)['messages'][-1]['status'] == 'error'
    assert not svc.active


async def test_busy_and_stop_preserves_partial_text(setup, monkeypatch):
    svc, client = setup
    sid = svc.create_session()['id']
    class Delayed(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'data: {"choices":[{"delta":{"content":"first"}}]}\n\n'
            await asyncio.sleep(.05)
            yield b'data: {"choices":[{"delta":{"content":"second"}}]}\n\n'
    upstream(monkeypatch, lambda request: httpx.Response(200, stream=Delayed()))
    run = svc.reserve(sid)
    with pytest.raises(ApiError) as exc:
        svc.reserve(sid)
    assert exc.value.status_code == 409
    events = []
    async for event in svc.stream(sid, 'hello', 'chat', None, run):
        events.append(event)
        if event[0] == 'delta':
            await svc.stop(sid)
    final = svc.session(sid)['messages'][-1]
    assert final['content'] == 'first'
    assert final['status'] == 'stopped'
    assert not svc.active


async def test_missing_conversation_and_context_validation(setup):
    _, client = setup
    assert (await client.get('/api/assistant/sessions/missing')).status_code == 404
    sid = (await client.post('/api/assistant/sessions', json={})).json()['id']
    response = await client.post(f'/api/assistant/sessions/{sid}/messages', json={'content': 'x', 'context': {'secret': 'x'}})
    assert response.status_code == 400
    assert (await client.post(f'/api/assistant/sessions/{sid}/messages', json={'content': ' '})).status_code == 400


async def test_cover_generate_apply_restore_and_ownership(setup, monkeypatch):
    svc, client = setup
    async def fake_image(prompt, model):
        return PNG
    monkeypatch.setattr(svc, 'hermes_python', lambda: Path(__file__))
    monkeypatch.setattr(svc, 'bridge_image', fake_image)
    a = (await client.post('/api/assistant/covers', json={'prompt': '晨雾', 'job_id': 'song'})).json()
    b = (await client.post('/api/assistant/covers', json={'prompt': '湖面', 'job_id': 'song'})).json()
    assert a['id'] != b['id']
    assert (await client.get(a['url'])).content == PNG
    assert (await client.post(f"/api/assistant/covers/{a['id']}/apply", json={'job_id': 'missing'})).status_code == 404
    assert (await client.post(f"/api/assistant/covers/{a['id']}/apply", json={'job_id': 'running'})).status_code == 409
    applied = await client.post(f"/api/assistant/covers/{a['id']}/apply", json={'job_id': 'song'})
    assert applied.json()['cover_id'] == a['id']
    await client.post(f"/api/assistant/covers/{b['id']}/apply", json={'job_id': 'song'})
    restored = await client.post('/api/assistant/covers/restore', json={'job_id': 'song'})
    assert restored.json()['cover_id'] == a['id']
    restored = await client.post('/api/assistant/covers/restore', json={'job_id': 'song'})
    assert restored.json()['cover_url'] is None
    assert (await client.post('/api/assistant/covers/restore', json={'job_id': 'song'})).status_code == 409
    assert len((await client.get('/api/assistant/covers?job_id=song')).json()['covers']) == 2
    assert svc.config()['image_verified']


async def test_failed_cover_keeps_existing_artwork(setup, monkeypatch):
    svc, client = setup
    monkeypatch.setattr(svc, 'hermes_python', lambda: Path(__file__))
    async def fail(prompt, model):
        raise ApiError(502, 'image_failed', '图片不可用')
    monkeypatch.setattr(svc, 'bridge_image', fail)
    response = await client.post('/api/assistant/covers', json={'prompt': '晨雾', 'job_id': 'song'})
    assert response.status_code == 502
    assert svc.covers('song')['covers'] == []
    assert not svc.image_busy
    assert svc.applied('song')['cover_url'] is None


async def test_status_separates_chat_and_image(setup, monkeypatch):
    svc, client = setup
    svc.update_config({'image_provider': 'disabled'})
    upstream(monkeypatch, lambda request: httpx.Response(200, json={'data': [{'id': 'hermes-agent'}]}))
    response = (await client.get('/api/assistant/status')).json()
    assert response['chat']['available']
    assert not response['image']['available']
    assert not response['image']['verified']


async def test_reject_dns_rebinding_host(setup):
    _, client = setup
    response = await client.get('/api/assistant/config', headers={'Host': 'evil.example'})
    assert response.status_code == 403


async def test_detached_cover_finishes_and_unbound_candidate_is_reusable(setup, monkeypatch):
    svc, client = setup
    release = asyncio.Event()
    started = asyncio.Event()
    async def delayed_image(prompt, model):
        started.set()
        await release.wait()
        return PNG
    monkeypatch.setattr(svc, 'hermes_python', lambda: Path(__file__))
    monkeypatch.setattr(svc, 'bridge_image', delayed_image)
    request = asyncio.create_task(client.post('/api/assistant/covers', json={'prompt': '保留我的封面构思'}))
    await started.wait()
    request.cancel()
    with pytest.raises(asyncio.CancelledError):
        await request
    assert svc.image_busy
    assert svc.image_task()['prompt'] == '保留我的封面构思'
    release.set()
    await asyncio.gather(*svc.image_tasks)
    result = (await client.get('/api/assistant/covers?job_id=song')).json()
    assert result['task']['status'] == 'complete'
    assert result['covers'][0]['job_id'] is None
    assert not result['generating']


async def test_image_timeout_and_restart_recovery_preserve_prompt(setup, monkeypatch):
    svc, client = setup
    monkeypatch.setattr(svc, 'hermes_python', lambda: Path(__file__))
    async def timeout(prompt, model):
        raise ApiError(504, 'image_timeout', '封面生成超时，请稍后重试')
    monkeypatch.setattr(svc, 'bridge_image', timeout)
    response = await client.post('/api/assistant/covers', json={'prompt': '保存这段描述'})
    assert response.status_code == 504
    result = (await client.get('/api/assistant/covers')).json()
    assert result['task']['status'] == 'error'
    assert result['task']['prompt'] == '保存这段描述'
    assert '超时' in result['task']['error']
    svc.write_image_task(status='running')
    recreated = AssistantService(svc.root.parent, hermes_home=svc.hermes_home, recover=True)
    assert recreated.image_task()['status'] == 'interrupted'
    assert recreated.image_task()['prompt'] == '保存这段描述'
