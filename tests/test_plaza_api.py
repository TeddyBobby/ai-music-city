"""Exercise local publication persistence, eligibility and feed contracts in temp storage."""
import shutil
import json
import sqlite3
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from yue2_studio import api, jobs
from yue2_studio.plaza_api import install
from yue2_studio.plaza_service import PlazaService
from yue2_studio.review_service import ReviewService


@pytest.fixture
async def plaza(tmp_path):
    app = FastAPI()
    app.state.paths = SimpleNamespace(data_dir=tmp_path / 'data', songs_dir=tmp_path / 'data/songs')
    app.state.store = jobs.JobStore(tmp_path / 'data/app.db', app.state.paths.songs_dir)
    app.state.worker = SimpleNamespace(
        bus=SimpleNamespace(last=lambda _id: None),
        delete_song_dir=lambda job_id: shutil.rmtree(app.state.paths.songs_dir / job_id, ignore_errors=True))
    app.state.reviews = ReviewService(app.state.paths.data_dir, None)
    api.install_error_handlers(app)
    app.include_router(api.router)
    install(app)

    def add(*, title='午后微风', style='gentle acoustic pop', lyrics='[Verse]\n风吹过窗台',
            status='done', audio=True):
        job = jobs.submit(app.state.store, {'kind': 'create', 'params': {
            'title': title, 'style': style, 'lyrics': lyrics}}).jobs[0]
        app.state.store.update_status(job.id, status)
        if audio:
            song_dir = app.state.paths.songs_dir / job.id / 'song'
            song_dir.mkdir(parents=True)
            (song_dir / 'audio.flac').write_bytes(b'fixture artifact')
        return job.id

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url='http://127.0.0.1:8765') as client:
        yield app, client, add
    app.state.store.close()


async def test_publish_update_and_restart_keep_one_post(plaza, monkeypatch):
    app, client, add = plaza
    job_id = add()
    assert (await client.get(f'/api/plaza/{job_id}')).json() == {'post': None, 'scope': 'local'}
    stamps = iter(('2026-10-21T01:00:00.000Z', '2026-10-21T01:10:00.000Z'))
    monkeypatch.setattr('yue2_studio.plaza_service.now_iso', lambda: next(stamps))
    response = await client.put(f'/api/plaza/{job_id}', json={'caption': '  第一次分享  '})
    assert response.status_code == 200
    assert response.json()['scope'] == 'local'
    first = response.json()['post']
    assert first['id'] == first['job_id'] == job_id
    assert first['caption'] == '第一次分享'
    assert first['author'] == {'id': 'local', 'name': '本机创作者'}
    assert first['can_manage'] is True and 'kind' not in first
    assert first['job']['title'] == '午后微风' and first['job']['artifacts']['audio']
    assert first['published_at'] == first['updated_at']
    updated = (await client.put(f'/api/plaza/{job_id}', json={'caption': '新的文案'})).json()['post']
    assert updated['published_at'] == first['published_at']
    assert updated['updated_at'] > first['updated_at']
    app.state.plaza = PlazaService(app.state.paths.data_dir)
    assert (await client.get(f'/api/plaza/{job_id}')).json()['post'] == updated
    feed = (await client.get('/api/plaza')).json()
    assert feed == {'posts': [updated], 'total': 1, 'scope': 'local'}


async def test_withdraw_is_idempotent_and_preserves_original_and_reviews(plaza):
    app, client, add = plaza
    job_id = add()
    reviews = ReviewService(app.state.paths.data_dir, None)
    saved_review = reviews.save_manual(job_id, 7.1, '保留个人评论')
    await client.put(f'/api/plaza/{job_id}', json={'caption': ''})
    for _ in range(2):
        response = await client.delete(f'/api/plaza/{job_id}')
        assert response.status_code == 204 and not response.content
    assert (await client.get('/api/plaza')).json()['total'] == 0
    assert (await client.get(f'/api/plaza/{job_id}')).json()['post'] is None
    assert app.state.store.get(job_id).status == 'done'
    assert (app.state.paths.songs_dir / job_id / 'song/audio.flac').is_file()
    assert reviews.get(job_id) == saved_review
    # Withdrawal also remains available after an artifact is lost.
    await client.put(f'/api/plaza/{job_id}', json={'caption': '再发布'})
    (app.state.paths.songs_dir / job_id / 'song/audio.flac').unlink()
    assert (await client.delete(f'/api/plaza/{job_id}')).status_code == 204


@pytest.mark.parametrize('body', [{}, {'caption': None}, {'caption': 1}, {'caption': False},
                                 {'caption': ['text']}, {'caption': 'x' * 601},
                                 {'caption': '', 'author': {'id': 'somebody'}}])
async def test_rejects_invalid_publications_without_saving(plaza, body):
    app, client, add = plaza
    job_id = add()
    response = await client.put(f'/api/plaza/{job_id}', json=body)
    assert response.status_code == 400
    assert response.json()['error']['code'] == 'validation_error'
    assert app.state.plaza.get(job_id) is None


async def test_caption_boundary_plain_text_and_malformed_json(plaza):
    _, client, add = plaza
    job_id = add()
    caption = '<script>example</script>' + '词' * (600 - len('<script>example</script>'))
    assert len(caption) == 600
    response = await client.put(f'/api/plaza/{job_id}', json={'caption': caption})
    assert response.status_code == 200 and response.json()['post']['caption'] == caption
    invalid = await client.put(f'/api/plaza/{job_id}', content='{broken',
                               headers={'content-type': 'application/json'})
    assert invalid.status_code == 400 and invalid.json()['error']['code'] == 'validation_error'
    assert (await client.get(f'/api/plaza/{job_id}')).json()['post']['caption'] == caption


@pytest.mark.parametrize('status,audio', [('queued', True), ('running', True), ('failed', True),
                                        ('cancelled', True), ('done', False)])
async def test_publish_requires_completed_audio(plaza, status, audio):
    _, client, add = plaza
    job_id = add(status=status, audio=audio)
    assert (await client.get(f'/api/plaza/{job_id}')).status_code == 409
    response = await client.put(f'/api/plaza/{job_id}', json={'caption': ''})
    assert response.status_code == 409 and response.json()['error']['code'] == 'not_completed'
    assert (await client.get('/api/plaza')).json()['total'] == 0


async def test_unknown_job_returns_404(plaza):
    _, client, _ = plaza
    for method in ('GET', 'PUT', 'DELETE'):
        response = await client.request(method, '/api/plaza/missing',
                                        **({'json': {'caption': ''}} if method == 'PUT' else {}))
        assert response.status_code == 404 and response.json()['error']['code'] == 'not_found'


async def test_feed_filters_searches_paginates_and_reads_live_title(plaza):
    app, client, add = plaza
    first = add(title='晴天', style='Acoustic Jazz', lyrics='[Intro]\n[Outro]')
    second = add(title='晚风', style='gentle piano', lyrics='[Verse]\n轻轻唱')
    third = add(title='星空', style='ambient', lyrics='[Intro]')
    for job_id, caption in ((first, '安静的午后'), (second, '夜色很温柔'), (third, '最后一颗星')):
        await client.put(f'/api/plaza/{job_id}', json={'caption': caption})
    feed = (await client.get('/api/plaza?offset=1&limit=1')).json()
    assert feed['total'] == 3 and [p['id'] for p in feed['posts']] == [second]
    for needle, expected in [(' 晴天 ', first), ('JAZZ', first), ('温柔', second)]:
        result = (await client.get('/api/plaza', params={'query': needle})).json()
        assert result['total'] == 1 and result['posts'][0]['id'] == expected
    assert (await client.get('/api/plaza?query=%25')).json()['total'] == 0
    assert (await client.get('/api/plaza?offset=99')).json() == {'posts': [], 'total': 3, 'scope': 'local'}
    assert (await client.get('/api/plaza?query=不存在')).json()['total'] == 0
    app.state.store.set_title(second, '重新命名')
    renamed = (await client.get('/api/plaza', params={'query': '重新命名'})).json()
    assert renamed['total'] == 1 and renamed['posts'][0]['job']['title'] == '重新命名'


@pytest.mark.parametrize('query', ['offset=-1', 'offset=nope', 'limit=0',
                                  'limit=101', 'limit=3.5', 'query=' + 'x' * 201])
async def test_rejects_invalid_feed_parameters(plaza, query):
    _, client, _ = plaza
    response = await client.get('/api/plaza?' + query)
    assert response.status_code == 400 and response.json()['error']['code'] == 'validation_error'


async def test_deleted_or_invalid_songs_hidden_before_pagination(plaza):
    app, client, add = plaza
    valid, missing, deleted, failed = [add(title=str(i)) for i in range(4)]
    for job_id in (valid, missing, deleted, failed):
        await client.put(f'/api/plaza/{job_id}', json={'caption': ''})
    (app.state.paths.songs_dir / missing / 'song/audio.flac').unlink()
    # Exercise the real delete API, so its publication visibility is part of the contract.
    assert (await client.delete(f'/api/jobs/{deleted}')).status_code == 204
    app.state.store.update_status(failed, 'failed')
    feed = (await client.get('/api/plaza?limit=1')).json()
    assert feed['total'] == 1 and [p['id'] for p in feed['posts']] == [valid]
    assert (await client.get(f'/api/plaza/{deleted}')).status_code == 404


async def test_external_audio_symlink_cannot_be_published(plaza, tmp_path):
    app, client, add = plaza
    job_id = add()
    audio = app.state.paths.songs_dir / job_id / 'song/audio.flac'
    external = tmp_path / 'private.flac'
    audio.replace(external)
    audio.symlink_to(external)
    response = await client.put(f'/api/plaza/{job_id}', json={'caption': ''})
    assert response.status_code == 404
    assert app.state.plaza.get(job_id) is None


@pytest.mark.parametrize('headers', [{'origin': 'https://evil.example'}, {'host': 'evil.example'},
                                    {'origin': 'http://127.0.0.1:9999'}])
async def test_all_routes_require_loopback_and_same_origin(plaza, headers):
    _, client, add = plaza
    job_id = add()
    for method, path in (('GET', '/api/plaza'), ('GET', f'/api/plaza/{job_id}'),
                         ('PUT', f'/api/plaza/{job_id}'), ('DELETE', f'/api/plaza/{job_id}')):
        response = await client.request(method, path, headers=headers,
                                        **({'json': {'caption': ''}} if method == 'PUT' else {}))
        assert response.status_code == 403 and 'error' in response.json()
    allowed = await client.put(f'/api/plaza/{job_id}', json={'caption': ''},
                               headers={'origin': 'http://127.0.0.1:8765'})
    assert allowed.status_code == 200


async def test_storage_errors_use_private_json_message(plaza):
    app, client, add = plaza
    job_id = add()
    app.state.plaza.db_path = app.state.plaza.root  # A directory cannot be opened as SQLite.
    response = await client.put(f'/api/plaza/{job_id}', json={'caption': ''})
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'plaza_unavailable'
    assert str(app.state.plaza.root) not in response.text


async def test_factory_mounts_plaza_before_static(app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url='http://127.0.0.1') as client:
        response = await client.get('/api/plaza')
    assert response.status_code == 200
    assert response.json() == {'posts': [], 'total': 0, 'scope': 'local'}
    assert app.state.plaza.db_path.is_file()


def test_existing_single_publication_database_migrates_without_changes(tmp_path):
    root = tmp_path / 'plaza'
    root.mkdir()
    with sqlite3.connect(root / 'plaza.db') as db:
        db.execute('CREATE TABLE publications (job_id TEXT PRIMARY KEY, caption TEXT NOT NULL, '
                   'published_at TEXT NOT NULL, updated_at TEXT NOT NULL)')
        db.execute('INSERT INTO publications VALUES (?,?,?,?)',
                   ('old-job', '旧发布', '2026-10-20T00:00:00Z', '2026-10-20T01:00:00Z'))
    service = PlazaService(tmp_path)
    assert service.get('old-job') == {'job_id': 'old-job', 'caption': '旧发布',
                                     'published_at': '2026-10-20T00:00:00Z',
                                     'updated_at': '2026-10-20T01:00:00Z'}
    assert service.album_records() == []


async def test_album_create_order_update_restart_and_independent_withdrawal(plaza, monkeypatch):
    app, client, add = plaza
    first, second, third = [add(title=name) for name in ('晴天', '夜色', '月光')]
    app.state.store.set_timing(first, {}, audio_seconds=10.5)
    app.state.store.set_timing(second, {}, audio_seconds=20)
    await client.put(f'/api/plaza/{first}', json={'caption': '独立单曲'})
    review = app.state.reviews.save_manual(first, 8.2, '保留')
    stamps = iter(('2026-10-21T01:00:00.000Z', '2026-10-21T01:10:00.000Z'))
    monkeypatch.setattr('yue2_studio.plaza_service.now_iso', lambda: next(stamps))
    body = {'title': '  四季  ', 'caption': '  两首作品  ', 'job_ids': [second, first]}
    response = await client.post('/api/plaza/albums', json=body)
    assert response.status_code == 201
    assert response.json()['scope'] == 'local'
    created = response.json()['album']
    album_id = created['id']
    assert created['title'] == '四季' and created['caption'] == '两首作品'
    assert created['job_ids'] == [second, first]
    assert [track['id'] for track in created['tracks']] == [second, first]
    assert created['track_count'] == 2 and created['unavailable_count'] == 0
    assert created['duration_seconds'] == 30.5
    assert created['author'] == {'id': 'local', 'name': '本机创作者'}
    assert created['can_manage'] is True
    assert created['published_at'] == created['updated_at']
    # Album publication does not publish its songs as individual singles.
    assert (await client.get('/api/plaza')).json()['total'] == 1
    assert (await client.get(f'/api/plaza/{second}')).json()['post'] is None
    update = await client.put(f'/api/plaza/albums/{album_id}',
                              json={'title': '四季 · 新版', 'caption': '', 'job_ids': [third, first]})
    assert update.status_code == 200
    updated = update.json()['album']
    assert updated['published_at'] == created['published_at']
    assert updated['updated_at'] > created['updated_at']
    assert [track['id'] for track in updated['tracks']] == [third, first]
    app.state.plaza = PlazaService(app.state.paths.data_dir)
    assert (await client.get(f'/api/plaza/albums/{album_id}')).json()['album'] == updated
    assert (await client.get('/api/plaza/albums')).json() == {
        'albums': [updated], 'total': 1, 'scope': 'local'}
    for _ in range(2):
        assert (await client.delete(f'/api/plaza/albums/{album_id}')).status_code == 204
    assert (await client.get(f'/api/plaza/albums/{album_id}')).status_code == 404
    assert (await client.get('/api/plaza/albums')).json()['total'] == 0
    assert (await client.get('/api/plaza')).json()['total'] == 1
    for job_id in (first, second, third):
        assert app.state.store.get(job_id).status == 'done'
        assert (app.state.paths.songs_dir / job_id / 'song/audio.flac').is_file()
    assert app.state.reviews.get(first) == review


@pytest.mark.parametrize('invalid', [
    {'title': ''}, {'title': '   '}, {'title': 'x' * 81}, {'title': 42},
    {'caption': '词' * 601}, {'caption': None}, {'job_ids': []},
    {'job_ids': ['one']}, {'job_ids': ['one', 'one']}, {'job_ids': ['one', 2]},
    {'job_ids': [''] * 2}, {'job_ids': [str(i) for i in range(51)]}, {'author': 'other'},
])
async def test_album_invalid_input_never_saves(plaza, invalid):
    app, client, add = plaza
    body = {'title': '新专辑', 'caption': '', 'job_ids': [add(), add()]}
    body.update(invalid)
    response = await client.post('/api/plaza/albums', json=body)
    assert response.status_code == 400
    assert response.json()['error']['code'] == 'validation_error'
    assert app.state.plaza.album_records() == []


@pytest.mark.parametrize('status,audio', [('queued', True), ('running', True), ('failed', True),
                                        ('cancelled', True), ('done', False)])
async def test_album_checks_all_tracks_before_creating_or_editing(plaza, status, audio):
    app, client, add = plaza
    first, second = add(), add()
    bad = add(status=status, audio=audio)
    body = {'title': '专辑', 'caption': '', 'job_ids': [first, bad]}
    assert (await client.post('/api/plaza/albums', json=body)).status_code == 409
    assert app.state.plaza.album_records() == []
    original = (await client.post('/api/plaza/albums', json={**body, 'job_ids': [first, second]})).json()['album']
    assert (await client.put(f"/api/plaza/albums/{original['id']}", json=body)).status_code == 409
    assert (await client.get(f"/api/plaza/albums/{original['id']}")).json()['album'] == original


async def test_album_unknown_track_and_unknown_edit_return_404(plaza):
    app, client, add = plaza
    body = {'title': '专辑', 'caption': '', 'job_ids': [add(), 'missing']}
    assert (await client.post('/api/plaza/albums', json=body)).status_code == 404
    assert (await client.put('/api/plaza/albums/missing', json=body)).status_code == 404
    assert app.state.plaza.album_records() == []


async def test_album_keeps_record_and_original_order_when_tracks_are_lost(plaza):
    app, client, add = plaza
    first, second, third = [add() for _ in range(3)]
    app.state.store.set_timing(second, {}, audio_seconds=22.5)
    original = (await client.post('/api/plaza/albums', json={
        'title': '不丢失专辑', 'caption': '', 'job_ids': [first, second, third]})).json()['album']
    (app.state.paths.songs_dir / first / 'song/audio.flac').unlink()
    await client.delete(f'/api/jobs/{third}')
    item = (await client.get(f"/api/plaza/albums/{original['id']}")).json()['album']
    assert item['job_ids'] == [first, second, third]
    assert [track['id'] for track in item['tracks']] == [second]
    assert item['track_count'] == 1 and item['unavailable_count'] == 2
    assert item['duration_seconds'] == 22.5
    app.state.store.update_status(second, 'failed')
    feed = (await client.get('/api/plaza/albums')).json()
    assert feed['total'] == 1 and feed['albums'][0]['tracks'] == []
    assert feed['albums'][0]['unavailable_count'] == 3
    assert feed['albums'][0]['duration_seconds'] == 0
    assert (await client.delete(f"/api/plaza/albums/{original['id']}")).status_code == 204


async def test_album_search_and_pagination(plaza):
    _, client, add = plaza
    first, second = add(title='云朵'), add(style='Acoustic Jazz')
    albums = []
    for title, caption in (('春', '第一张'), ('夏', '暖意'), ('冬', '雪')):
        albums.append((await client.post('/api/plaza/albums', json={
            'title': title, 'caption': caption, 'job_ids': [first, second]})).json()['album'])
    feed = (await client.get('/api/plaza/albums?offset=1&limit=1')).json()
    assert feed['total'] == 3 and feed['albums'][0]['id'] == albums[1]['id']
    for query in ('夏', ' 暖意 '):
        searched = (await client.get('/api/plaza/albums', params={'query': query})).json()
        assert searched['total'] == 1 and searched['albums'][0]['id'] == albums[1]['id']
    for query in ('云朵', 'JAZZ'):
        assert (await client.get('/api/plaza/albums', params={'query': query})).json()['total'] == 3
    assert (await client.get('/api/plaza/albums?query=不存在')).json()['total'] == 0


def saved_ai(reviews, job_id, score, status='complete'):
    # A completed review fixture exercises persisted results without invoking a model.
    with reviews.db() as db:
        db.execute('INSERT INTO reviews (job_id,ai_status,ai_result) VALUES (?,?,?) '
                   'ON CONFLICT(job_id) DO UPDATE SET ai_status=excluded.ai_status,ai_result=excluded.ai_result',
                   (job_id, status, json.dumps({'score': score})))


async def test_rankings_separate_real_scores_only_for_playable_published_singles(plaza):
    app, client, add = plaza
    manual, ai, zero, unscored, private, failed_ai, stale_ai, missing = [add(title=str(i)) for i in range(8)]
    for job_id in (manual, ai, zero, unscored, failed_ai, stale_ai, missing):
        await client.put(f'/api/plaza/{job_id}', json={'caption': ''})
    app.state.reviews.save_manual(manual, 8.6, '')
    app.state.reviews.save_manual(zero, 0, '')
    app.state.reviews.save_manual(unscored, None, '只有评论')
    app.state.reviews.save_manual(private, 10, '')
    app.state.reviews.save_manual(missing, 9.8, '')
    saved_ai(app.state.reviews, ai, 8.2)
    saved_ai(app.state.reviews, manual, 6.1)
    saved_ai(app.state.reviews, private, 10)
    saved_ai(app.state.reviews, failed_ai, 9.9, 'failed')
    saved_ai(app.state.reviews, stale_ai, 9.9, 'running')
    (app.state.paths.songs_dir / missing / 'song/audio.flac').unlink()
    response = await client.get('/api/plaza/rankings')
    assert response.status_code == 200
    ranking = response.json()
    assert ranking['scope'] == 'local'
    assert [(r['rank'], r['score'], r['post']['id']) for r in ranking['manual']] == [(1, 8.6, manual), (2, 0, zero)]
    assert [(r['rank'], r['score'], r['post']['id']) for r in ranking['ai']] == [(1, 8.2, ai), (2, 6.1, manual)]
    # Publishing a collection alone must not promote its private track to the singles charts.
    await client.post('/api/plaza/albums', json={'title': '专辑', 'caption': '', 'job_ids': [private, ai]})
    assert (await client.get('/api/plaza/rankings')).json() == ranking
    await client.delete(f'/api/plaza/{manual}')
    assert [r['post']['id'] for r in (await client.get('/api/plaza/rankings')).json()['manual']] == [zero]


async def test_rankings_sort_stably_and_search_preserves_global_position(plaza, monkeypatch):
    app, client, add = plaza
    first, second, third, top = [add(title=name) for name in ('旧作品', '同日甲', '同日乙', '榜首')]
    stamps = iter(('2026-10-20T01:00:00Z', '2026-10-21T01:00:00Z',
                   '2026-10-21T01:00:00Z', '2026-10-19T01:00:00Z'))
    monkeypatch.setattr('yue2_studio.plaza_service.now_iso', lambda: next(stamps))
    for job_id in (first, second, third, top):
        await client.put(f'/api/plaza/{job_id}', json={'caption': '唯一描述' if job_id == first else ''})
        app.state.reviews.save_manual(job_id, 9 if job_id == top else 8, '')
    rank = (await client.get('/api/plaza/rankings')).json()['manual']
    expected = [top, *sorted((second, third)), first]
    assert [r['post']['id'] for r in rank] == expected
    for query in ('旧作品', '唯一描述'):
        results = (await client.get('/api/plaza/rankings', params={'query': query})).json()
        assert [(r['rank'], r['post']['id']) for r in results['manual']] == [(4, first)]
    app.state.reviews.save_manual(first, 10, '')
    assert (await client.get('/api/plaza/rankings')).json()['manual'][0]['post']['id'] == first


@pytest.mark.parametrize('path', ['/api/plaza/albums?limit=0', '/api/plaza/albums?offset=-1',
                                  '/api/plaza/albums?query=' + 'x' * 201,
                                  '/api/plaza/rankings?query=' + 'x' * 201])
async def test_album_and_ranking_query_validation(plaza, path):
    _, client, _ = plaza
    response = await client.get(path)
    assert response.status_code == 400 and response.json()['error']['code'] == 'validation_error'


async def test_album_and_ranking_routes_keep_local_access_boundary(plaza):
    _, client, add = plaza
    body = {'title': '专辑', 'caption': '', 'job_ids': [add(), add()]}
    album_id = (await client.post('/api/plaza/albums', json=body)).json()['album']['id']
    for method, path in (('GET', '/api/plaza/albums'), ('POST', '/api/plaza/albums'),
                         ('GET', f'/api/plaza/albums/{album_id}'),
                         ('PUT', f'/api/plaza/albums/{album_id}'),
                         ('DELETE', f'/api/plaza/albums/{album_id}'), ('GET', '/api/plaza/rankings')):
        response = await client.request(method, path, headers={'origin': 'https://elsewhere.example'},
                                        **({'json': body} if method in ('POST', 'PUT') else {}))
        assert response.status_code == 403


async def test_legacy_kind_parameter_is_ignored_and_absent_from_schema(plaza):
    app, client, add = plaza
    for job_id in (add(), add(lyrics='[Intro]')):
        await client.put(f'/api/plaza/{job_id}', json={'caption': ''})
    response = (await client.get('/api/plaza?kind=vocal')).json()
    assert response['total'] == 2
    assert all('kind' not in post for post in response['posts'])
    params = app.openapi()['paths']['/api/plaza']['get']['parameters']
    assert 'kind' not in {parameter['name'] for parameter in params}


@pytest.mark.parametrize('score', [True, False, float('nan'), float('inf'), -1, 11, '8.5', None])
async def test_rankings_skip_invalid_stored_scores(plaza, score):
    app, client, add = plaza
    job_id = add()
    await client.put(f'/api/plaza/{job_id}', json={'caption': ''})
    saved_ai(app.state.reviews, job_id, score)
    with app.state.reviews.db() as db:
        db.execute('UPDATE reviews SET manual=? WHERE job_id=?',
                   (json.dumps({'score': score, 'comment': ''}), job_id))
    assert (await client.get('/api/plaza/rankings')).json() == {'manual': [], 'ai': [], 'scope': 'local'}


async def test_rankings_limit_results_but_preserve_search_rank(plaza):
    app, client, add = plaza
    ids = []
    for number in range(101):
        job_id = add(title=f'曲目-{number}')
        app.state.plaza.publish(job_id, '')
        app.state.reviews.save_manual(job_id, 8, '')
        ids.append(job_id)
    response = (await client.get('/api/plaza/rankings')).json()
    assert len(response['manual']) == 100
    assert [entry['rank'] for entry in response['manual']] == list(range(1, 101))
    # The last song is still discoverable by search without being renumbered #1.
    all_records = app.state.plaza.records()
    ordered = sorted(all_records, key=lambda record: record['job_id'])
    ordered.sort(key=lambda record: record['published_at'], reverse=True)
    last = ordered[-1]['job_id']
    app.state.store.set_title(last, '唯一榜尾')
    filtered = (await client.get('/api/plaza/rankings', params={'query': '唯一榜尾'})).json()
    assert [(entry['rank'], entry['post']['id']) for entry in filtered['manual']] == [(101, last)]


async def test_album_external_audio_is_rejected(plaza, tmp_path):
    app, client, add = plaza
    first, second = add(), add()
    audio = app.state.paths.songs_dir / second / 'song/audio.flac'
    external = tmp_path / 'private.flac'
    audio.replace(external)
    audio.symlink_to(external)
    response = await client.post('/api/plaza/albums', json={
        'title': '专辑', 'caption': '', 'job_ids': [first, second]})
    assert response.status_code == 404
    assert app.state.plaza.album_records() == []
