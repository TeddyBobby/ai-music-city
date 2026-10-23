"""Private provider overrides and side-effect-free checks; every provider is mocked."""
import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI

from yue2_studio.api import install_error_handlers
from yue2_studio.assistant_api import router
from yue2_studio.assistant_service import AssistantService, endpoint_url

HTTP_CLIENT = httpx.AsyncClient


@pytest.fixture(autouse=True)
def deployment(monkeypatch):
    monkeypatch.setenv('AMC_ASSISTANT_BASE_URL', 'https://default.example/v1')
    monkeypatch.setenv('AMC_ASSISTANT_MODEL', 'default-model')
    monkeypatch.setenv('AMC_ASSISTANT_API_KEY', 'deployment-fixture-key')


@pytest.fixture
async def connection(tmp_path):
    app = FastAPI()
    app.state.assistant = AssistantService(tmp_path / 'data', hermes_home=tmp_path / 'hermes')
    install_error_handlers(app)
    app.include_router(router)
    async with HTTP_CLIENT(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1') as client:
        yield app.state.assistant, client
    await app.state.assistant.close()


def provider(monkeypatch, handler):
    monkeypatch.setattr('yue2_studio.assistant_service.httpx.AsyncClient',
                        lambda **kwargs: HTTP_CLIENT(transport=httpx.MockTransport(handler)))


def models(model='available-model'):
    return httpx.Response(200, json={'data': [{'id': model}]})


@pytest.mark.parametrize('base,expected', [
    ('https://api.deepseek.com', 'https://api.deepseek.com'),
    ('https://api.deepseek.com/v1/', 'https://api.deepseek.com/v1'),
    ('https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
    ('https://open.bigmodel.cn/api/paas/v4', 'https://open.bigmodel.cn/api/paas/v4'),
    ('http://127.0.0.1:8642', 'http://127.0.0.1:8642/v1'),
    ('http://localhost:1234/v1', 'http://localhost:1234/v1'),
    ('http://localhost:1234', 'http://localhost:1234'),
])
async def test_check_uses_provider_prefix_for_models_and_chat(connection, monkeypatch, base, expected):
    svc, client = connection
    called = []
    provider(monkeypatch, lambda request: called.append(request) or models())
    response = await client.post('/api/assistant/check', json={
        'hermes_base_url': base, 'hermes_api_key': 'draft-fixture-key'})
    assert response.status_code == 200 and response.json()['chat']['available']
    assert str(called[0].url) == expected + '/models'
    assert called[0].headers['authorization'] == 'Bearer draft-fixture-key'
    assert endpoint_url(base, 'chat/completions') == expected + '/chat/completions'
    assert not svc.chat_settings_path.exists()


async def test_draft_success_failure_and_empty_body_do_not_replace_saved_connection(connection, monkeypatch):
    svc, client = connection
    svc.update_config({'hermes_base_url': 'https://saved.example/v1', 'hermes_api_key': 'saved-fixture-key'})
    called = []

    def handle(request):
        called.append(request)
        if request.headers.get('authorization') == 'Bearer wrong-fixture-key':
            return httpx.Response(401, text='private-fixture-diagnostic /private/provider')
        return models(request.url.host)

    provider(monkeypatch, handle)
    saved_catalog = await svc._model_catalog()
    saved_cache = svc.model_cache
    saved_check = svc.last_chat_check = ('sentinel',)
    settings = svc.settings_path.read_bytes()
    personal = svc.chat_settings_path.read_bytes()
    for credential, available in [('draft-fixture-key', True), ('wrong-fixture-key', False)]:
        response = await client.post('/api/assistant/check', json={
            'hermes_base_url': 'https://draft.example/api/paas/v4', 'hermes_api_key': credential})
        assert response.status_code == 200
        assert response.json()['chat']['available'] is available
        if not available:
            assert '鉴权失败' in response.json()['chat']['message']
            assert response.json()['chat']['error_code'] == 'models_unavailable'
        assert credential not in response.text and 'private-fixture-diagnostic' not in response.text
        assert '/private/provider' not in response.text
        assert svc.model_cache is saved_cache and svc.last_chat_check is saved_check
        assert svc.settings_path.read_bytes() == settings
        assert svc.chat_settings_path.read_bytes() == personal
    assert await svc._model_catalog() == saved_catalog
    assert len(called) == 3, 'draft checks must not overwrite or evict the saved catalog'
    for body in (None, {}):
        response = await client.post('/api/assistant/check', json=body)
        assert response.json()['chat']['model'] == 'saved.example'
        assert str(called[-1].url) == 'https://saved.example/v1/models'
    assert svc.settings_path.read_bytes() == settings and svc.chat_settings_path.read_bytes() == personal


@pytest.mark.parametrize('new_url', ['https://different.example/v1', 'https://saved.example/other/v1'])
@pytest.mark.parametrize('key_patch', [{}, {'hermes_api_key': ''}])
async def test_endpoint_change_cannot_forward_saved_or_default_keys(connection, monkeypatch, new_url, key_patch):
    svc, client = connection
    called = []
    provider(monkeypatch, lambda request: called.append(request) or models())
    # Even choosing the deployment's own URL does not borrow its server credential.
    await client.post('/api/assistant/check', json={'hermes_base_url': 'https://default.example/v1'})
    assert 'authorization' not in called[-1].headers
    svc.update_config({'hermes_base_url': 'https://saved.example/v1', 'hermes_api_key': 'saved-fixture-key'})
    patch = {'hermes_base_url': new_url, **key_patch}
    assert (await client.post('/api/assistant/check', json=patch)).json()['chat']['available']
    assert 'authorization' not in called[-1].headers
    assert svc.config()['hermes_api_key'] == 'saved-fixture-key', 'draft cannot clear the saved key'
    saved = (await client.put('/api/assistant/config', json=patch)).json()
    assert saved['source'] == 'custom' and saved['has_hermes_api_key'] is False
    await client.post('/api/assistant/check')
    assert 'authorization' not in called[-1].headers
    assert svc.server_config()['hermes_api_key'] == 'deployment-fixture-key'


async def test_same_endpoint_keeps_only_personal_key_and_reset_restores_default(connection, monkeypatch):
    svc, client = connection
    default = (await client.get('/api/assistant/config')).json()
    assert default == {'hermes_base_url': '', 'has_hermes_api_key': False,
                       'source': 'default', 'default_configured': True}
    cfg = {'hermes_base_url': 'https://mine.example/v1', 'hermes_api_key': 'personal-fixture-key'}
    response = await client.put('/api/assistant/config', json=cfg)
    assert 'personal-fixture-key' not in response.text
    assert svc.chat_settings_path.stat().st_mode & 0o777 == 0o600
    svc.update_config({'hermes_base_url': cfg['hermes_base_url'] + '/', 'hermes_api_key': ''})
    assert svc.config()['hermes_api_key'] == 'personal-fixture-key'
    restarted = AssistantService(svc.root.parent, hermes_home=svc.hermes_home)
    assert restarted.config()['hermes_api_key'] == 'personal-fixture-key'
    assert restarted.config()['hermes_model'] == '', 'do not reuse a model from the deployment provider'
    assert (await client.put('/api/assistant/config', json={'hermes_base_url': ''})).json() == default
    assert not svc.chat_settings_path.exists()
    called = []
    provider(monkeypatch, lambda request: called.append(request) or models())
    assert (await client.post('/api/assistant/check')).json()['chat']['available']
    assert called[0].headers['authorization'] == 'Bearer deployment-fixture-key'


@pytest.mark.parametrize('url', [
    'http://remote.example/v1', 'file:///private/file', 'https://user:password@example.test/v1',
    'https://example.test/v1?key=private', 'https://example.test/v1#private',
    'https://example.test:invalid/v1', 'https://example.test:70000/v1', 'https://bad host.test/v1',
    'https://example.test/\nv1',
])
async def test_invalid_draft_urls_are_rejected_before_request_or_save(connection, monkeypatch, url):
    svc, client = connection
    provider(monkeypatch, lambda request: pytest.fail('Invalid draft reached provider'))
    for route, method in [('/api/assistant/check', 'POST'), ('/api/assistant/config', 'PUT')]:
        response = await client.request(method, route, json={'hermes_base_url': url, 'hermes_api_key': 'fixture-key'})
        assert response.status_code == 400 and response.json()['error']['code'] == 'invalid_url'
        assert 'fixture-key' not in response.text
    assert not svc.chat_settings_path.exists()


async def test_accounts_including_legacy_owner_manage_only_their_own_provider(app, client, monkeypatch):
    async with HTTP_CLIENT(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1') as other:
        registered = await other.post('/api/auth/register', json={
            'email': 'provider-owner@example.test', 'password': 'provider-test-password-42'})
        assert registered.status_code == 201
        owner_service = app.state.assistant
        baseline = owner_service.settings_path.read_bytes()
        owner = {'hermes_base_url': 'https://owner.example/v1', 'hermes_api_key': 'owner-fixture-key'}
        second = {'hermes_base_url': 'https://second.example/v1', 'hermes_api_key': 'second-fixture-key'}
        assert (await client.put('/api/assistant/config', json=owner)).status_code == 200
        assert (await other.get('/api/assistant/config')).json()['source'] == 'default'
        calls = []
        provider(monkeypatch, lambda request: calls.append(request) or models(request.url.host))
        assert (await other.post('/api/assistant/check')).json()['chat']['model'] == 'default.example'
        assert calls[-1].headers['authorization'] == 'Bearer deployment-fixture-key'
        assert (await other.put('/api/assistant/config', json=second)).status_code == 200
        first, second_result = await asyncio.gather(client.post('/api/assistant/check'), other.post('/api/assistant/check'))
        assert first.json()['chat']['model'] == 'owner.example'
        assert second_result.json()['chat']['model'] == 'second.example'
        assert (await client.get('/api/assistant/config')).json()['hermes_base_url'] == owner['hermes_base_url']
        assert (await other.get('/api/assistant/config')).json()['hermes_base_url'] == second['hermes_base_url']
        assert owner_service.settings_path.read_bytes() == baseline
        assert (await client.put('/api/assistant/config', json={'hermes_base_url': ''})).json()['source'] == 'default'
        assert (await other.get('/api/assistant/config')).json()['source'] == 'custom'
        await other.post('/api/auth/logout')
        assert (await other.get('/api/assistant/config')).status_code == 401
        assert (await other.post('/api/assistant/check', json=second)).status_code == 401


async def test_custom_prefix_used_by_actual_chat_request(connection, monkeypatch):
    svc, _ = connection
    svc.update_config({'hermes_base_url': 'https://vision.example/api/paas/v4', 'hermes_api_key': 'personal-fixture-key'})
    requests = []

    def handle(request):
        requests.append(request)
        if request.url.path.endswith('/models'):
            return models('custom-chat')
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n')

    provider(monkeypatch, handle)
    selected = await svc.request_model(None)
    session = svc.create_session()
    events = [event async for event in svc.stream(session['id'], '你好', 'chat', None,
                                                 svc.reserve(session['id']), model=selected)]
    assert events[-1][0] == 'done'
    assert [str(request.url) for request in requests] == [
        'https://vision.example/api/paas/v4/models', 'https://vision.example/api/paas/v4/chat/completions']
    assert json.loads(requests[-1].content)['model'] == 'custom-chat'
    assert requests[-1].headers['authorization'] == 'Bearer personal-fixture-key'


async def test_invalid_legacy_fallback_url_does_not_echo_embedded_credentials(connection, monkeypatch):
    svc, client = connection
    svc._save_config({**svc.server_config(), 'hermes_base_url': 'https://old-user:private-fixture@example.test/v1'})
    provider(monkeypatch, lambda request: pytest.fail('Invalid saved fallback reached provider'))
    response = await client.get('/api/assistant/status')
    assert response.status_code == 200
    assert response.json()['chat']['base_url'] == ''
    assert response.json()['chat']['error_code'] == 'invalid_url'
    assert 'private-fixture' not in response.text and 'old-user' not in response.text


@pytest.mark.parametrize('old_status', [200, 401])
async def test_status_does_not_label_new_model_with_old_connection(connection, monkeypatch, old_status):
    svc, client = connection
    entered, release = asyncio.Event(), asyncio.Event()

    async def handle(request):
        if request.url.host == 'default.example':
            entered.set()
            await release.wait()
            if old_status != 200:
                return httpx.Response(old_status)
        return models(request.url.host)

    provider(monkeypatch, handle)
    task = asyncio.create_task(client.post('/api/assistant/check'))
    await asyncio.wait_for(entered.wait(), 2)
    svc.update_config({'hermes_base_url': 'https://new.example/api/v4', 'hermes_api_key': 'new-fixture-key'})
    release.set()
    status = (await task).json()['chat']
    assert status['base_url'] == 'https://new.example/api/v4'
    assert status['model'] == 'new.example'
