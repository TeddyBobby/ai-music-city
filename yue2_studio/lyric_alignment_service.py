"""Persistent, local audio-based lyric alignment on the serial inference worker.

The UI never receives stale or estimated timestamps from this service. The heavy
aligner lives in a separate process that can be killed on shutdown; importing this
module does not import or download a model.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import psutil
import soundfile as sf

from yue2_studio.api import ApiError
from yue2_studio.jobs import NotFound
from yue2_studio.lyric_alignment_worker import ALGORITHM_VERSION, MODEL_BYTES, MODEL_NAME

MAX_RESULT_BYTES = 2 * 1024 * 1024
MAX_AUDIO_SECONDS = 1800
MIN_AVAILABLE_BYTES = 2 * 1024**3
ALIGNMENT_TIMEOUT = 20 * 60
STATUSES = {"idle", "queued", "running", "ready", "failed", "unavailable"}


def has_lyrics(text: str) -> bool:
    return bool(re.sub(r"\[[^\]]*\]", "", text).strip())


def _empty(status="idle", message=None):
    result = {"status": status, "source": "audio", "lines": []}
    if message:
        result["message"] = message
    return result


def _atomic_json(path: Path, data: dict):
    fd, temporary = tempfile.mkstemp(prefix=".lyrics-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as target:
            json.dump(data, target, ensure_ascii=False, allow_nan=False)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def validate_result(value: dict, duration: float) -> dict:
    """Validate model output and strip private fields before persistence/exposure."""
    if not isinstance(value, dict) or value.get("status") not in {"ready", "failed", "unavailable"}:
        raise ValueError("invalid alignment result")
    status = value["status"]
    if status != "ready":
        # Only documented fixed messages are exposed, never model stderr or paths.
        return _empty(status, "本机歌词校准工具尚未就绪" if status == "unavailable"
                      else "没有找到可靠的人声时间轴，请重试或检查实际演唱歌词")
    raw_lines = value.get("lines")
    if not isinstance(raw_lines, list) or not 1 <= len(raw_lines) <= 2000:
        raise ValueError("invalid alignment lines")
    lines, previous, matched = [], -1.0, 0
    for item in raw_lines:
        if not isinstance(item, dict) or not isinstance(item.get("text"), str):
            raise ValueError("invalid lyric line")
        text = item["text"].strip()
        if not text or len(text) > 1000:
            raise ValueError("invalid lyric text")
        at = item.get("at")
        line = {"text": text, "at": None}
        if at is not None:
            if isinstance(at, bool) or not isinstance(at, (int, float)) or not math.isfinite(at):
                raise ValueError("invalid lyric time")
            if at < 0 or at > duration + 0.25 or at < previous:
                raise ValueError("non-monotonic lyric time")
            line["at"] = round(min(float(at), duration), 3)
            previous = at
            matched += 1
            end = item.get("end")
            if end is not None:
                if (isinstance(end, bool) or not isinstance(end, (int, float))
                        or not math.isfinite(end) or end < at or end > duration + 0.25):
                    raise ValueError("invalid lyric end")
                line["end"] = round(min(float(end), duration), 3)
        section = item.get("section")
        if isinstance(section, str) and section.strip():
            line["section"] = section.strip()[:120]
        lines.append(line)
    if not matched:
        return _empty("failed", "没有找到可靠的人声时间轴，请重试或检查实际演唱歌词")
    result = {"status": "ready", "source": "audio", "lines": lines,
              "matched_lines": matched, "total_lines": len(lines), "progress": 100}
    if matched < len(lines):
        result["message"] = "部分歌词未在演唱中可靠识别，这些行不会自动高亮或跳转"
    return result


class LyricAlignmentService:
    def __init__(self, paths, store, worker, *, command=None):
        self.paths, self.store, self.worker = paths, store, worker
        self.command = command or [sys.executable, "-m", "yue2_studio.lyric_alignment_worker"]
        self._custom_command = command is not None
        self._lock = threading.RLock()
        self._active: dict[str, str] = {}
        self._process: subprocess.Popen | None = None
        self._closed = False

    def _available(self):
        if self._custom_command:
            return True
        model = self.paths.models_dir / "whisper" / MODEL_NAME
        try:
            return bool(shutil.which("whisper-cli") and shutil.which("ffmpeg")
                        and model.is_file() and model.stat().st_size == MODEL_BYTES
                        and importlib.util.find_spec("opencc") and importlib.util.find_spec("pypinyin"))
        except OSError:
            return False

    def _source(self, job_id):
        try:
            job = self.store.get(job_id)
        except NotFound:
            raise ApiError(404, "not_found", "作品不存在") from None
        root = Path(self.paths.songs_dir).resolve()
        song_dir = (root / job.id).resolve()
        path = (song_dir / "song" / "audio.flac").resolve()
        target = (song_dir / "alignment" / "lyrics.json").resolve()
        if (not song_dir.is_relative_to(root) or not path.is_relative_to(song_dir)
                or not target.is_relative_to(song_dir)):
            raise ApiError(404, "not_found", "作品音频不存在")
        if job.status != "done" or not path.is_file():
            raise ApiError(409, "not_completed", "完成生成后才能校准歌词")
        lyrics = job.params.get("lyrics") or ""
        if not isinstance(lyrics, str) or not has_lyrics(lyrics):
            raise ApiError(400, "no_lyrics", "这首作品没有需要校准的歌词")
        try:
            stat = path.stat()
            info = sf.info(path)
            duration = info.duration
            if not math.isfinite(duration) or not 0 < duration <= MAX_AUDIO_SECONDS:
                raise ValueError("invalid audio length")
        except (OSError, RuntimeError, ValueError):
            raise ApiError(400, "invalid_audio", "无法读取作品音频，暂时不能校准歌词") from None
        signature = json.dumps([ALGORITHM_VERSION, lyrics, stat.st_size, stat.st_mtime_ns,
                                stat.st_ino], ensure_ascii=False).encode()
        return job, path, target, duration, hashlib.sha256(signature).hexdigest()

    def _read(self, target, fingerprint, duration):
        try:
            if target.stat().st_size > MAX_RESULT_BYTES:
                return _empty()
            data = json.loads(target.read_text(encoding="utf-8"))
            if data.get("fingerprint") != fingerprint or data.get("version") != ALGORITHM_VERSION:
                return _empty(message="音频或歌词已变化，需要重新校准")
            result = data["result"]
            if result.get("status") == "ready":
                return validate_result(result, duration)
            if result.get("status") in STATUSES:
                return _empty(result["status"], result.get("message"))
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            pass
        return _empty()

    def _save(self, target, fingerprint, result):
        # Never recreate a deleted song while a queued/background task finishes.
        if not target.parent.parent.is_dir():
            return
        target.parent.mkdir(exist_ok=True, mode=0o700)
        _atomic_json(target, {"version": ALGORITHM_VERSION, "fingerprint": fingerprint,
                              "result": result})

    def get(self, job_id):
        _, _, target, duration, fingerprint = self._source(job_id)
        with self._lock:
            result = self._read(target, fingerprint, duration)
            if result["status"] in {"queued", "running"} and job_id not in self._active:
                return _empty(message="上次校准已中断，可以重新校准")
            if result["status"] == "idle" and not self._available():
                return _empty("unavailable", "本机歌词校准工具尚未就绪")
            return result

    def start(self, job_id):
        job, _, target, duration, fingerprint = self._source(job_id)
        with self._lock:
            if self._closed:
                raise ApiError(503, "alignment_unavailable", "服务正在停止，请稍后重试")
            existing = self._read(target, fingerprint, duration)
            if existing["status"] == "ready" or job_id in self._active:
                return existing
            if not self._available():
                return _empty("unavailable", "本机歌词校准工具尚未就绪")
            self._active[job_id] = fingerprint
            result = _empty("queued", "等待本机生成任务完成后校准歌词")
            try:
                self._save(target, fingerprint, result)
                accepted = self.worker.submit_maintenance(
                    "lyrics:" + job_id, lambda cancelled: self._run(job.id, fingerprint, cancelled))
            except OSError:
                self._active.pop(job_id, None)
                raise ApiError(503, "alignment_unavailable", "无法保存校准任务，请检查本机存储空间") from None
            if not accepted:
                self._active.pop(job_id, None)
                result = _empty("idle", "服务暂时无法排队，请稍后重试")
                self._save(target, fingerprint, result)
            return result

    def after_job(self, job):
        """Called by the worker after generation; imports/downloads no model here."""
        try:
            fresh = self.store.get(job.id)
            if fresh.status == "done" and has_lyrics(fresh.params.get("lyrics") or ""):
                self.start(job.id)
        except (ApiError, NotFound):
            return

    @staticmethod
    def _terminate(process):
        if process.poll() is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=2)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=3)

    def _run(self, job_id, fingerprint, cancelled):
        target = None
        process = None
        result = _empty("failed", "歌词校准失败，请重试")
        try:
            job, audio, target, duration, current = self._source(job_id)
            if current != fingerprint:
                result = _empty("idle", "音频或歌词已变化，需要重新校准")
                return
            if cancelled() or self._closed:
                result = _empty("idle", "校准已停止，可以重新校准")
                return
            if psutil.virtual_memory().available < MIN_AVAILABLE_BYTES:
                result = _empty("failed", "可用内存不足，关闭暂时不用的应用后再校准")
                return
            with self._lock:
                self._save(target, fingerprint, _empty("running", "正在根据实际演唱校准歌词"))
            with tempfile.TemporaryDirectory(prefix="yue2-lyrics-") as temporary:
                temporary = Path(temporary)
                input_path, output_path = temporary / "input.json", temporary / "output.json"
                input_path.write_text(json.dumps({"lyrics": job.params["lyrics"]}, ensure_ascii=False),
                                      encoding="utf-8")
                cmd = [*self.command, "--audio", str(audio), "--lyrics", str(input_path),
                       "--output", str(output_path)]
                service_home = getattr(self.paths, "home", self.paths.songs_dir.parent.parent)
                env = {**os.environ, "OMP_NUM_THREADS": "4", "OPENBLAS_NUM_THREADS": "4",
                       "VECLIB_MAXIMUM_THREADS": "4", "HF_HUB_OFFLINE": "1",
                       "YUE2_STUDIO_HOME": str(service_home)}
                with tempfile.TemporaryFile() as errors:
                    with self._lock:
                        if cancelled() or self._closed:
                            result = _empty("idle", "校准已停止，可以重新校准")
                            return
                        process = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=errors,
                                                   env=env, start_new_session=True)
                        self._process = process
                    deadline = time.monotonic() + ALIGNMENT_TIMEOUT
                    while process.poll() is None:
                        if cancelled() or self._closed:
                            self._terminate(process)
                            result = _empty("idle", "校准已停止，可以重新校准")
                            return
                        if time.monotonic() > deadline:
                            self._terminate(process)
                            result = _empty("failed", "歌词校准超时，请稍后重试")
                            return
                        time.sleep(0.2)
                if cancelled() or self._closed:
                    result = _empty("idle", "校准已停止，可以重新校准")
                    return
                if output_path.is_file() and output_path.stat().st_size <= MAX_RESULT_BYTES:
                    result = validate_result(json.loads(output_path.read_text(encoding="utf-8")), duration)
                elif process.returncode != 0:
                    result = _empty("unavailable", "本机歌词校准工具尚未就绪")
        except ApiError:
            # Song deleted/modified while waiting: do not resurrect its directory.
            result = _empty("idle")
        except (OSError, ValueError, subprocess.SubprocessError):
            result = _empty("failed", "未能取得可靠的歌词时间轴，请重试")
        finally:
            if process is not None and process.poll() is None:
                self._terminate(process)
            with self._lock:
                if target is not None:
                    try:
                        _, _, current_target, _, current = self._source(job_id)
                        if current == fingerprint:
                            self._save(current_target, fingerprint, result)
                    except (ApiError, OSError):
                        pass
                self._active.pop(job_id, None)
                self._process = None

    def close(self):
        with self._lock:
            self._closed = True
            active = list(self._active)
            process = self._process
            for job_id in active:
                self.worker.cancel_maintenance("lyrics:" + job_id)
                try:
                    _, _, target, _, fingerprint = self._source(job_id)
                    self._save(target, fingerprint, _empty("idle", "校准已停止，可以重新校准"))
                except (ApiError, OSError):
                    pass
        if process is not None:
            self._terminate(process)
