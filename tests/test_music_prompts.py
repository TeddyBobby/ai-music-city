"""Exercise music-intent guidance at real provider request boundaries, without inference."""

import json

import httpx
import pytest

from yue2_studio import assist, config, engines, jobs, worker
from yue2_studio.assistant_service import AssistantService
from yue2_studio.fake import FakeEngine
from yue2_studio.music_prompts import MUSIC_INTENT_POLICY

STYLE_REQUEST = "lo-fi hip hop，96 BPM，温暖电钢琴，干燥鼓组，克制女声"
EXPLICIT_LYRICS_REQUEST = '轻快民谣，歌词写离家求学的故事，副歌保留原句“明天的车票在口袋里”'
STYLE = "lo-fi hip hop, 96 BPM, warm electric piano, dry drums, restrained female vocals"
LYRICS = "[Verse]\n楼下的灯替我留着门\n旧外套挂着一天的风\n[Chorus]\n把没说完的话放在窗边\n等第一班车慢慢经过"
EXPLICIT_LYRICS = (
    "[Verse]\n母亲把围巾折了又折\n我数着站台的钟\n[Chorus]\n明天的车票在口袋里\n故乡还睡在掌心中"
)
HTTP_CLIENT = httpx.Client
HTTP_ASYNC_CLIENT = httpx.AsyncClient


@pytest.fixture
def draft_provider(monkeypatch):
    """Replace only config/network; run the worker's request construction and parser."""
    captured = []
    answer = {}
    config = {
        "hermes_base_url": "https://music-provider.example.test/v1",
        "hermes_api_key": "fixture-key",
        "hermes_model": "fixture-music-model",
    }
    monkeypatch.setattr(worker, "_assistant_cfg", lambda: config)

    def route(request):
        assert request.method == "POST"
        assert str(request.url) == "https://music-provider.example.test/v1/chat/completions"
        captured.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {
            "content": json.dumps(answer, ensure_ascii=False),
        }}]})

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: HTTP_CLIENT(
        transport=httpx.MockTransport(route), **kwargs,
    ))
    return answer, captured


@pytest.mark.parametrize(("description", "lyrics"), [
    pytest.param(STYLE_REQUEST, LYRICS, id="sound-keywords-are-not-lyrics"),
    pytest.param(EXPLICIT_LYRICS_REQUEST, EXPLICIT_LYRICS, id="explicit-story-and-line-preserved"),
])
def test_worker_sends_music_policy_and_keeps_style_and_lyrics_separate(draft_provider, description, lyrics):
    answer, captured = draft_provider
    answer.update(title="  第一班车  ", style=f" {STYLE} ", lyrics=f" {lyrics} ")

    draft = worker._ai_complete_draft(description, "vocal")

    assert len(captured) == 1
    request = captured[0]
    assert request["model"] == "fixture-music-model" and request["stream"] is False
    assert [message["role"] for message in request["messages"]] == ["system", "user"]
    assert MUSIC_INTENT_POLICY in request["messages"][0]["content"]
    assert request["messages"][1]["content"] == f"创作想法：{description}"
    assert draft == {"title": "第一班车", "style": STYLE, "lyrics": lyrics}
    assert "96 BPM" in draft["style"] and "96 BPM" not in draft["lyrics"]
    if description == EXPLICIT_LYRICS_REQUEST:
        assert "明天的车票在口袋里" in draft["lyrics"]
    else:
        assert draft["lyrics"] != description


def test_worker_instrumental_only_asks_for_music_and_ignores_accidental_lyric_output(draft_provider):
    answer, captured = draft_provider
    answer.update(title="窗边", style="ambient, felt piano, slow tempo", lyrics=LYRICS)

    draft = worker._ai_complete_draft("纯音乐，安静的钢琴与弦乐，适合阅读", "instrumental")

    request = captured[0]
    system = request["messages"][0]["content"]
    assert MUSIC_INTENT_POLICY in system
    assert '"title"' in system and '"style"' in system
    assert '"lyrics":' not in system
    assert "纯音乐" in system
    assert draft == {
        "title": "窗边",
        "style": "ambient, felt piano, slow tempo, instrumental, no vocals",
        "lyrics": "纯音乐",
    }
    assert LYRICS not in json.dumps(draft, ensure_ascii=False)


@pytest.mark.parametrize(("description", "style", "lyrics"), [
    pytest.param(
        "音乐风格：温暖原声民谣，克制女声\n歌词/歌词风格：自然、有留白\n避免的风格：电子合成器、密集鼓点",
        "warm acoustic folk, restrained female vocals, sparse hand percussion",
        LYRICS,
        id="literary-style-and-sound-exclusions-keep-free-lyric-subject",
    ),
    pytest.param(
        f"音乐风格：轻快民谣\n歌词/歌词风格：原文保留\n{EXPLICIT_LYRICS}\n避免的风格：",
        "acoustic folk, light rhythm, warm vocals",
        EXPLICIT_LYRICS,
        id="structured-lyric-original-survives-draft-boundary",
    ),
    pytest.param(
        f"{STYLE_REQUEST}\n音乐风格：\n歌词/歌词风格：\n避免的风格：",
        STYLE,
        LYRICS,
        id="empty-shortcut-labels-remain-template-not-lyric-content",
    ),
])
def test_shortcut_brief_reaches_provider_intact_and_keeps_draft_fields(
    draft_provider, description, style, lyrics,
):
    """Keep the three distinct user constraints intact at the model boundary."""
    answer, captured = draft_provider
    answer.update(title="第一班车", style=style, lyrics=lyrics)

    draft = worker._ai_complete_draft(description, "vocal")

    assert len(captured) == 1
    system, user = captured[0]["messages"]
    assert MUSIC_INTENT_POLICY in system["content"]
    assert user["content"] == f"创作想法：{description}"
    assert draft == {"title": "第一班车", "style": style, "lyrics": lyrics}


@pytest.mark.parametrize("model_rewrites_fields", [False, True])
def test_worker_sends_only_creative_context_and_preserves_it_in_output(draft_provider, model_rewrites_fields):
    answer, captured = draft_provider
    if model_rewrites_fields:
        answer.update(title="第一班车", style=STYLE, lyrics=LYRICS)

    draft = worker._ai_complete_draft(STYLE_REQUEST, "vocal", context={
        "title": "用户曲名",
        "lyrics": EXPLICIT_LYRICS,
        "style": "acoustic folk, brushed drums",
        "api_key": "must-not-be-sent",
        "upload_id": "private-upload-id",
    })

    user_content = captured[0]["messages"][-1]["content"]
    assert user_content.startswith(f"创作想法：{STYLE_REQUEST}")
    for value in ("用户曲名", "明天的车票在口袋里", "acoustic folk, brushed drums"):
        assert value in user_content
    assert "must-not-be-sent" not in user_content
    assert "private-upload-id" not in user_content
    assert draft == {
        "title": "用户曲名", "style": "acoustic folk, brushed drums", "lyrics": EXPLICIT_LYRICS,
    }


@pytest.mark.parametrize("mode", ["chat", "lyrics"])
async def test_assistant_stream_sends_shared_policy_and_keeps_proposal_fields(tmp_path, monkeypatch, mode):
    monkeypatch.setenv("AMC_ASSISTANT_BASE_URL", "https://music-provider.example.test/v1")
    monkeypatch.setenv("AMC_ASSISTANT_MODEL", "fixture-music-model")
    monkeypatch.setenv("AMC_ASSISTANT_API_KEY", "fixture-key")
    service = AssistantService(tmp_path / "data", hermes_home=tmp_path / "hermes")
    proposal = {"title": "第一班车", "description": STYLE, "lyrics": LYRICS, "music_kind": "vocal"}
    captured = []

    def route(request):
        assert request.url.path == "/v1/chat/completions"
        captured.append(json.loads(request.content))
        reply = "已整理好。<music_proposal>" + json.dumps(proposal, ensure_ascii=False) + "</music_proposal>"
        chunk = json.dumps({"choices": [{"delta": {"content": reply}}]})
        return httpx.Response(200, text=f"data: {chunk}\n\ndata: [DONE]\n\n")

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: HTTP_ASYNC_CLIENT(
        transport=httpx.MockTransport(route), **kwargs,
    ))
    try:
        session = service.create_session()["id"]
        events = [event async for event in service.stream(
            session, STYLE_REQUEST, mode, None, service.reserve(session),
        )]
        assert not any(event == "error" for event, _data in events)
        assert len(captured) == 1
        messages = captured[0]["messages"]
        assert messages[0]["role"] == "system" and MUSIC_INTENT_POLICY in messages[0]["content"]
        assert messages[-1]["content"].startswith(STYLE_REQUEST)
        reply = service.session(session)["messages"][-1]
        assert reply["status"] == "complete" and reply["suggestion"] == proposal
        assert reply["content"] == "已整理好。"
    finally:
        await service.close()


def test_legacy_assist_provider_receives_the_same_music_policy(monkeypatch):
    captured = []

    def provider(system, user, model, key):
        captured.append((system, user))
        return {"title": "第一班车", "style": STYLE, "lyrics": LYRICS}, "fixture-music-model"

    monkeypatch.setattr(assist, "run_api", provider)
    result = assist.assist(
        {"assist_provider": "api", "anthropic_api_key": "fixture-key"},
        prompt=STYLE_REQUEST,
    )
    assert MUSIC_INTENT_POLICY in captured[0][0]
    assert captured[0][1] == f"Page: create\n\nRequest: {STYLE_REQUEST}"
    assert result.fields == {"title": "第一班车", "style": STYLE, "lyrics": LYRICS}


@pytest.mark.parametrize("existing", [
    pytest.param({"lyrics": EXPLICIT_LYRICS}, id="existing-lyrics-survive-style-completion"),
    pytest.param({"style": "acoustic folk, brushed drums"}, id="existing-style-survives-lyric-completion"),
    pytest.param({"lyrics": "[Verse]\n" + "窗前的灯还亮着\n" * 24}, id="duration-follows-preserved-lyrics"),
])
def test_worker_only_fills_missing_fields_before_sending_to_engine(tmp_path, monkeypatch, existing):
    paths = config.paths_for(tmp_path)
    paths.ensure_dirs()
    store = jobs.JobStore(paths.db_path, paths.songs_dir)
    engine = FakeEngine(delay=0)
    monkeypatch.setattr(engines, "current", lambda: None)
    captured = []

    def generate(request, *_args, **_kwargs):
        # The old YuE FakeEngine rejects ACE-Step's description/duration fields.
        # Capture this engine boundary so no model or audio generation is invoked.
        engine.calls.append(("create_song", dict(request)))
        return {"seconds": 1}

    monkeypatch.setattr(engine, "create_song", generate)
    prompt = "不要纯音乐，要有克制女声。" + STYLE_REQUEST

    def complete(description, music_kind, *, context=None):
        captured.append((description, music_kind, context))
        return {"title": "生成的新曲名", "style": STYLE, "lyrics": LYRICS}

    monkeypatch.setattr(worker, "_ai_complete_draft", complete)
    try:
        job = jobs.submit(store, {"kind": "create", "preset": "fast", "params": {
            "description": prompt, "music_kind": "vocal", "title": "用户曲名", **existing,
        }}).jobs[0]
        runner = worker.Worker(store, engine, paths, fake=True)
        runner._run_job(job)
        saved = store.get(job.id)
        assert saved.status == "done", saved.error
        assert saved.params["title"] == "用户曲名"
        assert saved.params["style"] == existing.get("style", STYLE)
        assert saved.params["lyrics"] == existing.get("lyrics", LYRICS).strip()
        assert len(captured) == 1
        description, music_kind, context = captured[0]
        assert description == prompt and music_kind == "vocal"
        assert context["title"] == "用户曲名"
        for key, value in existing.items():
            assert context[key] == value.strip()
        assert len(engine.calls) == 1
        method, request = engine.calls[0]
        assert method == "create_song"
        assert request["style"] == saved.params["style"]
        assert request["lyrics"] == saved.params["lyrics"]
        if request["lyrics"].count("窗前的灯还亮着") == 24:
            assert request["duration"] == pytest.approx(108.8)
    finally:
        store.close()
