"""Pixel validation, multimodal transport and cancellation for picture-inspired music."""

import asyncio
import base64
import io
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from PIL import Image
from starlette.datastructures import Headers, UploadFile

from yue2_studio import image_music
from yue2_studio.api import ApiError, install_error_handlers
from yue2_studio.assistant_api import image_mood, router

ATMOSPHERE = {
    "image_seen": True,
    "title": "林间微光",
    "summary": "夕阳透过森林，绿色与金色相映。",
    "mood": "温暖、宁静",
    "style": "Warm acoustic folk, 80 BPM, guitar, soft strings, gentle dynamics",
}


def picture(format="PNG", size=(36, 24), **kwargs):
    output = io.BytesIO()
    Image.new("RGB", size, (20, 140, 60)).save(output, format=format, **kwargs)
    return output.getvalue()


class Service:
    def config(self):
        return {"hermes_base_url": "http://provider.test/v1", "hermes_api_key": "private-credential"}

    async def models(self):
        return {"default_model": "vision::model"}

    async def request_model(self, selected):
        assert selected == "vision::model"
        return {"model": "vision-model", "provider": "vision"}


@pytest.fixture
async def setup():
    app = FastAPI()
    svc = Service()
    app.state.assistant = svc
    install_error_handlers(app)
    app.include_router(router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8765"
    ) as client:
        yield svc, client


def provider(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(
        image_music.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler))
    )


def reply(value=ATMOSPHERE):
    return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(value)}}]})


async def test_image_endpoint_sends_actual_pixels_and_description_without_jobs(setup, monkeypatch):
    _, client = setup
    captured = []

    def inspect(request):
        body = json.loads(request.content)
        captured.append(body)
        assert request.headers["authorization"] == "Bearer private-credential"
        assert body["model"] == "vision-model" and body["provider"] == "vision"
        parts = body["messages"][-1]["content"]
        assert "轻快一些" in parts[0]["text"]
        decoded = base64.b64decode(parts[1]["image_url"]["url"].split(",", 1)[1])
        with Image.open(io.BytesIO(decoded)) as actual:
            assert actual.size == (36, 24)
            assert actual.format == "JPEG"
            assert actual.getpixel((5, 5))[1] > 120
        return reply()

    provider(monkeypatch, inspect)
    response = await client.post(
        "/api/assistant/image-mood",
        files={"file": ("not-a-real-extension.bin", picture(), "image/png")},
        data={"description": "轻快一些"},
    )
    assert response.status_code == 200
    assert response.json() == {key: value for key, value in ATMOSPHERE.items() if key != "image_seen"}
    assert len(captured) == 1
    assert "private-credential" not in response.text


@pytest.mark.parametrize(
    "raw,mime",
    [
        (b"not an image", "image/png"),
        (b"<svg></svg>", "image/svg+xml"),
        (picture(), "image/jpeg"),
        (picture()[:-20], "image/png"),
    ],
)
async def test_rejects_wrong_or_corrupt_format_before_provider(setup, monkeypatch, raw, mime):
    _, client = setup
    provider(monkeypatch, lambda request: pytest.fail("Invalid pixels reached the model"))
    response = await client.post("/api/assistant/image-mood", files={"file": ("image.png", raw, mime)})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_image"


async def test_rejects_oversize_image_and_description(setup, monkeypatch):
    _, client = setup
    monkeypatch.setattr(image_music, "MAX_IMAGE_BYTES", 100)
    provider(monkeypatch, lambda request: pytest.fail("Oversize data reached the model"))
    response = await client.post(
        "/api/assistant/image-mood", files={"file": ("image.png", b"x" * 101, "image/png")}
    )
    assert response.status_code == 413
    response = await client.post(
        "/api/assistant/image-mood",
        files={"file": ("image.png", picture(), "image/png")},
        data={"description": "x" * 2001},
    )
    assert response.status_code == 400


def test_dimension_limit_rejects_before_decoding_pixels(monkeypatch):
    monkeypatch.setattr(image_music, "MAX_IMAGE_PIXELS", 100)
    with pytest.raises(ApiError) as error:
        image_music.normalize_image(picture(), "image/png")
    assert error.value.code == "image_dimensions"


def test_normalizes_orientation_strips_exif_and_limits_pixels():
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = "private metadata"
    result = image_music.normalize_image(picture("JPEG", (2000, 1000), exif=exif), "image/jpeg")
    with Image.open(io.BytesIO(result)) as clean:
        assert clean.size == (768, 1536)
        assert not clean.getexif()
        assert b"private metadata" not in result


@pytest.mark.parametrize(
    "format,mime", [("JPEG", "image/jpeg"), ("PNG", "image/png"), ("WEBP", "image/webp")]
)
def test_all_supported_image_encodings(format, mime):
    assert image_music.normalize_image(picture(format), mime).startswith(b"\xff\xd8\xff")


@pytest.mark.parametrize(
    "value",
    [
        {},
        {"image_seen": False},
        {**ATMOSPHERE, "style": ""},
        {**ATMOSPHERE, "summary": ["not text"]},
        {**ATMOSPHERE, "title": "x" * 81},
    ],
)
async def test_rejects_missing_or_unseen_image_analysis(setup, monkeypatch, value):
    _, client = setup
    provider(monkeypatch, lambda request: reply(value))
    response = await client.post(
        "/api/assistant/image-mood", files={"file": ("p.png", picture(), "image/png")}
    )
    assert response.status_code == 502


@pytest.mark.parametrize("status", [400, 401, 429, 500])
async def test_provider_failure_does_not_leak_diagnostics(setup, monkeypatch, status):
    _, client = setup
    provider(
        monkeypatch, lambda request: httpx.Response(status, text="SECRET private-credential /private/file")
    )
    response = await client.post(
        "/api/assistant/image-mood", files={"file": ("p.png", picture(), "image/png")}
    )
    assert response.status_code == 502
    assert all(value not in response.text for value in ("SECRET", "private-credential", "/private/file"))


async def test_timeout_cancels_provider_work(setup, monkeypatch):
    _, client = setup
    cancelled = asyncio.Event()

    async def delayed(request):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    provider(monkeypatch, delayed)
    monkeypatch.setattr(image_music, "ANALYSIS_TIMEOUT", 0.05)
    response = await client.post(
        "/api/assistant/image-mood", files={"file": ("p.png", picture(), "image/png")}
    )
    assert response.status_code == 504
    assert cancelled.is_set()


async def test_disconnection_cancels_upstream_and_closes_upload(monkeypatch):
    started, cancelled = asyncio.Event(), asyncio.Event()

    async def analyze(*args):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    async def disconnected():
        await started.wait()
        return True

    monkeypatch.setattr("yue2_studio.assistant_api.analyze_image", analyze)
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(assistant=Service())), is_disconnected=disconnected
    )
    file = UploadFile(io.BytesIO(picture()), filename="p.png", headers=Headers({"content-type": "image/png"}))
    with pytest.raises(asyncio.CancelledError):
        await image_mood(request, file, "", None)
    assert cancelled.is_set() and file.file.closed


async def test_origin_and_missing_file_validation(setup):
    _, client = setup
    response = await client.post("/api/assistant/image-mood", headers={"Origin": "https://other.example"})
    assert response.status_code == 403
    assert (await client.post("/api/assistant/image-mood")).status_code == 400
