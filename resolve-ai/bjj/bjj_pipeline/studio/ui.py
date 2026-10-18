"""Local web interface (stdlib only, binds to 127.0.0.1 - footage never leaves the PC).

    bjj studio ui            -> http://127.0.0.1:8765

Create a production, write the brief (English/Arabic captions), point at the
footage folders and an optional reference, run, inspect the analysis, watch
the draft, add feedback at the current playback time, build revision
operations, and export.  One job runs at a time per project in a background
thread; the job log and stage states are polled.
"""
from __future__ import annotations

import json
import mimetypes
import threading
import time
import traceback
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from ..util import read_json, to_jsonable
from .project import Brief, Project, open_project, studio_home

JOBS: dict[str, dict] = {}
LOCK = threading.Lock()


def _projects_dir() -> Path:
    d = studio_home() / "projects"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _project(name: str) -> Project:
    root = (_projects_dir() / name).resolve()
    if _projects_dir().resolve() not in root.parents:
        raise PermissionError("bad project name")
    return open_project(root)


def _start_job(name: str, label: str, fn) -> dict:
    with LOCK:
        j = JOBS.get(name)
        if j and j["state"] == "running":
            raise RuntimeError(f"a job is already running for {name}: {j['label']}")
        job = {"label": label, "state": "running", "started": time.time(), "error": None, "result": None}
        JOBS[name] = job

    def target():
        try:
            job["result"] = to_jsonable(fn())
            job["state"] = "done"
        except Exception as exc:  # noqa: BLE001 - reported to the UI
            job["state"] = "failed"
            job["error"] = str(exc)
            job["trace"] = traceback.format_exc()[-2000:]
        job["ended"] = time.time()

    threading.Thread(target=target, daemon=True).start()
    return job


def project_view(p: Project) -> dict:
    from .revise import list_feedback
    from .timeline import load, record_layout
    v: dict = {"summary": p.summary(), "brief": p.state["brief"], "sources": p.state.get("sources", []),
               "reference": p.state.get("reference"), "renders": p.state.get("renders", []),
               "stages": p.state.get("stages", {})}
    v["assets"] = p.assets
    idx = p.root / "cache" / "index.json"
    v["index"] = read_json(idx) if idx.exists() else None
    cand = p.root / "cache" / "candidates.json"
    if cand.exists():
        d = read_json(cand)
        v["candidates"] = [{k: c.get(k) for k in ("id", "asset", "category", "start", "end", "peak_t", "technical",
                                                  "editorial", "reasons", "flags", "suggested_labels")}
                           for c in d["candidates"][:60]]
        v["honesty"] = d.get("honesty")
    if p.state.get("timeline_version"):
        tl = load(p)
        v["timeline"] = tl
        v["layout"] = record_layout(tl)
    ref = p.root / "reference" / "breakdown.json"
    if ref.exists():
        r = read_json(ref)
        v["reference_breakdown"] = {"params": r["params"], "evidence": r["evidence"], "shots": len(r["shots"]),
                                    "not_measured": r["not_measured"]}
    if p.state.get("renders"):
        stem = Path(p.state["renders"][-1]["file"]).stem
        q = p.root / "qc" / f"{stem}.json"
        if q.exists():
            v["qc"] = read_json(q)
        rv = p.root / "qc" / f"{stem}.review.json"
        if rv.exists():
            v["review"] = read_json(rv)
    revs = p.root / "revisions.jsonl"
    v["revisions"] = [json.loads(l) for l in revs.read_text(encoding="utf-8").splitlines() if l.strip()] if revs.exists() else []
    v["feedback"] = list_feedback(p, None)
    log = p.root / "logs" / "jobs.jsonl"
    v["log_tail"] = log.read_text(encoding="utf-8").splitlines()[-25:] if log.exists() else []
    v["job"] = JOBS.get(p.root.name)
    ex = p.root / "export" / "manifest.json"
    v["export"] = read_json(ex) if ex.exists() else None
    return v


class Handler(BaseHTTPRequestHandler):
    server_version = "BBMStudio/1"

    def log_message(self, fmt, *args):  # quiet
        pass

    def _json(self, obj, status=200):
        body = json.dumps(to_jsonable(obj), ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def _file(self, path: Path):
        if not path.exists() or not path.is_file():
            return self._json({"error": "not found"}, 404)
        size = path.stat().st_size
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        if rng and rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            start = int(a) if a else max(0, size - int(b))
            end = int(b) if (a and b) else size - 1
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        with path.open("rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 20, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                left -= len(chunk)

    def do_GET(self):
        u = urlparse(self.path)
        parts = [unquote(x) for x in u.path.strip("/").split("/") if x]
        try:
            if not parts:
                body = PAGE.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if parts == ["api", "projects"]:
                out = []
                for d in sorted(_projects_dir().iterdir()):
                    if (d / "project.json").exists():
                        s = read_json(d / "project.json")
                        out.append({"name": d.name, "title": s.get("name"), "kind": s["brief"].get("kind"),
                                    "created": s.get("created"), "timeline_version": s.get("timeline_version")})
                return self._json(out)
            if parts == ["api", "health"]:
                from .health import check
                return self._json(check(resolve=True))
            if len(parts) == 3 and parts[:2] == ["api", "p"]:
                return self._json(project_view(_project(parts[2])))
            if len(parts) >= 3 and parts[0] == "files":
                p = _project(parts[1])
                f = (p.root / "/".join(parts[2:])).resolve()
                if p.root not in f.parents:
                    return self._json({"error": "forbidden"}, 403)
                return self._file(f)
            return self._json({"error": "not found"}, 404)
        except Exception as exc:  # noqa: BLE001
            return self._json({"error": str(exc)}, 500)

    def do_POST(self):
        parts = [unquote(x) for x in urlparse(self.path).path.strip("/").split("/") if x]
        try:
            b = self._body()
            if parts == ["api", "projects"]:
                p = Project.create(b["name"], Brief.from_dict(b.get("brief") or {"title": b["name"]}), _projects_dir())
                return self._json({"name": p.root.name})
            if len(parts) != 4 or parts[:2] != ["api", "p"]:
                return self._json({"error": "not found"}, 404)
            name, act = parts[2], parts[3]
            p = _project(name)
            from . import pipeline
            from . import revise as rv
            if act == "brief":
                p.set_brief(b)
                return self._json({"ok": True})
            if act == "run":
                footage = [x.strip() for x in b.get("footage", []) if x.strip()] or None
                ref = (b.get("reference") or "").strip() or None
                return self._json(_start_job(name, "run", lambda: pipeline.run(p, footage, ref)))
            if act == "feedback":
                return self._json(rv.add_feedback(p, b["text"], b.get("at"), b.get("to")))
            if act == "revise":
                def job():
                    from .qc import run_qc
                    from .render import render
                    from .timeline import load
                    drafts = [r for r in p.state.get("renders", []) if r["quality"] == "draft"]
                    before = run_qc(p, drafts[-1]["file"] if drafts else None)
                    ops = list(b.get("ops") or [])
                    if b.get("proposed"):
                        ops += rv.proposed_ops_from_qc(before, load(p))
                    rv.revise(p, ops, problems=[{"text": o.get("why", ""), "clip": o.get("clip")} for o in ops],
                              feedback_ids=b.get("feedback_ids") or [], note=b.get("note", ""), force=b.get("force", False))
                    render(p, quality="draft")
                    after = run_qc(p)
                    return rv.attach_evidence(p, before, after)
                return self._json(_start_job(name, "revise", job))
            if act == "export":
                from .export import export
                return self._json(_start_job(name, "export", lambda: export(p)))
            if act == "cancel":
                p.request_cancel()
                return self._json({"ok": True})
            return self._json({"error": f"unknown action {act}"}, 404)
        except Exception as exc:  # noqa: BLE001
            return self._json({"error": str(exc)}, 400)


def serve(port: int = 8765, open_browser: bool = True) -> None:
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as exc:
        raise SystemExit(f"port {port} is busy ({exc.strerror}). BBM Studio may already be open: "
                         f"go to http://127.0.0.1:{port} or start with --port {port + 1}")
    url = f"http://127.0.0.1:{port}"
    print(f"BBM Studio UI on {url}  (Ctrl+C to stop; projects in {_projects_dir()})")
    if open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BBM Studio</title>
<style>
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--fg:#e7e9ee;--mut:#9aa3b2;--acc:#3d7cff;--ok:#2fbf71;--warn:#e8b339;--bad:#ef5350}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,Segoe UI,Noto Sans,Noto Sans Arabic,sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;gap:12px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
header b{letter-spacing:.04em}select,input,textarea,button{font:inherit;color:inherit;background:#0c0e12;border:1px solid var(--line);border-radius:6px;padding:6px 8px}
button{background:var(--acc);border:0;cursor:pointer;font-weight:600}button.sec{background:#2a3040}button:disabled{opacity:.5}
main{display:grid;grid-template-columns:minmax(320px,420px) 1fr;gap:14px;padding:14px}@media(max-width:900px){main{grid-template-columns:1fr}}
section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:14px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin:0 0 10px}
label{display:block;color:var(--mut);font-size:12px;margin:8px 0 3px}input,textarea,select{width:100%}textarea{min-height:60px}
.row{display:flex;gap:8px}.row>*{flex:1}.pill{display:inline-block;padding:1px 7px;border-radius:99px;font-size:11px;font-weight:700}
.pass,.done,.ok{background:#173d2a;color:var(--ok)}.warn,.stale,.running{background:#3d3215;color:var(--warn)}.fail,.failed,.damaged,.unreadable,.cancelled{background:#3d1919;color:var(--bad)}.duplicate{background:#2a3040;color:var(--mut)}
table{width:100%;border-collapse:collapse;font-size:12.5px}td,th{border-bottom:1px solid var(--line);padding:5px 6px;text-align:left;vertical-align:top}th{color:var(--mut);font-weight:600}
video{width:100%;max-height:70vh;background:#000;border-radius:8px}.strip{display:flex;gap:2px;margin:8px 0;overflow-x:auto}.strip div{flex:none;background:#2a3040;border-radius:3px;font-size:10px;padding:3px;cursor:pointer;white-space:nowrap;overflow:hidden}
.strip div.on{outline:2px solid var(--acc)}img.sheet{width:100%;border-radius:6px;border:1px solid var(--line)}.mut{color:var(--mut)}pre{white-space:pre-wrap;font-size:11.5px;background:#0c0e12;padding:8px;border-radius:6px;max-height:220px;overflow:auto}
.caprow{display:grid;grid-template-columns:1fr 70px 90px 28px;gap:6px;margin-bottom:6px}.small{font-size:12px}
</style></head><body>
<header><b>BLUE BELT MEDIA · STUDIO</b><select id="proj"></select><button class="sec" onclick="newProject()">New production</button>
<span id="job" class="mut small"></span><span style="flex:1"></span><a class="mut small" href="#" onclick="health();return false">health</a></header>
<main><div>
<section><h2>Brief</h2>
<div class="row"><div><label>Type</label><select id="kind"><option>athlete_highlight</option><option>team_recap</option><option>tournament_reel</option><option>promo</option><option>fight_edit</option></select></div>
<div><label>Format</label><select id="format"><option>vertical</option><option>landscape</option><option>square</option></select></div></div>
<label>Title</label><input id="title" dir="auto">
<div class="row"><div><label>Target length (s)</label><input id="target" type="number" min="5" step="1"></div><div><label>Athletes (comma)</label><input id="athletes" dir="auto"></div></div>
<label>Captions (English / Arabic) — text · lang · role</label><div id="caps"></div><button class="sec small" onclick="addCap()">+ caption</button>
<label>Music file (optional, local path you have rights to)</label><input id="music" placeholder="D:\Music\track.mp3">
<label>Notes</label><textarea id="notes" dir="auto"></textarea>
<div class="row" style="margin-top:8px"><label class="small"><input type="checkbox" id="chrono" style="width:auto"> keep chronology</label><label class="small"><input type="checkbox" id="slowmo" style="width:auto" checked> real-frame slow-mo</label><label class="small"><input type="checkbox" id="stab" style="width:auto" checked> stabilise shaky clips</label></div>
<button onclick="saveBrief()" style="margin-top:8px">Save brief</button></section>
<section><h2>Footage &amp; reference</h2><label>Footage folders or files (one per line; originals are only read)</label><textarea id="footage" placeholder="E:\Footage\2026-10 Qatar Open\CAM-A"></textarea>
<label>Reference video (file path, or link if yt-dlp is installed) — techniques only, nothing is copied</label><input id="reference">
<div class="row" style="margin-top:8px"><button onclick="run()">Run / resume</button><button class="sec" onclick="post('cancel',{})">Cancel</button></div>
<div id="stages" class="small" style="margin-top:8px"></div></section>
<section><h2>Job log</h2><pre id="log"></pre></section>
</div><div>
<section><h2>Draft</h2><video id="vid" controls></video><div class="strip" id="strip"></div>
<div class="row"><input id="fbtext" placeholder="Feedback at the current time, e.g. 'cut before the sweep finishes'" dir="auto"><button style="flex:none" onclick="addFeedback()">Add at <span id="tnow">0.0</span>s</button></div>
<div id="fblist" class="small"></div></section>
<section><h2>Revise</h2><div class="row small"><div><label>Clip</label><select id="opclip"></select></div><div><label>Operation</label><select id="opkind" onchange="opForm()">
<option value="trim">trim</option><option value="replace">replace with next-best moment</option><option value="remove">remove</option><option value="move">move</option><option value="reframe">reframe</option><option value="audio">audio gain/fades</option><option value="speed">speed</option><option value="transition">transition</option><option value="stabilize">stabilise on/off</option></select></div></div>
<div id="opargs" class="row small"></div><div class="row" style="margin-top:6px"><input id="opwhy" placeholder="why (recorded in the revision log)"><button class="sec" style="flex:none" onclick="queueOp()">Add op</button></div>
<pre id="ops">[]</pre><label class="small"><input type="checkbox" id="proposed" style="width:auto"> also apply QC-proposed mechanical fixes</label>
<button onclick="revise()">Apply ops → re-render draft → QC</button></section>
<section><h2>Automated QC <span class="mut small">(measurements only — no overall score)</span></h2><div id="qc"></div><img id="sheet" class="sheet"></section>
<section><h2>Revisions</h2><div id="revs" class="small"></div></section>
<section><h2>Analysis</h2><div id="honesty" class="mut small"></div><div id="assets"></div><div id="cands" style="margin-top:10px"></div></section>
<section><h2>Reference breakdown</h2><div id="ref" class="small mut">none</div></section>
<section><h2>Export</h2><button onclick="post('export',{})">Final render from originals + export</button><div id="export" class="small" style="margin-top:8px"></div></section>
</div></main>
<script>
let P=null,V=null,OPS=[];const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function api(u,o){const r=await fetch(u,o);const j=await r.json();if(!r.ok||j.error){alert(j.error||r.status);throw j}return j}
async function post(a,b){await api(`/api/p/${P}/${a}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});wasRunning=true;refresh()}
async function loadProjects(sel){const l=await api('/api/projects');$('proj').innerHTML=l.map(p=>`<option value="${esc(p.name)}">${esc(p.title)} (${p.kind})</option>`).join('');
 if(sel)$('proj').value=sel;P=$('proj').value||null;if(P)refresh()}
$('proj').onchange=()=>{P=$('proj').value;refresh()};
async function newProject(){const n=prompt('Production name (e.g. "Qatar Open 2026 - Ahmed highlight")');if(!n)return;const r=await api('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,brief:{title:n}})});loadProjects(r.name)}
function addCap(c={text:'',lang:'en',role:'title'}){const d=document.createElement('div');d.className='caprow';d.innerHTML=`<input dir="auto" value="${esc(c.text)}"><select><option>en</option><option>ar</option></select><select><option>title</option><option>lower_third</option><option>caption</option><option>cta</option></select><button class="sec" onclick="this.parentNode.remove()">×</button>`;d.children[1].value=c.lang;d.children[2].value=c.role;$('caps').appendChild(d)}
function briefFromForm(){return{kind:$('kind').value,format:$('format').value,title:$('title').value,target_seconds:+$('target').value||30,athletes:$('athletes').value.split(',').map(s=>s.trim()).filter(Boolean),
 captions:[...$('caps').children].map(r=>({text:r.children[0].value,lang:r.children[1].value,role:r.children[2].value})).filter(c=>c.text.trim()),music:$('music').value.trim()||null,notes:$('notes').value,keep_chronology:$('chrono').checked,allow_slowmo:$('slowmo').checked,allow_stabilize:$('stab').checked}}
async function saveBrief(){await post('brief',briefFromForm())}
async function run(){await saveBrief();await post('run',{footage:$('footage').value.split('\n'),reference:$('reference').value})}
async function addFeedback(){const t=+$('vid').currentTime.toFixed(2);if(!$('fbtext').value.trim())return;await post('feedback',{text:$('fbtext').value,at:t});$('fbtext').value=''}
$('vid').ontimeupdate=()=>{$('tnow').textContent=$('vid').currentTime.toFixed(1);if(!V||!V.layout)return;const t=$('vid').currentTime;[...$('strip').children].forEach((d,i)=>d.classList.toggle('on',V.layout[i][0]<=t&&t<V.layout[i][1]))};
function opForm(){const k=$('opkind').value,f={trim:'in_delta:-0.3,out_delta:0.5',move:'to:1',reframe:'mode:crop,x:0.5',audio:'gain_db:0,fade_in:0.1,fade_out:0.2',speed:'speed:0.5',transition:'type:dissolve,duration:0.3',stabilize:'on:true'}[k]||'';
 $('opargs').innerHTML=f?`<input id="opa" value="${f}" title="key:value pairs">`:'<span class="mut">no arguments</span>'}
function queueOp(){const op={op:$('opkind').value,clip:$('opclip').value};const a=$('opa');if(a)a.value.split(',').forEach(kv=>{let[k,v]=kv.split(':');v=v.trim();op[k.trim()]=v==='true'?true:v==='false'?false:isNaN(+v)?v:+v});if($('opwhy').value)op.why=$('opwhy').value;OPS.push(op);$('ops').textContent=JSON.stringify(OPS,null,1)}
async function revise(){const fb=(V.feedback||[]).filter(f=>f.status==='open').map(f=>f.id);await post('revise',{ops:OPS,proposed:$('proposed').checked,feedback_ids:fb});OPS=[];$('ops').textContent='[]'}
async function health(){const h=await api('/api/health');alert(JSON.stringify({ok:h.ok,problems:h.problems,optional_missing:h.optional_missing,gpu:h.gpu,resolve:h.resolve&&h.resolve.summary},null,1))}
function pill(s){return `<span class="pill ${esc(s)}">${esc(s)}</span>`}
async function refresh(){if(!P)return;V=await api(`/api/p/${P}`);const b=V.brief;
 if(document.activeElement.tagName!=='INPUT'&&document.activeElement.tagName!=='TEXTAREA'){$('kind').value=b.kind;$('format').value=b.format;$('title').value=b.title;$('target').value=b.target_seconds;$('athletes').value=(b.athletes||[]).join(', ');$('music').value=b.music||'';$('notes').value=b.notes||'';$('chrono').checked=b.keep_chronology;$('slowmo').checked=b.allow_slowmo;$('stab').checked=b.allow_stabilize;
 $('caps').innerHTML='';(b.captions||[]).forEach(addCap);if(!$('footage').value)$('footage').value=(V.sources||[]).join('\n');if(!$('reference').value&&V.reference)$('reference').value=V.reference.source}
 $('stages').innerHTML=Object.entries(V.stages||{}).map(([k,s])=>`${esc(k)} ${pill(s.status)}${s.error?` <span class="mut">${esc(s.error).slice(0,160)}</span>`:''}`).join(' &nbsp; ');
 const j=V.job;$('job').innerHTML=j?`${esc(j.label)}: ${pill(j.state)} ${j.error?esc(j.error).slice(0,140):''}`:'';
 $('log').textContent=(V.log_tail||[]).map(l=>{try{const o=JSON.parse(l);return `${o.ts} ${o.kind} ${o.stage||o.label||''} ${o.status||o.rc??''}`}catch(e){return l}}).join('\n');
 const r=(V.renders||[]).slice(-1)[0];if(r){const src=`/files/${P}/${r.file}`;if(!$('vid').src.endsWith(encodeURI(src)))$('vid').src=src}
 if(V.timeline){const tl=V.timeline,tot=V.layout.slice(-1)[0][1];$('strip').innerHTML=tl.clips.map((c,i)=>{const[a,e]=V.layout[i];return `<div title="${esc(c.reason)}\n${esc((c.notes||[]).join('; '))}" style="width:${Math.max(28,(e-a)/tot*100*7)}px" onclick="vid.currentTime=${a+0.01}">${c.id} ${esc(c.role)}<br>${a.toFixed(1)}s</div>`}).join('');
  $('opclip').innerHTML=tl.clips.map(c=>`<option>${c.id}</option>`).join('')}
 $('fblist').innerHTML=(V.feedback||[]).map(f=>`${pill(f.status)} ${f.at!=null?f.at+'s':''} [${(f.clips||[]).join(',')}] ${esc(f.text)}`).join('<br>');
 if(V.qc){$('qc').innerHTML='<table><tr><th></th><th>check</th><th>value</th><th>expected</th><th>where</th></tr>'+V.qc.automated.checks.map(c=>`<tr><td>${pill(c.status)}</td><td>${esc(c.title)}</td><td>${esc(JSON.stringify(c.value))}</td><td>${esc(c.expected)}</td><td>${(c.timestamps||[]).map(t=>`<a href="#" onclick="vid.currentTime=${t.t||0};return false">${t.t??''}s ${t.clip||''}</a>`).join(' ')}</td></tr>`).join('')+'</table>';
  $('sheet').src=`/files/${P}/${V.qc.evidence.sheet}?${Date.now()}`}
 $('revs').innerHTML=(V.revisions||[]).map(r=>`<b>round ${r.round}</b> v${r.from_version}→v${r.to_version} changed ${esc(r.changed.join(', '))}<br>problems: ${esc(r.problems.map(p=>p.text).join(' | '))}<br>${r.evidence?`evidence: QC ${esc(JSON.stringify(r.evidence.qc_before))} → ${esc(JSON.stringify(r.evidence.qc_after))}; ${r.evidence.changed_checks.map(c=>`${esc(c.check)}: ${esc(JSON.stringify(c.before.value))}→${esc(JSON.stringify(c.after.value))}`).join('; ')}`:'evidence pending'}`).join('<hr>');
 $('honesty').textContent=V.honesty||'';
 $('assets').innerHTML='<table><tr><th>file</th><th>status</th><th>fps</th><th>size</th><th>dur</th><th>problems / groups</th></tr>'+(V.assets||[]).map(a=>`<tr><td>${a.thumb?`<a target=_blank href="/files/${P}/${a.thumb}">${esc(a.filename)}</a>`:esc(a.filename)}</td><td>${pill(a.status)}</td><td>${a.fps_float??''}</td><td>${a.width??''}x${a.height??''}</td><td>${a.duration??''}</td><td>${esc((a.problems||[]).join('; '))} ${esc((a.groups||[]).join(' '))}</td></tr>`).join('')+'</table>'+
  (V.index&&V.index.overlaps.length?'<p class="small">Possible same-moment recordings: '+V.index.overlaps.map(o=>`${esc(o.meaning)} (${o.confidence}, r=${o.window_r_median})`).join('; ')+'</p>':'');
 $('cands').innerHTML=V.candidates?'<table><tr><th>moment</th><th>kind</th><th>tech</th><th>edit</th><th>why</th></tr>'+V.candidates.slice(0,25).map(c=>`<tr><td>${esc(c.id)}<br>${c.start}–${c.end}s</td><td>${esc(c.category)}</td><td>${c.technical}</td><td>${c.editorial}</td><td>${esc((c.reasons||[]).join('; '))}</td></tr>`).join('')+'</table>':'';
 if(V.reference_breakdown){const rb=V.reference_breakdown;$('ref').innerHTML=`<pre>${esc(JSON.stringify(rb.params,null,1))}</pre>`+rb.evidence.map(e=>`<img class="sheet" src="/files/${P}/${e}">`).join('')+`<p>Not measured: ${esc(rb.not_measured.join(', '))}</p>`}
 if(V.export){$('export').innerHTML=Object.entries(V.export.files).map(([k,f])=>`<a target=_blank href="/files/${P}/export/${f}">${k}: ${esc(f)}</a>`).join('<br>')}
}
opForm();loadProjects();let wasRunning=false;setInterval(()=>{const r=!!(V&&V.job&&V.job.state==='running');if(P&&(r||wasRunning))refresh();wasRunning=r},2500);
</script></body></html>"""
