"""Local vocal timing, isolated from the music model process.

Whisper supplies audio-derived token timestamps. Monotonic text alignment maps those
tokens back onto the original lyrics (including repeated choruses). Missing or weak
matches are deliberately left untimed; no duration-based interpolation is used.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from yue2_studio import config

MODEL_NAME = "ggml-small-q5_1.bin"
MODEL_BYTES = 190085487
ALGORITHM_VERSION = "whisper-small-dtw-phonetic-v2"

SECTIONS = {
    "intro": "前奏", "verse": "主歌", "chorus": "副歌", "prechorus": "预副歌",
    "postchorus": "后副歌", "bridge": "桥段", "outro": "尾声",
    "instrumental": "器乐段落", "interlude": "间奏", "solo": "独奏",
}


def lyric_lines(text: str) -> list[dict]:
    lines: list[dict] = []
    section = None
    for raw in text.splitlines():
        raw = raw.strip()
        if not raw:
            continue
        marker = re.fullmatch(r"\[([^\[\]]+)\]", raw)
        if marker:
            label = marker[1]
            if re.match(r"(?:ar|ti|al|by|offset|length):", label, re.I):
                continue
            section = re.sub(
                r"^(pre[-_ ]?chorus|post[-_ ]?chorus|intro|verse|chorus|bridge|outro|"
                r"instrumental|interlude|solo)"
                r"(?=$|\s|\d|[:：-])",
                lambda m: SECTIONS[re.sub(r"[-_ ]", "", m[0].lower())], label, flags=re.I,
            )
            continue
        raw = re.sub(r"\[\d+:[0-5]\d(?:[.:]\d{1,3})?\]", "", raw).strip()
        if raw:
            lines.append({"text": raw, "at": None, **({"section": section} if section else {})})
            section = None
    return lines


@dataclass(frozen=True)
class AudioChar:
    text: str
    sound: str
    at: float
    end: float


class Normalizer:
    def __init__(self):
        from opencc import OpenCC
        from pypinyin import lazy_pinyin

        self.convert = OpenCC("t2s").convert
        self.pinyin = lazy_pinyin

    def text(self, value: str) -> str:
        return "".join(c for c in self.convert(unicodedata.normalize("NFKC", value)).lower()
                       if c.isalnum())

    def sounds(self, value: str) -> list[str]:
        # Use phrase-aware readings, but only compare one character with one char.
        sounds = self.pinyin(value, errors=lambda x: list(x))
        return sounds if len(sounds) == len(value) else list(value)


def audio_chars(transcript: dict, norm: Normalizer, duration: float) -> list[AudioChar]:
    chars = []
    for segment in transcript.get("transcription", []):
        segment_start = segment.get("offsets", {}).get("from", 0) / 1000
        segment_end = segment.get("offsets", {}).get("to", duration * 1000) / 1000
        for token in segment.get("tokens", []):
            if token.get("id", 50257) >= 50257 or "[_" in token.get("text", ""):
                continue
            text = norm.text(token.get("text", ""))
            offsets = token.get("offsets", {})
            dtw = token.get("t_dtw", -1)
            start = dtw / 100 if isinstance(dtw, (int, float)) and dtw >= 0 else None
            if start is None:
                continue  # A segment-wide timestamp is not a token alignment.
            # DTW occasionally attends to instrumental audio several seconds
            # before the segment containing the word. In that case only trust
            # the independent token offset inside the recognized vocal segment.
            if start < segment_start - 0.75 or start > segment_end + 0.75:
                token_start = offsets.get("from", -1) / 1000
                if not segment_start <= token_start <= segment_end:
                    continue
                start = token_start
            end = offsets.get("to", -1) / 1000
            if not text or not math.isfinite(start) or not 0 <= start < duration:
                continue
            # Token offsets can lag behind DTW; never create a negative interval.
            end = min(duration, max(start + 0.08, end))
            for char, sound in zip(text, norm.sounds(text), strict=True):
                chars.append(AudioChar(char, sound, start, end))
    return chars


def match_characters(text: str, sounds: list[str], audio: list[AudioChar]) -> dict[int, int]:
    """Global ordered alignment; a repeated line cannot steal an earlier chorus."""
    # Backtrace is byte-sized, scores need only two rows. Bound input before allocation.
    if len(text) > 12000 or len(audio) > 16000 or len(text) * len(audio) > 20_000_000:
        raise ValueError("歌词过长，请分段校准")
    width = len(audio) + 1
    trace = bytearray((len(text) + 1) * width)
    previous = [-1.5 * j for j in range(width)]
    for i, char in enumerate(text, 1):
        current = [-1.5 * i] + [0.0] * len(audio)
        trace[i * width] = 1
        for j, token in enumerate(audio, 1):
            same = char == token.text
            phonetic = sounds[i - 1] == token.sound and not char.isascii()
            diagonal = previous[j - 1] + (3.0 if same else 2.0 if phonetic else -1.8)
            delete = previous[j] - 1.5
            insert = current[j - 1] - 1.5
            best = max(diagonal, delete, insert)
            current[j] = best
            trace[i * width + j] = 0 if best == diagonal else 1 if best == delete else 2
        previous = current
    mapping = {}
    i, j = len(text), len(audio)
    while i and j:
        move = trace[i * width + j]
        if move == 0:
            mapping[i - 1] = j - 1
            i -= 1
            j -= 1
        elif move == 1:
            i -= 1
        else:
            j -= 1
    return mapping


def align_transcript(lyrics: str, transcript: dict, duration: float) -> dict:
    norm = Normalizer()
    lines = lyric_lines(lyrics)
    normalized = [norm.text(line["text"]) for line in lines]
    text = "".join(normalized)
    sounds = norm.sounds(text)
    audio = audio_chars(transcript, norm, duration)
    mapping = match_characters(text, sounds, audio)
    cursor = 0
    previous_start = -1.0
    for line, content in zip(lines, normalized, strict=True):
        positions = [(i, mapping[i]) for i in range(cursor, cursor + len(content)) if i in mapping]
        evidence = [(i, j) for i, j in positions if text[i] == audio[j].text
                    or (not text[i].isascii() and sounds[i] == audio[j].sound)]
        coverage = len(evidence) / max(1, len(content))
        # Require anchors near both ends; do not infer the start of an omitted line.
        reliable = (len(evidence) >= min(3, len(content)) and len(content) >= 2 and coverage >= 0.6
                    and evidence[0][0] - cursor <= 1
                    and cursor + len(content) - 1 - evidence[-1][0] <= 1)
        if reliable:
            first, last = audio[positions[0][1]], audio[positions[-1][1]]
            span = last.end - first.at
            times = [audio[j].at for _, j in positions]
            # A nearby misheard syllable can share the line's audio boundary,
            # but an unmatched token across a pause must not move its onset.
            boundary_gap = max(audio[evidence[0][1]].at - first.at,
                               last.at - audio[evidence[-1][1]].at)
            if (first.at > previous_start and 0.12 <= span <= max(12, len(content) * 1.4)
                    and boundary_gap <= 1.2
                    and all(a <= b for a, b in zip(times, times[1:], strict=False))):
                line.update(at=round(first.at, 3), end=round(last.end, 3), confidence=round(coverage, 3))
                previous_start = first.at
        cursor += len(content)
    timed = [line for line in lines if line["at"] is not None]
    # Do not let a long held note's offset overlap the next sung sentence.
    for left, right in zip(timed, timed[1:], strict=False):
        left["end"] = min(left["end"], right["at"])
    return {
        "status": "ready" if timed else "failed", "source": "audio", "lines": lines,
        "matched_lines": len(timed), "total_lines": len(lines), "progress": 100,
        "model": "whisper.cpp/small-q5_1", "algorithm": ALGORITHM_VERSION,
        "message": ("歌词已按音频校准" if len(timed) == len(lines) and timed else
                    f"已校准 {len(timed)}/{len(lines)} 句，未匹配的歌词不参与高亮" if timed else
                    "未识别到可靠的演唱匹配，歌词保留为静态显示"),
    }


def run(audio: Path, lyrics: str) -> dict:
    cli, ffmpeg = shutil.which("whisper-cli"), shutil.which("ffmpeg")
    model = config.paths_for().models_dir / "whisper" / MODEL_NAME
    if not cli or not ffmpeg or not model.is_file() or model.stat().st_size != MODEL_BYTES:
        return {"status": "unavailable", "source": "audio", "lines": [],
                "message": "尚未安装歌词校准模型，请运行 scripts/setup_lyrics.py"}
    try:
        import soundfile as sf
        info = sf.info(audio)
        duration = info.frames / info.samplerate
    except Exception as exc:
        raise ValueError("无法读取歌曲音频") from exc
    if not 0 < duration <= 1800:
        raise ValueError("歌词校准支持 30 分钟以内的歌曲")
    if not lyric_lines(lyrics):
        raise ValueError("没有需要校准的演唱歌词")
    with tempfile.TemporaryDirectory(prefix="aimusic-lyrics-") as temp:
        wav = Path(temp) / "vocals.wav"
        output = Path(temp) / "transcript"
        subprocess.run([ffmpeg, "-nostdin", "-v", "error", "-y", "-i", str(audio), "-vn",
                        "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120)
        # DTW requires non-flash attention. Keep CPU-only and bounded to 4 threads
        # so the model never competes for Metal memory with the music generator.
        language = "zh" if re.search(r"[\u3400-\u9fff]", lyrics) else "auto"
        subprocess.run([cli, "-m", str(model), "-f", str(wav), "-l", language,
                        "-ng", "-t", "4", "-dtw", "small", "-nfa", "-ojf", "-of", str(output)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=900)
        transcript = json.loads(output.with_suffix(".json").read_text(encoding="utf-8"))
        return align_transcript(lyrics, transcript, duration)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--lyrics", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        lyrics = json.loads(args.lyrics.read_text(encoding="utf-8"))["lyrics"]
        result = run(args.audio, lyrics)
    except ImportError:
        result = {"status": "unavailable", "source": "audio", "lines": [],
                  "message": "歌词校准依赖尚未安装，请更新项目依赖后重试"}
    except (subprocess.SubprocessError, OSError, ValueError, KeyError):
        result = {"status": "failed", "source": "audio", "lines": [],
                  "message": "音频校准未完成，请稍后重试"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    os.replace(temporary, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
