"""FastAPI app factory and the ``yue2-studio`` console entry point.

``create_app(engine=None, *, home=None, fake=False)`` wires the job store, worker thread, event
bus and routes. The real engine (``yue2_studio.engine``, which imports mlx) is imported lazily
and only when neither ``engine`` nor ``fake`` is given, so tests and ``--fake`` never touch MLX.
"""

from __future__ import annotations

from yue2_studio import config  # isort: skip  (sets MLX_ENABLE_TF32 before anything imports mlx)

import argparse  # noqa: E402
import asyncio  # noqa: E402
import contextlib  # noqa: E402
import logging  # noqa: E402
import os  # noqa: E402
import threading  # noqa: E402
import webbrowser  # noqa: E402
from pathlib import Path  # noqa: E402

from fastapi import FastAPI  # noqa: E402

from yue2_studio import (  # noqa: E402
    __version__,
    admin_api,
    api,
    assistant_api,
    auth_api,
    lyric_alignment_api,
    plaza_api,
    review_api,
)
from yue2_studio.tenancy import TenantRegistry  # noqa: E402
from yue2_studio.jobs import JobStore  # noqa: E402
from yue2_studio.worker import EventBus, SharedDispatcher, Worker  # noqa: E402

STATIC_DIR = Path(__file__).resolve().parent / "static"
log = logging.getLogger("yue2_studio")


def _real_engine(paths: config.Paths):
    from yue2_studio.engine import Engine  # imports mlx; deliberately lazy

    return Engine(converted_dir=paths.converted_dir, vae_dir=paths.vae_dir, loras_dir=paths.loras_dir)


def _acestep_engine():
    from yue2_studio.acestep_engine import ACEStepEngine

    checkpoint = os.environ.get("AMC_ACESTEP_CHECKPOINTS") or "/home/teddy/projects/ACE-Step/checkpoints"
    return ACEStepEngine(checkpoint_dir=checkpoint)


def create_app(engine=None, *, home: str | os.PathLike | None = None, fake: bool = False,
               fake_delay: float = 0.05, static_dir: Path | None = None) -> FastAPI:
    paths = config.paths_for(home)
    paths.ensure_dirs()
    if engine is None and fake:
        from yue2_studio.fake import FakeEngine

        engine = FakeEngine(delay=fake_delay)
    is_fake = fake or (engine is not None and type(engine).__name__ == "FakeEngine")
    if engine is None:
        if os.environ.get("AMC_ENGINE") == "acestep15":
            from yue2_studio.acestep15_engine import ACEStep15Engine
            engine = ACEStep15Engine(
                use_sft=os.environ.get("AMC_ACE15_SFT", "") == "1",
                lm_model=os.environ.get("AMC_ACE15_LM", "acestep-5Hz-lm-1.7B"),
            )
        elif os.environ.get("AMC_ENGINE") == "acestep":
            engine = _acestep_engine()
        elif os.environ.get("AMC_ENGINE") == "suno":
            from yue2_studio.suno_engine import SunoEngine
            engine = SunoEngine(api_key=os.environ.get("AMC_SUNO_API_KEY") or "",
                                base_url=os.environ.get("AMC_SUNO_BASE_URL", "https://api.sunoapi.org"))
        else:
            engine = _real_engine(paths)

    store = JobStore(paths.db_path, paths.songs_dir)
    bus = EventBus()
    dispatcher = SharedDispatcher(engine)
    worker = Worker(store, engine, paths, bus, fake=is_fake, dispatcher=dispatcher)

    # engine registry (runtime switchable): cache instances on a mutable holder
    import yue2_studio.engines as engines
    _instances = {"local": None, "suno": None, "legacy": None}

    class _EngineHolder:
        """Keeps one instance per engine kind; workers fetch via engines.current()."""

    holder = _EngineHolder()

    def _factory_local():
        from yue2_studio.acestep15_engine import ACEStep15Engine
        if _instances["local"] is None:
            _instances["local"] = ACEStep15Engine(
                use_sft=os.environ.get("AMC_ACE15_SFT", "") == "1",
                lm_model=os.environ.get("AMC_ACE15_LM", "acestep-5Hz-lm-1.7B"))
        return _instances["local"]

    def _factory_suno():
        from yue2_studio.suno_engine import SunoEngine
        if _instances["suno"] is None:
            _instances["suno"] = SunoEngine(
                api_key=os.environ.get("AMC_SUNO_API_KEY") or "",
                base_url=os.environ.get("AMC_SUNO_BASE_URL", "https://api.sunoapi.org"))
        return _instances["suno"]

    def _factory_legacy():
        if _instances["legacy"] is None:
            _instances["legacy"] = _acestep_engine()
        return _instances["legacy"]

    engines.register("local", _factory_local, "标准（本地）",
                     "本地 ACE-Step 1.5 生成，免费，约 2-3 分钟一首", "local")
    if os.environ.get("AMC_SUNO_API_KEY"):
        engines.register("suno", _factory_suno, "高品质（云端）",
                         "Suno V5 云端生成，商业级质量，约 1-2 分钟一首", "cloud")
    if engines._ACTIVE is None:
        engines.switch("suno" if (os.environ.get("AMC_ENGINE") == "suno"
                                  and os.environ.get("AMC_SUNO_API_KEY")) else "local")

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        await app.state.tenants.start(asyncio.get_running_loop())
        try:
            yield
        finally:
            await app.state.tenants.close()

    app = FastAPI(title="听见 · 本地音乐工作台", version=__version__, lifespan=lifespan, docs_url="/api/docs",
                  openapi_url="/api/openapi.json", redoc_url=None)
    app.state.paths = paths
    app.state.store = store
    app.state.worker = worker
    app.state.bus = bus
    app.state.engine = engine
    app.state.fake = is_fake
    api.install_error_handlers(app)
    app.include_router(api.router)
    auth_api.install(app)
    admin_api.install(app)
    assistant_api.install(app)
    review_api.install(app)
    plaza_api.install(app)
    lyric_alignment_api.install(app)

    app.state.tenants = TenantRegistry(app, dispatcher)
    api.install_static(app, static_dir or STATIC_DIR)
    return app


def app_factory() -> FastAPI:
    """Factory for ``uvicorn --factory yue2_studio.main:app_factory`` (used by ``--reload``)."""
    return create_app(
        fake=os.environ.get("YUE2_STUDIO_FAKE") == "1",
        fake_delay=float(os.environ.get("YUE2_STUDIO_FAKE_DELAY", "0.3")),
        home=os.environ.get("YUE2_STUDIO_HOME") or None,
    )


def _open_browser_later(url: str, delay: float = 1.0) -> None:
    threading.Timer(delay, lambda: webbrowser.open(url)).start()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="yue2-studio", description="Local YuE2 music-generation studio")
    parser.add_argument("--host", default=config.DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=config.DEFAULT_PORT)
    parser.add_argument("--open", action="store_true", help="open the UI in the default browser")
    parser.add_argument("--fake", action="store_true", help="use the scripted fake engine (no models needed)")
    parser.add_argument("--fake-delay", type=float, default=0.3, help="seconds between fake engine events")
    parser.add_argument("--reload", action="store_true", help="auto-reload on code changes (development)")
    parser.add_argument("--log-level", default="info")
    args = parser.parse_args(argv)

    import uvicorn

    logging.basicConfig(level=args.log_level.upper())
    url = f"http://{args.host}:{args.port}/"
    if args.open:
        _open_browser_later(url)
    if args.reload:
        os.environ["YUE2_STUDIO_FAKE"] = "1" if args.fake else "0"
        os.environ["YUE2_STUDIO_FAKE_DELAY"] = str(args.fake_delay)
        uvicorn.run("yue2_studio.main:app_factory", factory=True, host=args.host, port=args.port,
                    reload=True, log_level=args.log_level)
        return 0
    app = create_app(fake=args.fake, fake_delay=args.fake_delay)
    log.info("YuE2 Studio %s (%s engine) on %s", __version__, "fake" if args.fake else "mlx", url)
    uvicorn.run(app, host=args.host, port=args.port, log_level=args.log_level)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
