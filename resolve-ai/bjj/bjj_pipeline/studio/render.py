"""Stage 4 - render (FFmpeg).  Draft first (half resolution, from proxies), final from originals.

Per-clip segments are rendered once and cached under renders/segments/ keyed by
a fingerprint of (clip settings, source hash, output size, quality).  A revision
that changes three clips re-renders three segments; assembly (cuts/dissolves,
captions, music, loudness) is re-run because it is cheap.

Per clip:  trim -> [vidstab 2-pass] -> exposure/contrast (eq) -> speed -> fps
           -> reframe (crop | fit over blurred fill | pad) -> scale -> yuv420p
Assembly:  concat / xfade dissolves -> ASS captions (libass) -> natural sound +
           music bed ducked under natural peaks -> loudnorm (-14 LUFS, -1.5 dBTP)

Resource notes (8 GB GPU, 32 GB RAM): x264 on CPU is the default and always
works.  settings.encoder = "nvenc" uses the RTX 3070's NVENC for the FINAL
encode only (one session), after `bjj studio health` confirms it works.
"""
from __future__ import annotations

import math
import shutil
from pathlib import Path

from ..util import LOG, ffmpeg_path, parse_fps, write_json
from .captions import FONT_DIR, FONT_FILES, write_ass
from .jobs import StudioError, run_tool, stage
from .project import Project, fingerprint
from .timeline import clip_duration, load, record_layout, validate

RENDER_VERSION = "render-v1"


def _even(x: float) -> int:
    return max(2, int(round(x / 2)) * 2)


def clip_filters(c: dict, asset: dict, W: int, H: int, fps: str, transforms: Path | None) -> tuple[str, str]:
    """(video filter chain, audio filter chain) for one clip.  Input label [0:v]/[0:a]."""
    v: list[str] = []
    if c.get("stabilize") and transforms is not None:
        v.append(f"vidstabtransform=input={transforms.name}:smoothing=12:optzoom=1:zoomspeed=0.2:interpol=bicubic")
    col = c.get("color", {}) or {}
    g, ct, sat = float(col.get("gamma", 1)), float(col.get("contrast", 1)), float(col.get("saturation", 1))
    if abs(g - 1) > 1e-3 or abs(ct - 1) > 1e-3 or abs(sat - 1) > 1e-3:
        v.append(f"eq=gamma={g:.3f}:contrast={ct:.3f}:saturation={sat:.3f}")
    sp = float(c.get("speed", 1.0))
    if abs(sp - 1) > 1e-6:
        v.append(f"setpts=PTS/{sp:.4f}")
    v.append(f"fps={fps}")
    rf = c.get("reframe", {}) or {"mode": "none"}
    mode = rf.get("mode", "none")
    pre = ",".join(v)
    if mode == "crop":
        w = float(rf.get("w", 1.0))
        x = float(rf.get("x", 0.5))
        chain = (f"[0:v]{pre},crop=w='trunc(iw*{w:.5f}/2)*2':h=ih:x='(iw-ow)*{(x - w / 2) / max(1 - w, 1e-6):.5f}':y=0,"
                 f"scale={W}:{H}:flags=lanczos,setsar=1,format=yuv420p[v]") if w < 0.999 else \
                (f"[0:v]{pre},scale={W}:{H}:flags=lanczos,setsar=1,format=yuv420p[v]")
    elif mode == "fit_blur":
        chain = (f"[0:v]{pre},split=2[bg][fg];"
                 f"[bg]scale={_even(W / 4)}:{_even(H / 4)}:force_original_aspect_ratio=increase,"
                 f"crop={_even(W / 4)}:{_even(H / 4)},boxblur=10:2,eq=brightness=-0.12:saturation=0.8,"
                 f"scale={W}:{H},setsar=1[bgs];"
                 f"[fg]scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[fgs];"
                 f"[bgs][fgs]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]")
    elif mode == "fit_pad":
        chain = (f"[0:v]{pre},scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,"
                 f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[v]")
    else:
        chain = f"[0:v]{pre},scale={W}:{H}:flags=lanczos,setsar=1,format=yuv420p[v]"
    au = c.get("audio", {}) or {}
    d = clip_duration(c)
    gain = float(au.get("gain_db", 0.0))
    fi, fo = float(au.get("fade_in", 0.04)), float(au.get("fade_out", 0.06))
    if sp < 0.999 or gain <= -80 or not asset.get("has_audio"):
        achain = None     # slow motion / muted / silent source -> silence (pitched-down crowd audio sounds wrong)
    else:
        a = [f"volume={gain:.2f}dB"] if abs(gain) > 0.01 else []
        if sp > 1.001:
            a.append(f"atempo={min(sp, 2.0):.4f}")
        a += [f"afade=t=in:d={fi:.3f}", f"afade=t=out:st={max(0.0, d - fo):.3f}:d={fo:.3f}",
              "aresample=48000", "aformat=channel_layouts=stereo"]
        achain = "[0:a]" + ",".join(a) + "[a]"
    return chain, achain


def photo_filters(c: dict, W: int, H: int, fps: str) -> str:
    d = clip_duration(c)
    frames = max(2, int(round(d * float(parse_fps(fps)))))
    rf = c.get("reframe", {}) or {}
    big_w, big_h = _even(W * 1.25), _even(H * 1.25)
    if rf.get("mode") == "fit_blur":
        return (f"[0:v]split=2[bg][fg];[bg]scale={_even(W / 4)}:{_even(H / 4)}:force_original_aspect_ratio=increase,"
                f"crop={_even(W / 4)}:{_even(H / 4)},boxblur=10:2,eq=brightness=-0.12,scale={W}:{H},setsar=1[bgs];"
                f"[fg]scale={W}:{H}:force_original_aspect_ratio=decrease,setsar=1[fgs];[bgs][fgs]overlay=(W-w)/2:(H-h)/2,"
                f"loop=loop={frames}:size=1,fps={fps},trim=duration={d:.3f},format=yuv420p[v]")
    # slow Ken Burns push-in (4%) on a cover-cropped still
    return (f"[0:v]scale={big_w}:{big_h}:force_original_aspect_ratio=increase,crop={big_w}:{big_h},setsar=1,"
            f"zoompan=z='1+0.04*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={fps},"
            f"trim=duration={d:.3f},format=yuv420p[v]")


def render_segment(proj: Project, c: dict, asset: dict, W: int, H: int, fps: str, quality: str) -> Path:
    use_proxy = quality == "draft"
    src = (proj.root / asset["proxy"]) if (use_proxy and asset.get("proxy")) else Path(asset["source"])
    key = fingerprint(RENDER_VERSION, {k: c.get(k) for k in ("kind", "src_in", "src_out", "speed", "reframe",
                                                             "stabilize", "color", "audio", "hold")},
                      asset["hash"], W, H, fps, quality)
    out = proj.p("renders", "segments", f"{c['id']}_{key}.mp4")
    if out.exists() and out.stat().st_size > 0:
        return out
    d = clip_duration(c)
    tmp = out.with_suffix(".tmp.mp4")
    venc = (["-c:v", "libx264", "-preset", "ultrafast", "-crf", "26"] if quality == "draft"
            else ["-c:v", "libx264", "-preset", "medium", "-crf", "14"])
    if c.get("kind") == "photo":
        vf = photo_filters(c, W, H, fps)
        cmd = [ffmpeg_path(), "-v", "error", "-nostdin", "-y", "-i", str(src), "-f", "lavfi", "-t", f"{d:.3f}",
               "-i", "anullsrc=r=48000:cl=stereo", "-filter_complex", vf, "-map", "[v]", "-map", "1:a",
               *venc, "-c:a", "aac", "-b:a", "192k", "-t", f"{d:.3f}", str(tmp)]
        run_tool(cmd, project_root=proj.root, label=f"seg_{c['id']}", timeout=600, cancel_check=proj.cancelled)
        tmp.replace(out)
        return out
    src_len = float(c["src_out"]) - float(c["src_in"])
    transforms = None
    if c.get("stabilize"):
        transforms = out.with_suffix(".trf")
        run_tool([ffmpeg_path(), "-v", "error", "-nostdin", "-y", "-ss", f"{c['src_in']:.3f}", "-i", str(src),
                  "-t", f"{src_len:.3f}", "-vf", f"vidstabdetect=shakiness=6:accuracy=12:result={transforms.name}",
                  "-f", "null", "-"], project_root=proj.root, label=f"stab_{c['id']}", timeout=1200,
                 cancel_check=proj.cancelled, cwd=out.parent)
    vchain, achain = clip_filters(c, asset, W, H, fps, transforms)
    cmd = [ffmpeg_path(), "-v", "error", "-nostdin", "-y", "-ss", f"{c['src_in']:.3f}", "-t", f"{src_len:.3f}",
           "-i", str(src)]
    if achain is None:
        cmd += ["-f", "lavfi", "-t", f"{d:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
        fc = vchain
        amap = ["-map", "1:a"]
    else:
        fc = vchain + ";" + achain
        amap = ["-map", "[a]"]
    cmd += ["-filter_complex", fc, "-map", "[v]", *amap, *venc, "-c:a", "aac", "-b:a", "192k",
            "-t", f"{d:.3f}", str(tmp.name)]
    run_tool(cmd, project_root=proj.root, label=f"seg_{c['id']}", timeout=max(600, d * 60),
             cancel_check=proj.cancelled, cwd=out.parent)
    tmp.replace(out)
    if transforms and transforms.exists():
        transforms.unlink()
    return out


def assemble(proj: Project, tl: dict, segs: list[Path], out: Path, W: int, H: int, quality: str) -> Path:
    clips = tl["clips"]
    lay = record_layout(tl)
    total = lay[-1][1]
    inputs: list[str] = []
    for s in segs:
        inputs += ["-i", str(s)]
    fc: list[str] = []
    # video + audio chain, pairwise: cut -> concat, dissolve -> xfade/acrossfade
    vcur, acur = "[0:v]", "[0:a]"
    cur_len = clip_duration(clips[0])
    for i in range(1, len(clips)):
        tr = clips[i].get("transition_in", {}) or {}
        d = float(tr.get("duration", 0)) if tr.get("type") in ("dissolve", "dip_to_black") else 0.0
        vn, an = f"[v{i}]", f"[a{i}]"
        if d > 0:
            kind = "fade" if tr["type"] == "dissolve" else "fadeblack"
            fc.append(f"{vcur}[{i}:v]xfade=transition={kind}:duration={d:.3f}:offset={cur_len - d:.3f}{vn}")
            fc.append(f"{acur}[{i}:a]acrossfade=d={d:.3f}:c1=tri:c2=tri{an}")
            cur_len = cur_len + clip_duration(clips[i]) - d
        else:
            fc.append(f"{vcur}{acur}[{i}:v][{i}:a]concat=n=2:v=1:a=1{vn}{an}")
            cur_len += clip_duration(clips[i])
        vcur, acur = vn, an
    # captions
    if tl.get("captions"):
        ass = write_ass(tl["captions"], W, H, out.with_suffix(".ass"))
        fonts = out.parent / "fonts"
        fonts.mkdir(exist_ok=True)
        for f in FONT_FILES:
            shutil.copy(FONT_DIR / f, fonts / f)
        fc.append(f"{vcur}subtitles=filename={ass.name}:fontsdir=fonts[vcap]")
        vcur = "[vcap]"
    # music bed ducked under natural sound
    music = tl.get("music")
    a = tl.get("audio", {})
    lufs, tp = float(a.get("target_lufs", -14)), float(a.get("true_peak_db", -1.5))
    if music and Path(music["path"]).exists():
        mi = len(segs)
        inputs += ["-stream_loop", "-1", "-i", music["path"]]
        fo = float(music.get("fade_out", 1.5))
        fc.append(f"[{mi}:a]atrim=start={float(music.get('start', 0)):.3f}:duration={total:.3f},asetpts=PTS-STARTPTS,"
                  f"volume={float(music.get('gain_db', -18)):.2f}dB,afade=t=in:d={float(music.get('fade_in', .3)):.2f},"
                  f"afade=t=out:st={max(0, total - fo):.3f}:d={fo:.2f},aresample=48000,aformat=channel_layouts=stereo[mus]")
        fc.append(f"{acur}asplit=2[nat][key]")
        ratio = max(1.5, 10 ** (float(music.get('duck_db', 6)) / 20) * 2)
        fc.append(f"[mus][key]sidechaincompress=threshold=0.05:ratio={ratio:.2f}:attack=20:release=400[duck]")
        fc.append(f"[nat][duck]amix=inputs=2:duration=first:normalize=0[mix]")
        acur = "[mix]"
    # loudness is normalised in a second, measured pass (see _loudnorm_two_pass); here only resample
    fc.append(f"{acur}aresample=48000[aout]")
    if quality == "draft":
        venc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "26"]
    else:
        ex = tl.get("export", {})
        enc = proj.state.get("settings", {}).get("encoder", "cpu")
        if enc == "nvenc":
            venc = ["-c:v", "h264_nvenc", "-preset", "p6", "-rc", "vbr", "-cq", "19", "-b:v", "0"]
        else:
            venc = ["-c:v", ex.get("vcodec", "libx264"), "-preset", ex.get("preset", "slow"),
                    "-crf", str(ex.get("crf", 18)), "-profile:v", "high"]
    gop = int(round(float(parse_fps(tl["fps"])) * 2))
    tmp = out.with_suffix(".tmp.mp4")
    cmd = [ffmpeg_path(), "-v", "error", "-nostdin", "-y", *inputs, "-filter_complex", ";".join(fc),
           "-map", "0:v" if vcur == "[0:v]" else vcur, "-map", "[aout]", *venc, "-g", str(gop), "-pix_fmt", "yuv420p", "-r", tl["fps"],
           "-c:a", "aac", "-b:a", tl.get("export", {}).get("abitrate", "256k"), "-ar", "48000",
           "-movflags", "+faststart", "-t", f"{total:.3f}", tmp.name]
    run_tool(cmd, project_root=proj.root, label=f"assemble_{out.stem}", timeout=max(900, total * 40),
             cancel_check=proj.cancelled, cwd=out.parent)
    _loudnorm_two_pass(proj, tmp, out, lufs, tp, tl.get("export", {}).get("abitrate", "256k"))
    tmp.unlink(missing_ok=True)
    return out


def _loudnorm_two_pass(proj: Project, src: Path, dst: Path, lufs: float, tp: float, abitrate: str) -> None:
    """EBU R128 two-pass: measure, then apply a linear gain (video stream copied, not re-encoded).
    Single-pass loudnorm overshoots on short social edits (measured -12.3 LUFS for a -14 target)."""
    import json as _json
    m = run_tool([ffmpeg_path(), "-v", "info", "-nostdin", "-i", str(src), "-vn", "-af",
                  f"loudnorm=I={lufs}:TP={tp}:LRA=11:print_format=json", "-f", "null", "-"],
                 project_root=proj.root, label=f"loudnorm_measure_{dst.stem}", timeout=900)
    blob = m.stderr[m.stderr.rfind("{"): m.stderr.rfind("}") + 1]
    try:
        meas = _json.loads(blob)
        if float(meas["input_i"]) < -70:          # (near) silent edit: nothing to normalise, gain would explode
            raise ValueError("silent")
        af = (f"loudnorm=I={lufs}:TP={tp}:LRA=11:measured_I={meas['input_i']}:measured_TP={meas['input_tp']}:"
              f"measured_LRA={meas['input_lra']}:measured_thresh={meas['input_thresh']}:"
              f"offset={meas['target_offset']}:linear=true,aresample=48000")
    except ValueError as exc:
        af = "anull" if "silent" in str(exc) or "inf" in blob else f"loudnorm=I={lufs}:TP={tp}:LRA=11,aresample=48000"
    except KeyError:
        af = f"loudnorm=I={lufs}:TP={tp}:LRA=11,aresample=48000"
    tmp = dst.with_suffix(".ln.mp4")
    run_tool([ffmpeg_path(), "-v", "error", "-nostdin", "-y", "-i", str(src), "-map", "0:v", "-map", "0:a",
              "-c:v", "copy", "-af", af, "-c:a", "aac", "-b:a", abitrate, "-ar", "48000", "-movflags", "+faststart",
              str(tmp)], project_root=proj.root, label=f"loudnorm_apply_{dst.stem}", timeout=900,
             cancel_check=proj.cancelled)
    tmp.replace(dst)


def render(proj: Project, *, quality: str = "draft", version: int | None = None) -> dict:
    tl = load(proj, version)
    from .timeline import reflow_captions
    reflow_captions(tl)              # older timelines may carry captions past the end
    assets = {a["id"]: a for a in proj.assets}
    errors = [i for i in validate(tl, assets) if i.level == "error"]
    if errors:
        raise StudioError("timeline is invalid: " + "; ".join(f"{e.where}: {e.message}" for e in errors),
                          "fix the timeline (or re-run plan) before rendering")
    scale = float(proj.state["settings"].get("draft_scale", 0.5)) if quality == "draft" else 1.0
    W, H = _even(tl["width"] * scale), _even(tl["height"] * scale)
    fp = fingerprint(RENDER_VERSION, tl, quality, W, H, [assets[c["asset"]]["hash"] for c in tl["clips"]])
    name = f"{quality}_v{tl['version']:03d}"
    with stage(proj, "render", fp) as ctx:
        if ctx["skip"]:
            return proj.stage("render")
        missing = [c["asset"] for c in tl["clips"] if not Path(assets[c["asset"]]["source"]).exists()]
        if quality == "final" and missing:
            raise StudioError(f"{len(missing)} original source file(s) are not reachable: {missing[:3]}",
                              "reconnect the footage drive, or render a draft (drafts use the cached proxies)")
        segs = []
        for c in tl["clips"]:
            segs.append(render_segment(proj, c, assets[c["asset"]], W, H, tl["fps"], quality))
        out = proj.p("renders", f"{name}.mp4")
        assemble(proj, tl, segs, out, W, H, quality)
        proj.state["render_version"] = tl["version"]
        proj.state.setdefault("renders", []).append({"file": f"renders/{name}.mp4", "timeline_version": tl["version"],
                                                     "quality": quality, "size": f"{W}x{H}"})
        proj.save()
        proj.invalidate_from("qc")
        ctx["outputs"] = [f"renders/{name}.mp4"]
        ctx["extra"] = {"file": f"renders/{name}.mp4", "quality": quality, "timeline_version": tl["version"],
                        "size": f"{W}x{H}", "segments_cached": None}
        LOG.info("render %s -> %s", quality, out)
    return proj.stage("render")
