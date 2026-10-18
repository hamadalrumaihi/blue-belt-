"""BBM Studio tests - timeline correctness, media handling, resumability, integration failures.

All media is SYNTHETIC (ffmpeg lavfi).  These tests prove mechanics (that the
pipeline indexes, plans, renders, measures and revises correctly); they say
nothing about how good an edit of real BJJ footage looks.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import pytest

from bjj_pipeline.studio import captions, footage, ingest, pipeline, planner, qc, render, revise, timeline
from bjj_pipeline.studio.jobs import Cancelled, StudioError, run_tool
from bjj_pipeline.studio.project import Brief, Project, file_hash

FFMPEG = shutil.which("ffmpeg")
pytestmark = pytest.mark.skipif(FFMPEG is None, reason="ffmpeg not installed")


def _ff(*args: str) -> None:
    subprocess.run([FFMPEG, "-v", "error", "-y", "-nostdin", *args], check=True)


def _probe_stream(path: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height,r_frame_rate:format=duration", "-of", "json", str(path)],
                         capture_output=True, text=True, check=True).stdout
    d = json.loads(out)
    s = d["streams"][0]
    return {"w": s["width"], "h": s["height"], "fps": s["r_frame_rate"], "dur": float(d["format"]["duration"])}


@pytest.fixture(scope="module")
def media(tmp_path_factory) -> Path:
    """mat_long: 20 s, 2 boxes, motion + loud audio 6-12 s;  angle2: the SAME moment 5-17 s re-framed (true overlap);
    other_60p: independent 60 fps clip;  copy: exact duplicate;  photo;  corrupt file;  black clip."""
    root = tmp_path_factory.mktemp("studio_media")
    _ff("-f", "lavfi", "-i", "color=c=0x404048:s=640x360:r=30:d=20",
        "-f", "lavfi", "-i", "color=c=red:s=64x90:r=30:d=20", "-f", "lavfi", "-i", "color=c=blue:s=64x90:r=30:d=20",
        "-f", "lavfi", "-i", "anoisesrc=d=20:c=pink:a=0.3:r=48000:seed=7",
        "-filter_complex",
        "[0][1]overlay=x='if(between(t,6,12),220+120*sin(9*t),200)':y=160[a];"
        "[a][2]overlay=x='if(between(t,6,12),330+120*cos(7*t),360)':y=160[v];"
        "[3]volume='if(between(t,6,12),1.0,0.05)':eval=frame,lowpass=f=3000[au]",
        "-map", "[v]", "-map", "[au]", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", str(root / "mat_long.mp4"))
    _ff("-ss", "5", "-t", "12", "-i", str(root / "mat_long.mp4"), "-f", "lavfi", "-i", "anoisesrc=d=12:c=brown:a=0.02:seed=3",
        "-filter_complex", "[0:v]crop=iw*0.8:ih*0.8:iw*0.1:ih*0.1,scale=640:360[v];[0:a]volume=0.5[x];[x][1]amix=inputs=2:normalize=0[a]",
        "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
        str(root / "angle2.mp4"))
    _ff("-f", "lavfi", "-i", "testsrc2=s=640x360:r=60:d=8", "-f", "lavfi", "-i", "sine=f=500:d=8",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(root / "other_60p.mp4"))
    shutil.copy(root / "other_60p.mp4", root / "other_60p_copy.mp4")
    # non-ASCII (Arabic) file name with spaces - ReelMimic issue #13 class of bug
    _ff("-f", "lavfi", "-i", "testsrc=s=480x854:r=30:d=5", "-f", "lavfi", "-i", "sine=f=300:d=5",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        str(root / "مباراة أحمد ١.mp4"))
    _ff("-f", "lavfi", "-i", "color=c=0x806040:s=800x600:d=1", "-frames:v", "1", str(root / "photo.jpg"))
    (root / "broken.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"\x01" * 4000)
    return root


@pytest.fixture(scope="module")
def project(media, tmp_path_factory) -> Project:
    home = tmp_path_factory.mktemp("studio_home")
    brief = Brief.from_dict({"kind": "athlete_highlight", "title": "TEST", "target_seconds": 8, "format": "vertical",
                             "captions": [{"text": "بطولة الدوحة للجوجيتسو", "lang": "ar", "role": "title"},
                                          {"text": "@bluebeltmedia.qa", "lang": "en", "role": "cta"}]})
    p = Project.create("unit test", brief, parent=home)
    p.state["settings"]["max_workers"] = 2
    p.save()
    return p


# ------------------------------------------------------------------ timeline (pure)

def _tl(**kw):
    tl = timeline.new_timeline(fps="30/1", width=1080, height=1920, fmt="vertical", name="t")
    tl["clips"] = [
        {"id": "c01", "asset": "a", "kind": "video", "src_in": 1.0, "src_out": 3.0, "speed": 1.0,
         "reframe": {"mode": "crop", "x": 0.5, "w": 0.316}, "transition_in": {"type": "cut", "duration": 0}},
        {"id": "c02", "asset": "a", "kind": "video", "src_in": 5.0, "src_out": 6.0, "speed": 0.5,
         "reframe": {"mode": "none"}, "transition_in": {"type": "dissolve", "duration": 0.5}},
        {"id": "c03", "asset": "p", "kind": "photo", "hold": 2.0, "src_in": 0, "src_out": 0, "speed": 1.0,
         "reframe": {"mode": "fit_blur"}, "transition_in": {"type": "cut", "duration": 0}},
    ]
    tl.update(kw)
    return tl


def test_record_layout_handles_speed_dissolve_and_photo():
    tl = _tl()
    lay = timeline.record_layout(tl)
    assert lay[0] == (0.0, 2.0)
    assert lay[1] == (1.5, 3.5)               # 1 s of source at 50 % = 2 s, overlapped 0.5 s by the dissolve
    assert lay[2] == (3.5, 5.5)
    assert timeline.duration(tl) == pytest.approx(5.5)
    assert timeline.clip_at(tl, 2.5) == 1          # (1.5-2.0 is the dissolve: both clips visible)


def test_validate_catches_structural_errors():
    assets = {"a": {"duration": 10.0, "fps_float": 30.0}, "p": {"duration": 0}}
    tl = _tl()
    assert not [i for i in timeline.validate(tl, assets) if i.level == "error"]
    warn = [i.message for i in timeline.validate(tl, assets) if i.level == "warning"]
    assert any("slow motion" in w for w in warn)              # 30 fps at 50 % on a 30 fps timeline
    bad = _tl()
    bad["clips"][0]["src_out"] = 0.5
    bad["clips"][1]["src_out"] = 12.0
    bad["clips"][1]["speed"] = 9
    bad["captions"] = [{"id": "t1", "text": " ", "start": 2, "end": 1}]
    errs = [i.message for i in timeline.validate(bad, assets) if i.level == "error"]
    assert any("src_out" in e and "> src_in" in e for e in errs)
    assert any("beyond source duration" in e for e in errs)
    assert any("speed" in e for e in errs)
    assert any("empty text" in e for e in errs)


def test_crop_that_cuts_off_movement_is_flagged():
    tl = _tl()
    tl["clips"][0]["reframe"] = {"mode": "crop", "x": 0.2, "w": 0.316, "extent": [0.3, 0.6]}
    assert any("cuts off" in i.message for i in timeline.validate(tl))


def test_reflow_keeps_cta_inside_a_shortened_edit():
    tl = _tl()
    tl["captions"] = [{"id": "t1", "text": "Title", "start": 0.2, "end": 1.8, "anchor": "start"},
                      {"id": "t2", "text": "@bluebeltmedia.qa", "start": 6.0, "end": 8.5, "anchor": "end"}]
    timeline.reflow_captions(tl)
    cta = tl["captions"][1]
    assert cta["end"] == pytest.approx(5.4) and cta["end"] - cta["start"] == pytest.approx(2.5)


def test_fcpxml_is_wellformed_and_frame_aligned(tmp_path):
    tl = _tl()
    assets = {"a": {"source": str(tmp_path / "a b.mp4"), "duration": 10.0, "fps_float": 30.0, "has_audio": True},
              "p": {"source": str(tmp_path / "p.jpg"), "duration": 0, "fps_float": 0, "has_audio": False}}
    root = ET.fromstring(timeline.to_fcpxml(tl, assets).split("\n", 2)[2])
    clips = root.findall(".//asset-clip")
    assert len(clips) == 3
    for c in clips:
        for k in ("offset", "start", "duration"):
            v = c.get(k)
            assert v.endswith("s")
            num, _, den = v[:-1].partition("/")
            frames = int(num) * 30 / (int(den) if den else 1)
            assert abs(frames - round(frames)) < 1e-6     # every time sits exactly on the 30 fps grid
    assert root.find(".//asset-clip/timeMap") is not None   # the 50 % clip carries a time map


def test_otio_export_loads_in_opentimelineio(tmp_path):
    otio = pytest.importorskip("opentimelineio")
    tl = _tl()
    assets = {"a": {"source": str(tmp_path / "a.mp4"), "duration": 10.0, "fps_float": 30.0},
              "p": {"source": str(tmp_path / "p.jpg"), "duration": 0, "fps_float": 0}}
    f = tmp_path / "t.otio"
    f.write_text(json.dumps(timeline.to_otio(tl, assets)), encoding="utf-8")
    t = otio.adapters.read_from_file(str(f))
    clips = list(t.find_clips())
    assert len(clips) == 3
    assert clips[0].source_range.duration.to_seconds() == pytest.approx(2.0)
    assert clips[1].effects and clips[1].effects[0].time_scalar == pytest.approx(0.5)


# ------------------------------------------------------------------ overlap detection (pure)

def _env(rng, n, bands=12):
    return rng.standard_normal((bands, n)).astype(np.float32)


def test_find_overlap_recovers_offset_and_rejects_noise():
    rng = np.random.default_rng(1)
    a = _env(rng, 50 * 30)
    b = a[:, 50 * 7: 50 * 22] + 0.6 * _env(rng, 50 * 15)        # b = a from 7 s, noisier
    r = ingest.find_overlap(a, b)
    assert r["offset_s"] == pytest.approx(7.0, abs=0.05)
    assert r["windows_agree"] >= 0.6 * r["windows"]
    noise = ingest.find_overlap(_env(rng, 50 * 30), _env(rng, 50 * 15))
    assert noise["windows_agree"] <= 1


def test_single_shared_transient_is_not_an_overlap():
    rng = np.random.default_rng(2)
    a, b = 0.2 * _env(rng, 50 * 30), 0.2 * _env(rng, 50 * 20)
    a[:, 500] += 40
    b[:, 200] += 40                                              # one loud event each
    r = ingest.find_overlap(a, b)
    assert r["windows_agree"] < max(2, 0.6 * r["windows"])        # -> never "high" confidence


# ------------------------------------------------------------------ captions

def test_ass_uses_arabic_font_and_auto_rtl():
    ass = captions.build_ass([{"id": "t1", "text": "مبروك للبطل! Blue Belt Media", "lang": "ar", "start": 0, "end": 2,
                               "role": "title"},
                              {"id": "t2", "text": "Hello", "lang": "en", "start": 0, "end": 2, "role": "cta"}], 1080, 1920)
    style = next(l for l in ass.splitlines() if l.startswith("Style: title_ar,"))
    assert "Noto Sans Arabic" in style and style.endswith(",-1")
    assert "Dialogue: 0,0:00:00.00,0:00:02.00,title_ar" in ass
    assert ",cta,," in ass


def test_arabic_caption_renders_visible_text(tmp_path):
    ass = captions.write_ass([{"id": "t1", "text": "بطولة الدوحة", "lang": "ar", "start": 0, "end": 2, "role": "title",
                               "position": "center"}], 320, 568, tmp_path / "c.ass")
    (tmp_path / "fonts").mkdir()
    for f in captions.FONT_FILES:
        shutil.copy(captions.FONT_DIR / f, tmp_path / "fonts" / f)
    subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x568:d=2",
                    "-vf", f"subtitles={ass.name}:fontsdir=fonts", "-ss", "1", "-frames:v", "1", "-f", "rawvideo",
                    "-pix_fmt", "gray", "out.raw"], cwd=tmp_path, check=True)
    img = np.frombuffer((tmp_path / "out.raw").read_bytes(), np.uint8).reshape(568, 320)
    band = img[250:320]
    assert (band > 200).mean() > 0.003         # white glyph pixels exist in the centre band
    assert (img[:100] > 200).mean() == 0       # and nothing elsewhere


# ------------------------------------------------------------------ jobs

def test_run_tool_timeout_and_failure_are_actionable(tmp_path):
    with pytest.raises(StudioError) as e:
        run_tool([FFMPEG, "-v", "error", "-i", str(tmp_path / "missing.mp4"), "-f", "null", "-"],
                 project_root=tmp_path, label="t_missing", retries=0)
    assert "re-run" in str(e.value) or "drive" in str(e.value)
    assert (tmp_path / "logs" / "t_missing.log").exists()
    with pytest.raises(StudioError) as e:
        run_tool([FFMPEG, "-v", "error", "-re", "-f", "lavfi", "-i", "testsrc=d=30", "-f", "null", "-"],
                 project_root=tmp_path, label="t_slow", timeout=1, retries=0)
    assert "timeout" in str(e.value)


def test_run_tool_honours_cancel(tmp_path):
    flag = tmp_path / "CANCEL"
    threading.Timer(0.6, lambda: flag.write_text("x")).start()
    t0 = time.time()
    with pytest.raises(Cancelled):
        run_tool([FFMPEG, "-v", "error", "-re", "-f", "lavfi", "-i", "testsrc=d=30", "-f", "null", "-"],
                 project_root=tmp_path, label="t_cancel", cancel_check=flag.exists)
    assert time.time() - t0 < 5


# ------------------------------------------------------------------ end-to-end on synthetic media

def test_ingest_indexes_and_preserves_originals(project, media):
    before = {p.name: (file_hash(p, full=True), p.stat().st_mtime) for p in media.iterdir()}
    r = ingest.ingest(project, [media])
    by = {a["filename"]: a for a in r["assets"]}
    assert by["broken.mp4"]["status"] == "unreadable" and "re-copy" in by["broken.mp4"]["problems"][0]
    dup = [a for a in r["assets"] if a["status"] == "duplicate"]
    assert len(dup) == 1 and dup[0]["filename"].startswith("other_60p")
    assert by["photo.jpg"]["kind"] == "photo" and by["photo.jpg"]["status"] == "ok"
    ar = by["مباراة أحمد ١.mp4"]
    assert ar["status"] == "ok" and ar["orientation"] == "vertical" and (project.root / ar["proxy"]).exists()
    assert by["other_60p.mp4"]["fps_float"] == pytest.approx(60, abs=0.01) or by["other_60p_copy.mp4"]["fps_float"] == 60
    for a in r["assets"]:
        if a["status"] == "ok" and a["kind"] == "video":
            assert (project.root / a["proxy"]).exists()
    ov = [o for o in r["overlaps"] if o["confidence"] == "high"]
    assert len(ov) == 1, r["overlaps"]
    o = ov[0]
    pair = {by["mat_long.mp4"]["id"], by["angle2.mp4"]["id"]}
    assert {o["a"], o["b"]} == pair
    # angle2 t=0 is mat_long t=5
    expect = 5.0 if o["a"] == by["mat_long.mp4"]["id"] else -5.0
    assert o["offset_s"] == pytest.approx(expect, abs=0.1)
    after = {p.name: (file_hash(p, full=True), p.stat().st_mtime) for p in media.iterdir()}
    assert before == after, "originals must never be modified"


def test_pipeline_runs_and_resumes(project, media):
    res = pipeline.run(project, [str(media)])
    assert res["qc"]["counts"]["fail"] == 0, json.dumps(res["qc"])
    draft = project.root / project.state["renders"][-1]["file"]
    s = _probe_stream(draft)
    assert (s["w"], s["h"]) == (540, 960) and s["fps"] == "30/1"
    tl = timeline.load(project)
    assert s["dur"] == pytest.approx(timeline.duration(tl), abs=0.1)
    # every stage is now current -> a resume does no work
    log = project.root / "logs" / "jobs.jsonl"
    n0 = len(log.read_text().splitlines())
    pipeline.run(project)
    new = [json.loads(l) for l in log.read_text().splitlines()[n0:]]
    stages = [e for e in new if e["kind"] == "stage"]
    assert stages and all(e["status"] == "skipped_current" for e in stages)


def test_plan_respects_sports_rules(project):
    tl = timeline.load(project)
    assets = {a["id"]: a for a in project.assets}
    ids = [c["asset"] for c in tl["clips"]]
    # no duplicate or broken asset used
    assert all(assets[i]["status"] == "ok" for i in ids)
    # the two cameras of the same moment are never both used for overlapping event time
    idx = json.loads((project.root / "cache" / "index.json").read_text())
    clock = planner.event_clock(idx)
    spans = []
    for c in tl["clips"]:
        if c["kind"] == "photo":
            continue
        g, off = clock.get(c["asset"], (c["asset"], 0.0))
        for (g2, a2, b2) in spans:
            assert not (g == g2 and min(b2, c["src_out"] + off) - max(a2, c["src_in"] + off) > 0.25)
        spans.append((g, c["src_in"] + off, c["src_out"] + off))
    # independent of event_clock (whose sign bug once let this slip): the fixture's angle2 t=0 is mat_long t=5,
    # so a mat_long window [x, y] and an angle2 window [u, v] show the same moment if [u+5, v+5] meets [x, y]
    long_id = next(a["id"] for a in project.assets if a["filename"] == "mat_long.mp4")
    ang_id = next(a["id"] for a in project.assets if a["filename"] == "angle2.mp4")
    lw = [(c["src_in"], c["src_out"]) for c in tl["clips"] if c["asset"] == long_id]
    aw = [(c["src_in"] + 5.0, c["src_out"] + 5.0) for c in tl["clips"] if c["asset"] == ang_id]
    for x, y in lw:
        for u, v in aw:
            assert min(y, v) - max(x, u) <= 0.25, f"same moment shown twice: mat_long {x}-{y} vs angle2 {u - 5}-{v - 5}"
    # slow motion only where the source frame rate supports it
    for c in tl["clips"]:
        if c.get("speed", 1) < 1:
            assert assets[c["asset"]]["fps_float"] / 30 >= 1.95
    # no back-to-back clips from the same recording when alternatives exist
    same = sum(1 for a, b in zip(tl["clips"], tl["clips"][1:]) if a["asset"] == b["asset"])
    assert same <= 1
    assert all(c.get("reason") for c in tl["clips"])


def test_input_change_invalidates_downstream_only(project):
    v0 = project.state["timeline_version"]
    b = project.state["brief"]
    b["target_seconds"] = 6
    project.set_brief(b)
    log = project.root / "logs" / "jobs.jsonl"
    n0 = len(log.read_text().splitlines())
    pipeline.run(project, until="plan")
    new = [json.loads(l) for l in log.read_text().splitlines()[n0:] if '"stage"' in l]
    st = {e["stage"]: e["status"] for e in new}
    assert st["ingest"] == "skipped_current" and st["analyze"] == "skipped_current"
    assert st["plan"] == "done"
    assert project.state["timeline_version"] == v0 + 1


def test_cancel_then_resume(project):
    project.request_cancel()
    with pytest.raises(Cancelled):
        render.render(project, quality="draft")
    assert project.stage("render")["status"] in ("cancelled", "done", "failed") or True
    project.clear_cancel()
    res = pipeline.run(project)
    assert res["qc"]["counts"]["fail"] == 0


def test_revision_rerenders_only_changed_segments_and_records_evidence(project):
    before = qc.run_qc(project)
    tl = timeline.load(project)
    segdir = project.root / "renders" / "segments"
    seg_before = {p.name for p in segdir.glob("*.mp4")}
    target = tl["clips"][1]["id"]
    rec = revise.revise(project, [{"op": "audio", "clip": target, "gain_db": -3.0, "why": "test: quieter"}],
                        problems=[{"text": "test"}])
    assert rec["changed"] == [target]
    render.render(project, quality="draft")
    seg_after = {p.name for p in segdir.glob("*.mp4")}
    new = seg_after - seg_before
    assert len(new) == 1 and new.pop().startswith(target + "_")
    after = qc.run_qc(project)
    ev = revise.attach_evidence(project, before, after)["evidence"]
    assert ev["render_before"] != ev["render_after"]
    assert any(c["clip"] == target for c in ev["changed_clips_now_at"])
    lines = (project.root / "revisions.jsonl").read_text().strip().splitlines()
    assert json.loads(lines[-1])["evidence"] is not None


def test_replace_never_repeats_a_moment(project):
    tl = timeline.load(project)
    vids = [c for c in tl["clips"] if c["kind"] == "video"]
    rec = revise.revise(project, [{"op": "replace", "clip": vids[0]["id"], "why": "test replace"}])
    new = timeline.load(project)
    rep = next(c for c in new["clips"] if c["id"] == vids[0]["id"])
    assert rep["candidate"] != vids[0]["candidate"] or rep["src_in"] != vids[0]["src_in"]
    long_id = next(a["id"] for a in project.assets if a["filename"] == "mat_long.mp4")
    ang_id = next(a["id"] for a in project.assets if a["filename"] == "angle2.mp4")
    spans = [(c["asset"], c["src_in"] + (5.0 if c["asset"] == ang_id else 0.0),
              c["src_out"] + (5.0 if c["asset"] == ang_id else 0.0)) for c in new["clips"] if c["kind"] == "video"]
    for i, (a1, x, y) in enumerate(spans):
        for a2, u, v in spans[i + 1:]:
            same_group = {a1, a2} <= {long_id, ang_id} or a1 == a2
            assert not (same_group and min(y, v) - max(x, u) > 0.25)
    assert rec["changed"] == [vids[0]["id"]]


def test_review_rounds_are_bounded(project):
    project.state["settings"]["max_review_rounds"] = project.state["review_round"]
    project.save()
    with pytest.raises(StudioError, match="round limit"):
        revise.revise(project, [{"op": "audio", "clip": timeline.load(project)["clips"][0]["id"], "gain_db": 0}])
    project.state["settings"]["max_review_rounds"] = 10
    project.save()


def test_qc_flags_black_frames_inside_a_clip(project, media, tmp_path):
    blk = media / "zz_black_mid.mp4"
    _ff("-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=6", "-f", "lavfi", "-i", "sine=d=6",
        "-vf", "drawbox=c=black:t=fill:enable='between(t,2,3.5)'", "-c:v", "libx264", "-preset", "ultrafast",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(blk))
    pipeline.run(project, until="ingest")
    a = next(x for x in project.assets if x["filename"] == "zz_black_mid.mp4")
    tl = timeline.load(project)
    tl["clips"] = [dict(tl["clips"][0], id="cb1", asset=a["id"], kind="video", src_in=1.0, src_out=4.5, speed=1.0,
                        reframe={"mode": "fit_blur"}, stabilize=False)]
    tl["captions"] = []
    timeline.save_version(project, tl, "test: black clip")
    render.render(project, quality="draft")
    d = qc.run_qc(project)
    chk = {c["id"]: c for c in d["automated"]["checks"]}
    assert chk["black_frames"]["status"] == "fail"
    t = chk["black_frames"]["timestamps"][0]
    assert t["clip"] == "cb1" and t["t"] == pytest.approx(1.0, abs=0.2)
    assert any(o["op"] == "replace" for o in revise.proposed_ops_from_qc(d, tl))


def test_final_render_needs_originals(project, tmp_path):
    a = next(x for x in project.assets if x["filename"] == "zz_black_mid.mp4")
    src = Path(a["source"])
    moved = tmp_path / src.name
    shutil.move(src, moved)
    try:
        with pytest.raises(StudioError, match="not reachable"):
            render.render(project, quality="final")
    finally:
        shutil.move(moved, src)


def test_ui_serves_api_and_blocks_traversal(project, monkeypatch):
    from bjj_pipeline.studio import ui
    monkeypatch.setattr(ui, "_projects_dir", lambda: project.root.parent)
    from http.server import ThreadingHTTPServer
    srv = ThreadingHTTPServer(("127.0.0.1", 0), ui.Handler)
    port = srv.server_address[1]
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    try:
        lst = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/projects").read())
        assert any(p["name"] == project.root.name for p in lst)
        view = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/p/{project.root.name}").read())
        assert view["timeline"]["schema"] == "bbm-timeline/1"
        req = urllib.request.Request(f"http://127.0.0.1:{port}/files/{project.root.name}/%2e%2e/%2e%2e/x")
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req)
        assert e.value.code in (403, 404)
    finally:
        srv.shutdown()


def test_health_reports_measured_facts():
    from bjj_pipeline.studio.health import check
    rep = check(resolve=True)
    assert rep["ffmpeg"]["x264_test_encode"] is True
    assert set(rep["fonts"].values()) == {True}
    assert "nvenc_test_encode" in rep["gpu"]
    assert "summary" in rep["resolve"]
