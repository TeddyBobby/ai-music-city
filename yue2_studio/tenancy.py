"""Authenticated user runtimes with isolated data and shared model execution."""
from __future__ import annotations

import asyncio
import logging
import re
import threading
from dataclasses import dataclass
from types import SimpleNamespace

from yue2_studio import config
from yue2_studio.jobs import JobStore
from yue2_studio.worker import EventBus, SharedDispatcher, Worker

log = logging.getLogger("yue2_studio.tenancy")


def runtime(request):
    """Resolve the account selected by authentication, never an anonymous default.

    Standalone router test apps may provide their own state without auth. The
    production app always installs auth and must have a selected request runtime.
    """
    selected = getattr(getattr(request, "state", None), "runtime", None)
    if selected is not None:
        return selected
    if getattr(request.app.state, "auth", None) is None:
        return request.app.state
    from yue2_studio.api import ApiError
    raise ApiError(401, "authentication_required", "请先登录")


@dataclass(frozen=True)
class UserPaths(config.Paths):
    user_id: str

    def __post_init__(self):
        if not re.fullmatch(r"[a-f0-9]{16,64}", self.user_id):
            raise ValueError("invalid account storage id")

    @property
    def data_dir(self):
        return self.home / "data" / "users" / self.user_id


class TenantRegistry:
    """Keep user services alive across navigation and HTTP sessions.

    The legacy owner's runtime uses the original files in place. Other users
    receive fresh databases and file namespaces, sharing only server model files
    and provider configuration. Logging out never interrupts a running job.
    """

    def __init__(self, app, dispatcher: SharedDispatcher):
        self.app = app
        self.legacy = app.state
        self.dispatcher = dispatcher
        self._runtimes: dict[str, object] = {}
        self._lock = threading.RLock()
        self._loop = None
        self._closed = False

    def for_user(self, user: dict):
        user_id = user["id"]
        # Check even the legacy id: only opaque database account ids are allowed.
        if not re.fullmatch(r"[a-f0-9]{16,64}", user_id):
            raise ValueError("invalid account storage id")
        with self._lock:
            if self._closed:
                raise RuntimeError("server is shutting down")
            selected = self._runtimes.get(user_id)
            if selected is None:
                selected = self.legacy if user.get("legacy_owner") else self._create(user_id)
                self._runtimes[user_id] = selected
                if self._loop is not None:
                    self._start_runtime(selected)
            return selected

    def _create(self, user_id):
        # Imports stay local because API modules import the lightweight resolver.
        from yue2_studio.assistant_service import AssistantService
        from yue2_studio.lyric_alignment_service import LyricAlignmentService
        from yue2_studio.plaza_service import PlazaService
        from yue2_studio.review_service import ReviewService

        paths = UserPaths(self.legacy.paths.home, user_id)
        paths.ensure_dirs()
        store = JobStore(paths.db_path, paths.songs_dir)
        bus = EventBus()
        worker = Worker(store, self.legacy.engine, paths, bus, fake=self.legacy.fake,
                        dispatcher=self.dispatcher)
        assistant = AssistantService(paths.data_dir, recover=True, config_source=self.legacy.assistant)
        selected = SimpleNamespace(
            paths=paths, store=store, bus=bus, worker=worker,
            engine=self.legacy.engine, fake=self.legacy.fake, assistant=assistant,
            reviews=ReviewService(paths.data_dir, assistant, recover=True),
            plaza=PlazaService(paths.data_dir),
            lyric_alignment=LyricAlignmentService(paths, store, worker),
        )
        self._wire_after_job(selected)
        return selected

    @staticmethod
    def _wire_after_job(selected):
        from yue2_studio import uploads

        def after_job(job):
            uploads.auto_prune(selected.paths, selected.store)
            if not selected.fake:
                selected.lyric_alignment.after_job(job)

        selected.worker.after_job = after_job

    def _start_runtime(self, selected, *, start_dispatcher=True):
        from yue2_studio import projects, uploads

        uploads.auto_prune(selected.paths, selected.store)
        projects.sweep_temp(selected.paths.data_dir)
        selected.worker.start(self._loop, start_dispatcher=start_dispatcher)

    async def start(self, loop):
        from yue2_studio import projects

        # Disposable download archives are never user source data. Remove stale
        # legacy archives even while the original library awaits its first owner.
        await asyncio.to_thread(projects.sweep_temp, self.legacy.paths.data_dir)
        with self._lock:
            self._wire_after_job(self.legacy)
            # Recover every registered account's queue, even before their next login.
            for user in self.app.state.auth.users():
                self.for_user(user)
            self._loop = loop
            for selected in self._runtimes.values():
                self._start_runtime(selected, start_dispatcher=False)
            if self._runtimes:
                self.dispatcher.start()

    async def close(self):
        with self._lock:
            self._closed = True
            # Include unclaimed legacy services so their resources are closed too.
            runtimes = list({id(value): value for value in
                             [self.legacy, *self._runtimes.values()]}.values())
        for selected in runtimes:
            await asyncio.to_thread(selected.lyric_alignment.close)
            await selected.reviews.close()
            await selected.assistant.close()
        await asyncio.to_thread(self.dispatcher.stop)
        if self.dispatcher.alive:
            log.warning("worker did not stop in time; leaving user job stores open")
            return
        for selected in runtimes:
            selected.store.close()
