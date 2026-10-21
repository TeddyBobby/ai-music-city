"""Run only Hermes's authenticated loopback API, without changing its configuration.

Invoke using ~/.hermes/hermes-agent/venv/bin/python this_file --settings <private settings.json>.
"""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import signal
import sys


async def serve(settings_path):
    root = Path.home() / '.hermes/hermes-agent'
    sys.path.insert(0, str(root))
    from dotenv import load_dotenv
    load_dotenv(Path.home() / '.hermes/.env', override=False)
    from gateway.config import PlatformConfig
    from gateway.platforms import api_server
    # This dedicated process exposes chat only. Empty explicit toolsets are
    # respected by Hermes (None would enable defaults). Other Hermes sessions
    # and configuration are unaffected. Image calls use the separate provider.
    api_server._get_platform_tools = lambda _config, _platform: []
    APIServerAdapter = api_server.APIServerAdapter
    cfg = json.loads(Path(settings_path).read_text())
    # This adapter serves the music assistant only; no other gateway platforms start.
    adapter = APIServerAdapter(PlatformConfig(enabled=True, extra={
        'host': '127.0.0.1', 'port': 8642, 'key': cfg['hermes_api_key'],
        'direct_model_requests': True,
    }))
    if not await adapter.connect():
        raise RuntimeError('Hermes API could not start; see local server log')
    stop = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        asyncio.get_running_loop().add_signal_handler(sig, stop.set)
    try:
        await stop.wait()
    finally:
        await adapter.disconnect()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--settings', required=True)
    args = parser.parse_args()
    asyncio.run(serve(args.settings))
