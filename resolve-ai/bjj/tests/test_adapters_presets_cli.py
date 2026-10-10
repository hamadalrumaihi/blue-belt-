from __future__ import annotations

import json
import os
from pathlib import Path

from bjj_pipeline import adapters, presets, resolve_bridge
from bjj_pipeline.cli import main
from bjj_pipeline.export import write_edl


def test_hypecut_sidecar_to_events(tmp_path: Path):
    sidecar = tmp_path / "x.hypecut.json"
    sidecar.write_text(json.dumps({
        "source": "/footage/match.MP4",
        "segments": [
            {"start": 3.1, "end": 18.2, "score": 0.93, "reasons": {"crowd_roar": 2.7, "audio_rms": 4.0, "motion": 0.86},
             "meta": {"peak_time": 10.0, "rank": 1}},
            {"start": 40.0, "end": 44.0, "score": 0.4, "reasons": {"motion": 2.1}, "meta": {}},
        ]}))
    evs = adapters.hypecut_events(sidecar)
    assert len(evs) == 2 and evs[0].clip == "match.MP4"
    assert evs[0].source == "hypecut" and evs[0].kind == adapters.HYPECUT_KIND
    assert evs[0].confidence <= 0.70 and evs[0].needs_review
    assert "crowd_reaction" in evs[0].suggested_labels
    assert evs[1].suggested_labels[0] == "intense_exchange"
    assert evs[0].extra["peak_time"] == 10.0


def test_video_ad_editor_plan_and_srt(tmp_path: Path, footage: Path):
    work = tmp_path / "work"
    work.mkdir()
    (work / "cut.json").write_text(json.dumps({"keep": [[0.5, 3.0], [5.0, 7.5]], "total": 5.0, "src_dur": 20.0}))
    (work / "caps.json").write_text(json.dumps({"total": 5.0, "cards": [
        {"s": 0.0, "e": 2.4, "w": [{"t": "Oss", "s": 0.0, "e": 0.5}, {"t": "everyone", "s": 0.6, "e": 2.4}]}]}))
    plan = adapters.video_ad_editor_plan(work, footage / "action_60p.MP4")
    assert len(plan.cuts) == 2 and plan.timeline_fps == "60/1"
    edl = write_edl(plan, tmp_path / "vae.edl").read_text()
    assert "00:00:00:30 00:00:03:00 00:00:00:00 00:00:02:30" in edl
    srt = adapters.video_ad_editor_srt(work, tmp_path / "c.srt").read_text()
    assert srt.startswith("1\n00:00:00,000 --> 00:00:02,400\nOss everyone")


def test_presets_follow_timeline_fps():
    p = presets.preset("instagram_reel").for_timeline("30000/1001", "C:/out", "reel")
    assert p["settings"]["FrameRate"] == "29.97"
    assert (p["settings"]["FormatWidth"], p["settings"]["FormatHeight"]) == (1080, 1920)
    assert p["settings"]["CustomName"] == "reel_reel"
    m = presets.preset("master").for_timeline("25", "/out", "x")
    assert m["codec"] == "DNxHR HQX" and m["settings"]["AudioCodec"] == "lpcm" and m["settings"]["VideoQuality"] == 0
    assert {d["key"] for d in presets.describe_all()} == {"instagram_reel", "instagram_story", "youtube", "master"}


def test_resolve_status_is_graceful_without_resolve(monkeypatch):
    monkeypatch.setenv("RESOLVE_SCRIPT_LIB", "/nonexistent/fusionscript.so")
    st = resolve_bridge.status()
    assert not st.connected and "not found" in (st.error or "")
    assert st.hints


def test_resolve_build_dry_run_without_resolve_reports_hints(monkeypatch, footage: Path):
    from bjj_pipeline.plan import Cut, EditPlan
    monkeypatch.setenv("RESOLVE_SCRIPT_LIB", "/nonexistent/fusionscript.so")
    plan = EditPlan(name="x", template="cinematic", timeline_fps="30/1", target_min_s=15, target_max_s=30,
                    cuts=[Cut(order=1, clip="action_60p.MP4", clip_path=str(footage / "action_60p.MP4"), src_in=1, src_out=3)])
    res = resolve_bridge.build_timeline(plan, project_name="never-overwrite", dry_run=True)
    assert not res.ok and res.error and res.manual_steps


def test_native_ai_inventory_without_resolve(monkeypatch):
    monkeypatch.setenv("RESOLVE_SCRIPT_LIB", "/nonexistent/fusionscript.so")
    inv = resolve_bridge.native_ai_inventory()
    assert inv["status"]["connected"] is False and "features" not in inv


def test_cli_end_to_end(footage: Path, tmp_path: Path, capsys):
    out = tmp_path / "an"
    assert main(["analyze", str(footage), "--out", str(out)]) == 0
    assert (out / "analysis.json").exists() and (out / "review.csv").exists() and (out / "report.md").exists()
    assert main(["rank", "--analysis", str(out)]) == 0
    assert main(["plan", "--analysis", str(out), "--template", "high_energy", "--name", "E2E", "--include-flagged"]) == 0
    res = json.loads(capsys.readouterr().out.rsplit("{", 1)[-1].join(["{", ""]))
    assert res["cuts"] >= 1 and Path(res["edl"]).exists()
    assert main(["subclips", "--plan", str(out / "plans" / "E2E.plan.json"), "--out", str(tmp_path / "sel")]) == 0
    assert list((tmp_path / "sel").glob("*.mp4"))
    assert main(["issues", "--analysis", str(out)]) == 0
    assert main(["color", "--analysis", str(out)]) == 0
    assert main(["presets", "--list"]) == 0
    assert main(["doctor", "--no-resolve"]) == 0
    assert main(["adapters", "hypecut-markers", str(out / "analysis.json"), "--out", str(tmp_path / "m.csv"),
                 "--source", str(footage / "action_60p.MP4")]) == 0  # analysis.json has no segments -> 0 events, still ok


def test_cli_rejects_unknown_template():
    assert main(["plan", "--analysis", "/nowhere", "--template", "cinematic", "--name", "x"]) == 1
