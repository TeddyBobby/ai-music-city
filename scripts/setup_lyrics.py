"""Install the optional, pinned local Whisper model for lyric alignment.

    uv run python scripts/setup_lyrics.py          # verify or download the model
    uv run python scripts/setup_lyrics.py --check  # check only; never download

Audio stays on this computer. This script downloads only public model weights;
it never installs Homebrew packages or loads an inference model.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import os
import shutil
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from yue2_studio import config  # noqa: E402

MODEL_REPO = "ggerganov/whisper.cpp"
MODEL_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1"
MODEL_FILENAME = "ggml-small-q5_1.bin"
MODEL_BYTES = 190085487
MODEL_SHA256 = "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb"
CHUNK_BYTES = 1024 * 1024


def model_is_valid(path: Path) -> bool:
    """Validate content as well as size; a partial download is never accepted."""
    if not path.is_file() or path.stat().st_size != MODEL_BYTES:
        return False
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(CHUNK_BYTES), b""):
            digest.update(block)
    return digest.hexdigest() == MODEL_SHA256


def model_url() -> str:
    endpoint = os.environ.get("HF_ENDPOINT", "https://huggingface.co").strip().rstrip("/")
    parsed = urlsplit(endpoint)
    if (parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.query
            or parsed.fragment or parsed.username or parsed.password):
        raise ValueError("HF_ENDPOINT 必须是有效的 HTTP(S) 地址，不能包含凭据、查询参数或片段")
    return f"{endpoint}/{MODEL_REPO}/resolve/{MODEL_REVISION}/{MODEL_FILENAME}"


def install_model(target: Path) -> bool:
    """Install atomically. Return False when an existing verified model is reused."""
    target.parent.mkdir(parents=True, exist_ok=True)
    # Serialize installers so another invocation cannot replace a verified model.
    with (target.parent / ".setup-lyrics.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if model_is_valid(target):
            return False
        request = Request(model_url(), headers={"User-Agent": "AI-Music-City/lyrics-setup"})
        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                prefix=f".{MODEL_FILENAME}.", suffix=".download", dir=target.parent, delete=False,
            ) as output:
                temp_path = Path(output.name)
                size = 0
                digest = hashlib.sha256()
                with urlopen(request, timeout=60) as response:
                    while block := response.read(CHUNK_BYTES):
                        size += len(block)
                        if size > MODEL_BYTES:
                            raise ValueError("下载文件超过预期大小，已停止；原文件未改动")
                        output.write(block)
                        digest.update(block)
                output.flush()
                os.fsync(output.fileno())
            if size != MODEL_BYTES or digest.hexdigest() != MODEL_SHA256:
                raise ValueError("模型大小或 SHA-256 校验失败；原文件未改动，请重试或检查 HF_ENDPOINT")
            # Preserve a valid file even if an external process placed it here.
            if model_is_valid(target):
                return False
            os.replace(temp_path, target)
            return True
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="安装并验证本地歌词校准模型（约 190 MB）")
    parser.add_argument("--check", action="store_true", help="只检查依赖和模型，不访问网络或下载")
    args = parser.parse_args()
    target = config.MODELS_DIR / "whisper" / MODEL_FILENAME
    missing = [name for name in ("whisper-cli", "ffmpeg") if shutil.which(name) is None]
    if missing:
        print(f"[lyrics] 缺少命令：{', '.join(missing)}", file=sys.stderr)
        print("[lyrics] 请先手动运行：brew install whisper-cpp ffmpeg", file=sys.stderr)
        return 1
    if args.check:
        if not model_is_valid(target):
            print(f"[lyrics] 模型缺失或校验失败：{target}", file=sys.stderr)
            print("[lyrics] 请运行：uv run python scripts/setup_lyrics.py", file=sys.stderr)
            return 1
        print(f"[lyrics] 依赖与模型校验通过：{target}")
        return 0
    print(f"[lyrics] 检查本地模型；仅在缺失或损坏时下载约 190 MB：{target}", flush=True)
    try:
        installed = install_model(target)
    except (OSError, ValueError) as exc:
        print(f"[lyrics] 安装失败：{exc}", file=sys.stderr)
        return 1
    print(f"[lyrics] {'下载完成并通过 SHA-256 校验' if installed else '已验证现有模型，无需下载'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
