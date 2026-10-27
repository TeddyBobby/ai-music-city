"""Suno cloud engine adapter (commercial-quality generation via sunoapi.org v1 API).

Wiring: set AMC_ENGINE=suno, AMC_SUNO_API_KEY=<key>. Jobs follow the same
contract as ACEStepEngine: create_song(request, out_dir, options, on_event, cancelled).
"""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Callable

import httpx

from yue2_studio.config import EngineOptions
from yue2_studio.jobs import SunoParams

SAMPLE_RATE = 44100


class SunoEngine:
    """Cloud engine: submits (style, lyrics) to sunoapi.org and polls
    record-info until the audio is ready, then downloads it."""

    engine_id = "suno"

    def __init__(self, *, api_key: str | None = None, base_url: str = "https://api.sunoapi.org"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.state = "cold"
        self.precision = None
        self.low_memory = None

    # -- lifecycle ------------------------------------------------------------------
    def ensure(self, options: EngineOptions, on_event: Callable | None = None) -> None:
        if not self.api_key:
            raise RuntimeError("Suno engine needs AMC_SUNO_API_KEY")
        self.state = "ready"

    def unload(self) -> None:
        self.state = "cold"

    def memory_footprint(self) -> dict:
        return {"engine": "suno", "cloud": True}

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    def _lyrics_for(self, request: dict) -> tuple[str, str]:
        style = (request.get("style") or "").strip()
        lyrics = (request.get("lyrics") or "").strip()
        if (request.get("music_kind") == "instrumental" or not lyrics
                or lyrics.lower() in {"instrumental", "纯音乐", "[inst]", "[intro]"}):
            return style, ""
        return style, lyrics

    def _custom_payload(self, request: dict, *, audio_reference: bool = False) -> dict:
        """Build a custom-generation payload from validated, optional controls."""
        style, lyrics = self._lyrics_for(request)
        instrumental = request.get("music_kind") == "instrumental" or (
            request.get("music_kind") != "vocal" and not lyrics)
        controls = SunoParams.model_validate(request.get("suno") or {}).model_dump(exclude_none=True)
        if instrumental:
            controls.pop("vocalGender", None)
        if not audio_reference and instrumental:
            controls.pop("audioWeight", None)
        if not controls.get("personaId"):
            controls.pop("personaModel", None)
        title = (request.get("title") or "").strip() or "未命名的音乐"
        for label, value, limit in (("作品名称", title, 80), ("音乐风格", style, 1000),
                                    ("歌词", lyrics, 5000)):
            if len(value) > limit:
                raise ValueError(f"{label}最多支持 {limit} 个字符")
        payload = {
            "customMode": True,
            "instrumental": instrumental,
            "model": "V6",
            "callBackUrl": "https://music.myzai.top/s/ping",
            "style": style,
            "title": title,
            **controls,
        }
        if audio_reference:
            payload.pop("customMode")  # upload-cover always uses custom mode.
        if not instrumental:
            payload["lyrics"] = lyrics
        return payload

    # -- jobs -----------------------------------------------------------------------
    # -- reference upload -----------------------------------------------------------
    def _upload_file(self, client: httpx.Client, path: Path, upload_path: str) -> str:
        """Upload a local file to sunoapi's temporary storage; returns a public URL."""
        import base64

        data = Path(path).read_bytes()
        mime = "audio/mpeg" if path.suffix in {".mp3", ".wav"} else "application/octet-stream"
        if path.suffix in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
            mime = f"image/{path.suffix.lstrip('.').replace('jpg', 'jpeg')}"
        b64 = base64.b64encode(data).decode()
        body = {
            "base64Data": f"data:{mime};base64,{b64}",
            "uploadPath": upload_path,
            "fileName": path.name,
        }
        resp = client.post("https://sunoapiorg.redpandaai.co/api/file-base64-upload",
                           json=body, headers=self._headers())
        pdata = resp.json()
        url = (pdata.get("data") or {}).get("downloadUrl")
        if not url:
            raise RuntimeError(f"Suno file upload failed: {pdata.get('msg')}")
        return url

    def _submit(self, client: httpx.Client, payload: dict, *, path: str = "/api/v1/generate") -> str:
        """Submit generation or an upload cover; returns taskId."""
        resp = client.post(f"{self.base_url}{path}", json=payload, headers=self._headers())
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 200:
            raise RuntimeError(f"Suno submit failed: {data.get('msg')}")
        task_id = (data.get("data") or {}).get("taskId")
        if not task_id:
            raise RuntimeError(f"Suno returned no taskId: {data}")
        return task_id

    def _poll_and_save(self, client: httpx.Client, task_id: str, song_dir: Path,
                       cancelled: Callable | None, emit) -> Path:
        """Poll record-info until audio is ready; download and convert to FLAC."""
        for i in range(120):  # up to 10 min
            if cancelled and cancelled():
                raise InterruptedError("Cancelled")
            time.sleep(5)
            poll = client.get(f"{self.base_url}/api/v1/generate/record-info",
                              params={"taskId": task_id}, headers=self._headers())
            pdata = poll.json()
            data = pdata.get("data") or {}
            clips = (data.get("clips")
                     or ((data.get("response") or {}).get("sunoData"))
                     or [])
            if not clips:
                progress = data.get("taskProgress") or 0
                emit("Cloud generation", completed=int(min(90, float(progress) * 0.9)), total=100)
                continue
            clip = clips[0]
            audio_url = (clip.get("audio_url") or clip.get("audioUrl")
                         or clip.get("source_audio_url") or clip.get("sourceAudioUrl"))
            if not audio_url:
                status = str(data.get("taskStatus") or clip.get("status") or "")
                if "ERROR" in status.upper() or clip.get("errorMessage"):
                    raise RuntimeError(f"Suno clip failed: {clip.get('errorMessage', status)}")
                emit("Cloud generation", completed=min(90, i * 8), total=100)
                continue
            emit("Downloading audio", completed=95, total=100)
            audio = client.get(audio_url, timeout=httpx.Timeout(120))
            audio.raise_for_status()
            song_dir.mkdir(parents=True, exist_ok=True)
            final_audio = song_dir / "audio.flac"
            suffix = ".mp3" if ".mp3" in audio_url else (".wav" if ".wav" in audio_url else ".mp3")
            raw = song_dir / f"audio{suffix}"
            raw.write_bytes(audio.content)
            if suffix != ".flac":
                import subprocess
                subprocess.run(["ffmpeg", "-y", "-v", "quiet", "-i", str(raw),
                                "-c:a", "flac", str(final_audio)], check=True)
                raw.unlink()
            else:
                final_audio.write_bytes(audio.content)
            return final_audio
        raise RuntimeError("Suno generation timed out")

    def _finish_summary(self, final_audio: Path, song_dir: Path, options: EngineOptions,
                        request: dict) -> dict:
        seconds = 0.0
        try:
            import subprocess
            probe = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                 "-of", "csv=p=0", str(final_audio)],
                capture_output=True, text=True, check=True)
            seconds = float(probe.stdout.strip())
        except Exception:
            pass
        return {
            "status": "complete",
            "audio_path": str(final_audio),
            "score_path": None,
            "song_dir": str(song_dir),
            "plan_dir": str(song_dir.parent / "plan"),
            "sample_rate": SAMPLE_RATE,
            "seconds": seconds,
            "identity": "suno",
            "preset": options.preset, "precision": options.precision,
            "ode_steps": options.ode_steps, "fast_numerics": options.fast_numerics,
            "low_memory": options.low_memory, "seed": request.get("seed"),
            "loras": [],
        }

    def create_song(self, request: dict, out_dir: Path, *, options: EngineOptions,
                    on_event: Callable | None = None, cancelled: Callable | None = None) -> dict:
        out_dir = Path(out_dir)
        song_dir = out_dir / "song"
        tags, lyrics = self._lyrics_for(request)

        def emit(label, **kw):
            if on_event:
                on_event({"type": "stage", "stage": label, "ts": time.time(),
                          "status": "running", **kw})

        emit("Submitting to cloud")
        with httpx.Client(timeout=httpx.Timeout(60, connect=10), trust_env=False) as client:
            # 参考（图片/音频）存在时走非 custom 模式：imageUrls/audioUrls 驱动
            ref_image = request.get("ref_image_url")
            ref_audio = request.get("ref_audio_url")
            if (ref_image or ref_audio) and "suno" not in request:
                payload = {
                    "customMode": False,
                    "instrumental": not lyrics,
                    "model": "V6",
                    "callBackUrl": "https://music.myzai.top/s/ping",
                    "prompt": request.get("description") or tags or "根据参考生成一首歌",
                }
                if ref_image:
                    payload["imageUrls"] = [ref_image]
                if ref_audio:
                    payload["audioUrls"] = [ref_audio]
                if tags:
                    payload["style"] = tags
            else:
                payload = self._custom_payload(request)
            task_id = self._submit(client, payload)
            emit("Cloud generation", total=100)
            final_audio = self._poll_and_save(client, task_id, song_dir, cancelled, emit)
        return self._finish_summary(final_audio, song_dir, options, request)

    # -- hum / cover with real audio references -------------------------------------
    def hum_song(self, audio_path, out_dir, *, request, hum, options, on_event=None, cancelled=None, **kw):
        """哼唱：上传录音作 audioUrls 参考，Suno 沿旋律/氛围生成完整歌曲。"""
        out_dir = Path(out_dir)
        song_dir = out_dir / "song"
        tags, lyrics = self._lyrics_for(request)

        def emit(label, **kw2):
            if on_event:
                on_event({"type": "stage", "stage": label, "ts": time.time(),
                          "status": "running", **kw2})

        with httpx.Client(timeout=httpx.Timeout(120, connect=10), trust_env=False) as client:
            emit("Uploading hum recording")
            ref_url = self._upload_file(client, Path(audio_path), "amc/hum")
            request = {**request, "ref_audio_url": ref_url,
                       "description": request.get("description") or "围绕这段哼唱创作完整歌曲"}
            if "suno" in request:
                payload = self._custom_payload(request, audio_reference=True)
                payload["uploadUrl"] = ref_url
                task_id = self._submit(client, payload, path="/api/v1/generate/upload-cover")
            else:
                payload = {
                    "customMode": False,
                    "instrumental": not lyrics,
                    "model": "V6",
                    "callBackUrl": "https://music.myzai.top/s/ping",
                    "prompt": request["description"],
                    "audioUrls": [ref_url],
                }
                if tags:
                    payload["style"] = tags
                if lyrics:
                    payload["lyrics"] = lyrics
                task_id = self._submit(client, payload)
            emit("Cloud generation", total=100)
            final_audio = self._poll_and_save(client, task_id, song_dir, cancelled, emit)
        summary = self._finish_summary(final_audio, song_dir, options, request)
        summary["hum"] = {"reference": True}
        return summary

    def cover_song(self, audio_path, out_dir, *, request, options, on_event=None, cancelled=None, **kw):
        """翻唱：上传原曲，Suno 保留旋律换风格（upload-cover 接口）。"""
        out_dir = Path(out_dir)
        song_dir = out_dir / "song"

        def emit(label, **kw2):
            if on_event:
                on_event({"type": "stage", "stage": label, "ts": time.time(),
                          "status": "running", **kw2})

        with httpx.Client(timeout=httpx.Timeout(120, connect=10), trust_env=False) as client:
            emit("Uploading source track")
            ref_url = self._upload_file(client, Path(audio_path), "amc/cover")
            payload = self._custom_payload(request, audio_reference=True)
            payload["uploadUrl"] = ref_url
            task_id = self._submit(client, payload, path="/api/v1/generate/upload-cover")
            emit("Cloud generation", total=100)
            final_audio = self._poll_and_save(client, task_id, song_dir, cancelled, emit)
        return self._finish_summary(final_audio, song_dir, options, request)
