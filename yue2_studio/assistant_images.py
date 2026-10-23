"""Private image attachments for assistant conversations, without starting generation."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import re
import uuid
from pathlib import Path

from fastapi import UploadFile
from PIL import Image

from yue2_studio.api import ApiError
from yue2_studio.image_music import MAX_IMAGE_BYTES, normalize_image


def _directory(root: Path) -> Path:
    return Path(root) / "attachments" / "images"


def _validate_id(image_id: str) -> None:
    if not isinstance(image_id, str) or not re.fullmatch(r"[a-f0-9]{32}", image_id):
        raise ApiError(404, "image_not_found", "这张图片不存在，请重新上传")


def image_path(root: Path, record: dict) -> Path:
    """Only derive a path from a validated opaque id, never uploaded file names."""
    image_id = record.get("id")
    _validate_id(image_id)
    return _directory(root) / (image_id + ".jpg")


def image_attachment(root: Path, image_id: str) -> dict:
    """Resolve within the current account; an id from another account is not found."""
    _validate_id(image_id)
    try:
        value = json.loads((_directory(root) / (image_id + ".json")).read_text())
        if not isinstance(value, dict) or value.get("id") != image_id:
            raise ValueError("Invalid image record")
        width, height = value["width"], value["height"]
        if not all(type(size) is int and 0 < size <= 1536 for size in (width, height)):
            raise ValueError("Invalid image dimensions")
        path = image_path(root, value)
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_IMAGE_BYTES:
            raise ValueError("Missing image pixels")
        # Rebuild the public contract instead of returning arbitrary stored fields.
        return {
            "id": image_id,
            "url": f"/api/assistant/images/{image_id}",
            "mime_type": "image/jpeg",
            "filename": str(value.get("filename") or "图片.jpg")[:180],
            "width": width,
            "height": height,
        }
    except (OSError, ValueError, KeyError, TypeError):
        raise ApiError(404, "image_not_found", "这张图片不存在，请重新上传") from None


async def receive_image(root: Path, file: UploadFile) -> dict:
    """Validate pixels, discard metadata and store only a small normalized JPEG."""
    raw = await file.read(MAX_IMAGE_BYTES + 1)
    clean = await asyncio.to_thread(normalize_image, raw, file.content_type)
    with Image.open(io.BytesIO(clean)) as image:
        width, height = image.size
    directory = _directory(root)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    image_id = uuid.uuid4().hex
    original_name = Path((file.filename or "图片.jpg").replace("\\", "/")).name
    filename = "".join(character for character in original_name if character.isprintable())[:180]
    record = {
        "id": image_id,
        "url": f"/api/assistant/images/{image_id}",
        "mime_type": "image/jpeg",
        "filename": filename or "图片.jpg",
        "width": width,
        "height": height,
    }
    destination = image_path(root, record)
    metadata = directory / (image_id + ".json")
    created_image = created_metadata = False
    try:
        # Exclusive creation and private modes also apply when the process umask is broad.
        with destination.open("xb") as output:
            created_image = True
            destination.chmod(0o600)
            output.write(clean)
        with metadata.open("x", encoding="utf-8") as output:
            created_metadata = True
            metadata.chmod(0o600)
            json.dump(record, output, ensure_ascii=False)
    except BaseException:
        if created_image:
            destination.unlink(missing_ok=True)
        if created_metadata:
            metadata.unlink(missing_ok=True)
        raise
    return record


def image_content(root: Path, record: dict) -> dict:
    """Build provider content from the actual account-owned pixels, not a public URL."""
    attachment = image_attachment(root, record.get("id"))
    encoded = base64.b64encode(image_path(root, attachment).read_bytes()).decode("ascii")
    return {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + encoded}}
