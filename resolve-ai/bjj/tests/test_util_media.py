from fractions import Fraction
from pathlib import Path

from bjj_pipeline.media import dominant_fps, probe
from bjj_pipeline.util import frames_to_tc, is_drop_frame, parse_fps, safe_name, seconds_to_frames


def test_parse_fps_variants():
    assert parse_fps("30000/1001") == Fraction(30000, 1001)
    assert parse_fps("25/1") == Fraction(25)
    assert parse_fps(29.97) == Fraction(30000, 1001)
    assert parse_fps("60") == Fraction(60)


def test_drop_frame_detection():
    assert is_drop_frame(Fraction(30000, 1001))
    assert is_drop_frame(Fraction(60000, 1001))
    assert not is_drop_frame(Fraction(24000, 1001))
    assert not is_drop_frame(Fraction(25))


def test_timecode_ndf_and_df():
    assert frames_to_tc(0, Fraction(25)) == "00:00:00:00"
    assert frames_to_tc(25 * 61 + 3, Fraction(25)) == "00:01:01:03"
    assert frames_to_tc(519, Fraction(60)) == "00:00:08:39"
    # drop frame: frame 1800 at 29.97 is 00:01:00;02 (frames 0 and 1 dropped each minute)
    assert frames_to_tc(1800, Fraction(30000, 1001)) == "00:01:00;02"
    assert frames_to_tc(17982, Fraction(30000, 1001)) == "00:10:00;00"


def test_seconds_to_frames_rounds():
    assert seconds_to_frames(2.5, Fraction(25)) == 62  # 62.5 -> banker's rounding gives 62
    assert seconds_to_frames(8.65, Fraction(60)) == 519


def test_safe_name():
    assert safe_name("Qatar Open / Final: GI") == "Qatar_Open___Final__GI"
    assert safe_name("") == "untitled"


def test_probe_reads_true_frame_rates(footage: Path):
    a = probe(footage / "action_60p.MP4")
    s = probe(footage / "shaky_25p.MP4")
    w = probe(footage / "walkout_30p.MP4")
    assert a.fps == "60/1" and a.is_high_frame_rate and a.has_audio
    assert s.fps == "25/1" and not s.is_high_frame_rate
    assert w.fps == "30/1"
    assert a.width == 640 and a.height == 360 and not a.is_vertical
    assert abs(a.duration - 20.0) < 0.2
    assert a.max_clean_slowmo_factor(30) == 2.0
    assert s.max_clean_slowmo_factor(25) == 1.0


def test_dominant_fps_prefers_base_rate_for_hfr(footage: Path):
    infos = [probe(footage / "action_60p.MP4")] * 3 + [probe(footage / "shaky_25p.MP4")]
    assert dominant_fps(infos) == Fraction(30)
    assert dominant_fps([probe(footage / "shaky_25p.MP4")]) == Fraction(25)
