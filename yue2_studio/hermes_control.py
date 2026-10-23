"""Start/reuse/stop only the music platform's Hermes API process."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time
import urllib.request

import psutil

from yue2_studio.assistant_service import AssistantService, _atomic_json
from yue2_studio.config import paths_for


def owns_process(pid, launcher, settings, created=None):
    try:
        process = psutil.Process(pid)
        if created is not None and abs(process.create_time() - created) > .01:
            return False
        args = process.cmdline()
        cwd = Path(process.cwd())
        scripts = [(cwd / arg).resolve() for arg in args[1:] if arg.endswith('hermes_launcher.py')]
        if launcher.resolve() not in scripts or '--settings' not in args:
            return False
        target = args[args.index('--settings') + 1]
        return (cwd / target).resolve() == settings.resolve()
    except (psutil.Error, OSError, ValueError, IndexError):
        return False


def health(cfg):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request('http://127.0.0.1:8642/health/detailed',
        headers={'Authorization': 'Bearer ' + cfg['hermes_api_key']})
    try:
        with opener.open(request, timeout=2) as response:
            data = json.load(response)
        return data.get('pid') if data.get('status') == 'ok' else None
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['start', 'stop', 'status'])
    parser.add_argument('--home', required=True)
    args = parser.parse_args()
    root = Path(args.home).resolve()
    svc = AssistantService(paths_for(root).data_dir)
    cfg = svc.server_config()
    launcher = Path(__file__).with_name('hermes_launcher.py').resolve()
    pidfile = svc.root / 'hermes-process.json'
    if args.action != 'stop' and cfg['hermes_base_url'].rstrip('/') not in {
        'http://127.0.0.1:8642', 'http://localhost:8642',
    }:
        print('已设置自定义 Hermes 地址，请自行启动对应服务；音乐服务仍可独立使用。')
        return 0
    pid = health(cfg)
    owned = bool(pid and owns_process(pid, launcher, svc.settings_path))
    if args.action == 'stop':
        try:
            record = json.loads(pidfile.read_text())
        except (OSError, ValueError):
            record = {'pid': pid} if owned else {}
        candidate = record.get('pid')
        if not candidate or not owns_process(candidate, launcher, svc.settings_path, record.get('created')):
            print('没有可确认属于本工作台的 Hermes 进程；未关闭其他服务。')
            return 0
        os.kill(candidate, signal.SIGTERM)
        try:
            psutil.Process(candidate).wait(timeout=10)
        except psutil.NoSuchProcess:
            pass
        except psutil.TimeoutExpired:
            print('已请求助手停止，当前连接仍在清理；未强制结束进程。')
            return 1
        pidfile.unlink(missing_ok=True)
        print('本工作台的 Hermes 助手已停止；音乐服务不受影响。')
        return 0
    if owned:
        _atomic_json(pidfile, {'pid': pid, 'created': psutil.Process(pid).create_time()})
        print('已复用本工作台的 Hermes 助手（127.0.0.1:8642）。')
        return 0
    if args.action == 'status':
        print('助手未连接；音乐生成仍可独立使用。')
        return 1
    try:
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 8642))
    except OSError:
        print('助手端口 8642 已被其他服务占用，未启动或关闭任何其他服务；音乐仍可使用。')
        return 1
    if not svc.hermes_python().exists():
        print('未找到本机 Hermes 环境；音乐仍可使用，请在连接设置中配置助手。')
        return 1
    logpath = svc.root / 'hermes-api.log'
    fd = os.open(logpath, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.chmod(logpath, 0o600)
    with os.fdopen(fd, 'ab') as log:
        child = subprocess.Popen([str(svc.hermes_python()), str(launcher), '--settings', str(svc.settings_path)],
            cwd=root, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    _atomic_json(pidfile, {'pid': child.pid, 'created': psutil.Process(child.pid).create_time()})
    for _ in range(40):
        if health(cfg) == child.pid:
            print('Hermes 助手已启动（对话 + GPT Image 2 封面）。对话和封面需要联网。')
            return 0
        if child.poll() is not None:
            break
        time.sleep(.25)
    print('助手尚未就绪；音乐仍可使用。请查看 YuE2-Studio/data/assistant/hermes-api.log。')
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
