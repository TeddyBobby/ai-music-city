"""Suno cloud engine adapter (commercial-quality generation via Suno API).

Wiring: set AMC_ENGINE=suno, AMC_SUNO_API_KEY=<key>, and (optional)
AMC_SUNO_BASE_URL=<provider endpoint>. Jobs follow the same contract as
ACEStepEngine: create_song(request, out_dir, options, on_event, cancelled).
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
    """Cloud engine: submits (style, lyrics) to a Suno-compatible API and polls
    until the audio is ready, then downloads it into the song directory."""

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
            payload = {
                "prompt": tags,
                "make_instrumental": not lyrics,
                "wait_audio": False,
            }
            if lyrics:
                payload["lyrics"] = lyrics
            resp = client.post(f"{self.base_url}/api/v2/generate", json=payload, headers=self._headers())
            resp.raise_for_status()
            clips = resp.json() or []
            if not clips:
                raise RuntimeError("Suno returned no clips")
            clip_id = clips[0].get("id")

            emit("Cloud generation", total=100)
            audio_url = None
            for i in range(120):  # up to 10 min
                if cancelled and cancelled():
                    raise InterruptedError("Cancelled")
                time.sleep(5)
                poll = client.get(f"{self.base_url}/api/v2/generate/{clip_id}", headers=self._headers())
                poll.raise_for_status()
                data = poll.json() or [{}]
                clip = data[0] if isinstance(data, list) else data
                status = (clip.get("status") or "").lower()
                if status == "completed":
                    audio_url = clip.get("audio_url")
                    break
                if status == "error":
                    raise RuntimeError(f"Suno clip failed: {clip.get('error_message', 'unknown')}")
                emit("Cloud generation", completed=min(90, i * 8), total=100)

            if not audio_url:
                raise RuntimeError("Suno generation timed out")

            emit("Downloading audio", completed=95, total=100)
            audio = client.get(audio_url, timeout=httpx.Timeout(120))
            audio.raise_for_status()
            song_dir.mkdir(parents=True, exist_ok=True)
            final_audio = song_dir / "audio.flac"
            suffix = ".mp3" if "mp3" in audio_url else ".flac"
            raw = song_dir / f"audio{suffix}"
            raw.write_bytes(audio.content)
            if suffix != ".flac":
                # convert to flac via ffmpeg for a uniform contract
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
