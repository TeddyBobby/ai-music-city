"""Assistant attachment pixels remain private and are sent only when requested."""

import base64
import io
import json

import pytest
from PIL import Image
from starlette.datastructures import Headers, UploadFile

from yue2_studio import assistant_images
from yue2_studio.api import ApiError


def upload(*, raw=None, mime="image/png", filename="画面.png", size=(30, 20), exif=None):
    if raw is None:
        buffer = io.BytesIO()
        image = Image.new("RGB", size, (40, 150, 90))
        options = {"exif": exif} if exif else {}
        image.save(buffer, format="PNG", **options)
        raw = buffer.getvalue()
    return UploadFile(
        io.BytesIO(raw), filename=filename, headers=Headers({"content-type": mime})
    )


async def test_image_upload_normalizes_and_returns_only_private_reference(tmp_path):
    root = tmp_path / "user-one" / "assistant"
    exif = Image.Exif()
    exif[270] = "private location metadata"
    record = await assistant_images.receive_image(root, upload(exif=exif, filename="../画面.png"))
    assert record == {
        "id": record["id"],
        "url": f"/api/assistant/images/{record['id']}",
        "mime_type": "image/jpeg",
        "filename": "画面.png",
        "width": 30,
        "height": 20,
    }
    assert str(tmp_path) not in json.dumps(record)
    path = assistant_images.image_path(root, record)
    assert path.stat().st_mode & 0o777 == 0o600
    assert path.with_suffix(".json").stat().st_mode & 0o777 == 0o600
    with Image.open(path) as clean:
        assert clean.format == "JPEG"
        assert not clean.getexif()
        assert clean.getpixel((5, 5))[1] > 140
    assert b"private location metadata" not in path.read_bytes()
    assert assistant_images.image_attachment(root, record["id"]) == record


async def test_image_reference_cannot_cross_user_roots(tmp_path):
    first = tmp_path / "one" / "assistant"
    second = tmp_path / "two" / "assistant"
    record = await assistant_images.receive_image(first, upload())
    for operation in (
        lambda: assistant_images.image_attachment(second, record["id"]),
        lambda: assistant_images.image_content(second, record),
    ):
        with pytest.raises(ApiError) as error:
            operation()
        assert error.value.status_code == 404
        assert error.value.code == "image_not_found"


async def test_provider_content_has_verified_pixels_not_an_external_url(tmp_path):
    record = await assistant_images.receive_image(tmp_path, upload())
    content = assistant_images.image_content(tmp_path, {**record, "url": "https://untrusted.test/"})
    assert content["type"] == "image_url"
    prefix, encoded = content["image_url"]["url"].split(",", 1)
    assert prefix == "data:image/jpeg;base64"
    assert base64.b64decode(encoded) == assistant_images.image_path(tmp_path, record).read_bytes()


@pytest.mark.parametrize("image_id", ["../outside", "x" * 32, "a" * 31, "A" * 32, "", None])
def test_invalid_ids_never_become_paths(tmp_path, image_id):
    for operation in (
        lambda: assistant_images.image_attachment(tmp_path, image_id),
        lambda: assistant_images.image_path(tmp_path, {"id": image_id}),
    ):
        with pytest.raises(ApiError) as error:
            operation()
        assert error.value.code == "image_not_found"


@pytest.mark.parametrize(
    "file",
    [
        upload(raw=b"<svg><script>alert(1)</script></svg>", mime="image/svg+xml"),
        upload(raw=b"not image pixels"),
        upload(mime="image/jpeg"),
        upload(raw=b""),
    ],
)
async def test_invalid_image_does_not_create_attachment_files(tmp_path, file):
    with pytest.raises(ApiError) as error:
        await assistant_images.receive_image(tmp_path, file)
    assert error.value.code == "invalid_image"
    assert not (tmp_path / "attachments").exists()


async def test_upload_bound_is_enforced_before_storage(tmp_path):
    file = upload(raw=b"x" * (assistant_images.MAX_IMAGE_BYTES + 1))
    with pytest.raises(ApiError) as error:
        await assistant_images.receive_image(tmp_path, file)
    assert error.value.code == "image_too_large"
    assert not (tmp_path / "attachments").exists()


async def test_thumbnail_size_and_orientation_are_normalized(tmp_path):
    exif = Image.Exif()
    exif[274] = 6
    record = await assistant_images.receive_image(
        tmp_path, upload(size=(2000, 1000), exif=exif)
    )
    assert (record["width"], record["height"]) == (768, 1536)


async def test_missing_pixels_and_tampered_record_are_not_forwarded(tmp_path):
    record = await assistant_images.receive_image(tmp_path, upload())
    path = assistant_images.image_path(tmp_path, record)
    metadata = path.with_suffix(".json")
    metadata.write_text(json.dumps({**record, "id": "b" * 32}))
    with pytest.raises(ApiError):
        assistant_images.image_content(tmp_path, record)
    metadata.write_text(json.dumps(record))
    path.unlink()
    with pytest.raises(ApiError):
        assistant_images.image_content(tmp_path, record)


async def test_attachment_does_not_follow_pixel_symlinks(tmp_path):
    record = await assistant_images.receive_image(tmp_path, upload())
    path = assistant_images.image_path(tmp_path, record)
    outside = tmp_path / "outside.jpg"
    path.rename(outside)
    path.symlink_to(outside)
    with pytest.raises(ApiError) as error:
        assistant_images.image_content(tmp_path, record)
    assert error.value.code == "image_not_found"
