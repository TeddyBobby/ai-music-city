"""User namespaces and a single engine thread across all accounts."""
import asyncio
import threading

import pytest

from yue2_studio import config, jobs
from yue2_studio.api import ApiError
from yue2_studio.fake import FakeEngine
from yue2_studio.jobs import JobStore
from yue2_studio.main import create_app
from yue2_studio.tenancy import UserPaths
from yue2_studio.worker import SharedDispatcher, Worker

BASE = {"style": "gentle piano", "lyrics": "[instrumental]", "seed": 1}
OWNER = {"id": "a" * 32, "email": "owner@example.com", "legacy_owner": True, "is_admin": True}
OTHER = {"id": "b" * 32, "email": "other@example.com", "legacy_owner": False, "is_admin": False}


def submit(store):
    return jobs.submit(store, {"kind": "create", "preset": "fast", "params": BASE},
                       upload_lookup=lambda _: None).jobs[0]


async def wait_terminal(store, job_id):
    async with asyncio.timeout(8):
        while not (job := store.get(job_id)).terminal:
            await asyncio.sleep(.01)
    return job


def test_user_paths_share_models_but_reject_unsafe_ids(tmp_path):
    paths = UserPaths(tmp_path, OTHER["id"])
    assert paths.models_dir == config.paths_for(tmp_path).models_dir
    assert paths.data_dir == tmp_path / "data" / "users" / OTHER["id"]
    for user_id in ("../owner", "", "a/" + "b" * 32, "z" * 32):
        with pytest.raises(ValueError):
            UserPaths(tmp_path, user_id)


async def test_runtime_isolates_every_service_and_preserves_legacy_files(tmp_path):
    app = create_app(fake=True, fake_delay=0, home=tmp_path)
    legacy_job = submit(app.state.store)
    legacy_session = app.state.assistant.create_session("Private old conversation")
    owner = app.state.tenants.for_user(OWNER)
    other = app.state.tenants.for_user(OTHER)
    try:
        assert owner is app.state
        assert app.state.tenants.for_user(OTHER) is other
        assert owner.store.get(legacy_job.id).id == legacy_job.id
        assert other.store.find(legacy_job.id) is None
        assert other.assistant.sessions() == []
        with pytest.raises(ApiError) as rejected:
            other.assistant.session(legacy_session["id"])
        assert rejected.value.status_code == 404
        for attr in ("db_path", "songs_dir", "uploads_dir"):
            assert getattr(owner.paths, attr) != getattr(other.paths, attr)
        for attr in ("assistant", "reviews", "plaza"):
            assert getattr(owner, attr).db_path != getattr(other, attr).db_path
        assert other.assistant.config_source is owner.assistant
        assert other.assistant.audio_slots is owner.assistant.audio_slots
        assert not other.assistant.settings_path.exists()
        assert owner.worker.dispatcher is other.worker.dispatcher
        assert owner.engine is other.engine
    finally:
        await app.state.tenants.close()


async def test_shared_dispatcher_runs_generation_and_maintenance_on_one_thread(tmp_path):
    class ObservedEngine(FakeEngine):
        def __init__(self):
            super().__init__(delay=.005)
            self.threads = set()
            self.active = 0
            self.peak = 0

        def create_song(self, *args, **kwargs):
            self.threads.add(threading.get_ident())
            self.active += 1
            self.peak = max(self.active, self.peak)
            try:
                return super().create_song(*args, **kwargs)
            finally:
                self.active -= 1

        def unload(self):
            self.threads.add(threading.get_ident())
            super().unload()

    engine = ObservedEngine()
    dispatcher = SharedDispatcher(engine)
    workers = []
    for user in (OWNER, OTHER):
        paths = UserPaths(tmp_path, user["id"])
        paths.ensure_dirs()
        store = JobStore(paths.db_path, paths.songs_dir)
        workers.append(Worker(store, engine, paths, fake=True, dispatcher=dispatcher))
    first, second = (submit(worker.store) for worker in workers)
    maintenance_done = threading.Event()
    observed = []

    def maintenance(cancelled):
        observed.append((threading.get_ident(), engine.active,
                         workers[0].store.get(first.id).status, workers[1].store.get(second.id).status))
        maintenance_done.set()

    # Enqueue maintenance first: both users' persisted generation must still run first.
    workers[0].submit_maintenance("alignment", maintenance)
    for worker in workers:
        worker.start(asyncio.get_running_loop())
    try:
        assert await asyncio.to_thread(maintenance_done.wait, 8)
        assert observed == [(next(iter(engine.threads)), 0, "done", "done")]
        assert engine.peak == 1
        assert len(engine.threads) == 1
        assert workers[0].store.find(second.id) is None
        assert workers[1].store.find(first.id) is None
    finally:
        await asyncio.to_thread(dispatcher.stop)
        assert not dispatcher.alive
        assert len(engine.threads) == 1  # unload ran on that same thread, too
        for worker in workers:
            worker.store.close()


async def test_restart_recovers_all_registered_account_queues(tmp_path, monkeypatch):
    app = create_app(fake=True, fake_delay=0, home=tmp_path)
    owner = app.state.tenants.for_user(OWNER)
    other = app.state.tenants.for_user(OTHER)
    first, second = submit(owner.store), submit(other.store)
    await app.state.tenants.close()

    restarted = create_app(fake=True, fake_delay=0, home=tmp_path)
    monkeypatch.setattr(restarted.state.auth, "users", lambda: [OWNER, OTHER])
    async with restarted.router.lifespan_context(restarted):
        owner = restarted.state.tenants.for_user(OWNER)
        other = restarted.state.tenants.for_user(OTHER)
        assert (await wait_terminal(owner.store, first.id)).status == "done"
        assert (await wait_terminal(other.store, second.id)).status == "done"
