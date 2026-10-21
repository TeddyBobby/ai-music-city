"""Local publication records, kept independently from music and personal reviews."""
from __future__ import annotations

import contextlib
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

from yue2_studio.api import ApiError
from yue2_studio.jobs import now_iso


class PlazaService:
    def __init__(self, data_dir: Path):
        self.root = Path(data_dir) / 'plaza'
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db_path = self.root / 'plaza.db'
        with self.db() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS publications (
                job_id TEXT PRIMARY KEY, caption TEXT NOT NULL,
                published_at TEXT NOT NULL, updated_at TEXT NOT NULL)''')
            db.execute('''CREATE TABLE IF NOT EXISTS albums (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, caption TEXT NOT NULL,
                job_ids TEXT NOT NULL, published_at TEXT NOT NULL, updated_at TEXT NOT NULL)''')
        self.db_path.chmod(0o600)

    @contextlib.contextmanager
    def db(self):
        connection = None
        try:
            connection = sqlite3.connect(self.db_path, timeout=5)
            connection.row_factory = sqlite3.Row
            with connection:
                yield connection
        except sqlite3.Error:
            raise ApiError(503, 'plaza_unavailable', '广场暂时不可用，请稍后重试') from None
        finally:
            if connection is not None:
                connection.close()

    def records(self) -> list[dict]:
        with self.db() as db:
            rows = db.execute('SELECT * FROM publications ORDER BY published_at DESC, rowid DESC').fetchall()
        return [dict(row) for row in rows]

    def get(self, job_id: str) -> dict | None:
        with self.db() as db:
            row = db.execute('SELECT * FROM publications WHERE job_id=?', (job_id,)).fetchone()
        return dict(row) if row else None

    def publish(self, job_id: str, caption: str) -> dict:
        if not isinstance(caption, str) or len(caption) > 600:
            raise ApiError(400, 'validation_error', '发布文案最多 600 字')
        stamp = now_iso()
        with self.db() as db:
            db.execute('INSERT INTO publications (job_id,caption,published_at,updated_at) VALUES (?,?,?,?) '
                       'ON CONFLICT(job_id) DO UPDATE SET caption=excluded.caption, '
                       'updated_at=excluded.updated_at', (job_id, caption.strip(), stamp, stamp))
            row = db.execute('SELECT * FROM publications WHERE job_id=?', (job_id,)).fetchone()
        return dict(row)

    def withdraw(self, job_id: str) -> None:
        with self.db() as db:
            db.execute('DELETE FROM publications WHERE job_id=?', (job_id,))

    @staticmethod
    def _album(row) -> dict | None:
        if row is None:
            return None
        record = dict(row)
        record['job_ids'] = json.loads(record['job_ids'])
        return record

    def album_records(self) -> list[dict]:
        with self.db() as db:
            rows = db.execute('SELECT * FROM albums ORDER BY published_at DESC, rowid DESC').fetchall()
        return [self._album(row) for row in rows]

    def get_album(self, album_id: str) -> dict | None:
        with self.db() as db:
            row = db.execute('SELECT * FROM albums WHERE id=?', (album_id,)).fetchone()
        return self._album(row)

    def publish_album(self, title: str, caption: str, job_ids: list[str],
                      album_id: str | None = None) -> dict:
        stamp = now_iso()
        with self.db() as db:
            if album_id is None:
                album_id = uuid4().hex
                db.execute('INSERT INTO albums (id,title,caption,job_ids,published_at,updated_at) '
                           'VALUES (?,?,?,?,?,?)',
                           (album_id, title, caption.strip(), json.dumps(job_ids), stamp, stamp))
            else:
                updated = db.execute('UPDATE albums SET title=?,caption=?,job_ids=?,updated_at=? WHERE id=?',
                                     (title, caption.strip(), json.dumps(job_ids), stamp, album_id))
                if not updated.rowcount:
                    raise ApiError(404, 'not_found', '专辑不存在')
            row = db.execute('SELECT * FROM albums WHERE id=?', (album_id,)).fetchone()
        return self._album(row)

    def withdraw_album(self, album_id: str) -> None:
        with self.db() as db:
            db.execute('DELETE FROM albums WHERE id=?', (album_id,))
