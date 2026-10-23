"""Persistent music conversations and artwork, backed by local Hermes.

Secrets stay in a mode-0600 settings file and are never returned to the browser.
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
from urllib.parse import urlsplit
import uuid

import httpx

from yue2_studio.api import ApiError


SYSTEM_PROMPT = '''你是中文音乐创作助手。帮助用户创作歌词、曲风描述和专辑封面描述。
只根据提供的作品上下文作答；不操作文件、不运行命令、不调用工具、不声称已生成音频或已应用修改。
直接给出简洁中文回答。涉及歌词时使用 [verse]、[chorus]、[bridge] 分段。'''
MODES = {
    'chat': '',
    'lyrics': '仅输出JSON对象，字段 title、lyrics、description；lyrics为完整可编辑歌词，description为供音乐模型使用的曲风描述。不要Markdown围栏。',
    'style': '仅输出JSON对象，字段 title、description；description为供音乐模型使用的曲风、配器、节奏、人声描述。不要Markdown围栏。',
    'cover_prompt': '仅输出JSON对象，字段 cover_prompt；内容为详细中文方形专辑封面提示词，不包含生成或保存成功的陈述。不要Markdown围栏。',
}


def now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def identifier():
    return uuid.uuid4().hex


def _atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix('.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    path.chmod(0o600)


def _safe_url(value, *, local=False):
    value = value.rstrip('/')
    parsed = urlsplit(value)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
        raise ApiError(400, 'invalid_url', '服务地址不能包含凭证、查询参数或锚点')
    if parsed.scheme not in {'http', 'https'}:
        raise ApiError(400, 'invalid_url', '服务地址必须使用 http 或 https')
    return value


def structured(content):
    text = content.strip()
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text)
    try:
        obj = json.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(obj, dict):
        return None
    result = {k: v[:20000] for k, v in obj.items()
              if k in {'title', 'lyrics', 'description', 'cover_prompt'} and isinstance(v, str)}
    return result or None


class AssistantService:
    def __init__(self, data_dir: Path, *, hermes_home: Path | None = None, recover=False):
        self.root = Path(data_dir) / 'assistant'
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.images = self.root / 'images'
        self.images.mkdir(exist_ok=True)
        self.settings_path = self.root / 'settings.json'
        self.hermes_home = hermes_home or Path.home() / '.hermes'
        self.db_path = self.root / 'assistant.db'
        self.active = {}
        self.image_busy = False
        self.last_chat_check = None
        self.image_task_path = self.root / 'image-task.json'
        if recover and self.image_task().get('status') == 'running':
            self.write_image_task(status='interrupted', error='服务重启中断了封面生成，请重试')
        with self.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL,
                job_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
                role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
                created_at TEXT NOT NULL, suggestion TEXT);
            CREATE TABLE IF NOT EXISTS covers (id TEXT PRIMARY KEY, job_id TEXT, prompt TEXT NOT NULL,
                model TEXT NOT NULL, filename TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS artwork (job_id TEXT PRIMARY KEY, current_id TEXT, history TEXT NOT NULL);
            ''')
            if recover:
                db.execute("UPDATE messages SET status='interrupted' WHERE status='streaming'")
        if not self.settings_path.exists():
            self._save_config({'hermes_base_url': 'https://api.vectron.meta-stone.com/v1',
                'hermes_model': 'ZhipuAi/GLM-5.3', 'hermes_api_key': 'sk-0f6975cd471b73925f8c71838ca5c4e4',
                'image_provider': 'openai-compatible',
                'image_base_url': 'https://api.vectron.meta-stone.com/v1', 'image_model': 'gpt-image-2-low',
                'image_api_key': 'sk-0f6975cd471b73925f8c71838ca5c4e4',
                'image_verified': False})

    @contextlib.contextmanager
    def db(self):
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def config(self):
        return json.loads(self.settings_path.read_text())

    def _save_config(self, cfg):
        _atomic_json(self.settings_path, cfg)

    def public_config(self):
        cfg = self.config()
        return {**{k: cfg[k] for k in ('hermes_base_url', 'hermes_model', 'image_provider',
                                       'image_base_url', 'image_model')},
                'has_hermes_api_key': bool(cfg.get('hermes_api_key')),
                'has_image_api_key': bool(cfg.get('image_api_key'))}

    def update_config(self, patch):
        cfg = self.config()
        allowed = {'hermes_base_url', 'hermes_model', 'hermes_api_key', 'image_provider',
                   'image_base_url', 'image_model', 'image_api_key'}
        if set(patch) - allowed:
            raise ApiError(400, 'validation_error', '未知配置字段')
        for k, v in patch.items():
            if not isinstance(v, str) or len(v) > 4096:
                raise ApiError(400, 'validation_error', '配置字段必须为文本')
        new = {**cfg, **patch}
        new['hermes_base_url'] = _safe_url(new['hermes_base_url'], local=True)
        if new['image_provider'] not in {'disabled', 'hermes-codex', 'openai-compatible'}:
            raise ApiError(400, 'validation_error', '不支持的图片服务')
        if new['image_provider'] == 'openai-compatible' and new['image_base_url']:
            new['image_base_url'] = _safe_url(new['image_base_url'])
        if new['image_provider'] == 'hermes-codex' and new['image_model'] not in {
            'gpt-image-2-low', 'gpt-image-2-medium', 'gpt-image-2-high',
        }:
            raise ApiError(400, 'validation_error', 'Hermes Codex 支持 GPT Image 2 Low / Medium / High')
        if any(new[k] != cfg[k] for k in allowed if k.startswith('image_')):
            new['image_verified'] = False
        self._save_config(new)
        self.last_chat_check = None
        return self.public_config()

    def model_info(self):
        try:
            import yaml
            model = yaml.safe_load((self.hermes_home / 'config.yaml').read_text()).get('model', {})
            return model.get('default', 'Hermes'), model.get('provider', 'Hermes')
        except (ImportError, OSError, ValueError, AttributeError):
            return 'Hermes', 'Hermes'

    async def status(self, *, refresh=False):
        cfg = self.config()
        chat = {'configured': bool(cfg['hermes_base_url'] and cfg['hermes_api_key']), 'available': False,
                'model': cfg['hermes_model'],
                'provider': 'agent', 'base_url': cfg['hermes_base_url'], 'message': 'Agent 尚未连接'}
        if chat['configured']:
            if refresh or not self.last_chat_check or time.monotonic() - self.last_chat_check[0] > 20:
                try:
                    async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
                        response = await client.get(cfg['hermes_base_url'].removesuffix('/v1') + '/v1/models',
                            headers={'Authorization': 'Bearer ' + cfg['hermes_api_key']})
                    ok = response.status_code == 200 and isinstance(response.json().get('data'), list)
                    message = '已连接 Agent 服务' if ok else ('Agent 鉴权失败，请检查连接凭证' if response.status_code in {401,403} else 'Agent 服务返回异常')
                except (httpx.HTTPError, ValueError):
                    ok, message = False, 'Agent 服务连接超时'
                self.last_chat_check = (time.monotonic(), ok, message)
            chat.update(available=self.last_chat_check[1], message=self.last_chat_check[2])
        configured = False
        if cfg['image_provider'] == 'hermes-codex':
            configured = self.hermes_python().exists() and (self.hermes_home / 'auth.json').exists()
        elif cfg['image_provider'] == 'openai-compatible':
            configured = bool(cfg['image_base_url'] and cfg['image_api_key'] and cfg['image_model'])
        image = {'configured': configured, 'available': configured, 'verified': bool(cfg.get('image_verified')),
                 'model': cfg['image_model'], 'provider': cfg['image_provider'],
                 'message': '已通过真实封面生成验证' if cfg.get('image_verified') and configured else
                    ('凭证已配置，首次生成将验证图片能力' if configured else '尚未配置图片服务')}
        return {'chat': chat, 'image': image}

    def sessions(self):
        with self.db() as db:
            rows = db.execute('''SELECT s.*, (SELECT count(*) FROM messages WHERE session_id=s.id) AS message_count
                                FROM sessions s ORDER BY updated_at DESC''').fetchall()
        return [dict(r) for r in rows]

    def create_session(self, title=None, job_id=None):
        session = {'id': identifier(), 'title': (title or '新对话')[:80], 'job_id': job_id,
                   'created_at': now(), 'updated_at': now()}
        with self.db() as db:
            db.execute('INSERT INTO sessions VALUES (:id,:title,:job_id,:created_at,:updated_at)', session)
        return {**session, 'messages': [], 'message_count': 0}

    def session(self, session_id):
        with self.db() as db:
            row = db.execute('SELECT * FROM sessions WHERE id=?', (session_id,)).fetchone()
            if row is None:
                raise ApiError(404, 'not_found', '会话不存在')
            messages = [dict(r) for r in db.execute('SELECT * FROM messages WHERE session_id=? ORDER BY rowid', (session_id,))]
        for msg in messages:
            msg.pop('session_id', None)
            msg['suggestion'] = json.loads(msg['suggestion']) if msg['suggestion'] else None
        return {**dict(row), 'messages': messages, 'message_count': len(messages)}

    def save_message(self, sid, role, content, *, status='complete', message_id=None, suggestion=None):
        msg = {'id': message_id or identifier(), 'role': role, 'content': content, 'status': status,
               'created_at': now(), 'suggestion': suggestion}
        with self.db() as db:
            db.execute('INSERT OR REPLACE INTO messages VALUES (?,?,?,?,?,?,?)',
                (msg['id'], sid, role, content, status, msg['created_at'], json.dumps(suggestion) if suggestion else None))
            db.execute('UPDATE sessions SET updated_at=? WHERE id=?', (now(), sid))
        return msg

    def reserve(self, sid):
        self.session(sid)
        if sid in self.active:
            raise ApiError(409, 'busy', '此会话仍在回复，请先停止或等待完成')
        run = {'id': identifier(), 'stop': asyncio.Event(), 'response': None}
        self.active[sid] = run
        return run

    async def stop(self, sid):
        self.session(sid)
        run = self.active.get(sid)
        if not run:
            return {'status': 'idle'}
        run['stop'].set()
        if run['response']:
            await run['response'].aclose()
        return {'status': 'stopping'}

    async def stream(self, sid, content, mode, context, run):
        cfg = self.config()
        previous = self.session(sid)
        self.save_message(sid, 'user', content)
        if previous['title'] == '新对话':
            with self.db() as db:
                db.execute('UPDATE sessions SET title=? WHERE id=?', (content[:32], sid))
        message_id, result = identifier(), ''
        messages = [{'role': 'system', 'content': SYSTEM_PROMPT}]
        messages += [{'role': m['role'], 'content': m['content']} for m in previous['messages'][-30:]
                     if m['content'] and m['status'] == 'complete']
        enriched = content
        if context:
            enriched += '\n\n作品上下文（仅供参考）：\n' + json.dumps(context, ensure_ascii=False)
        if MODES[mode]:
            enriched += '\n\n' + MODES[mode]
        messages.append({'role': 'user', 'content': enriched})
        yield 'meta', {'run_id': run['id'], 'session_id': sid}
        state = 'complete'
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=10), trust_env=False) as client:
                async with client.stream('POST', cfg['hermes_base_url'].removesuffix('/v1') + '/v1/chat/completions',
                    headers={'Authorization': 'Bearer ' + cfg['hermes_api_key'], 'X-Hermes-Session-Key': 'yue2-' + sid},
                    json={'model': cfg['hermes_model'], 'messages': messages, 'stream': True, 'max_tokens': 2400}) as response:
                    run['response'] = response
                    if response.status_code != 200:
                        raise ApiError(502, 'hermes_failed', 'Agent 鉴权失败' if response.status_code in {401,403} else f'Agent 请求失败（HTTP {response.status_code}）')
                    checkpoint = time.monotonic()
                    async for line in response.aiter_lines():
                        if run['stop'].is_set():
                            state = 'stopped'
                            break
                        if not line.startswith('data:'):
                            continue
                        raw = line[5:].strip()
                        if raw == '[DONE]':
                            break
                        try:
                            event = json.loads(raw)
                        except ValueError:
                            continue
                        choices = event.get('choices') or []
                        delta = choices[0].get('delta', {}).get('content', '') if choices else ''
                        if isinstance(delta, str) and delta:
                            result += delta
                            yield 'delta', {'text': delta}
                            if time.monotonic() - checkpoint > 2:
                                self.save_message(sid, 'assistant', result, status='streaming', message_id=message_id)
                                checkpoint = time.monotonic()
            if run['stop'].is_set():
                state = 'stopped'
            if not result and state == 'complete':
                raise ApiError(502, 'empty_response', 'Hermes 没有返回回复，请重试')
        except asyncio.CancelledError:
            state = 'stopped'
            raise
        except Exception as exc:
            if run['stop'].is_set():
                state = 'stopped'
            else:
                state = 'error'
                error = exc.message if isinstance(exc, ApiError) else 'Hermes 连接中断或超时，请检查服务后重试'
                yield 'error', {'message': error, 'code': 'hermes_failed'}
        finally:
            run['response'] = None
            suggestion = structured(result) if mode != 'chat' and state == 'complete' else None
            final = self.save_message(sid, 'assistant', result, status=state,
                                      message_id=message_id, suggestion=suggestion)
            self.active.pop(sid, None)
        yield 'done', {'message': final}

    def hermes_python(self):
        root = self.hermes_home / 'hermes-agent'
        return root / ('venv/bin/python' if (root / 'venv/bin/python').exists() else '.venv/bin/python')

    async def bridge_image(self, prompt, model):
        proc = await asyncio.create_subprocess_exec(str(self.hermes_python()),
            str(Path(__file__).with_name('hermes_bridge.py')),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            output, _ = await asyncio.wait_for(proc.communicate(json.dumps({'mode': 'image', 'prompt': prompt, 'model': model}).encode()), 330)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise ApiError(504, 'image_timeout', '封面生成超时，请稍后重试') from None
        except asyncio.CancelledError:
            proc.kill()
            await proc.wait()
            raise
        try:
            result = json.loads(output)
        except ValueError:
            raise ApiError(502, 'image_failed', 'Hermes 图片服务未返回有效结果') from None
        if not result.get('success') or result.get('partial'):
            raise ApiError(502, 'image_failed', 'Hermes 图片生成失败（' + str(result.get('error_type', 'provider_error'))[:80] + '），请检查 Codex 登录和图片能力')
        path = Path(result.get('image', '')).resolve()
        cache = (self.hermes_home / 'cache/images').resolve()
        if not path.is_relative_to(cache) or not path.is_file() or path.stat().st_size > 25 * 1024 * 1024:
            raise ApiError(502, 'invalid_image', '图片服务返回的文件无效')
        return path.read_bytes()

    async def make_cover(self, prompt, job_id=None):
        if self.image_busy:
            raise ApiError(409, 'busy', '正在生成封面，请等待当前任务完成')
        cfg = self.config()
        self.image_busy = True
        _atomic_json(self.image_task_path, {'id': identifier(), 'status': 'running', 'prompt': prompt,
            'job_id': job_id, 'created_at': now(), 'updated_at': now(), 'cover_id': None, 'error': None})
        try:
            if cfg['image_provider'] == 'hermes-codex':
                if not self.hermes_python().exists():
                    raise ApiError(503, 'unconfigured', '未找到本机 Hermes 环境')
                raw = await self.bridge_image(prompt, cfg['image_model'])
            elif cfg['image_provider'] == 'openai-compatible':
                if not cfg['image_api_key'] or not cfg['image_base_url']:
                    raise ApiError(503, 'unconfigured', '请先配置图片服务地址和凭证')
                async with httpx.AsyncClient(timeout=180) as client:
                    response = await client.post(cfg['image_base_url'].rstrip('/') + '/images/generations',
                        headers={'Authorization': 'Bearer ' + cfg['image_api_key']},
                        json={'model': cfg['image_model'], 'prompt': prompt, 'size': '1024x1024',
                              'n': 1, 'response_format': 'b64_json'})
                if response.status_code != 200:
                    raise ApiError(502, 'image_failed', f'图片服务请求失败（HTTP {response.status_code}）')
                try:
                    raw = base64.b64decode(response.json()['data'][0]['b64_json'], validate=True)
                except (ValueError, KeyError, IndexError):
                    raise ApiError(502, 'invalid_image', '图片服务没有返回有效的 b64_json 图片') from None
            else:
                raise ApiError(503, 'unconfigured', '请先配置图片服务')
            candidate = self.save_cover(raw, prompt, cfg['image_model'], job_id)
            # Re-read settings so a long image request cannot overwrite a concurrent config change.
            latest = self.config()
            if all(latest[k] == cfg[k] for k in ('image_provider', 'image_model', 'image_base_url', 'image_api_key')):
                latest['image_verified'] = True
                self._save_config(latest)
            self.write_image_task(status='complete', cover_id=candidate['id'])
            return candidate
        except asyncio.CancelledError:
            self.write_image_task(status='interrupted', error='服务关闭中断了封面生成，请重试')
            raise
        except ApiError as exc:
            self.write_image_task(status='error', error=exc.message)
            raise
        except httpx.TimeoutException:
            self.write_image_task(status='error', error='图片服务超时，请稍后重试')
            raise ApiError(504, 'image_timeout', '图片服务超时，请稍后重试') from None
        except Exception:
            self.write_image_task(status='error', error='图片服务连接中断或返回异常，请重试')
            raise ApiError(502, 'image_failed', '图片服务连接中断或返回异常，请重试') from None
        finally:
            self.image_busy = False

    def image_task(self):
        try:
            return json.loads(self.image_task_path.read_text())
        except (OSError, ValueError):
            return {}

    def write_image_task(self, **changes):
        _atomic_json(self.image_task_path, {**self.image_task(), **changes, 'updated_at': now()})

    def save_cover(self, raw, prompt, model, job_id=None):
        """Persist a completed provider image; applying it is a separate explicit action."""
        if len(raw) > 25 * 1024 * 1024 or len(raw) < 24 or not raw.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ApiError(502, 'invalid_image', '图片服务未返回有效的 PNG 封面')
        cid = identifier()
        filename = cid + '.png'
        (self.images / filename).write_bytes(raw)
        record = {'id': cid, 'job_id': job_id, 'prompt': prompt, 'model': model,
                  'filename': filename, 'created_at': now()}
        with self.db() as db:
            db.execute('INSERT INTO covers VALUES (:id,:job_id,:prompt,:model,:filename,:created_at)', record)
        return self.public_cover(record)

    def public_cover(self, record):
        return {k: v for k, v in {**dict(record), 'url': '/api/assistant/covers/' + record['id'] + '/image'}.items() if k != 'filename'}

    def cover(self, cid):
        with self.db() as db:
            row = db.execute('SELECT * FROM covers WHERE id=?', (cid,)).fetchone()
        if not row:
            raise ApiError(404, 'not_found', '封面不存在')
        return dict(row)

    def covers(self, job_id=None):
        with self.db() as db:
            rows = db.execute('SELECT * FROM covers WHERE job_id=? OR job_id IS NULL ORDER BY created_at DESC', (job_id,)).fetchall() if job_id else db.execute('SELECT * FROM covers ORDER BY created_at DESC').fetchall()
        applied = self.applied(job_id) if job_id else {}
        return {'covers': [self.public_cover(r) for r in rows],
                'applied_id': applied.get('cover_id'), 'can_restore': applied.get('can_restore', False),
                'generating': self.image_busy, 'task': self.image_task()}

    def applied(self, job_id):
        with self.db() as db:
            row = db.execute('SELECT * FROM artwork WHERE job_id=?', (job_id,)).fetchone()
        cid = row['current_id'] if row else None
        return {'job_id': job_id, 'cover_id': cid,
                'cover_url': '/api/assistant/covers/' + cid + '/image' if cid else None,
                'can_restore': bool(row and json.loads(row['history']))}

    def apply(self, cid, job_id):
        self.cover(cid)
        with self.db() as db:
            row = db.execute('SELECT * FROM artwork WHERE job_id=?', (job_id,)).fetchone()
            if row and row['current_id'] == cid:
                return self.applied(job_id)
            history = json.loads(row['history']) if row else []
            history.append(row['current_id'] if row else None)
            db.execute('INSERT OR REPLACE INTO artwork VALUES (?,?,?)', (job_id, cid, json.dumps(history[-50:])))
        return self.applied(job_id)

    def restore(self, job_id):
        with self.db() as db:
            row = db.execute('SELECT * FROM artwork WHERE job_id=?', (job_id,)).fetchone()
            history = json.loads(row['history']) if row else []
            if not history:
                raise ApiError(409, 'no_previous_cover', '没有可恢复的上一张封面')
            cid = history.pop()
            db.execute('UPDATE artwork SET current_id=?,history=? WHERE job_id=?', (cid, json.dumps(history), job_id))
        return self.applied(job_id)

    async def close(self):
        for sid in list(self.active):
            await self.stop(sid)
        tasks = list(getattr(self, 'image_tasks', set()))
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
