"""Small subprocess bridge run with the existing Hermes virtualenv.

Does not change Hermes settings or expose credentials. Stdout is a single JSON result.
"""
from __future__ import annotations

import asyncio
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import sys


def provider():
    root = Path.home() / '.hermes' / 'hermes-agent'
    sys.path.insert(0, str(root))
    from dotenv import load_dotenv
    load_dotenv(Path.home() / '.hermes' / '.env', override=False)
    spec = importlib.util.spec_from_file_location('studio_codex_image', root / 'plugins/image_gen/openai-codex/__init__.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Hermes currently hardcodes an obsolete host model in this provider.
    # Reuse the user's selected Codex chat model without mutating Hermes files.
    from hermes_cli.config import load_config
    model = load_config().get('model', {})
    if isinstance(model, dict) and model.get('provider') == 'openai-codex' and model.get('default'):
        module._CODEX_CHAT_MODEL = model['default']
    return module.OpenAICodexImageGenProvider()


def main():
    payload = json.loads(sys.stdin.read())
    mode = payload.get('mode', 'image')
    with contextlib.redirect_stdout(sys.stderr):
        p = provider()
        if mode == 'check':
            result = {'available': p.is_available()}
        else:
            os.environ['OPENAI_IMAGE_MODEL'] = payload.get('model', 'gpt-image-2-low')
            result = p.generate(payload['prompt'], aspect_ratio='square')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
