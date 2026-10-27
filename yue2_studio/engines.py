"""Runtime engine registry: multiple generation engines (local / cloud), hot-switchable.

The active engine is stored on app.state; workers read it per job, so a switch
applies immediately when idle or on the next job when one is running.
"""
from __future__ import annotations

import os
import threading

_ENGINES: dict = {}
_ACTIVE = None
_LOCK = threading.RLock()


def register(key: str, factory, label: str, description: str, kind: str):
    """Register an engine factory. `factory()` returns a fresh engine instance."""
    _ENGINES[key] = {"key": key, "factory": factory, "label": label,
                     "description": description, "kind": kind}


def available() -> dict:
    with _LOCK:
        return {
            "active": _ACTIVE,
            "engines": [
                {"key": k, "label": v["label"], "description": v["description"], "kind": v["kind"]}
                for k, v in _ENGINES.items()
            ],
        }


def current():
    with _LOCK:
        return _ENGINES.get(_ACTIVE)["factory"]() if _ACTIVE in _ENGINES else None


def current_id() -> str | None:
    """Key of the active engine (e.g. 'local' / 'suno'), or None before install_default."""
    with _LOCK:
        return _ACTIVE


def switch(key: str) -> str:
    """Switch the active engine. Returns the new key; raises KeyError for unknown keys."""
    with _LOCK:
        if key not in _ENGINES:
            raise KeyError(key)
        global _ACTIVE
        _ACTIVE = key
        return _ACTIVE


def install_default(app_state=None):
    """Register the engines this deployment knows about and pick the default.

    Order of preference for the default: AMC_ENGINE env > local acestep15.
    The Suno engine only registers (and becomes selectable) when a key exists.
    """
    from yue2_studio.acestep15_engine import ACEStep15Engine
    register("local", lambda: app_state and getattr(app_state, "_engine_local", None) or ACEStep15Engine(),
             "标准（本地）", "本地 ACE-Step 1.5 引擎生成，免费、约 3 分钟一首", "local")

    suno_key = os.environ.get("AMC_SUNO_API_KEY") or ""
    if suno_key:
        from yue2_studio.suno_engine import SunoEngine
        register("suno", lambda: SunoEngine(api_key=suno_key,
                                            base_url=os.environ.get("AMC_SUNO_BASE_URL", "https://api.sunoapi.org")),
                 "高品质（云端）", "Suno V5 云端生成，商业级质量、约 1-2 分钟一首", "cloud")
        if os.environ.get("AMC_ENGINE") == "suno":
            switch("suno")
    if os.environ.get("AMC_ENGINE") == "acestep":
        from yue2_studio.acestep_engine import ACEStepEngine
        register("legacy", lambda: ACEStepEngine(), "兼容（旧版）", "ACE-Step 初代引擎", "local")
        switch("legacy")
    if _ACTIVE is None:
        switch("local")
    return _ACTIVE
