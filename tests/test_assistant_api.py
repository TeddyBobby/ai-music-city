"""Persistence, network-stream, cancellation and artwork ownership contracts."""
import asyncio
import base64
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from yue2_studio.api import ApiError, install_error_handlers
from yue2_studio.assistant_api import router
from yue2_studio.assistant_service import AssistantService, visible_reply, music_proposal
from yue2_studio.jobs import NotFound

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')


class Songs:
    def get(self, job_id):
        if job_id == 'missing':
            raise NotFound(job_id)
        return SimpleNamespace(id=job_id, status='running' if job_id == 'running' else 'done')


@pytest.fixture
async def setup(tmp_path, monkeypatch):
    monkeypatch.setenv("AMC_ASSISTANT_BASE_URL", "https://assistant.example.test/v1")
    monkeypatch.setenv("AMC_ASSISTANT_MODEL", "test-music-model")
    monkeypatch.setenv("AMC_ASSISTANT_API_KEY", "test-provider-secret")
    app = FastAPI()
    app.state.assistant = AssistantService(tmp_path / 'data', hermes_home=tmp_path / 'hermes')
    app.state.store = Songs()
    install_error_handlers(app)
    app.include_router(router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8765') as client:
        try:
            yield app.state.assistant, client
        finally:
            await app.state.assistant.close()


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
    assert response.status_code == 400


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


def upstream(monkeypatch, handler, *, model_handler=None):
    original = httpx.AsyncClient

    def route(request):
        if request.method == 'GET' and request.url.path.endswith('/models'):
            if model_handler:
                return model_handler(request)
            return httpx.Response(200, json={'data': [{'id': 'test-music-model'}]})
        return handler(request)

    monkeypatch.setattr('yue2_studio.assistant_service.httpx.AsyncClient',
                        lambda **kwargs: original(transport=httpx.MockTransport(route), timeout=30))


async def test_real_sse_parse_structure_and_multiturn(setup, monkeypatch):
    svc, client = setup
    sid = svc.create_session()['id']
    svc.save_message(sid, 'user', '这首歌叫晨光')
    svc.save_message(sid, 'assistant', '好的，作品叫晨光')
    suggestion = {'title': '晨光', 'lyrics': '[verse]\n清晨的风', 'description': '温暖流行', 'music_kind': 'vocal'}
    encoded = '整理好了。<music_proposal>' + json.dumps(suggestion, ensure_ascii=False) + '</music_proposal>'
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


async def test_existing_cover_apply_restore_and_ownership(setup):
    svc, client = setup
    # Existing local covers remain available after image generation was retired.
    a = svc.save_cover(PNG, '晨雾', 'historical-provider', 'song')
    b = svc.save_cover(PNG, '湖面', 'historical-provider', 'song')
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


async def test_disabled_cover_generation_keeps_existing_artwork(setup, monkeypatch):
    svc, client = setup
    existing = svc.save_cover(PNG, '已有封面', 'historical-provider', 'song')
    svc.apply(existing['id'], 'song')

    async def never_call_provider(*args):
        pytest.fail('Disabled cover generation must not invoke a provider')

    monkeypatch.setattr(svc, 'bridge_image', never_call_provider)
    response = await client.post('/api/assistant/covers', json={'prompt': '晨雾', 'job_id': 'song'})
    assert response.status_code == 503 and response.json()['error']['code'] == 'unconfigured'
    assert [cover['id'] for cover in svc.covers('song')['covers']] == [existing['id']]
    assert not svc.image_busy
    assert svc.applied('song')['cover_id'] == existing['id']
    assert svc.image_task()['status'] == 'error'
    assert svc.image_task()['prompt'] == '晨雾'


async def test_status_separates_chat_and_image(setup, monkeypatch):
    svc, client = setup
    assert svc.config()['image_provider'] == 'disabled'
    upstream(monkeypatch, lambda request: httpx.Response(200, json={'data': [{'id': 'hermes-agent'}]}))
    response = (await client.get('/api/assistant/status')).json()
    assert response['chat']['available']
    assert not response['image']['available']
    assert not response['image']['verified']


async def test_reject_dns_rebinding_host(setup):
    _, client = setup
    response = await client.get('/api/assistant/config', headers={'Host': 'evil.example'})
    assert response.status_code == 403


async def test_existing_unbound_cover_is_reusable(setup):
    svc, client = setup
    candidate = svc.save_cover(PNG, '保留我的封面构思', 'historical-provider')
    result = (await client.get('/api/assistant/covers?job_id=song')).json()
    assert result['covers'][0]['id'] == candidate['id']
    assert result['covers'][0]['job_id'] is None
    assert not result['generating']
    for job_id in ('song', 'another'):
        applied = await client.post(f"/api/assistant/covers/{candidate['id']}/apply", json={'job_id': job_id})
        assert applied.status_code == 200 and applied.json()['cover_id'] == candidate['id']


async def test_interrupted_legacy_cover_task_preserves_prompt_on_restart(setup):
    svc, _ = setup
    svc.write_image_task(id='legacy-image-task', status='running', prompt='保存这段描述')
    recreated = AssistantService(svc.root.parent, hermes_home=svc.hermes_home, recover=True)
    assert recreated.image_task()['status'] == 'interrupted'
    assert recreated.image_task()['prompt'] == '保存这段描述'
    assert '重启' in recreated.image_task()['error']


async def test_model_catalog_uses_endpoint_aliases_without_provider_inventory(setup, monkeypatch):
    svc, client = setup
    cfg = {**svc.config(), 'hermes_base_url': 'http://127.0.0.1:8642', 'hermes_model': 'hermes-agent'}
    svc._save_config(cfg)

    async def bridge(mode, **kwargs):
        assert mode == 'probe', 'Model options must never come from Hermes provider inventory'
        return {'available': True}

    monkeypatch.setattr(svc, 'hermes_bridge', bridge)
    requested, captured = [], []

    def models(request):
        requested.append(str(request.url))
        assert request.headers['authorization'] == 'Bearer ' + cfg['hermes_api_key']
        return httpx.Response(200, json={'data': [
            {'id': 'hermes-agent', 'owned_by': 'hermes'},
            {'id': 'music-alias', 'owned_by': 'hermes', 'root': 'underlying-provider-model'},
        ]})

    def chat(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n')

    upstream(monkeypatch, chat, model_handler=models)
    catalog = (await client.get('/api/assistant/models')).json()
    assert requested == ['http://127.0.0.1:8642/v1/models']
    assert [model['id'] for model in catalog['models']] == ['hermes-agent', 'music-alias']
    assert catalog['default_model'] == 'hermes-agent'
    assert catalog['audio']['available']
    assert cfg['hermes_api_key'] not in json.dumps(catalog)
    assert 'underlying-provider-model' not in json.dumps(catalog)
    sid = svc.create_session()['id']
    response = await client.post(f'/api/assistant/sessions/{sid}/messages',
                                 json={'content': '你好', 'model': 'music-alias'})
    assert response.status_code == 200
    assert captured[0]['model'] == 'music-alias' and 'provider' not in captured[0]
    assert svc.config() == cfg
    assert svc.session(sid)['messages'][-1]['model'] == 'music-alias'
    response = await client.post(f'/api/assistant/sessions/{sid}/messages',
                                 json={'content': '你好', 'model': 'invented-model'})
    assert response.status_code == 400 and not svc.active
    assert len(captured) == 1 and len(requested) == 1


@pytest.mark.parametrize('configured,expected', [('available-b', 'available-b'), ('retired', 'available-a'), ('', 'available-a')])
async def test_model_default_is_always_in_endpoint_inventory(setup, monkeypatch, configured, expected):
    svc, client = setup
    cfg = {**svc.config(), 'hermes_model': configured}
    svc._save_config(cfg)
    upstream(monkeypatch, lambda request: pytest.fail('No generation should be requested'),
             model_handler=lambda request: httpx.Response(200, json={'data': [
                 {'id': 'available-a'}, {'id': 'available-b'}, {'id': 'available-a'},
                 {'id': ''}, {'id': ' '}, {'id': None}, {'id': 9}, {}, 'invalid',
             ]}))
    catalog = (await client.get('/api/assistant/models')).json()
    assert [model['id'] for model in catalog['models']] == ['available-a', 'available-b']
    assert catalog['default_model'] == expected
    assert await svc.request_model(None) == {'model': expected}
    assert svc.config() == cfg


async def test_empty_model_inventory_does_not_invent_configured_default(setup, monkeypatch):
    svc, client = setup
    upstream(monkeypatch, lambda request: pytest.fail('Empty catalog must not allow generation'),
             model_handler=lambda request: httpx.Response(200, json={'data': []}))
    catalog = (await client.get('/api/assistant/models')).json()
    assert catalog['models'] == [] and catalog['default_model'] == ''
    sid = svc.create_session()['id']
    response = await client.post(f'/api/assistant/sessions/{sid}/messages', json={'content': '你好'})
    assert response.status_code == 503 and response.json()['error']['code'] == 'no_models'
    assert svc.session(sid)['messages'] == [] and not svc.active


@pytest.mark.parametrize('status,payload', [(401, {'detail': 'SECRET'}), (503, {'error': 'SECRET'}),
                                         (200, {'data': 'SECRET'}), (200, []), (200, {})])
async def test_failed_model_inventory_has_safe_error_and_no_fallback(setup, monkeypatch, status, payload):
    svc, client = setup
    upstream(monkeypatch, lambda request: pytest.fail('Failed catalog must not allow generation'),
             model_handler=lambda request: httpx.Response(status, json=payload))
    response = await client.get('/api/assistant/models')
    assert response.status_code == 502 and response.json()['error']['code'] == 'models_unavailable'
    assert 'SECRET' not in response.text and svc.config()['hermes_api_key'] not in response.text
    assert svc.model_cache is None
    with pytest.raises(ApiError) as exc:
        await svc.request_model(None)
    assert exc.value.code == 'models_unavailable'


async def test_model_connection_failure_does_not_use_stale_cache(setup, monkeypatch):
    svc, client = setup
    calls = []

    def models(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(200, json={'data': [{'id': 'available'}]})
        if len(calls) == 2:
            raise httpx.ConnectError('SECRET diagnostic', request=request)
        return httpx.Response(200, json={'data': [{'id': 'recovered'}]})

    upstream(monkeypatch, lambda request: pytest.fail('No generation should be requested'), model_handler=models)
    assert (await client.get('/api/assistant/models')).json()['default_model'] == 'available'
    svc.model_cache = (svc.model_cache[0] - 61, svc.model_cache[1])
    response = await client.get('/api/assistant/models')
    assert response.status_code == 502 and 'SECRET' not in response.text
    assert svc.model_cache is None
    assert (await client.get('/api/assistant/models')).json()['default_model'] == 'recovered'


async def test_shared_model_catalog_invalidates_when_admin_changes_connection(setup, monkeypatch, tmp_path):
    svc, _ = setup
    tenant = AssistantService(tmp_path / 'tenant', config_source=svc)
    calls = []

    def models(request):
        calls.append(request)
        model = 'new-model' if request.url.host == 'new.example.test' else 'old-model'
        return httpx.Response(200, json={'data': [{'id': model}]})

    upstream(monkeypatch, lambda request: pytest.fail('No generation should be requested'), model_handler=models)
    assert await tenant.request_model(None) == {'model': 'old-model'}
    assert await svc.request_model(None) == {'model': 'old-model'}
    assert len(calls) == 1
    svc.update_config({'hermes_base_url': 'https://new.example.test/v1'})
    assert await tenant.request_model(None) == {'model': 'new-model'}
    with pytest.raises(ApiError) as exc:
        await tenant.request_model('old-model')
    assert exc.value.code == 'invalid_model'
    assert len(calls) == 2


async def test_unconfigured_models_do_not_probe_any_provider(setup, monkeypatch):
    svc, client = setup
    svc._save_config({**svc.config(), 'hermes_base_url': ''})
    upstream(monkeypatch, lambda request: pytest.fail('Unconfigured service must not issue requests'),
             model_handler=lambda request: pytest.fail('Unconfigured service must not issue requests'))
    response = await client.get('/api/assistant/models')
    assert response.status_code == 503 and response.json()['error']['code'] == 'unconfigured'


async def test_voice_upload_replay_and_text_description_reach_assistant(setup, monkeypatch):
    svc, client = setup
    monkeypatch.setattr('yue2_studio.assistant_service.audio.probe_duration', lambda path: 3.5)

    async def bridge(mode, **kwargs):
        assert mode == 'transcribe'
        assert kwargs['path'].is_file()
        return {'success': True, 'transcript': '写一首关于海边的歌'}

    monkeypatch.setattr(svc, 'hermes_bridge', bridge)
    uploaded = await client.post('/api/assistant/audio', files={'file': ('voice.wav', b'wave-data', 'audio/wav')})
    assert uploaded.status_code == 201
    attachment = uploaded.json()
    assert attachment['seconds'] == 3.5
    assert attachment['transcript'] == '写一首关于海边的歌'
    assert (await client.get(attachment['url'])).content == b'wave-data'
    captured = []

    def handler(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"可以"}}]}\n\ndata: [DONE]\n\n')

    upstream(monkeypatch, handler)
    sid = svc.create_session()['id']
    await client.post(f'/api/assistant/sessions/{sid}/messages',
                      json={'content': '用木吉他伴奏', 'audio_id': attachment['id']})
    message = svc.session(sid)['messages'][0]
    assert message['content'] == '用木吉他伴奏' and message['audio'] == attachment
    prompt = captured[0]['messages'][-1]['content']
    assert '用木吉他伴奏' in prompt and '写一首关于海边的歌' in prompt
    recreated = AssistantService(svc.root.parent, hermes_home=svc.hermes_home)
    assert recreated.session(sid)['messages'][0]['audio'] == attachment
    # A voice-only request uses its transcript and carries it into subsequent context.
    await client.post(f'/api/assistant/sessions/{sid}/messages', json={'audio_id': attachment['id']})
    assert any('用木吉他伴奏' in m['content'] and '写一首关于海边的歌' in m['content']
               for m in captured[1]['messages'][:-1])


async def test_voice_rejects_transcription_failures_without_orphan_files(setup, monkeypatch):
    svc, client = setup
    monkeypatch.setattr('yue2_studio.assistant_service.audio.probe_duration', lambda path: 2)

    async def unavailable(mode, **kwargs):
        return {'success': False}

    monkeypatch.setattr(svc, 'hermes_bridge', unavailable)
    response = await client.post('/api/assistant/audio', files={'file': ('hum.wav', b'audio', 'audio/wav')})
    assert response.status_code == 503 and response.json()['error']['code'] == 'transcription_failed'
    assert not list(svc.audio_dir.iterdir())
    assert (await client.get('/api/assistant/audio/not-an-id')).status_code == 404
    sid = svc.create_session()['id']
    response = await client.post(f'/api/assistant/sessions/{sid}/messages',
                                 json={'content': '说明', 'audio_id': 'a' * 32})
    assert response.status_code == 404 and not svc.active


async def test_reply_survives_delivery_disconnect(setup, monkeypatch):
    svc, client = setup
    sid = svc.create_session()['id']
    started, release = asyncio.Event(), asyncio.Event()

    class Delayed(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'data: {"choices":[{"delta":{"content":"first"}}]}\n\n'
            started.set()
            await release.wait()
            yield b'data: {"choices":[{"delta":{"content":"second"}}]}\n\n'

    upstream(monkeypatch, lambda request: httpx.Response(200, stream=Delayed()))
    delivery = asyncio.create_task(client.post(f'/api/assistant/sessions/{sid}/messages', json={'content': 'hello'}))
    await asyncio.wait_for(started.wait(), 2)
    delivery.cancel()
    with pytest.raises(asyncio.CancelledError):
        await delivery
    assert svc.session(sid)['active']
    release.set()
    await asyncio.gather(*svc.chat_tasks)
    final = svc.session(sid)
    assert not final['active'] and final['messages'][-1]['status'] == 'complete'
    assert final['messages'][-1]['content'] == 'firstsecond'


async def test_stop_interrupts_upstream_before_response_headers(setup, monkeypatch):
    svc, client = setup
    sid = svc.create_session()['id']
    started = asyncio.Event()
    never = asyncio.Event()

    async def handler(request):
        started.set()
        await never.wait()
        return httpx.Response(200)

    upstream(monkeypatch, handler)
    delivery = asyncio.create_task(client.post(f'/api/assistant/sessions/{sid}/messages', json={'content': 'hello'}))
    await asyncio.wait_for(started.wait(), 2)
    assert svc.active[sid]['response'] is None
    stopped = await asyncio.wait_for(client.post(f'/api/assistant/sessions/{sid}/stop'), .5)
    assert stopped.status_code == 200
    response = await asyncio.wait_for(delivery, .5)
    assert 'event: done' in response.text
    final = svc.session(sid)
    assert not final['active']
    assert final['messages'][-1]['status'] == 'stopped'


async def test_voice_transcription_serializes_and_cancelled_upload_cleans_up(setup, monkeypatch):
    svc, client = setup
    monkeypatch.setattr('yue2_studio.assistant_service.audio.probe_duration', lambda path: 2)
    first_started, second_started, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
    calls, running, peak = 0, 0, 0

    async def transcription(path):
        nonlocal calls, running, peak
        calls += 1
        running += 1
        peak = max(peak, running)
        (first_started if calls == 1 else second_started).set()
        try:
            await release.wait()
            return {'success': True, 'transcript': '写一首歌'}
        finally:
            running -= 1

    monkeypatch.setattr(svc, 'transcribe_audio', transcription)
    first = asyncio.create_task(client.post('/api/assistant/audio',
                                            files={'file': ('first.wav', b'voice1', 'audio/wav')}))
    await asyncio.wait_for(first_started.wait(), 2)
    second = asyncio.create_task(client.post('/api/assistant/audio',
                                             files={'file': ('second.wav', b'voice2', 'audio/wav')}))
    await asyncio.sleep(.02)
    assert calls == 1
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    await asyncio.wait_for(second_started.wait(), .5)
    release.set()
    response = await second
    assert response.status_code == 201 and peak == 1
    assert sorted(path.suffix for path in svc.audio_dir.iterdir()) == ['.json', '.wav']


@pytest.mark.parametrize('mode', ['chat', 'lyrics'])
async def test_chat_and_lyrics_modes_persist_without_parsing_chat_as_song(setup, monkeypatch, mode):
    svc, client = setup
    sid = svc.create_session()['id']
    content = '{"title":"一个例子","lyrics":"这是 JSON 中的内容","description":"说明"}'
    captured = []

    def chat(request):
        captured.append(json.loads(request.content))
        chunk = json.dumps({'choices': [{'delta': {'content': content}}]})
        return httpx.Response(200, text='data: ' + chunk + '\n\ndata: [DONE]\n\n')

    upstream(monkeypatch, chat)
    response = await client.post(f'/api/assistant/sessions/{sid}/messages', json={'content': 'hi', 'mode': mode})
    assert response.status_code == 200
    recreated = AssistantService(svc.root.parent, hermes_home=svc.hermes_home)
    messages = recreated.session(sid)['messages']
    assert [message['mode'] for message in messages] == [mode, mode]
    assert messages[-1]['content'] == content
    assert messages[-1]['suggestion'] is None
    assert '仅输出JSON对象' not in captured[0]['messages'][-1]['content']
    assert '<music_proposal>' in captured[0]['messages'][0]['content']


async def test_message_mode_migration_keeps_untyped_history_and_existing_song_drafts(setup):
    svc, _ = setup
    sid = svc.create_session()['id']
    svc.save_message(sid, 'assistant', '普通回复')
    svc.save_message(sid, 'assistant', '{"title":"旧歌"}', suggestion={'title': '旧歌'})
    # Simulate a pre-mode database, including the existing audio/model columns.
    with svc.db() as db:
        db.execute('ALTER TABLE messages DROP COLUMN mode')
    recreated = AssistantService(svc.root.parent, hermes_home=svc.hermes_home)
    messages = recreated.session(sid)['messages']
    assert messages[0]['content'] == '普通回复' and messages[0]['mode'] is None
    assert messages[1]['suggestion'] == {'title': '旧歌'} and messages[1]['mode'] is None
    recreated.save_message(sid, 'assistant', '新的聊天', mode='chat')
    assert recreated.session(sid)['messages'][-1]['mode'] == 'chat'


@pytest.mark.parametrize('mode', ['chat', 'lyrics'])
async def test_explicit_proposal_stream_hides_every_protocol_chunk_and_preserves_prose(setup, monkeypatch, mode):
    svc, _ = setup
    sid = svc.create_session()['id']
    proposal = {'title': '海风', 'description': '轻柔吉他，温暖宁静', 'lyrics': '', 'music_kind': 'instrumental'}
    raw = '方向很清楚了。\n<music_proposal>' + json.dumps(proposal, ensure_ascii=False) + '</music_proposal>\n可以直接生成，也可以再调整。'

    def chat(request):
        body = ''.join('data: ' + json.dumps({'choices': [{'delta': {'content': char}}]}) + '\n\n' for char in raw)
        return httpx.Response(200, text=body + 'data: [DONE]\n\n')

    upstream(monkeypatch, chat)
    run = svc.reserve(sid)
    deltas = []
    async for event, data in svc.stream(sid, '可以发歌了', mode, None, run):
        if event == 'delta':
            deltas.append(data['text'])
            assert '<' not in ''.join(deltas)
            assert 'music_kind' not in ''.join(deltas)
            assert svc.session(sid)['messages'][-1]['mode'] == mode
    reply = svc.session(sid)['messages'][-1]
    assert ''.join(deltas) == '方向很清楚了。\n\n可以直接生成，也可以再调整。'
    assert reply['content'] == ''.join(deltas)
    assert reply['suggestion'] == proposal
    assert reply['status'] == 'complete'


@pytest.mark.parametrize('raw', [
    '<music_proposal>{"title":"unfinished',
    '<music_proposal>{"title":"invalid"}</music_proposal>',
    '<music_proposal>not json</music_proposal>',
])
async def test_incomplete_or_invalid_proposals_never_leak_json_or_create_cards(setup, monkeypatch, raw):
    svc, _ = setup
    sid = svc.create_session()['id']
    chunk = json.dumps({'choices': [{'delta': {'content': '先聊聊方向。' + raw}}]})
    upstream(monkeypatch, lambda request: httpx.Response(200, text='data: ' + chunk + '\n\ndata: [DONE]\n\n'))
    events = [event async for event in svc.stream(sid, '写歌', 'lyrics', None, svc.reserve(sid))]
    reply = svc.session(sid)['messages'][-1]
    assert reply['content'] == '先聊聊方向。'
    assert reply['suggestion'] is None and reply['status'] == 'error'
    assert any(event == 'error' for event, data in events)
    assert all('music_proposal' not in data.get('text', '') for event, data in events)


def test_proposal_requires_explicit_marker_and_complete_music_direction():
    assert music_proposal('{"title":"raw JSON","lyrics":"x","description":"x"}') is None
    assert music_proposal('<music_proposal>{"title":"歌","lyrics":"","description":"流行","music_kind":"vocal"}</music_proposal>') is None
    assert music_proposal('<music_proposal>{"title":"歌","lyrics":"[verse]风","description":"流行","music_kind":"vocal"}</music_proposal>')['lyrics'] == '[verse]风'
    assert visible_reply('自然回答 <music_pro') == '自然回答 '
    assert visible_reply('1 < 2，仍然是普通文字') == '1 < 2，仍然是普通文字'


async def test_non_speech_audio_is_kept_as_inspiration_without_claiming_melody_understanding(setup, monkeypatch):
    svc, client = setup
    monkeypatch.setattr('yue2_studio.assistant_service.audio.probe_duration', lambda path: 4)

    async def transcription(path):
        return {'success': True, 'transcript': ''}

    monkeypatch.setattr(svc, 'transcribe_audio', transcription)
    uploaded = await client.post('/api/assistant/audio', files={'file': ('hum.wav', b'audio', 'audio/wav')})
    assert uploaded.status_code == 201
    attachment = uploaded.json()
    assert attachment['transcript'] == '' and attachment['transcription_status'] == 'no_speech'
    assert (await client.get(attachment['url'])).content == b'audio'
    captured = []

    def chat(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"想用它表达什么样的情绪？"}}]}\n\ndata: [DONE]\n\n')

    upstream(monkeypatch, chat)
    sid = svc.create_session()['id']
    response = await client.post(f'/api/assistant/sessions/{sid}/messages', json={'audio_id': attachment['id'], 'mode': 'chat'})
    assert response.status_code == 200 and 'event: error' not in response.text
    session = svc.session(sid)
    assert session['title'] == '音频灵感'
    assert session['messages'][0]['audio'] == attachment
    assert session['messages'][-1]['status'] == 'complete'
    assert session['messages'][-1]['suggestion'] is None
    assert '没有分析音频中的旋律' in captured[0]['messages'][-1]['content']
    assert '不要声称听懂或猜测其内容' in captured[0]['messages'][-1]['content']
    await client.post(f'/api/assistant/sessions/{sid}/messages', json={'content': '想要轻快、开心的感觉'})
    assert any('没有分析音频中的旋律' in message['content'] for message in captured[1]['messages'][:-1])


async def test_image_only_session_uses_an_image_title_and_missing_image_releases_run(setup, monkeypatch):
    svc, _ = setup
    image = {'id': 'image', 'filename': 'picture.jpg'}
    monkeypatch.setattr('yue2_studio.assistant_images.image_content',
                        lambda root, record: {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,aW1hZ2U='}})
    upstream(monkeypatch, lambda request: httpx.Response(200, text='data: {"choices":[{"delta":{"content":"想给这个画面什么感觉？"}}]}\n\ndata: [DONE]\n\n'))
    sid = svc.create_session()['id']
    events = [event async for event in svc.stream(sid, '', 'chat', None, svc.reserve(sid), image_attachment=image)]
    assert svc.session(sid)['title'] == '图片灵感'
    assert svc.session(sid)['messages'][-1]['status'] == 'complete'

    def disappeared(root, record):
        raise FileNotFoundError('image disappeared after request validation')

    monkeypatch.setattr('yue2_studio.assistant_images.image_content', disappeared)
    sid = svc.create_session()['id']
    events = [event async for event in svc.stream(sid, '', 'chat', None, svc.reserve(sid), image_attachment=image)]
    assert any(event == 'error' and data['code'] == 'image_missing' for event, data in events)
    assert svc.session(sid)['messages'][-1]['status'] == 'error'
    assert not svc.active
