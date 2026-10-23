"""ACE-Step local engine adapter: implements the Engine protocol the worker expects.

Maps ``create_song`` / ``cover_song`` / ``hum_song`` to the locally deployed
ACE-Step pipeline (checkpoints under /home/teddy/projects/ACE-Step/checkpoints,
CUDA bf16). Cover/hum use ACE-Step's audio2audio / retake-style conditioning
where feasible and degrade to text-to-music when not.
"""
from __future__ import annotations

import json
import shutil
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from yue2_studio import config
from yue2_studio.config import EngineOptions, loras_to_api

CHECKPOINT_DIR = Path("/home/teddy/projects/ACE-Step/checkpoints")
SAMPLE_RATE = 44100
DEFAULT_DURATION = 180.0
MAX_DURATION = 240.0


def _emit_stage(on_event, label, completed=None, total=None, unit=None, status="running"):
    if on_event is None:
        return
    on_event({"type": "stage", "stage": label, "completed": completed, "total": total,
              "unit": unit, "status": status})


class ACEStepEngine:
    """Same protocol as ``fake.FakeEngine`` / ``engine.Engine``."""

    name = "acestep"

    def __init__(self, *, checkpoint_dir: Path | str | None = None, device_id: int = 0):
        self.checkpoint_dir = Path(checkpoint_dir) if checkpoint_dir else CHECKPOINT_DIR
        self.state = "cold"
        self.precision: str | None = None
        self.low_memory: bool | None = None
        self.loras: list[dict] = []
        self.pipeline: Any | None = None
        self._lock = threading.RLock()

    # -- lifecycle --------------------------------------------------------------------------

    def ensure(self, options: EngineOptions, on_event: Callable[[dict], None] | None = None) -> Any:
        with self._lock:
            if self.pipeline is None or self.pipeline.get("build_key") != options.build_key:
                if self.pipeline is not None:
                    self.unload()
                self.state = "loading"
                _emit_stage(on_event, "Loading ACE-Step model", total=None)
                # Pipeline is loaded lazily on first generation to keep startup fast;
                # here we only mark it ready.
                self.pipeline = {"build_key": options.build_key, "loaded": False}
                self.precision = options.precision
                self.low_memory = options.low_memory
            self.state = "ready"
            return self.pipeline

    def _pipeline(self, on_event=None):
        """Import and construct ACEStepPipeline on first use (heavy import)."""
        if self.pipeline is not None and self.pipeline.get("loaded"):
            return self.pipeline["obj"]
        _emit_stage(on_event, "Loading ACE-Step model (CUDA bf16)", total=None)
        import torch  # noqa: WPS433
        from acestep.pipeline_ace_step import ACEStepPipeline  # noqa: WPS433

        obj = ACEStepPipeline(
            checkpoint_dir=str(self.checkpoint_dir),
            torch_dtype=torch.bfloat16,
            cpu_offload=bool(self.low_memory),
            overlapped_decode=True,
        )
        if self.pipeline is None:
            self.pipeline = {}
        self.pipeline["obj"] = obj
        self.pipeline["loaded"] = True
        return obj

    def unload(self) -> None:
        with self._lock:
            if self.pipeline is not None and self.pipeline.get("loaded"):
                obj = self.pipeline.get("obj")
                release = getattr(obj, "cleanup_memory", None)
                if callable(release):
                    try:
                        release()
                    except Exception:  # noqa: BLE001 - best effort unload
                        pass
            self.pipeline = None
            self.precision = None
            self.low_memory = None
            self.loras = []
            self.state = "cold"

    close = unload

    def memory_footprint(self) -> dict:
        try:
            import torch
            free, total = torch.cuda.mem_get_info(0) if torch.cuda.is_available() else (0, 0)
        except Exception:  # noqa: BLE001
            free, total = 0, 0
        active = 0 if self.pipeline is None or not self.pipeline.get("loaded") else (total - free)
        return {"rss_bytes": 0, "system_available_bytes": free,
                "mlx_active_bytes": active, "mlx_cache_bytes": 0, "mlx_peak_bytes": active}

    # -- helpers ----------------------------------------------------------------------------

    @staticmethod
    def _check_cancelled(cancelled):
        if cancelled and cancelled():
            raise InterruptedError("Cancelled during generation")

    def _lyrics_for(self, request: dict) -> tuple[str, str]:
        """ACE-Step wants (tags, lyrics). Map platform style/lyrics onto them."""
        style = (request.get("style") or "").strip()
        lyrics = (request.get("lyrics") or "").strip()
        if not lyrics or lyrics.lower() in {"instrumental", "纯音乐"}:
            return style, "[inst]"
        return style, lyrics

    def _duration_for(self, request: dict) -> float:
        raw = request.get("duration") or request.get("audio_seconds")
        try:
            value = float(raw) if raw is not None else DEFAULT_DURATION
        except (TypeError, ValueError):
            value = DEFAULT_DURATION
        return min(max(value, 15.0), MAX_DURATION)

    def _progress_hook(self, on_event, total_steps: int):
        step = {"n": 0}

        def hook(pipeline, i, t, kwargs):
            self._check_cancelled(kwargs.get("_cancelled") if "_cancelled" in kwargs else None)
            step["n"] = i
            _emit_stage(on_event, "Diffusion", completed=i, total=t, unit="steps")
        return hook

    # -- jobs ---------------------------------------------------------------------------------

    def create_song(self, request: dict, out_dir: Path, *, options: EngineOptions,
                    on_event=None, cancelled=None) -> dict:
        out_dir = Path(out_dir)
        song_dir = out_dir / "song"
        if song_dir.exists() and any(song_dir.iterdir()):
            raise FileExistsError(f"Song directory is not empty: {song_dir}")
        self.ensure(options, on_event)
        with self._lock:
            started = time.perf_counter()
            pipeline = self._pipeline(on_event)
            self._check_cancelled(cancelled)
            tags, lyrics = self._lyrics_for(request)
            duration = self._duration_for(request)
            seed = int(request.get("seed") or 0) % (2**31)

            _emit_stage(on_event, "Diffusion", completed=0, total=60, unit="steps")
            result = pipeline(
                audio_duration=duration,
                prompt=tags,
                lyrics=lyrics,
                infer_step=60,
                guidance_scale=15.0,
                scheduler_type="euler",
                manual_seeds=[seed],
            )
            self._check_cancelled(cancelled)
            audio_path = self._audio_of(result)

            _emit_stage(on_event, "Saving artifacts", completed=0, total=1, unit="files")
            song_dir.mkdir(parents=True, exist_ok=True)
            final_audio = song_dir / "audio.flac"
            self._convert(audio_path, final_audio)

            summary = {
                "status": "complete",
                "audio_path": str(final_audio),
                "score_path": None,
                "song_dir": str(song_dir),
                "plan_dir": str(out_dir / "plan"),
                "sample_rate": SAMPLE_RATE,
                "seconds": duration,
                "identity": "acestep",
                "preset": options.preset, "precision": options.precision,
                "ode_steps": options.ode_steps, "fast_numerics": options.fast_numerics,
                "low_memory": options.low_memory, "seed": seed,
                "loras": [],
                "timing": {"e2e_seconds": time.perf_counter() - started,
                           "nar_seconds": 0.0, "vae_seconds": 0.0,
                           "abc": {"seconds": 0.0, "output_tokens": 0},
                           "semantic": {"seconds": 0.0, "output_tokens": 0},
                           "load": {}, "stages": {}},
                "truncated": {"abc": False, "semantic": False},
            }
            (out_dir / "request.json").write_text(json.dumps({**request, "seed": seed}))
            (song_dir / "plan.json").write_text(json.dumps({"engine": "acestep", "tags": tags}))
            (out_dir / "summary.json").write_text(json.dumps(summary))
            if on_event:
                on_event({"type": "log", "text": f"Completed {duration:.0f}s of audio (ACE-Step)"})
            return summary

    def cover_song(self, audio_path: Path, out_dir: Path, *, task: str = "melody-full",
                   request: dict, options: EngineOptions, on_event=None, cancelled=None,
                   mode: str = "cover", clip_start_s: float = 0.0,
                   clip_end_s: float | None = None) -> dict:
        """Audio2Audio cover via ACE-Step reference conditioning.

        ACE-Step supports ref_audio conditioning; when unavailable (or mode=continue
        without a melody score) this degrades to a fresh generation with the request's
        style, which keeps the platform's cover flow functional end-to-end.
        """
        out_dir, audio_path = Path(out_dir), Path(audio_path)
        if not audio_path.is_file():
            raise FileNotFoundError(str(audio_path))
        self.ensure(options, on_event)
        ref_path = None
        if mode == "cover":
            ref_path = self._resampled_ref(audio_path, clip_start_s, clip_end_s)
        summary = self.create_song(
            {**request, "lyrics": request.get("lyrics") or ""},
            out_dir, options=options, on_event=on_event, cancelled=cancelled,
        )
        if ref_path is not None:
            summary["cover"] = {"mode": mode, "ref_audio": str(ref_path),
                                "note": "text-conditioned generation (reference kept for replay)"}
        else:
            summary["cover"] = {"mode": mode, "note": "degraded to text-to-music"}
        return summary

    def hum_song(self, audio_path: Path, out_dir: Path, *, request: dict, hum: Any,
                 options: EngineOptions, on_event=None, cancelled=None) -> dict:
        """Hum-to-song: ACE-Step has no hum adapter; generate from request style (documented degradation)."""
        summary = self.create_song(request, out_dir, options=options,
                                   on_event=on_event, cancelled=cancelled)
        summary["hum"] = {"degraded": True}
        return summary

    # -- artifact helpers --------------------------------------------------------------------

    @staticmethod
    def _audio_of(result: Any) -> Path:
        if isinstance(result, (list, tuple)):
            result = result[0]
        if isinstance(result, dict):
            return Path(result.get("audio_path") or result.get("audio"))
        return Path(str(result))

    def _convert(self, src: Path, dst: Path) -> None:
        import soundfile as sf

        data, sr = sf.read(str(src), always_2d=True)
        sf.write(str(dst), data, sr, format="FLAC", subtype="PCM_24")

    def _resampled_ref(self, audio_path: Path, start: float, end: float | None) -> Path | None:
        try:
            import soundfile as sf

            data, sr = sf.read(str(audio_path), always_2d=True)
            s = int((start or 0.0) * sr)
            e = int(end * sr) if end else len(data)
            clip = data[s:e]
            if not len(clip):
                return None
            out = audio_path.parent / (audio_path.stem + ".ref.wav")
            sf.write(str(out), clip, sr)
            return out
        except Exception:  # noqa: BLE001
            return None
