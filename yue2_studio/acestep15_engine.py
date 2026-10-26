"""ACE-Step 1.5 engine adapter (DiT + LM planner).

Runs the new-generation model from /home/teddy/projects/ACE-Step-1.5:
- DiT: acestep-v15-turbo (8-step distilled, no CFG) or acestep-v15-sft (50-step + CFG)
- LM: acestep-5Hz-lm-1.7B planner (thinking mode plans structure/lyrics)
- VAE + Qwen3-Embedding text encoder

Contract identical to the previous ACEStepEngine.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

from yue2_studio.config import EngineOptions

PROJECT = Path("/home/teddy/projects/ACE-Step-1.5")
SAMPLE_RATE = 44100

# sys.path for the venv-less loader (pipeline imports live in the repo)
if str(PROJECT) not in sys.path:
    sys.path.insert(0, str(PROJECT))


def _emit_stage(on_event, label, completed=None, total=None, unit=None, status="running"):
    if on_event:
        on_event({"type": "stage", "stage": label, "completed": completed, "total": total,
                  "unit": unit, "status": status, "ts": time.time()})


class ACEStep15Engine:
    """ACE-Step 1.5 via its native handler/pipeline API."""

    def __init__(self, *, checkpoint_dir: Path | str | None = None,
                 dit_model: str = "acestep-v15-turbo",
                 lm_model: str = "acestep-5Hz-lm-1.7B",
                 use_sft: bool = False):
        self.dit_model = "acestep-v15-sft" if use_sft else "acestep-v15-turbo"
        self.lm_model = lm_model
        self.state = "cold"
        self.precision = None
        self.low_memory = None
        self._dit = None
        self._llm = None
        self._lock = __import__("threading").RLock()

    # -- lifecycle ------------------------------------------------------------------
    def ensure(self, options: EngineOptions, on_event: Callable | None = None) -> None:
        if self._dit is not None:
            return
        _emit_stage(on_event, "Loading ACE-Step 1.5 models", total=None)
        from acestep.handler import AceStepHandler
        from acestep.llm_inference import LLMHandler

        dit = AceStepHandler()
        msg, ok = dit.initialize_service(
            project_root=str(PROJECT),
            config_path=self.dit_model,
            device="auto",
            offload_to_cpu=False,
        )
        if not ok:
            raise RuntimeError(f"ACE-Step 1.5 DiT init failed: {msg}")

        llm = LLMHandler()
        msg, ok = llm.initialize(
            checkpoint_dir=str(PROJECT / "checkpoints"),
            lm_model_path=self.lm_model,
            backend="transformers",
            device="auto",
            offload_to_cpu=True,   # 8GB VRAM: LM lives on CPU, DiT on GPU
            dtype=None,
        )
        if not ok:
            raise RuntimeError(f"ACE-Step 1.5 LM init failed: {msg}")

        self._dit, self._llm = dit, llm
        self.state = "ready"

    def unload(self) -> None:
        self._dit = None
        self._llm = None
        self.state = "cold"

    def memory_footprint(self) -> dict:
        return {"engine": "acestep-v15", "dit": self.dit_model, "lm": self.lm_model}

    def _lyrics_for(self, request: dict) -> tuple[str, str]:
        style = (request.get("style") or "").strip()
        lyrics = (request.get("lyrics") or "").strip()
        if not lyrics or lyrics.lower() in {"instrumental", "纯音乐"}:
            return style, ""
        return style, lyrics

    def _duration_for(self, request: dict) -> float | None:
        raw = request.get("duration") or request.get("audio_seconds")
        try:
            return float(raw) if raw is not None else None
        except (TypeError, ValueError):
            return None

    # -- jobs -----------------------------------------------------------------------
    def create_song(self, request: dict, out_dir: Path, *, options: EngineOptions,
                    on_event: Callable | None = None, cancelled: Callable | None = None) -> dict:
        out_dir = Path(out_dir)
        song_dir = out_dir / "song"
        self.ensure(options, on_event)
        from acestep.inference import GenerationParams, GenerationConfig, generate_music

        with self._lock:
            tags, lyrics = self._lyrics_for(request)
            duration = self._duration_for(request)
            seed = int(request.get("seed") or 0)

            params = GenerationParams(
                task_type="text2music",
                thinking=True,
                caption=tags,
                lyrics=lyrics,
                vocal_language="zh" if _has_chinese(lyrics) else "en",
                duration=duration,
                inference_steps=8 if "turbo" in self.dit_model else 50,
                guidance_scale=1.0 if "turbo" in self.dit_model else 15.0,
                seed=seed if seed > 0 else -1,
            )
            config = GenerationConfig(batch_size=1, audio_format="wav")

            _emit_stage(on_event, "Diffusion", completed=0, total=8, unit="steps")
            result = generate_music(
                self._dit, self._llm, params=params, config=config, save_dir=str(song_dir),
            )
            if not result.success:
                raise RuntimeError(f"ACE-Step 1.5 generation failed: {result.status_message}")

            audio_path = Path(result.audios[0]["path"]) if result.audios else None
            if audio_path is None or not audio_path.is_file():
                raise RuntimeError("ACE-Step 1.5 produced no audio file")

            _emit_stage(on_event, "Saving artifacts", completed=0, total=1, unit="files")
            song_dir.mkdir(parents=True, exist_ok=True)
            final_audio = song_dir / "audio.flac"
            if audio_path.suffix != ".flac":
                subprocess.run(["ffmpeg", "-y", "-v", "quiet", "-i", str(audio_path),
                                "-c:a", "flac", str(final_audio)], check=True)
            else:
                final_audio.write_bytes(audio_path.read_bytes())

            seconds = 0.0
            try:
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
                "plan_dir": str(out_dir / "plan"),
                "sample_rate": SAMPLE_RATE,
                "seconds": seconds,
                "identity": "acestep-v15",
                "preset": options.preset, "precision": options.precision,
                "ode_steps": options.ode_steps, "fast_numerics": options.fast_numerics,
                "low_memory": options.low_memory, "seed": seed,
                "loras": [],
            }

    # -- degraded cover/hum paths ---------------------------------------------------
    def cover_song(self, audio_path, out_dir, *, request, options, on_event=None, cancelled=None, **kw):
        return self.create_song(request, out_dir, options=options, on_event=on_event, cancelled=cancelled)

    def hum_song(self, audio_path, out_dir, *, request, hum, options, on_event=None, cancelled=None, **kw):
        summary = self.create_song(request, out_dir, options=options, on_event=on_event, cancelled=cancelled)
        summary["hum"] = {"degraded": True}
        return summary


def _has_chinese(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in (text or ""))
