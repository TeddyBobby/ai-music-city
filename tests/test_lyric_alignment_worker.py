"""Audio evidence controls timing, never the relative lengths of lyric lines."""
from yue2_studio.lyric_alignment_worker import align_transcript, lyric_lines


def transcript(*segments):
    return {"transcription": [{"tokens": [
        {"text": c, "id": 100 + i, "t_dtw": round((at + i * 0.4) * 100),
         "offsets": {"to": round((at + (i + 1) * 0.4) * 1000)}}
        for i, c in enumerate(text)
    ]} for at, text in segments]}


def test_audio_onset_includes_instrumental_intro_and_gap():
    result = align_transcript("[verse]\n夜空里有星星\n[chorus]\n一起去看海", transcript(
        (22, "夜空裡有星星"), (45, "一起去看海")), 90)
    assert result["matched_lines"] == 2
    assert result["lines"][0]["at"] == 22
    assert result["lines"][0]["end"] == 24.4
    assert result["lines"][1]["at"] == 45
    assert result["lines"][0]["section"] == "主歌"


def test_repeated_chorus_keeps_distinct_performance_times():
    lyrics = "一起去看海\n月亮慢慢升起\n一起去看海"
    result = align_transcript(lyrics, transcript(
        (12, "一起去看海"), (35, "月亮慢慢升起"), (64, "一起去看海")), 100)
    assert [line["at"] for line in result["lines"]] == [12, 35, 64]


def test_missing_lyrics_and_instrumental_hallucinations_are_not_timed():
    result = align_transcript("夜空里有星星\n鲜花盛开迎接白昼\n一起去看海", transcript(
        (0, "Zither Harp"), (22, "夜空里有星星"), (60, "一起去看海")), 100)
    assert [line["at"] for line in result["lines"]] == [22, None, 60]
    assert result["matched_lines"] == 2


def test_homophones_and_traditional_chinese_keep_original_display_text():
    result = align_transcript("灯还没亮 我们自己发光", transcript(
        (38, "等還沒亮我們自己發狂")), 80)
    assert result["matched_lines"] == 1
    assert result["lines"][0]["text"] == "灯还没亮 我们自己发光"
    assert result["lines"][0]["at"] == 38


def test_without_audio_timestamps_nothing_is_fabricated():
    result = align_transcript("夜空里有星星", {"transcription": [{
        "text": "夜空里有星星", "offsets": {"from": 20000, "to": 25000},
        "tokens": [{"text": "夜空里有星星", "id": 100, "t_dtw": -1}],
    }]}, 90)
    assert result["status"] == "failed"
    assert result["lines"][0]["at"] is None


def test_dtw_intro_outlier_uses_in_segment_audio_token_boundary():
    data = transcript((20, "夜空里有星星"))
    segment = data["transcription"][0]
    segment["offsets"] = {"from": 20000, "to": 25000}
    segment["tokens"][0].update(t_dtw=1500, offsets={"from": 20050, "to": 20400})
    result = align_transcript("夜空里有星星", data, 90)
    assert result["lines"][0]["at"] == 20.05


def test_short_or_unrelated_text_is_not_claimed_as_alignment():
    result = align_transcript("夜空里有星星", transcript((10, "阳光照耀大地")), 100)
    assert result["matched_lines"] == 0
    assert result["status"] == "failed"


def test_lrc_metadata_and_sections_are_not_sung():
    assert lyric_lines("[ti:歌名]\n[verse 2]\n[00:12.30]夜空里有星星\n[instrumental]") == [
        {"text": "夜空里有星星", "section": "主歌 2", "at": None},
    ]
