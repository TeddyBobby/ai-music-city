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

SAMPLE_RATE = 44100


class SunoEngine:
    """Cloud engine: submits (style, lyrics) to sunoapi.org and polls
    record-info until the audio is ready, then downloads it."""

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
        if not lyrics or lyrics.lower() in {"instrumental", "纯音乐", "[inst]"}:
            return style, ""
        return style, lyrics

    # -- jobs -----------------------------------------------------------------------
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
        with httpx.Client(timeout=httpx.Timeout(30, connect=10), trust_env=False) as client:
            # v1 协议：customMode=true 时 prompt=歌词，tags=风格
            payload = {
                "customMode": bool(lyrics),
                "instrumental": not lyrics,
                "model": "V5",
                "callBackUrl": "https://music.myzai.top/s/ping",
            }
            if lyrics:
                payload["prompt"] = lyrics
                payload["tags"] = tags
                payload["title"] = (request.get("title") or "")[:60] or None
            else:
                payload["prompt"] = tags
            payload = {k: v for k, v in payload.items() if v is not None}
            resp = client.post(f"{self.base_url}/api/v1/generate", json=payload, headers=self._headers())
            data = resp.json()
            if data.get("code") != 200:
                raise RuntimeError(f"Suno submit failed: {data.get('msg')}")
            task_id = (data.get("data") or {}).get("taskId")
            if not task_id:
                raise RuntimeError(f"Suno returned no taskId: {data}")

            emit("Cloud generation", total=100)
            audio_url = None
            for i in range(120):  # up to 10 min
                if cancelled and cancelled():
                    raise InterruptedError("Cancelled")
                time.sleep(5)
                poll = client.get(f"{self.base_url}/api/v1/generate/record-info",
                                  params={"taskId": task_id}, headers=self._headers())
                pdata = poll.json()
                data = pdata.get("data") or {}
                # v1 record-info: clips live under data.response.sunoData (list);
                # some deployments also expose data.clips directly.
                clips = (data.get("clips")
                         or ((data.get("response") or {}).get("sunoData"))
                         or [])
                if not clips:
                    # v1 task-level status: 30%+ queued/running, 100% complete
                    progress = data.get("taskProgress") or 0
                    emit("Cloud generation", completed=int(min(90, float(progress) * 0.9)), total=100)
                    continue
                clip = clips[0]
                audio_url = (clip.get("audio_url") or clip.get("audioUrl")
                             or clip.get("source_audio_url") or clip.get("sourceAudioUrl"))
                if audio_url:
                    break
                status = str(data.get("taskStatus") or clip.get("status") or "")
                if "ERROR" in status.upper() or clip.get("errorMessage"):
                    raise RuntimeError(f"Suno clip failed: {clip.get('errorMessage', status)}")
                emit("Cloud generation", completed=min(90, i * 8), total=100)

            if not audio_url:
                raise RuntimeError("Suno generation timed out")

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

        return {
            "status": "complete",
            "audio_path": str(final_audio),
            "score_path": None,
            "song_dir": str(song_dir),
            "sample_rate": SAMPLE_RATE,
            "seconds": 0.0,
            "identity": "suno",
            "preset": options.preset, "precision": options.precision,
            "ode_steps": options.ode_steps, "fast_numerics": options.fast_numerics,
            "low_memory": options.low_memory, "seed": request.get("seed"),
            "loras": [],
        }

    # -- degrade paths (cover/hum map to plain generation) -------------------------
    def cover_song(self, audio_path, out_dir, **kw):
        return self.create_song(kw["request"], out_dir, options=kw["options"],
                                on_event=kw.get("on_event"), cancelled=kw.get("cancelled"))

    def hum_song(self, audio_path, out_dir, **kw):
        summary = self.create_song(kw["request"], out_dir, options=kw["options"],
                                   on_event=kw.get("on_event"), cancelled=kw.get("cancelled"))
        summary["hum"] = {"degraded": True}
        return summary
