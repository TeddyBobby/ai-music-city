"""Download the assistant's local, multilingual speech model (about 145 MB).

Install the optional runtime first: ``pip install -e '.[assistant-voice]'``.
Then run this file with the same Python environment as the music server.
The local model is preferred over cloud STT; audio stays on the machine and only
its transcript plus the user's description reach the selected chat provider.
"""
from __future__ import annotations

import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', type=Path,
                        default=Path(__file__).resolve().parents[1] / 'data/assistant/whisper-base')
    args = parser.parse_args()
    from huggingface_hub import snapshot_download
    from faster_whisper import WhisperModel

    snapshot_download('Systran/faster-whisper-base', local_dir=args.model_dir,
                      allow_patterns=['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt'])
    # Verify the downloaded weights and installed CPU runtime are usable before declaring success.
    WhisperModel(str(args.model_dir), device='cpu', compute_type='int8', cpu_threads=2)
    size = sum(path.stat().st_size for path in args.model_dir.iterdir() if path.is_file())
    print(f'Local voice model ready: {args.model_dir} ({size / 1024 ** 2:.1f} MiB)')


if __name__ == '__main__':
    main()
