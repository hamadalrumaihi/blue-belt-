"""End-to-end: organize -> analyze -> rank -> plan -> export, on synthetic clips."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from bjj_pipeline.analyze import HeuristicDetector, analyze_clip
from bjj_pipeline.export import (apply_review, read_review_csv, write_cutlist_csv, write_edl, write_markers_csv,
                                 write_review_csv)
from bjj_pipeline.organize import OrganizeOptions, organize
from bjj_pipeline.plan import TEMPLATES, build_plan, estimate_beat_interval
from bjj_pipeline.quality import load_weights, rank


@pytest.fixture(scope="module")
def analyses(footage: Path):
    det = [HeuristicDetector()]
    return [analyze_clip(footage / n, det) for n in ("action_60p.MP4", "shaky_25p.MP4", "walkout_30p.MP4")]


def test_organize_copies_without_touching_originals(footage: Path, tmp_path: Path, music: Path):
    lib = tmp_path / "Library"
    before = {p.name: p.stat().st_size for p in footage.glob("*.MP4")}
    m = organize(footage, OrganizeOptions(library=lib, tournament="Test Open", date="2026-10-10", athlete="A B",
                                          match="Final", camera="CAM-A", mode="copy", music=music.parent))
    assert len(m.clips) == 3 and not m.skipped
    after = {p.name: p.stat().st_size for p in footage.glob("*.MP4")}
    assert before == after  # originals untouched
    dest = lib / "2026-10-10_Test_Open" / "A_B" / "Final" / "CAM-A" / "01_Original"
    assert sorted(p.name for p in dest.iterdir()) == sorted(before)
    assert (lib / "2026-10-10_Test_Open" / "_music" / music.name).exists()
    assert list((lib / "2026-10-10_Test_Open" / "_analysis").glob("import-manifest_*.json"))
    # second run is idempotent (same sizes -> skip, no error)
    m2 = organize(footage, OrganizeOptions(library=lib, tournament="Test Open", date="2026-10-10", athlete="A B",
                                           match="Final", camera="CAM-A", mode="copy"))
    assert len(m2.clips) == 3


def test_organize_refuses_to_overwrite_different_file(footage: Path, tmp_path: Path):
    lib = tmp_path / "Library"
    opts = OrganizeOptions(library=lib, tournament="T", date="2026-01-01", mode="copy")
    organize(footage / "walkout_30p.MP4", opts)
    dest = lib / "2026-01-01_T" / "_unassigned" / "_unassigned" / "CAM-A" / "01_Original" / "walkout_30p.MP4"
    dest.write_bytes(b"different")
    with pytest.raises(FileExistsError):
        organize(footage / "walkout_30p.MP4", opts)
    assert dest.read_bytes() == b"different"


def test_organize_rejects_bad_date(footage: Path, tmp_path: Path):
    with pytest.raises(ValueError):
        organize(footage, OrganizeOptions(library=tmp_path, tournament="T", date="10/10/2026"))


def test_heuristics_find_action_then_reaction(analyses):
    action = analyses[0]
    kinds = [e.kind for e in action.events]
    peaks = [e for e in action.events if e.kind == "action_peak"]
    assert peaks, kinds
    # box moves 8-12 s; events are padded by 1.5 s on each side
    assert any(6.0 <= p.start <= 9.5 and 11.0 <= p.end <= 15.0 for p in peaks), [(p.start, p.end) for p in peaks]
    reactions = [e for e in action.events if e.kind in ("celebration_candidate", "crowd_reaction")]
    assert reactions and any(11.0 <= r.start <= 13.0 for r in reactions)
    assert any(r.kind == "celebration_candidate" for r in reactions), "audio spike right after action should be a celebration candidate"
    for e in action.events:
        assert 0 <= e.confidence <= 0.70  # heuristic ceiling
        assert e.needs_review or e.kind == "scene_cut"
        assert set(e.suggested_labels) & {"takedown", "sweep", "submission", "intense_exchange", "celebration",
                                          "crowd_reaction", "coach_reaction", "walkout", "b_roll", "referee_call", "scramble",
                                          "guard_pass", "stalling", "podium", "warmup"}


def test_walkout_is_low_activity(analyses):
    w = analyses[2]
    assert any(e.kind == "low_activity" for e in w.events)
    assert not any(e.kind == "action_peak" for e in w.events)


def test_shaky_clip_scores_low_stability(analyses):
    ranked = rank(analyses, load_weights(None))
    shaky = [r for r in ranked if r.clip == "shaky_25p.MP4"]
    steady = [r for r in ranked if r.clip in ("action_60p.MP4", "walkout_30p.MP4")]
    assert shaky and steady
    assert max(s.scores.stability for s in shaky) < min(s.scores.stability for s in steady)
    assert analyses[1].summary["shake_p90_px"] > max(analyses[0].summary["shake_p90_px"], analyses[2].summary["shake_p90_px"])


def test_rank_never_discards(analyses):
    ranked = rank(analyses, load_weights(None))
    clips = {r.clip for r in ranked}
    assert clips == {"action_60p.MP4", "shaky_25p.MP4", "walkout_30p.MP4"}
    assert all(0 <= r.scores.total <= 100 for r in ranked)
    assert ranked == sorted(ranked, key=lambda r: r.scores.total, reverse=True)


def test_review_roundtrip(analyses, tmp_path: Path):
    ranked = rank(analyses, load_weights(None))
    csv_path = write_review_csv(ranked, tmp_path / "review.csv")
    rows = csv_path.read_text(encoding="utf-8").splitlines()
    assert rows[0].startswith("rank,clip,start_s")
    # editor drops the first, labels the second as takedown with top narrative weight
    lines = rows[1].split(",")
    lines[-4:] = ["", "no", "", ""]
    rows[1] = ",".join(lines)
    l2 = rows[2].split(",")
    l2[-4:] = ["takedown", "yes", "5", "great"]
    rows[2] = ",".join(l2)
    csv_path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    kept = apply_review(ranked, read_review_csv(csv_path))
    assert len(kept) == len(ranked) - 1
    labelled = [k for k in kept if k.labels[0] == "takedown"]
    assert labelled and labelled[0].scores.narrative_importance == 95 and not labelled[0].needs_review


@pytest.mark.parametrize("template", sorted(TEMPLATES))
def test_plans_respect_targets_and_frame_rates(analyses, template: str, tmp_path: Path, music: Path):
    ranked = rank(analyses, load_weights(None))
    plan = build_plan(template, ranked, "30", name=f"t_{template}", include_flagged=True,
                      music=music if template == "high_energy" else None,
                      athletes=["action", "walkout"] if template == "club_recap" else None)
    lo, hi = TEMPLATES[template]["target"]
    assert plan.cuts, plan.notes
    assert plan.total_duration <= hi + TEMPLATES[template]["max_cut"] * 2
    for c in plan.cuts:
        assert 0 <= c.src_in < c.src_out
        if c.speed < 1.0:
            # slow motion only from the 60p clip on a 30p timeline, never slower than 25 %
            assert c.clip == "action_60p.MP4" and c.speed >= 0.25
        if c.clip in ("shaky_25p.MP4", "walkout_30p.MP4"):
            assert c.speed == 1.0 and ("no clean slow motion" in c.speed_note or c.speed_note == "")
    assert plan.cuts[0].transition_in == "cut"
    if template == "high_energy":
        assert plan.beat_interval_s and 0.4 <= plan.beat_interval_s <= 0.6  # ~120 BPM track
    if template == "cinematic":
        assert plan.cuts[0].role == "opening" and plan.cuts[0].title == "t_cinematic"
    edl = write_edl(plan, tmp_path / f"{template}.edl", {an.media.filename: an.media for an in analyses})
    text = edl.read_text()
    assert text.startswith(f"TITLE: t_{template}\nFCM: NON-DROP FRAME")
    assert text.count("* FROM CLIP NAME:") == len(plan.cuts)
    if any(c.speed != 1.0 for c in plan.cuts):
        assert "M2   AX" in text
    csv_path = write_cutlist_csv(plan, tmp_path / f"{template}.csv")
    assert csv_path.read_text().count("\n") == len(plan.cuts) + 1


def test_edl_record_timecodes_are_contiguous(analyses, tmp_path: Path):
    ranked = rank(analyses, load_weights(None))
    plan = build_plan("full_highlights", ranked, "30", name="contig", include_flagged=True)
    text = write_edl(plan, tmp_path / "c.edl").read_text().splitlines()
    events = [l for l in text if l[:3].isdigit() and "  AX" in l]
    prev_out = "00:00:00:00"
    for ev in events:
        parts = ev.split()
        rec_in, rec_out = parts[-2], parts[-1]
        assert rec_in == prev_out
        prev_out = rec_out
    assert prev_out != "00:00:00:00"


def test_markers_csv(analyses, tmp_path: Path):
    p = write_markers_csv(analyses, tmp_path / "markers.csv")
    rows = p.read_text().splitlines()
    assert rows[0].startswith("clip,clip_path,start_s,end_s,start_frame,duration_frames,kind,color")
    assert len(rows) - 1 == sum(len(a.events) for a in analyses)


def test_beat_estimate(music: Path):
    b = estimate_beat_interval(music)
    assert b is not None and 0.4 <= b <= 0.6
