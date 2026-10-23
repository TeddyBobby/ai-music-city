"""Assistant image uploads, tenant routing and multimodal proposal conversations."""

import base64
import io
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from PIL import Image

from yue2_studio.api import install_error_handlers
from yue2_studio.assistant_api import router
from yue2_studio.assistant_service import AssistantService


def picture():
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), (35, 160, 85)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
async def setup(tmp_path, monkeypatch):
    monkeypatch.setenv("AMC_ASSISTANT_BASE_URL", "https://assistant.example.test/v1")
    monkeypatch.setenv("AMC_ASSISTANT_MODEL", "test-vision-model")
    monkeypatch.setenv("AMC_ASSISTANT_API_KEY", "test-private-provider-credential")
    services = {
        name: AssistantService(tmp_path / name, hermes_home=tmp_path / "hermes")
        for name in ("one", "two")
    }
    app = FastAPI()

    @app.middleware("http")
    async def select_test_account(request, call_next):
        # Simulate the trusted runtime chosen by auth middleware, using only this test app.
        request.state.runtime = SimpleNamespace(
            assistant=services[request.headers.get("x-test-account", "one")]
        )
        return await call_next(request)

    install_error_handlers(app)
    app.include_router(router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8765"
    ) as client:
        try:
            yield services, client
        finally:
            for service in services.values():
                await service.close()


def upstream(monkeypatch, handler):
    original = httpx.AsyncClient

    def route(request):
        if request.method == "GET" and request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "test-vision-model"}]})
        return handler(request)

    monkeypatch.setattr(
        "yue2_studio.assistant_service.httpx.AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(route), timeout=30),
    )


def reply(text):
    # Small chunks also exercise proposal-marker boundaries in the SSE parser.
    body = "".join(
        "data: "
        + json.dumps({"choices": [{"delta": {"content": text[offset:offset + 7]}}]})
        + "\n\n"
        for offset in range(0, len(text), 7)
    )
    return httpx.Response(
        200, text=body + "data: [DONE]\n\n", headers={"content-type": "text/event-stream"}
    )


async def upload(client):
    response = await client.post(
        "/api/assistant/images", files={"file": ("森林.png", picture(), "image/png")}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_upload_and_read_image_without_provider_or_generation(setup, monkeypatch):
    services, client = setup
    upstream(monkeypatch, lambda request: pytest.fail("Uploading must not call a model"))
    record = await upload(client)
    assert record["mime_type"] == "image/jpeg"
    assert record["width"] == 40 and record["height"] == 30
    assert record["filename"] == "森林.png"
    assert record["url"] == f"/api/assistant/images/{record['id']}"
    assert str(services["one"].root) not in json.dumps(record)
    assert services["one"].sessions() == []
    response = await client.get(record["url"])
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/jpeg")
    assert "public" not in response.headers.get("cache-control", "")
    assert any(value in response.headers.get("cache-control", "") for value in ("private", "no-store"))
    assert response.headers["x-content-type-options"] == "nosniff"
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.format == "JPEG" and image.size == (40, 30)


@pytest.mark.parametrize("image_id", ["missing", "a" * 32])
async def test_missing_image_is_not_found(setup, image_id):
    _, client = setup
    response = await client.get(f"/api/assistant/images/{image_id}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "image_not_found"


@pytest.mark.parametrize(
    "files,status",
    [
        (None, 400),
        ({"file": ("image.png", b"not pixels", "image/png")}, 400),
        ({"file": ("image.svg", b"<svg></svg>", "image/svg+xml")}, 400),
        ({"file": ("image.jpg", picture(), "image/jpeg")}, 400),
        ({"file": ("image.png", b"x" * (8 * 1024 * 1024 + 1), "image/png")}, 413),
    ],
)
async def test_invalid_upload_rejected_without_storing_data(setup, files, status):
    services, client = setup
    response = await client.post("/api/assistant/images", files=files)
    assert response.status_code == status
    assert not (services["one"].root / "attachments").exists()


async def test_other_account_cannot_read_or_send_image_reference(setup, monkeypatch):
    services, client = setup
    record = await upload(client)
    upstream(monkeypatch, lambda request: pytest.fail("Foreign pixels must not reach a provider"))
    headers = {"x-test-account": "two"}
    assert (await client.get(record["url"], headers=headers)).status_code == 404
    session = services["two"].create_session()
    response = await client.post(
        f"/api/assistant/sessions/{session['id']}/messages",
        json={"image_id": record["id"]}, headers=headers,
    )
    assert response.status_code == 404
    assert services["two"].session(session["id"])["messages"] == []


async def test_image_only_message_sends_pixels_and_can_ask_a_question(setup, monkeypatch):
    services, client = setup
    record = await upload(client)
    captured = []

    def inspect(request):
        body = json.loads(request.content)
        captured.append(body)
        parts = body["messages"][-1]["content"]
        assert isinstance(parts, list)
        data_url = next(part["image_url"]["url"] for part in parts if part["type"] == "image_url")
        assert data_url.startswith("data:image/jpeg;base64,")
        with Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1]))) as image:
            assert image.size == (40, 30)
            assert image.getpixel((10, 10))[1] > 150
        return reply("这片绿色让人觉得宁静。你想要轻快一些，还是舒缓一些？")

    upstream(monkeypatch, inspect)
    sid = services["one"].create_session()["id"]
    response = await client.post(
        f"/api/assistant/sessions/{sid}/messages", json={"image_id": record["id"], "mode": "chat"}
    )
    assert response.status_code == 200
    assert "event: done" in response.text
    assert len(captured) == 1
    messages = services["one"].session(sid)["messages"]
    assert messages[0]["content"] == "" and messages[0]["image"] == record
    assert messages[1]["status"] == "complete"
    assert messages[1]["content"].startswith("这片绿色")
    assert messages[1]["suggestion"] is None


async def test_description_proposal_and_followup_preserve_image_context(setup, monkeypatch):
    services, client = setup
    record = await upload(client)
    captured = []
    proposal = {
        "title": "林间午后", "description": "舒缓木吉他，轻柔弦乐，80 BPM",
        "music_kind": "instrumental", "lyrics": "",
    }

    def inspect(request):
        captured.append(json.loads(request.content))
        return reply(
            "可以，按这个方向来。\n<music_proposal>"
            + json.dumps(proposal, ensure_ascii=False) + "</music_proposal>"
        )

    upstream(monkeypatch, inspect)
    sid = services["one"].create_session()["id"]
    response = await client.post(
        f"/api/assistant/sessions/{sid}/messages",
        json={"image_id": record["id"], "content": "为这片森林写舒缓的纯音乐，可以发歌了", "mode": "chat"},
    )
    assert response.status_code == 200
    first = services["one"].session(sid)["messages"][-1]
    assert first["suggestion"] == proposal
    assert first["content"].strip() == "可以，按这个方向来。"
    assert "<music_proposal>" not in response.text
    assert "森林" in captured[0]["messages"][-1]["content"][0]["text"]
    response = await client.post(
        f"/api/assistant/sessions/{sid}/messages", json={"content": "再轻快一点"}
    )
    assert response.status_code == 200
    image_messages = [
        message for message in captured[1]["messages"]
        if isinstance(message["content"], list)
        and any(part.get("type") == "image_url" for part in message["content"])
    ]
    assert len(image_messages) == 1
    assert any("之前的音乐提案" in message["content"] for message in captured[1]["messages"] if isinstance(message["content"], str))


async def test_unsupported_image_model_reports_an_actionable_error(setup, monkeypatch):
    services, client = setup
    record = await upload(client)
    upstream(monkeypatch, lambda request: httpx.Response(400, text="PRIVATE provider diagnostics"))
    sid = services["one"].create_session()["id"]
    response = await client.post(
        f"/api/assistant/sessions/{sid}/messages", json={"image_id": record["id"], "content": "这张图有什么感觉"}
    )
    assert response.status_code == 200
    assert "image_unsupported" in response.text
    assert "切换支持图片的模型" in response.text
    assert "PRIVATE" not in response.text
    message = services["one"].session(sid)["messages"][-1]
    assert message["status"] == "error" and message["suggestion"] is None
