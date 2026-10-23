"""Check the real frontend payloads against storage and YuE2's request protocol.

No music inference or external assistant call is made. A deterministic assistant
response replaces only that network boundary; TypeScript creation logic is real.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from yue2_studio import jobs


FRONTEND = Path(__file__).resolve().parents[1] / "frontend"
INSTRUMENTAL_LORAS = ("ar_lora_inst_v3abc.bf16", "nar_lora_joint_v4.bf16")


@pytest.fixture(scope="module")
def frontend_payloads():
    node = shutil.which("node")
    if not node or not (FRONTEND / "node_modules/typescript").exists():
        pytest.skip("frontend contract checks need Node and npm install")
    script = r"""
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const status = {
  memory: { machine_ram_gib: 16 }, models: { present: true, precisions: ['4bit', '8bit'] },
  hum: { available: true, adapters: [] },
  loras: { adapters: ['ar_lora_inst_v3abc.bf16', 'nar_lora_joint_v4.bf16'].map(name => ({ name, valid: true })) },
};
let submitted;
const context = { exports: {}, DOMException, require(name) {
  if (name === './api') return { api: {
    status: async () => status,
    submit: async body => { submitted = body; return { job: { id: 'contract' } }; },
  } };
  if (name === './assistant') return {
    assistantApi: { newSession: async () => ({ id: 'draft' }), stop: async () => {} },
    streamMessage: async (_id, _body, options) => options.onEvent({ type: 'done', message: {
      suggestion: { title: '雨后', description: '木吉他与钢琴纯音乐', lyrics: '[Verse]\n微风吹过青草地\n阳光落在你眼底' },
    } }),
  };
  throw new Error(name);
} };
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/musicCreation.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, context);
const music = context.exports, results = {};
for (const source of ['sentence', 'hum', 'image']) for (const musicKind of ['vocal', 'instrumental']) {
  const prompt = source === 'image' ? '雨后森林，绿色与薄雾的安静氛围，钢琴纯音乐' : '温暖的女声歌曲';
  if (source === 'hum') {
    const { draft, loras } = music.musicDraftForEngine(await music.prepareMusicDraft(prompt, { musicKind }), status, musicKind);
    submitted = { kind: 'hum', ...music.defaultMusicOptions(status), loras, params: {
      ...draft, upload_id: 'recorded-melody', melody: 'continue', adapter: null,
      hum_influence: 1, offset_s: 0, seed: null,
    } };
  } else await music.generateFromPrompt(prompt, { musicKind });
  results[`${source}-${musicKind}`] = submitted;
}
process.stdout.write(JSON.stringify(results));
"""
    result = subprocess.run([node, "--input-type=module", "-e", script], cwd=FRONTEND,
                            check=True, capture_output=True, text=True, timeout=30)
    return json.loads(result.stdout)


@pytest.mark.parametrize("source", ["sentence", "hum", "image"])
@pytest.mark.parametrize("music_kind", ["vocal", "instrumental"])
def test_frontend_music_kind_survives_storage_and_engine_request(tmp_path, frontend_payloads,
                                                               source, music_kind):
    from yue2.protocol import SongRequest

    body = frontend_payloads[f"{source}-{music_kind}"]
    store = jobs.JobStore(tmp_path / "app.db", tmp_path / "songs")
    try:
        job = jobs.submit(store, body,
                          upload_lookup=lambda uid: {"filename": "melody.webm"} if uid == "recorded-melody" else None,
                          lora_lookup=lambda name: name in INSTRUMENTAL_LORAS).jobs[0]
        saved = store.get(job.id)
        request = SongRequest(**jobs.engine_request(saved))
        options = saved.options()
        assert (options.precision, options.ode_steps) == ("4bit", 8)
        if music_kind == "instrumental":
            assert request.lyrics == "[Intro]"
            assert tuple(name for name, scale in options.loras) == INSTRUMENTAL_LORAS
            assert all(scale == 1 for name, scale in options.loras)
        else:
            assert "微风吹过青草地" in request.lyrics and "阳光落在你眼底" in request.lyrics
            assert options.loras == ()
            assert "人声演唱" in request.style and "纯音乐" not in request.style
        if source == "hum":
            assert saved.kind == "hum" and saved.params["upload_id"] == "recorded-melody"
            assert request.cot == ("full" if music_kind == "instrumental" else "melody")
            hum = jobs.hum_options(saved)
            assert hum.melody == "continue" and hum.influence == 1 and hum.adapter is None
        else:
            assert saved.kind == "create" and request.cot == "full"
    finally:
        store.close()


@pytest.mark.parametrize("music_kind", ["vocal", "instrumental"])
def test_actual_hum_engine_preserves_planning_mode_and_recorded_score(tmp_path, monkeypatch,
                                                                    frontend_payloads, music_kind):
    from types import SimpleNamespace

    pytest.importorskip("mlx.core")
    pytest.importorskip("lyra.pipeline")
    from yue2.protocol import SongRequest
    from yue2_studio import config, hum
    from yue2_studio.engine import Engine

    body = frontend_payloads[f"hum-{music_kind}"]
    expected_cot = "full" if music_kind == "instrumental" else "melody"
    stack = tuple((item["name"], item["scale"]) for item in body["loras"])
    options = config.resolve_preset("custom", "4bit", 8, loras=stack)
    captured = {}
    open_score = "X:1\nK:C\nV: Vocal\nC D E |\n"

    def transcribe(pipe, audio_path, transcription_dir, task, cancelled):
        captured["transcription"] = (audio_path, task)
        transcription_dir.mkdir(parents=True)
        (transcription_dir / "score.abc").write_text(open_score + "V: Vocal\nZ4|\n")
        return {"source_audio_sha256": "recorded-audio", "duration_seconds": 12}, 1

    def continuation(request, score, **kwargs):
        captured["planned"] = (request.cot, request.lyrics, score)

    pipe = SimpleNamespace(
        guarded_cancelled=lambda cancelled: cancelled or (lambda: False),
        set_loras=lambda loras, **kwargs: captured.update(loras=loras),
        release_models=lambda: None,
        log=lambda message: None,
        plan_continuation=continuation,
    )
    engine = Engine(pipeline_factory=lambda *args, **kwargs: pipe)
    monkeypatch.setattr(engine, "resolve_loras", lambda loras: list(loras))
    monkeypatch.setattr(engine, "_transcribe", transcribe)

    def run_create(pipe, fields, generation, abc_sampling, semantic_sampling, out_dir,
                   *, planner, abc_prefix, **kwargs):
        assert fields["cot"] == expected_cot
        assert abc_prefix == open_score
        planner(pipe, SongRequest(**fields), None, None, None)
        return {"truncated": None, "timing": {"e2e_seconds": 1}}

    monkeypatch.setattr(engine, "_run_create", run_create)
    recording = tmp_path / "recorded.webm"
    recording.write_bytes(b"uploaded audio boundary")
    summary = engine.hum_song(
        recording, tmp_path / "result", options=options, hum=hum.HumOptions(),
        request={"style": body["params"]["style"], "lyrics": body["params"]["lyrics"],
                 "cot": "melody", "seed": 1},
    )
    assert captured["transcription"] == (recording, "melody-vocal")
    assert captured["planned"] == (expected_cot, body["params"]["lyrics"], open_score)
    assert captured["loras"] == list(stack)
    assert summary["hum"]["melody"] == "continue"
    assert summary["hum"]["hum_abc"] == "hum/hum.abc"


def test_hum_full_planning_requires_active_paired_adapters_and_section_only_lyrics():
    from yue2_studio.hum import planning_mode

    pair = tuple((name, 1) for name in INSTRUMENTAL_LORAS)
    assert planning_mode("[Intro]", pair) == "full"
    assert planning_mode("[intro]\n[verse]\n[chorus]", pair) == "full"
    assert planning_mode("[Verse]\n真正唱出的歌词", pair) == "melody"
    assert planning_mode("[Intro]", pair[:1]) == "melody"
    assert planning_mode("[Intro]", ((pair[0][0], 0), pair[1])) == "melody"
