"""Persistent music conversations and artwork, backed by local Hermes.

Secrets stay in a mode-0600 settings file and are never returned to the browser.
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import time
from urllib.parse import urlsplit
import uuid

import httpx

from yue2_studio.api import ApiError
from yue2_studio import audio
from yue2_studio.music_prompts import MUSIC_INTENT_POLICY


SYSTEM_PROMPT = '''你是中文音乐创作助手。通过自然对话理解用户想表达的画面、情绪和音乐想法。
文字、图片和语音都是灵感材料，不是立即生成作品的命令。先回应用户当前的话，只有缺少关键方向时才简短追问一两个问题，不使用固定问卷。
用户明确说可以发歌、可以生成，或已有信息足以形成完整音乐方案时，给出一份音乐提案；信息充分时不必反复确认。
提案前后可以有自然语言说明。提案必须用单独的 <music_proposal>JSON</music_proposal> 块，JSON字段为：
title（作品名）、description（具体曲风、氛围和配器）、music_kind（vocal或instrumental）、lyrics（vocal时为完整歌词，instrumental时为空字符串）。
歌词用 [verse]、[chorus]、[bridge] 分段。不要用Markdown代码围栏包裹提案，也不要在自然正文中重复JSON。
只在方案可供用户审核和生成时输出提案，普通聊天、问候、追问和解释无需提案。不要输出其他格式的歌曲JSON。
提案只是一份待确认的创作方案；不操作文件、不运行命令、不调用工具、不声称已经生成音频或应用修改。直接给出简洁中文回答。''' + '\n\n' + MUSIC_INTENT_POLICY
MODES = {
    'chat': '当前交流重点是聊天和整理灵感。自然回应当前问题，理解意图；仅在方向充分或用户准备发歌时给出音乐提案。',
    'lyrics': '当前交流重点是歌词。尊重用户明确指定的主题、故事、原句和修改范围；仅有曲风、配器或情绪时，自主构思具体的歌词内容，不把音乐关键词逐词写进歌词。必要时讨论或润色片段；完整歌词和音乐方向成熟后再给出音乐提案。',
    'style': '仅输出JSON对象，字段 title、description；description为供音乐模型使用的曲风、配器、节奏、人声描述。不要Markdown围栏。',
    'cover_prompt': '仅输出JSON对象，字段 cover_prompt；内容为详细中文方形专辑封面提示词，不包含生成或保存成功的陈述。不要Markdown围栏。',
}
PROPOSAL_OPEN = '<music_proposal>'


def visible_reply(content):
    """Hide protocol blocks, including an opening marker split across stream chunks."""
    visible = re.sub(r'<music_proposal>[\s\S]*?(?:</music_proposal>|$)', '', content)
    for size in range(min(len(visible), len(PROPOSAL_OPEN) - 1), 0, -1):
        if visible.endswith(PROPOSAL_OPEN[:size]):
            return visible[:-size]
    return visible


def audio_prompt(attachment):
    transcript = str(attachment.get('transcript') or '').strip()
    if transcript:
        return '语音转写（自动识别，可能有误；请结合用户补充描述）：\n' + transcript
    return ('用户上传了一段音频灵感，但没有识别到可转写的话语。'
            '本次没有分析音频中的旋律、音色或节奏，不要声称听懂或猜测其内容。'
            '请结合用户补充描述继续了解想法；若还缺少方向，简短询问想表达的情绪或风格。'
            '可以根据用户文字整理音乐提案，但不要声称提案已经复现这段录音的旋律。')


def music_proposal(content):
    """Only the explicit proposal protocol can turn conversational text into a music card."""
    for match in re.finditer(r'<music_proposal>([\s\S]*?)</music_proposal>', content):
        try:
            value = json.loads(match.group(1))
        except (ValueError, TypeError):
            continue
        if not isinstance(value, dict):
            continue
        kind = value.get('music_kind')
        if not isinstance(kind, str) or kind not in {'vocal', 'instrumental'}:
            continue
        if not all(isinstance(value.get(key), str) and value[key].strip() for key in ('title', 'description')):
            continue
        lyrics = value.get('lyrics', '')
        if not isinstance(lyrics, str) or (value['music_kind'] == 'vocal' and not lyrics.strip()):
            continue
        return {'title': value['title'].strip()[:20000], 'description': value['description'].strip()[:20000],
                'lyrics': lyrics[:20000] if value['music_kind'] == 'vocal' else '',
                'music_kind': value['music_kind']}
    return None


# Runs in the already-configured Hermes environment. Only the requested audio capability or
# transcript crosses the process boundary; provider credentials never do.
HERMES_AUDIO_BRIDGE = r'''
import contextlib, io, json, sys
from pathlib import Path
request = json.load(sys.stdin)
root = Path(request['home'])
sys.path.insert(0, str(root / 'hermes-agent'))
try:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        from dotenv import load_dotenv
        load_dotenv(root / '.env', override=False)
        import tools.transcription_tools as stt
        cfg = stt._load_stt_config()
        cfg = {**cfg, 'language': '', 'local': {**(cfg.get('local') or {}), 'language': ''},
               'openai': {**(cfg.get('openai') or {}), 'language': ''}}
        stt._load_stt_config = lambda: cfg
        provider = stt._get_provider(cfg)
        if request['mode'] == 'probe':
            result = {'available': provider != 'none', 'method': 'transcription'}
        elif provider == 'none':
            result = {'success': False, 'error': 'unavailable'}
        else:
            response = stt.transcribe_audio(request['path'], source='music-assistant')
            result = {'success': bool(response.get('success')),
                      'transcript': response.get('transcript') or ''}
    print(json.dumps(result, ensure_ascii=False))
except Exception:
    print(json.dumps({'success': False, 'error': 'bridge_unavailable'}))
'''

LOCAL_AUDIO_BRIDGE = r'''
import contextlib, io, json, sys
request = json.load(sys.stdin)
try:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        from faster_whisper import WhisperModel
        model = WhisperModel(request['model_path'], device='cpu', compute_type='int8', cpu_threads=4)
        segments, _ = model.transcribe(request['path'], language=None, beam_size=3,
            vad_filter=True, condition_on_previous_text=False)
        transcript = ''.join(segment.text for segment in segments).strip()
    print(json.dumps({'success': True, 'transcript': transcript}, ensure_ascii=False))
except Exception:
    print(json.dumps({'success': False, 'error': 'local_transcription_failed'}))
'''


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
    value = value.strip().rstrip('/')
    if any(character.isspace() or ord(character) < 32 or ord(character) == 127 for character in value):
        raise ApiError(400, 'invalid_url', '服务地址不能包含空格或控制字符')
    try:
        parsed = urlsplit(value)
        parsed.port  # validate malformed/out-of-range ports before persisting
    except ValueError:
        raise ApiError(400, 'invalid_url', '服务地址格式不正确') from None
    if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
        raise ApiError(400, 'invalid_url', '服务地址不能包含凭证、查询参数或锚点')
    if parsed.scheme not in {'http', 'https'}:
        raise ApiError(400, 'invalid_url', '服务地址必须使用 http 或 https')
    try:
        loopback = ipaddress.ip_address(parsed.hostname).is_loopback
    except ValueError:
        loopback = parsed.hostname == 'localhost'
    if parsed.scheme == 'http' and not loopback:
        raise ApiError(400, 'invalid_url', '远程服务地址必须使用 HTTPS，本机服务可以使用 HTTP')
    return value


def endpoint_url(base_url, endpoint):
    """Keep provider API prefixes intact; only the legacy local Hermes root implies /v1."""
    base = base_url.rstrip('/')
    parsed = urlsplit(base)
    try:
        local = ipaddress.ip_address(parsed.hostname or '').is_loopback
    except ValueError:
        local = parsed.hostname == 'localhost'
    if not parsed.path.strip('/') and local and parsed.port == 8642:
        base += '/v1'
    return base + '/' + endpoint.lstrip('/')


def provider_headers(cfg):
    key = cfg.get('hermes_api_key') or ''
    return {'Authorization': 'Bearer ' + key} if key else {}


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
    def __init__(self, data_dir: Path, *, hermes_home: Path | None = None, recover=False,
                 config_source: AssistantService | None = None):
        self.config_source = config_source
        self.root = Path(data_dir) / 'assistant'
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.images = self.root / 'images'
        self.images.mkdir(exist_ok=True)
        self.audio_dir = self.root / 'audio'
        self.audio_dir.mkdir(exist_ok=True, mode=0o700)
        self.settings_path = self.root / 'settings.json'
        self.chat_settings_path = self.root / 'chat-settings.json'
        self.hermes_home = hermes_home or Path.home() / '.hermes'
        self.db_path = self.root / 'assistant.db'
        self.active = {}
        self.image_busy = False
        self.last_chat_check = None
        self.model_cache = None
        self.model_cache_key = None
        self.audio_cache = None
        self.chat_tasks = set()
        self.audio_slots = config_source.audio_slots if config_source else asyncio.Semaphore(1)
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
            columns = {row['name'] for row in db.execute('PRAGMA table_info(messages)')}
            for column in ('audio', 'model', 'mode', 'image'):
                if column not in columns:
                    db.execute(f'ALTER TABLE messages ADD COLUMN {column} TEXT')
            if recover:
                db.execute("UPDATE messages SET status='interrupted' WHERE status='streaming'")
        if config_source is None and not self.settings_path.exists():
            # Provider credentials are server configuration, never shipped defaults or copied into
            # users' workspaces. Existing local settings remain intact during the account upgrade.
            self._save_config({'hermes_base_url': os.environ.get('AMC_ASSISTANT_BASE_URL', ''),
                'hermes_model': os.environ.get('AMC_ASSISTANT_MODEL', ''),
                'hermes_api_key': os.environ.get('AMC_ASSISTANT_API_KEY', ''),
                'image_provider': 'disabled', 'image_base_url': '', 'image_model': '',
                'image_api_key': '', 'image_verified': False})

    @contextlib.contextmanager
    def db(self):
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def server_config(self):
        """The deployment fallback never includes the legacy owner's personal override."""
        if self.config_source is not None:
            return self.config_source.server_config()
        return json.loads(self.settings_path.read_text())

    def _chat_override(self):
        if not self.chat_settings_path.exists():
            return None
        try:
            value = json.loads(self.chat_settings_path.read_text())
            if not isinstance(value, dict):
                raise ValueError('invalid personal configuration')
            return {key: value.get(key, '') for key in ('hermes_base_url', 'hermes_api_key', 'hermes_model')}
        except (OSError, ValueError):
            raise ApiError(500, 'config_unavailable', '个人连接配置无法读取，请重新保存') from None

    def config(self):
        return {**self.server_config(), **(self._chat_override() or {})}

    def _save_config(self, cfg):
        if self.config_source is not None:
            self.config_source._save_config(cfg)
            return
        _atomic_json(self.settings_path, cfg)
        self.model_cache = None

    def public_config(self):
        personal = self._chat_override()
        return {'hermes_base_url': (personal or {}).get('hermes_base_url', ''),
                'has_hermes_api_key': bool((personal or {}).get('hermes_api_key')),
                'source': 'custom' if personal is not None else 'default',
                'default_configured': bool(self.server_config().get('hermes_base_url'))}

    def _patched_chat_config(self, patch):
        """Build a private candidate without ever borrowing fallback credentials."""
        allowed = {'hermes_base_url', 'hermes_api_key'}
        if set(patch) - allowed:
            raise ApiError(400, 'validation_error', '未知配置字段')
        for k, v in patch.items():
            if not isinstance(v, str) or len(v) > 4096:
                raise ApiError(400, 'validation_error', '配置字段必须为文本')
        patch = {key: value.strip() for key, value in patch.items()}
        key = patch.get('hermes_api_key', '')
        if any(ord(character) < 32 or ord(character) == 127 for character in key):
            raise ApiError(400, 'validation_error', 'API Key 格式不正确')
        personal = self._chat_override() or {}
        base = patch.get('hermes_base_url', personal.get('hermes_base_url', ''))
        if not base:
            if key:
                raise ApiError(400, 'invalid_url', '请填写与 API Key 对应的服务地址')
            return self.server_config(), None
        base = _safe_url(base)
        # Empty/omitted credentials keep only this user's key for this exact API base.
        # Even a path change can select a different tenant/provider, so drop it then.
        if not key and base == personal.get('hermes_base_url'):
            key = personal.get('hermes_api_key', '')
        override = {'hermes_base_url': base, 'hermes_api_key': key, 'hermes_model': ''}
        return {**self.server_config(), **override}, override

    def update_config(self, patch):
        _, override = self._patched_chat_config(patch)
        if override is None:
            self.chat_settings_path.unlink(missing_ok=True)
        else:
            _atomic_json(self.chat_settings_path, override)
        self.last_chat_check = None
        self.model_cache = None
        self.model_cache_key = None
        return self.public_config()

    async def hermes_bridge(self, mode, *, path=None):
        if not self.hermes_python().exists():
            raise ApiError(503, 'audio_unavailable', '语音识别服务尚未配置，请输入文字')
        payload = {'mode': mode, 'home': str(self.hermes_home)}
        if path is not None:
            payload['path'] = str(path)
        proc = await asyncio.create_subprocess_exec(str(self.hermes_python()), '-c', HERMES_AUDIO_BRIDGE,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            raw, _ = await asyncio.wait_for(proc.communicate(json.dumps(payload).encode()),
                                           150 if mode == 'transcribe' else 15)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            if proc.returncode is None:
                proc.kill()
            await proc.wait()
            raise
        try:
            result = json.loads(raw)
        except (ValueError, TypeError):
            raise ApiError(503, 'audio_unavailable', '语音服务暂时不可用，请稍后重试') from None
        if not isinstance(result, dict):
            raise ApiError(503, 'audio_unavailable', '语音服务暂时不可用，请稍后重试')
        return result

    @property
    def voice_model_dir(self):
        if self.config_source is not None:
            return self.config_source.voice_model_dir
        return self.root / 'whisper-base'

    def local_voice_available(self):
        model = self.voice_model_dir
        return (importlib.util.find_spec('faster_whisper') is not None
                and all((model / filename).is_file() for filename in ('model.bin', 'config.json', 'tokenizer.json')))

    async def transcribe_audio(self, path):
        if not self.local_voice_available():
            return await self.hermes_bridge('transcribe', path=path)
        proc = await asyncio.create_subprocess_exec(sys.executable, '-c', LOCAL_AUDIO_BRIDGE,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            raw, _ = await asyncio.wait_for(proc.communicate(json.dumps({
                'path': str(path), 'model_path': str(self.voice_model_dir)}).encode()), 150)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            if proc.returncode is None:
                proc.kill()
            await proc.wait()
            raise
        try:
            result = json.loads(raw)
            return result if isinstance(result, dict) else {'success': False}
        except (ValueError, TypeError):
            return {'success': False}

    async def audio_capability(self):
        if self.local_voice_available():
            return {'available': True, 'method': 'transcription', 'message': '语音在本机转成文字，与补充描述一起发送'}
        if not self.audio_cache or time.monotonic() - self.audio_cache[0] > 60:
            try:
                capability = await self.hermes_bridge('probe')
                available = bool(capability.get('available'))
            except (ApiError, OSError, asyncio.TimeoutError):
                available = False
            self.audio_cache = (time.monotonic(), {'available': available, 'method': 'transcription',
                'message': '语音会转成文字，与补充描述一起发送' if available else '语音识别服务尚未连接'})
        return self.audio_cache[1]

    @staticmethod
    def _connection_key(cfg):
        return tuple(cfg.get(key, '') for key in ('hermes_base_url', 'hermes_api_key', 'hermes_model'))

    async def _fetch_model_catalog(self, cfg):
        # Only the configured endpoint can advertise selectable models. Draft checks call this
        # pure request path directly, never touching saved settings or either account's cache.
        if not cfg.get('hermes_base_url'):
            raise ApiError(503, 'unconfigured', 'AI 助手尚未连接，请先配置服务地址')
        base = _safe_url(cfg['hermes_base_url'])
        try:
            async with httpx.AsyncClient(timeout=8, trust_env=False) as client:
                response = await client.get(endpoint_url(base, 'models'), headers=provider_headers(cfg))
                response.raise_for_status()
                payload = response.json()
            if not isinstance(payload, dict) or not isinstance(payload.get('data'), list):
                raise ValueError('invalid model list')
        except httpx.HTTPStatusError as exc:
            message = ('模型列表鉴权失败，请检查服务凭证' if exc.response.status_code in {401, 403}
                       else '模型列表暂时无法获取，请稍后重试')
            raise ApiError(502, 'models_unavailable', message) from None
        except (httpx.HTTPError, ValueError):
            raise ApiError(502, 'models_unavailable', '模型列表暂时无法获取，请检查连接后重试') from None
        options, seen = [], set()
        for item in payload['data']:
            if not isinstance(item, dict) or not isinstance(item.get('id'), str):
                continue
            model_id = item['id'].strip()
            if not model_id or len(model_id) > 300 or model_id in seen:
                continue
            seen.add(model_id)
            options.append({'id': model_id, 'name': model_id,
                            'provider': str(item.get('owned_by') or 'Agent')})
        default = cfg.get('hermes_model') or ''
        if default not in seen:
            default = options[0]['id'] if options else ''
        return {'models': options, 'default_model': default}

    async def _model_catalog(self, *, refresh=False):
        cfg = self.config()
        connection = self._connection_key(cfg)
        if (not refresh and self.model_cache and self.model_cache_key == connection
                and time.monotonic() - self.model_cache[0] < 60):
            return self.model_cache[1]
        self.model_cache = None
        try:
            result = await self._fetch_model_catalog(cfg)
        except ApiError:
            if self._connection_key(self.config()) != connection:
                return await self._model_catalog()
            raise
        # A response for an old connection must not replace a newer account setting.
        if self._connection_key(self.config()) != connection:
            return await self._model_catalog()
        self.model_cache = (time.monotonic(), result)
        self.model_cache_key = connection
        return result

    async def models(self):
        return {**await self._model_catalog(), 'audio': await self.audio_capability()}

    async def request_model(self, selected):
        catalog = await self._model_catalog()
        model_id = selected or catalog['default_model']
        if not model_id:
            raise ApiError(503, 'no_models', '当前服务没有可用模型，请检查服务配置')
        if not any(item['id'] == model_id for item in catalog['models']):
            raise ApiError(400, 'invalid_model', '该模型不在当前已连接的模型列表中，请重新选择')
        # Send the advertised id unchanged: Hermes resolves its own aliases and provider routes.
        return {'model': model_id}

    def audio_attachment(self, audio_id):
        if not re.fullmatch(r'[a-f0-9]{32}', audio_id or ''):
            raise ApiError(404, 'not_found', '语音文件不存在')
        try:
            record = json.loads((self.audio_dir / (audio_id + '.json')).read_text())
        except (OSError, ValueError):
            raise ApiError(404, 'not_found', '语音文件不存在') from None
        if record.get('ext') not in audio.UPLOAD_EXTENSIONS or not self.audio_path(record).is_file():
            raise ApiError(404, 'not_found', '语音文件不存在')
        return record

    def audio_path(self, record):
        return self.audio_dir / (record['id'] + '.' + record['ext'])

    def public_audio(self, record):
        return {**{key: record[key] for key in ('id', 'filename', 'url', 'seconds', 'transcript')},
                'transcription_status': record.get('transcription_status') or
                    ('transcribed' if record.get('transcript') else 'no_speech')}

    async def receive_audio(self, file):
        try:
            ext = audio.validate_upload_name(file.filename)
        except audio.BadUploadType:
            raise ApiError(400, 'invalid_audio', '请选择 MP3、WAV、M4A 或 WebM 音频') from None
        audio_id = identifier()
        destination = self.audio_dir / (audio_id + '.' + ext)
        total = 0
        try:
            with destination.open('wb') as target:
                while chunk := await file.read(1024 * 1024):
                    total += len(chunk)
                    if total > 20 * 1024 * 1024:
                        raise ApiError(413, 'audio_too_large', '语音文件不能超过 20 MB')
                    target.write(chunk)
            destination.chmod(0o600)
            seconds = await asyncio.to_thread(audio.probe_duration, destination)
            if not total or seconds is None or seconds <= 0:
                raise ApiError(400, 'invalid_audio', '无法读取这段音频，请重新录制或选择其他文件')
            if seconds > 120:
                raise ApiError(400, 'audio_too_long', '语音最长支持 2 分钟，请截取后再发送')
            # Keep model memory bounded even if more than one browser tab uploads a voice note.
            async with self.audio_slots:
                result = await self.transcribe_audio(destination)
            transcript = str(result.get('transcript') or '').strip()
            if not result.get('success'):
                raise ApiError(503, 'transcription_failed', '语音识别暂时不可用，请稍后重试或输入文字描述')
            record = {'id': audio_id, 'ext': ext, 'filename': Path(file.filename or ('语音.' + ext)).name,
                      'url': f'/api/assistant/audio/{audio_id}', 'seconds': seconds,
                      'transcript': transcript[:12000],
                      'transcription_status': 'transcribed' if transcript else 'no_speech'}
            _atomic_json(self.audio_dir / (audio_id + '.json'), record)
            return self.public_audio(record)
        except asyncio.TimeoutError:
            destination.unlink(missing_ok=True)
            raise ApiError(504, 'transcription_timeout', '语音识别超时，请稍后重试') from None
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
        finally:
            await file.close()

    async def auto_model(self, cfg):
        """Resolve a default without modifying deployment or personal credentials."""
        try:
            catalog = await self._model_catalog()
        except ApiError:
            return None
        if self._connection_key(self.config()) != self._connection_key(cfg):
            return None
        return catalog['default_model'] or None

    def model_info(self):
        try:
            import yaml
            model = yaml.safe_load((self.hermes_home / 'config.yaml').read_text()).get('model', {})
            return model.get('default', 'Hermes'), model.get('provider', 'Hermes')
        except (ImportError, OSError, ValueError, AttributeError):
            return 'Hermes', 'Hermes'

    async def status(self, *, refresh=False, draft=None):
        cfg = self._patched_chat_config(draft)[0] if draft is not None else self.config()
        chat = {'configured': bool(cfg.get('hermes_base_url')), 'available': False,
                'model': '', 'model_count': 0, 'error_code': None,
                'provider': 'agent', 'base_url': '', 'message': 'Agent 尚未连接'}
        if chat['configured']:
            try:
                # Deployment files can predate URL validation. Never reflect embedded credentials.
                chat['base_url'] = _safe_url(cfg['hermes_base_url'])
                catalog = (await self._fetch_model_catalog(cfg) if draft is not None
                           else await self._model_catalog(refresh=refresh))
                if draft is None and self._connection_key(self.config()) != self._connection_key(cfg):
                    return await self.status(refresh=False)
                available = bool(catalog['models'])
                chat.update(available=available, model=catalog['default_model'],
                            model_count=len(catalog['models']), error_code=None if available else 'no_models',
                            message='已连接 Agent 服务' if available else '连接成功，但当前服务没有可用模型')
            except ApiError as exc:
                chat.update(message=exc.message, error_code=exc.code)
        image = {'configured': False, 'available': False, 'verified': False,
                 'model': '', 'provider': 'disabled', 'message': '图片生成暂未开放'}
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
            msg['audio'] = json.loads(msg['audio']) if msg.get('audio') else None
            msg['image'] = json.loads(msg['image']) if msg.get('image') else None
        return {**dict(row), 'messages': messages, 'message_count': len(messages),
                'active': session_id in self.active}

    def save_message(self, sid, role, content, *, status='complete', message_id=None, suggestion=None,
                     attachment=None, model=None, mode=None, image_attachment=None):
        msg = {'id': message_id or identifier(), 'role': role, 'content': content, 'status': status,
               'created_at': now(), 'suggestion': suggestion, 'audio': attachment, 'model': model, 'mode': mode, 'image': image_attachment}
        with self.db() as db:
            db.execute('INSERT OR REPLACE INTO messages '
                       '(id,session_id,role,content,status,created_at,suggestion,audio,model,mode,image) '
                       'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                (msg['id'], sid, role, content, status, msg['created_at'], json.dumps(suggestion) if suggestion else None,
                 json.dumps(attachment, ensure_ascii=False) if attachment else None, model, mode,
                 json.dumps(image_attachment, ensure_ascii=False) if image_attachment else None))
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
        task = run.get('task')
        if task and run.get('started') and not task.done():
            # Closing a response cannot interrupt a request still waiting for headers. Cancel
            # the owned producer instead; stream's finally block persists the partial reply.
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        elif run['response']:
            await run['response'].aclose()
        return {'status': 'stopping'}

    async def stream(self, sid, content, mode, context, run, *, model=None, attachment=None, selected_model=None, image_attachment=None):
        cfg = self.config()
        previous = self.session(sid)
        self.save_message(sid, 'user', content, attachment=attachment, mode=mode, image_attachment=image_attachment)
        if previous['title'] == '新对话':
            with self.db() as db:
                title = (content or (attachment or {}).get('transcript') or
                         ('图片灵感' if image_attachment else '音频灵感' if attachment else '音乐灵感'))
                db.execute('UPDATE sessions SET title=? WHERE id=?', (title[:32], sid))
        message_id, result, raw_result = identifier(), '', ''
        conversational = mode in {'chat', 'lyrics'}
        model_name = selected_model or (model or {}).get('model') or cfg['hermes_model']
        self.save_message(sid, 'assistant', '', status='streaming', message_id=message_id, model=model_name, mode=mode)
        messages = [{'role': 'system', 'content': SYSTEM_PROMPT}]
        has_images = bool(image_attachment)
        for message in previous['messages'][-30:]:
            if message['status'] != 'complete':
                continue
            text = message['content']
            if message.get('suggestion'):
                text += '\n\n之前的音乐提案（尚未生成音频）：' + json.dumps(message['suggestion'], ensure_ascii=False)
            if message.get('audio'):
                text += '\n\n' + audio_prompt(message['audio'])
            image = message.get('image')
            if image:
                from yue2_studio.assistant_images import image_content
                try:
                    image_part = image_content(self.root, image)
                except (ApiError, OSError):
                    text += '\n[之前的图片目前无法读取]'
                else:
                    has_images = True
                    messages.append({'role': message['role'], 'content':
                        ([{'type': 'text', 'text': text}] if text else []) + [image_part]})
                    continue
            if text:
                messages.append({'role': message['role'], 'content': text})
        enriched = content
        if attachment:
            enriched += '\n\n' + audio_prompt(attachment)
        if context:
            enriched += '\n\n作品上下文（仅供参考）：\n' + json.dumps(context, ensure_ascii=False)
        if MODES[mode]:
            enriched += '\n\n' + MODES[mode]
        image_error = None
        if image_attachment:
            from yue2_studio.assistant_images import image_content
            try:
                image_part = image_content(self.root, image_attachment)
                enriched = ([{'type': 'text', 'text': enriched}] if enriched else []) + [image_part]
            except (ApiError, OSError):
                image_error = ApiError(404, 'image_missing', '图片已无法读取，请重新上传后再发送')
        messages.append({'role': 'user', 'content': enriched})
        yield 'meta', {'run_id': run['id'], 'session_id': sid}
        state = 'complete'
        try:
            if image_error:
                raise image_error
            if run['stop'].is_set():
                raise asyncio.CancelledError
            async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=10), trust_env=False) as client:
                async with client.stream('POST', endpoint_url(cfg['hermes_base_url'], 'chat/completions'),
                    headers={**provider_headers(cfg), 'X-Hermes-Session-Key': 'yue2-' + sid},
                    json={**(model or {'model': cfg['hermes_model']}), 'messages': messages,
                          'stream': True, 'max_tokens': 2400}) as response:
                    run['response'] = response
                    if response.status_code != 200:
                        if has_images and response.status_code in {400, 415, 422}:
                            raise ApiError(502, 'image_unsupported', '当前模型暂时无法读取图片，请切换支持图片的模型，或用文字描述画面。')
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
                            raw_result += delta
                            visible = visible_reply(raw_result) if conversational else raw_result
                            if len(visible) > len(result):
                                text = visible[len(result):]
                                result = visible
                                yield 'delta', {'text': text}
                            if time.monotonic() - checkpoint > 2:
                                self.save_message(sid, 'assistant', result, status='streaming',
                                                  message_id=message_id, model=model_name, mode=mode)
                                checkpoint = time.monotonic()
            if run['stop'].is_set():
                state = 'stopped'
            proposal = music_proposal(raw_result) if conversational else None
            if conversational and PROPOSAL_OPEN in raw_result and not proposal and state == 'complete':
                raise ApiError(502, 'invalid_proposal', '音乐提案尚未整理完整，请重试')
            if not result.strip() and not proposal and state == 'complete':
                raise ApiError(502, 'empty_response', 'Hermes 没有返回回复，请重试')
        except asyncio.CancelledError:
            state = 'stopped'
        except Exception as exc:
            if run['stop'].is_set():
                state = 'stopped'
            else:
                state = 'error'
                error = exc.message if isinstance(exc, ApiError) else 'Hermes 连接中断或超时，请检查服务后重试'
                yield 'error', {'message': error, 'code': exc.code if isinstance(exc, ApiError) else 'hermes_failed'}
        finally:
            run['response'] = None
            suggestion = ((music_proposal(raw_result) if conversational else structured(result))
                          if state == 'complete' else None)
            final = self.save_message(sid, 'assistant', result, status=state,
                                      message_id=message_id, suggestion=suggestion, model=model_name, mode=mode)
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
            latest = self.server_config()
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
        tasks += list(self.chat_tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
