"""Worker thread, cancellation and the SSE event bus.

* ``Worker`` owns the only thread that touches the engine. Jobs are handed over as ids through a
  ``queue.Queue``; each job has a ``threading.Event`` that backs the engine's ``cancelled()``.
* ``EventBus`` fans events out to per-job ``asyncio.Queue`` subscribers on the server's event loop
  (``loop.call_soon_threadsafe``) and caches the last progress event per job for late subscribers.
* ``normalise`` converts raw engine events into the HTTP ``ProgressEvent`` shape (API.md §6).
"""

from __future__ import annotations

import asyncio
import itertools
import json
import logging
import queue
import shutil
import threading
import time
import traceback
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from yue2_studio import config
from yue2_studio.jobs import Job, JobStore, engine_request, hum_options, iso
from yue2_studio.music_prompts import MUSIC_INTENT_POLICY

log = logging.getLogger("yue2_studio.worker")


class Engine(Protocol):
    """The engine surface the worker relies on (``yue2_studio.engine.Engine`` and ``FakeEngine``)."""

    state: str
    precision: str | None
    pipeline: Any | None

    def ensure(self, options: config.EngineOptions,
               on_event: Callable[[dict], None] | None = None) -> Any: ...

    def create_song(self, request: dict, out_dir: Path, *, options: config.EngineOptions,
                    on_event: Callable[[dict], None] | None = None,
                    cancelled: Callable[[], bool] | None = None) -> dict: ...

    def cover_song(self, audio_path: Path, out_dir: Path, *, task: str, request: dict,
                   options: config.EngineOptions, on_event: Callable[[dict], None] | None = None,
                   cancelled: Callable[[], bool] | None = None, mode: str = "cover",
                   clip_start_s: float = 0.0, clip_end_s: float | None = None) -> dict: ...

    def hum_song(self, audio_path: Path, out_dir: Path, *, request: dict, hum: Any,
                 options: config.EngineOptions, on_event: Callable[[dict], None] | None = None,
                 cancelled: Callable[[], bool] | None = None) -> dict: ...

    def memory_footprint(self) -> dict: ...

    def unload(self) -> None: ...


# ---------------------------------------------------------------------------------------------
# Normalisation: raw engine event -> HTTP ProgressEvent
# ---------------------------------------------------------------------------------------------

EVENT_FIELDS = ("type", "job_id", "ts", "stage", "label", "completed", "total", "unit", "status", "phase",
                "tokens", "tps", "seconds", "text", "partial", "message")

_STAGE_KEYS = {
    "verifying model files": "load",
    "ai writing lyrics": "writing",
    "cutting clip": "transcribe",
    "transcribing audio": "transcribe",
    "analysing hum": "hum",
    "encoding hum": "hum",
    "using provided score": "plan",
    "planning score": "plan",
    "generating song": "semantic",
    "synthesizing audio": "synthesize",
    "decoding audio": "decode",
    "saving artifacts": "save",
}
_STATUS_MAP = {"completed": "complete"}


def stage_key(label: str | None) -> str | None:
    if label is None:
        return None
    text = label.strip().lower()
    if text in _STAGE_KEYS:
        return _STAGE_KEYS[text]
    if text.startswith(("loading", "verifying", "merging")):
        return "load"  # LoRA merges are part of bringing the models up
    if "transcri" in text:
        return "transcribe"
    return text.split()[0] if text else None


def _ts(value) -> str:
    if isinstance(value, int | float):
        return iso(float(value))
    if isinstance(value, str) and value:
        return value
    return iso(time.time())


def normalise(raw: dict, job_id: str) -> dict:
    """Raw engine event (API.md §6 table) -> HTTP ``ProgressEvent`` with every field present."""
    kind = raw.get("type")
    event = dict.fromkeys(EVENT_FIELDS)
    event.update(type=kind, job_id=job_id, ts=_ts(raw.get("ts")))
    if kind == "stage":
        label = raw.get("stage")
        event.update(stage=stage_key(label), label=label, completed=raw.get("completed"),
                     total=raw.get("total"), unit=raw.get("unit"),
                     status=_STATUS_MAP.get(raw.get("status"), raw.get("status")),
                     tps=raw.get("tps"), seconds=raw.get("seconds"))
    elif kind == "token":
        event.update(phase=raw.get("phase"), tokens=raw.get("tokens"), tps=raw.get("tps"),
                     seconds=raw.get("seconds"))
    elif kind == "abc":
        status = raw.get("status")
        event.update(phase=raw.get("phase", "abc"), tokens=raw.get("tokens"), text=raw.get("text"),
                     partial=None if status is None else status != "final")
    elif kind == "log":
        event.update(message=raw.get("text", raw.get("message")))
    elif kind == "status":
        event.update(stage=raw.get("stage"), status=raw.get("status"), message=raw.get("message"))
    else:  # unknown type: keep it visible rather than dropping it
        event.update(type="log", message=json.dumps(raw, default=str))
    return event


def status_event(job_id: str, status: str, message: str, *, stage: str | None = None) -> dict:
    return normalise({"type": "status", "status": status, "message": message, "stage": stage,
                      "ts": time.time()}, job_id)


def derive_timing(summary: dict) -> dict:
    """``Job.timing`` from the engine summary (API.md §6)."""
    t = summary.get("timing") or {}
    abc, semantic = t.get("abc") or {}, t.get("semantic") or {}

    def tps(section: dict) -> float | None:
        seconds, tokens = section.get("seconds"), section.get("output_tokens")
        if seconds and tokens:
            return round(tokens / seconds, 2)
        return None

    def secs(value) -> float | None:
        return None if value is None else round(float(value), 3)

    return {
        "plan": secs(abc.get("seconds")),
        "semantic": secs(semantic.get("seconds")),
        "synthesize": secs(t.get("nar_seconds")),
        "decode": secs(t.get("vae_seconds")),
        "transcribe": secs(t.get("transcription_seconds")),
        "e2e": secs(t.get("e2e_seconds")),
        "abc_tps": tps(abc),
        "semantic_tps": tps(semantic),
        "audio_seconds": secs(summary.get("seconds")),
    }


def derive_truncated(summary: dict) -> dict | None:
    truncated = summary.get("truncated") or {}
    for phase in ("abc", "semantic"):
        if truncated.get(phase):
            return {"phase": phase, "reason": "generation limit reached"}
    return None


# ---------------------------------------------------------------------------------------------
# Event bus
# ---------------------------------------------------------------------------------------------


class EventBus:
    """Per-job fan-out to ``asyncio.Queue`` subscribers living on one event loop.

    ``publish``/``done`` may be called from any thread; ``subscribe``/``unsubscribe`` must run on
    the bound loop. Each subscriber receives ``("progress", event)`` items and finally
    ``("done", job_json)``.
    """

    def __init__(self, loop: asyncio.AbstractEventLoop | None = None):
        self.loop = loop
        self._lock = threading.Lock()
        self._subscribers: dict[str, list[asyncio.Queue]] = {}
        self._last: dict[str, dict] = {}
        self._last_stage: dict[str, dict] = {}

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    # -- subscription (loop thread) -------------------------------------------------------------

    def subscribe(self, job_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        with self._lock:
            self._subscribers.setdefault(job_id, []).append(q)
        return q

    def unsubscribe(self, job_id: str, q: asyncio.Queue) -> None:
        with self._lock:
            subs = self._subscribers.get(job_id)
            if subs and q in subs:
                subs.remove(q)
            if not subs:
                self._subscribers.pop(job_id, None)

    # -- publishing (any thread) ----------------------------------------------------------------

    def last(self, job_id: str) -> dict | None:
        with self._lock:
            return self._last.get(job_id)

    def last_stage(self, job_id: str) -> dict | None:
        """The latest real stage-bearing event, unaffected by subsequent tokens or logs."""
        with self._lock:
            return self._last_stage.get(job_id)

    def publish(self, job_id: str, event: dict) -> None:
        with self._lock:
            self._last[job_id] = event
            if event.get("stage"):
                self._last_stage[job_id] = event
        self._dispatch(job_id, ("progress", event))

    def done(self, job_id: str, job_json: dict) -> None:
        """Deliver the terminal frame; subscribers and the cached event are dropped (the DB keeps the
        terminal progress, which the worker persists before calling this)."""
        with self._lock:
            self._last.pop(job_id, None)
            self._last_stage.pop(job_id, None)
        self._dispatch(job_id, ("done", job_json))

    def forget(self, job_id: str) -> None:
        with self._lock:
            self._last.pop(job_id, None)
            self._last_stage.pop(job_id, None)
            self._subscribers.pop(job_id, None)

    def _dispatch(self, job_id: str, item: tuple) -> None:
        loop = self.loop
        if loop is None or loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(self._deliver, job_id, item)
        except RuntimeError:  # loop shut down between the check and the call
            pass

    def _deliver(self, job_id: str, item: tuple) -> None:
        with self._lock:
            subs = list(self._subscribers.get(job_id, ()))
            if item[0] == "done":
                self._subscribers.pop(job_id, None)
        for q in subs:
            q.put_nowait(item)


# ---------------------------------------------------------------------------------------------
# Worker thread
# ---------------------------------------------------------------------------------------------


def _error_text(error: BaseException) -> str:
    text = f"{type(error).__name__}: {error}".strip()
    return text[:2000]


# ---------------------------------------------------------------------------------------------


def _ai_complete_draft(description: str, music_kind: str = "vocal", *, context: dict | None = None) -> dict:
    """Design the sound first, then fill unspecified lyrics through the configured Agent."""
    import re

    import httpx

    from yue2_studio.assistant_service import endpoint_url, provider_headers

    cfg = _assistant_cfg()
    instrumental = music_kind == "instrumental"
    contract = (
        '输出纯音乐（无人声）方案。字段：'
        '{"title": "曲名(20字内)", "style": "英文音乐风格，含具体配器、节奏、氛围与制作要求"}。'
        '不要生成歌词。'
        if instrumental else
        '输出带歌词的人声歌曲方案。字段：'
        '{"title": "歌名(20字内)", "style": "英文音乐风格，含具体曲风、配器、节奏、制作与演唱方式", '
        '"lyrics": "完整可演唱歌词，段落用 [verse]/[chorus]/[bridge] 标记，50-90 秒长度"}。'
    )
    system = (
        "你是专业的音乐制作人与词曲创作者。将用户的一句话想法整理成可执行的音乐方案。\n\n"
        + MUSIC_INTENT_POLICY
        + "\n\n只输出一个 JSON 对象，不要解释或 Markdown 代码块。"
        + contract
    )
    content = f"创作想法：{description}"
    existing = {key: context[key] for key in ("title", "style", "lyrics")
                if context and isinstance(context.get(key), str) and context[key].strip()}
    if existing:
        content += "\n\n已指定字段（保留原文，仅补齐缺失项）：\n" + json.dumps(existing, ensure_ascii=False)
    body = {
        "model": cfg.get("hermes_model") or "ZhipuAi/GLM-5.3",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": content},
        ],
        "stream": False,
        # 推理模型思考内容计入 max_tokens：给足思考+正文空间，
        # 否则 finish_reason=length 时正文被截成碎片（曾致“方案无法解析”）。
        "max_tokens": 2048 if instrumental else 6144,
    }
    try:
        with httpx.Client(timeout=httpx.Timeout(180, connect=10), trust_env=False) as client:
            resp = client.post(
                endpoint_url(cfg["hermes_base_url"], "chat/completions"),
                headers=provider_headers(cfg),
                json=body,
            )
            resp.raise_for_status()
            payload = resp.json()
            text = payload["choices"][0]["message"]["content"].strip()
    except Exception:
        text = ""
    # 解析失败（截断/空内容）时重试一次：强制关闭思考，只留输出预算
    match = re.search(r"\{[\s\S]*\}", text) if text else None
    if not match:
        retry = dict(body)
        retry["max_tokens"] = 4096
        retry["thinking"] = {"type": "disabled"}
        retry["messages"] = [
            {"role": "system", "content": system + "\n直接输出结果，不要思考过程。"},
            body["messages"][1],
        ]
        with httpx.Client(timeout=httpx.Timeout(180, connect=10), trust_env=False) as client:
            resp = client.post(
                endpoint_url(cfg["hermes_base_url"], "chat/completions"),
                headers=provider_headers(cfg),
                json=retry,
            )
            resp.raise_for_status()
            text = resp.json()["choices"][0]["message"]["content"].strip()
    # Tolerate a JSON fence or proposal wrapper without mixing style and sung text.
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError("AI 创作方案返回无法解析")
    data = json.loads(match.group(0))
    fields = ("title", "style") if instrumental else ("title", "style", "lyrics")
    # Providers may return only missing fields; supplied text remains authoritative.
    data.update({key: value for key, value in existing.items() if key in fields})
    for key in fields:
        if not isinstance(data.get(key), str) or not data[key].strip():
            raise ValueError(f"AI 创作方案缺少字段 {key}")
    return {
        "title": data["title"].strip(),
        "style": f"{data['style'].strip()}, instrumental, no vocals" if instrumental else data["style"].strip(),
        "lyrics": "纯音乐" if instrumental else data["lyrics"].strip(),
    }


_ASSISTANT_CFG_CACHE: dict = {}
_ASSISTANT_CFG_TS = 0.0


def _assistant_cfg() -> dict:
    """读取 assistant 的连接配置（base_url/key/model）。缓存 30 秒避免每首歌词都读磁盘。"""
    global _ASSISTANT_CFG_TS
    import time as _time
    import os as _os
    if _time.time() - _ASSISTANT_CFG_TS > 30 or not _ASSISTANT_CFG_CACHE:
        import os as _os
        from yue2_studio import config as _config
        cfg_path = Path(_config.paths_for().data_dir) / "assistant" / "settings.json"
        data = {}
        try:
            data = json.loads(cfg_path.read_text())
        except (OSError, ValueError):
            pass
        merged = {
            "hermes_base_url": data.get("hermes_base_url")
            or _os.environ.get("AMC_ASSISTANT_BASE_URL", ""),
            "hermes_api_key": data.get("hermes_api_key")
            or _os.environ.get("AMC_ASSISTANT_API_KEY", ""),
            "hermes_model": data.get("hermes_model")
            or _os.environ.get("AMC_ASSISTANT_MODEL", "ZhipuAi/GLM-5.3"),
        }
        if not merged["hermes_base_url"] or not merged["hermes_api_key"]:
            raise RuntimeError("平台未配置 Agent 连接，无法 AI 写词（AMC_ASSISTANT_BASE_URL/KEY）")
        _ASSISTANT_CFG_CACHE.clear()
        _ASSISTANT_CFG_CACHE.update(merged)
        _ASSISTANT_CFG_TS = _time.time()
    return _ASSISTANT_CFG_CACHE


class Worker:
    """Serial job runner; the only code path that touches the engine.

    Life cycle: ``start(loop)`` spawns the thread, ``submit(job_id)`` enqueues, ``cancel(job_id)``
    marks a queued job cancelled immediately (announcing ``done`` on the bus) or sets the running
    job's cancel flag, ``stop()`` drains and unloads the engine on the worker thread.
    """

    # 引擎注册表存在时每个任务动态取当前引擎（支持运行时切换）。
    @property
    def engine(self):
        try:
            import yue2_studio.engines as _engines
            current = _engines.current()
            if current is not None:
                self._engine = current
        except Exception:
            pass
        return self._engine

    def __init__(self, store: JobStore, engine: Engine, paths: config.Paths, bus: EventBus | None = None, *,
                 fake: bool = False, dispatcher: SharedDispatcher | None = None):
        self.dispatcher = dispatcher
        self._started = False
        self.store = store
        self._engine = engine  # property `engine` resolves the registry's active engine
        self.paths = paths
        self.bus = bus or EventBus()
        self.fake = fake
        # Heavy maintenance (e.g. lyric alignment) shares this worker, so it cannot
        # overlap generation. Already queued generation always takes priority.
        self._queue: queue.PriorityQueue[tuple[int, int, str | None, Any]] = queue.PriorityQueue()
        self._task_sequence = itertools.count()
        self._maintenance: dict[str, threading.Event] = {}
        self.current_maintenance_key: str | None = None
        self._cancels: dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self.current_job_id: str | None = None
        self.memory: dict | None = None
        self._last_memory_sample = 0.0
        self._stopping = False
        # Housekeeping run on the worker thread after each job has been announced done (never raises
        # into the loop; e.g. ``uploads.auto_prune``). The engine is idle at that point.
        self.after_job: Callable[[Job], None] | None = None
        if dispatcher is not None:
            dispatcher.register(self)

    # -- lifecycle ----------------------------------------------------------------------------

    def start(self, loop: asyncio.AbstractEventLoop | None = None, *, start_dispatcher: bool = True) -> None:
        if loop is not None:
            self.bus.bind(loop)
        if self._started or self._thread is not None:
            return
        self._stopping = False
        # Recover stale running rows before publishing queued jobs: another tenant
        # may already have started the shared dispatcher.
        for job in self.store.list(status="running", limit=500)[0]:
            self.store.update_status(job.id, "failed", error="server restarted while the job was running")
        self._started = True
        for job_id in self.store.queued_ids():
            self.submit(job_id)
        if self.dispatcher is not None:
            if start_dispatcher:
                self.dispatcher.start()
            return
        self._thread = threading.Thread(target=self._run, name="yue2-worker", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 30.0) -> None:
        """Stop after the current job: it is cancelled, queued rows stay ``queued`` (re-enqueued on start)."""
        if self.dispatcher is not None:
            self._request_stop()
            return
        thread = self._thread
        if thread is None:
            return
        self._request_stop()
        self._queue.put((-1, next(self._task_sequence), None, None))
        thread.join(timeout)
        if not thread.is_alive():
            self._thread = None
            self._started = False

    def _request_stop(self) -> None:
        self._stopping = True
        with self._lock:
            current = self.current_job_id
            event = self._cancels.get(current) if current is not None else None
            for maintenance_event in self._maintenance.values():
                maintenance_event.set()
        if event is not None:
            event.set()

    @property
    def alive(self) -> bool:
        if self.dispatcher is not None:
            return self.dispatcher.alive
        return self._thread is not None and self._thread.is_alive()

    # -- submission / cancellation (any thread) -------------------------------------------------

    def submit(self, job_id: str) -> None:
        with self._lock:
            self._cancels.setdefault(job_id, threading.Event())
        self._enqueue(0, job_id, None)

    def submit_maintenance(self, key: str, callback: Callable[[Callable[[], bool]], None]) -> bool:
        """Run a cancellable CPU subprocess after generation, with the GPU model released.

        The callback runs on the engine-owning worker thread. It must poll the
        supplied cancellation callable and must not enqueue another blocking job.
        """
        with self._lock:
            if self._stopping or key in self._maintenance:
                return False
            self._maintenance[key] = threading.Event()
            self._enqueue(1, key, callback)
        return True

    def _enqueue(self, priority: int, key: str, callback) -> None:
        if self.dispatcher is not None:
            self.dispatcher.submit(self, priority, key, callback)
        else:
            self._queue.put((priority, next(self._task_sequence), key, callback))

    def cancel_maintenance(self, key: str) -> None:
        with self._lock:
            event = self._maintenance.get(key)
            if event is not None:
                event.set()

    def cancel(self, job_id: str) -> str | None:
        """Returns ``"cancelled"`` (was queued), ``"requested"`` (running) or ``None`` (terminal)."""
        if self.store.update_status(job_id, "cancelled", expected="queued"):
            with self._lock:
                self._cancels.pop(job_id, None)
            event = status_event(job_id, "cancelled", "cancelled before it started")
            self.store.set_progress(job_id, event)
            self.bus.publish(job_id, event)
            self.bus.done(job_id, self.store.get(job_id).to_api())
            return "cancelled"
        job = self.store.get(job_id)
        if job.status == "running":
            with self._lock:
                self._cancels.setdefault(job_id, threading.Event()).set()
            return "requested"
        return None

    def cancelled(self, job_id: str) -> bool:
        with self._lock:
            event = self._cancels.get(job_id)
        return bool(event and event.is_set())

    # -- status -------------------------------------------------------------------------------

    def engine_status(self) -> dict:
        state = getattr(self.engine, "state", "cold")
        precision = getattr(self.engine, "precision", None)
        memory = self.memory
        memory_gib = None
        if memory and state != "cold":
            used = memory.get("mlx_active_bytes") or memory.get("rss_bytes") or 0
            memory_gib = round(used / 2**30, 2)
        loras = getattr(self.engine, "loras", None)
        low_memory = getattr(self.engine, "low_memory", None)
        return {"state": state, "precision": precision if state != "cold" else None,
                "memory_gib": memory_gib, "current_job_id": self.current_job_id,
                "loras": list(loras) if loras and state != "cold" else [],
                "low_memory": None if state == "cold" or low_memory is None else bool(low_memory)}

    def _sample_memory(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_memory_sample < 1.0:
            return
        self._last_memory_sample = now
        try:
            self.memory = self.engine.memory_footprint()
        except Exception:  # never let a metrics failure hurt a job
            self.memory = None

    # -- worker thread ------------------------------------------------------------------------

    def _run(self) -> None:
        try:
            while True:
                _, _, job_id, maintenance = self._queue.get()
                if job_id is None or self._stopping:
                    break
                if maintenance is not None:
                    # The API persists jobs before submitting them. Cover that
                    # short gap too; duplicate ids are harmless (status is CAS'd).
                    waiting = self.store.queued_ids()
                    if waiting:
                        for waiting_id in waiting:
                            self.submit(waiting_id)
                        self._queue.put((1, next(self._task_sequence), job_id, maintenance))
                        continue
                    self._run_maintenance(job_id, maintenance)
                    continue
                job = self.store.find(job_id)
                if job is None or job.status != "queued":
                    with self._lock:
                        self._cancels.pop(job_id, None)
                    continue
                try:
                    self._run_job(job)
                except Exception:  # pragma: no cover - defensive: the loop must survive anything
                    log.exception("worker: unexpected error running job %s", job_id)
        finally:
            try:
                self.engine.unload()
            except Exception:  # pragma: no cover
                log.exception("worker: engine unload failed")

    def _run_maintenance(self, key: str, callback: Callable[[Callable[[], bool]], None]) -> None:
        with self._lock:
            cancelled = self._maintenance.get(key)
            if cancelled is None:
                return
            self.current_maintenance_key = key
        try:
            if not cancelled.is_set() and not self._stopping:
                try:
                    self.engine.unload()
                except Exception:
                    # Give the owner a chance to clear its queued state, without
                    # starting a second workload when release failed.
                    cancelled.set()
                    callback(cancelled.is_set)
                    raise
                self._sample_memory(force=True)
                callback(cancelled.is_set)
        except Exception:
            log.exception("worker: maintenance task failed")
        finally:
            with self._lock:
                self._maintenance.pop(key, None)
                self.current_maintenance_key = None

    def _publish(self, job_id: str, event: dict) -> None:
        self.bus.publish(job_id, event)

    def _on_engine_event(self, job_id: str, raw: dict) -> None:
        event = normalise(raw, job_id)
        self._publish(job_id, event)
        if event["type"] == "stage" and event["status"] != "running":
            self._sample_memory()

    def _upload_path(self, upload_id: str) -> Path:
        matches = sorted(p for p in self.paths.uploads_dir.iterdir()  # exact stem: never a glob
                         if p.stem == upload_id and p.suffix not in ("", ".json") and p.is_file())
        if not matches:
            raise FileNotFoundError(f"upload {upload_id!r} is missing from {self.paths.uploads_dir}")
        return matches[0]

    def _run_job(self, job: Job) -> None:
        with self._lock:
            if self._stopping:
                return  # stop() raced the dequeue: leave the row queued for the next start
            cancel = self._cancels.setdefault(job.id, threading.Event())
            if not self.store.update_status(job.id, "running", expected="queued"):
                self._cancels.pop(job.id, None)
                return  # cancelled between dequeue and start
            self.current_job_id = job.id  # under _lock so stop() sees it together with its Event
        job = self.store.get(job.id)
        song_dir = self.paths.songs_dir / job.id
        song_dir.mkdir(parents=True, exist_ok=True)
        settings = self.store.get_settings()
        options = job.options(settings)
        (song_dir / "job.json").write_text(json.dumps({
            "id": job.id, "kind": job.kind, "params": job.params, "preset": options.preset,
            "precision": options.precision, "ode_steps": options.ode_steps, "seed": job.seed,
            "loras": config.loras_to_api(options.loras), "group_id": job.group_id, "parent_id": job.parent_id,
            "created_at": job.created_at,
        }, ensure_ascii=False, indent=2))
        self._publish(job.id, status_event(job.id, "running", f"{job.kind} job started"))

        def on_event(raw: dict) -> None:
            self._on_engine_event(job.id, raw)

        final_status, error, summary = "done", None, None
        # 音乐构思阶段：优先设计声音，再按需补全歌词。
        # 用户点击生成立即拿到任务 ID，音乐构思成为任务生命周期的第一阶段。
        params = dict(job.params or {})
        if job.kind in {"create", "regenerate", "hum"} and params.get("description") and not (params.get("lyrics") and params.get("style")):
            try:
                if cancel.is_set():
                    raise InterruptedError("Cancelled before start")
                self._publish(job.id, normalise({
                    "type": "stage", "stage": "AI writing lyrics", "completed": 0, "total": None,
                    "status": "running", "ts": time.time()}, job.id))
                # 写词期间每 5 秒发心跳事件，保证前端 SSE 有持续反馈
                heartbeat = threading.Event()
                def _beat() -> None:
                    n = 0
                    while not heartbeat.wait(5.0):
                        n += 1
                        self._publish(job.id, normalise({
                            "type": "stage", "stage": "AI writing lyrics", "completed": None,
                            "total": None, "status": "running",
                            "seconds": n * 5.0, "ts": time.time()}, job.id))
                beat_thread = threading.Thread(target=_beat, daemon=True)
                beat_thread.start()
                _desc = params["description"] or ""
                _kind = params.get("music_kind")
                if _kind not in {"vocal", "instrumental"}:
                    _kind = "instrumental" if (
                        "纯音乐" in _desc or "instrumental" in _desc.lower() or "无人声" in _desc
                    ) else "vocal"
                draft = _ai_complete_draft(_desc, _kind, context=params)
                heartbeat.set()
                # An existing field is an explicit user choice, never replace it while filling the other.
                params["style"] = params.get("style") or draft["style"]
                params["lyrics"] = params.get("lyrics") or draft["lyrics"]
                if params.get("title") is None:
                    params["title"] = draft["title"]
                # 时长与歌词匹配：60 步扩散对 180s 去噪不足（人声电音）。
                # 每行约 4.2s + 8s 前奏尾奏余量，钳在 60–120s。
                lines = [ln for ln in params["lyrics"].splitlines() if ln.strip() and not ln.strip().startswith("[")]
                estimated = min(120.0, max(60.0, len(lines) * 4.2 + 8.0))
                if not params.get("duration"):
                    params["duration"] = estimated
                self.store.set_params(job.id, params)
                job = self.store.get(job.id)
                self._publish(job.id, normalise({
                    "type": "stage", "stage": "AI writing lyrics", "completed": 1, "total": 1,
                    "status": "completed", "ts": time.time()}, job.id))
            except (InterruptedError, asyncio.CancelledError):
                heartbeat.set()
                raise
            except Exception as exc:  # noqa: BLE001
                heartbeat.set()
                log.warning("job %s lyric-writing failed: %s", job.id, exc)
                terminal = status_event(job.id, "failed", f"AI 写词失败：{exc}")
                self.store.update_status(job.id, "failed", error=str(exc), progress=terminal)
                self._publish(job.id, terminal)
                with self._lock:
                    self._cancels.pop(job.id, None)
                self.current_job_id = None
                try:
                    self.bus.done(job.id, self.store.get(job.id).to_api())
                except Exception:
                    pass
                return
        try:
            if cancel.is_set():
                raise InterruptedError("Cancelled before start")
            engine = self.engine
            if "suno" in job.params and getattr(engine, "engine_id", None) != "suno":
                raise ValueError("生成引擎已切换，这个版本需要 Suno；请恢复云端引擎后重新生成。")
            if (engine.state == "cold" or engine.precision != options.precision
                    or getattr(engine, "low_memory", options.low_memory) != options.low_memory):
                self._publish(job.id, status_event(job.id, "running",
                                                   f"loading models ({options.precision})…", stage="load"))
            engine.ensure(options, on_event)
            self._sample_memory(force=True)
            request = engine_request(job, engine=getattr(engine, "engine_id", None))
            if job.kind == "cover":
                audio_path = self._upload_path(job.params["upload_id"])
                p = job.params
                summary = engine.cover_song(audio_path, song_dir, task=p.get("task", "melody-full"),
                                            request=request, options=options, on_event=on_event,
                                            cancelled=cancel.is_set, mode=p.get("mode", "cover"),
                                            clip_start_s=float(p.get("clip_start_s") or 0.0),
                                            clip_end_s=p.get("clip_end_s"))
            elif job.kind == "hum":
                audio_path = self._upload_path(job.params["upload_id"])
                summary = engine.hum_song(audio_path, song_dir, request=request, hum=hum_options(job),
                                          options=options, on_event=on_event, cancelled=cancel.is_set)
            else:
                summary = engine.create_song(request, song_dir, options=options, on_event=on_event,
                                             cancelled=cancel.is_set)
        except (InterruptedError, asyncio.CancelledError):
            final_status = "cancelled"
        except Exception as exc:  # noqa: BLE001 - any engine error fails the job, never the worker
            final_status, error = "failed", _error_text(exc)
            log.warning("job %s failed: %s\n%s", job.id, error, traceback.format_exc())
        finally:
            self._sample_memory(force=True)

        if final_status == "done" and summary is not None:
            self._publish(job.id, normalise({"type": "stage", "stage": "Saving artifacts", "completed": 0,
                                             "total": None, "status": "running", "seconds": 0.0,
                                             "ts": time.time()}, job.id))
            started = time.perf_counter()
            self.store.set_timing(job.id, derive_timing(summary), audio_seconds=summary.get("seconds"),
                                  truncated=derive_truncated(summary))
            self._publish(job.id, normalise({"type": "stage", "stage": "Saving artifacts", "completed": 1,
                                             "total": 1, "status": "completed",
                                             "seconds": round(time.perf_counter() - started, 3),
                                             "ts": time.time()}, job.id))
            message = "done"
        elif final_status == "cancelled":
            message = "cancelled"
        else:
            message = f"failed: {error}"

        latest_stage = self.bus.last_stage(job.id)
        terminal = status_event(job.id, final_status, message,
                                stage=latest_stage.get("stage") if latest_stage is not None else None)
        self.store.update_status(job.id, final_status, error=error, progress=terminal)
        self._publish(job.id, terminal)
        with self._lock:
            self._cancels.pop(job.id, None)
        self.current_job_id = None
        try:
            self.bus.done(job.id, self.store.get(job.id).to_api())
        except Exception:  # job deleted meanwhile
            log.debug("job %s vanished before done could be announced", job.id)
        if self.after_job is not None:
            try:
                self.after_job(job)
            except Exception:  # pragma: no cover - defensive
                log.exception("worker: after_job hook failed")

    # -- housekeeping used by the API ----------------------------------------------------------

    def delete_song_dir(self, job_id: str) -> None:
        shutil.rmtree(self.paths.songs_dir / job_id, ignore_errors=True)
        self.bus.forget(job_id)


class SharedDispatcher:
    """One engine-owning thread across isolated user workers.

    Queue entries carry their owning Worker, so identical ids in separate user
    databases cannot collide. Generation takes priority over maintenance across
    every account, including jobs recovered after a restart.
    """

    @property
    def engine(self):
        try:
            import yue2_studio.engines as _engines
            current = _engines.current()
            if current is not None:
                self._engine = current
        except Exception:
            pass
        return self._engine

    def __init__(self, engine: Engine):
        self._engine = engine
        self._queue: queue.PriorityQueue = queue.PriorityQueue()
        self._sequence = itertools.count()
        self._workers: list[Worker] = []
        self._lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self._stopping = False

    def register(self, worker: Worker) -> None:
        with self._lock:
            self._workers.append(worker)

    def start(self) -> None:
        with self._lock:
            if self._thread is not None:
                return
            self._thread = threading.Thread(target=self._run, name="yue2-worker", daemon=True)
            self._thread.start()

    @property
    def alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def submit(self, worker: Worker, priority: int, key: str, callback) -> None:
        self._queue.put((priority, next(self._sequence), worker, key, callback))

    def stop(self, timeout: float = 30.0) -> None:
        with self._lock:
            self._stopping = True
            workers, thread = list(self._workers), self._thread
        for worker in workers:
            worker._request_stop()
        if thread is None:
            return
        self._queue.put((-1, next(self._sequence), None, None, None))
        thread.join(timeout)
        if not thread.is_alive():
            self._thread = None

    def _run(self) -> None:
        try:
            while True:
                priority, _, worker, key, maintenance = self._queue.get()
                if worker is None or self._stopping:
                    return
                if worker._stopping:
                    continue
                if maintenance is not None:
                    # Persisting and enqueuing a new job are separate operations.
                    # Inspect all tenant stores before starting lower-priority work.
                    with self._lock:
                        workers = list(self._workers)
                    waiting = [(owner, job_id) for owner in workers if owner._started and not owner._stopping
                               for job_id in owner.store.queued_ids()]
                    if waiting:
                        for owner, job_id in waiting:
                            owner.submit(job_id)
                        self.submit(worker, priority, key, maintenance)
                        continue
                    worker._run_maintenance(key, maintenance)
                    continue
                job = worker.store.find(key)
                if job is None or job.status != "queued":
                    with worker._lock:
                        worker._cancels.pop(key, None)
                    continue
                try:
                    worker._run_job(job)
                except Exception:
                    log.exception("worker: unexpected error running tenant job %s", key)
        finally:
            try:
                self.engine.unload()
            except Exception:
                log.exception("worker: engine unload failed")
