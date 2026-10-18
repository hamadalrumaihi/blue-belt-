"""Job execution: cancellable subprocesses, timeouts, bounded retries, structured logs.

Every external tool call (ffmpeg/ffprobe) goes through `run_tool`, which
  * polls the project's CANCEL flag every 0.5 s and kills the process,
  * enforces a timeout,
  * retries transient failures a bounded number of times,
  * appends a JSON line to logs/jobs.jsonl and the raw stderr to logs/<label>.log,
  * raises StudioError with an *actionable* message (what failed, why, what to try).
"""
from __future__ import annotations

import json
import subprocess
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator

from ..util import LOG

_LOCK = threading.Lock()


class StudioError(RuntimeError):
    def __init__(self, message: str, hint: str = "", log: Path | None = None):
        self.hint = hint
        self.log = log
        full = message + (f"\n  -> {hint}" if hint else "") + (f"\n  log: {log}" if log else "")
        super().__init__(full)


class Cancelled(StudioError):
    pass


def log_event(project_root: Path, **event) -> None:
    event.setdefault("ts", time.strftime("%Y-%m-%dT%H:%M:%S"))
    p = Path(project_root) / "logs" / "jobs.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK, p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")


def _hint_for(stderr: str) -> str:
    s = stderr.lower()
    if "filter graph" in s or "filtergraph" in s or "error initializing filter" in s or "invalid argument" in s and "filter" in s:
        return "internal filter-graph error (a bug, not your footage): send logs/ + timeline/ to the maintainer"
    if "no such file" in s or "does not exist" in s:
        return "a source file moved or the drive is disconnected; re-run `bjj studio ingest` or reconnect the drive"
    if "invalid data found" in s or "moov atom not found" in s:
        return "the file is damaged or still being copied; re-copy it from the card or exclude it"
    if "no space left" in s:
        return "the disk is full; free space or point BBM_STUDIO_HOME to a bigger drive"
    if "nvenc" in s or "cuda" in s:
        return "GPU encoder failed (driver/VRAM); set settings.encoder='cpu' in project.json and resume"
    if "fontconfig" in s or "font" in s and "not found" in s:
        return "caption font missing; run `bjj studio health`"
    return "see the log for the full ffmpeg output"


def run_tool(cmd: list[str], *, project_root: Path, label: str, timeout: float = 1800, retries: int = 1,
             cancel_check: Callable[[], bool] | None = None, capture_stdout: bool = False,
             cwd: Path | None = None) -> subprocess.CompletedProcess:
    cmd = [str(c) for c in cmd]
    logdir = Path(project_root) / "logs"
    logdir.mkdir(parents=True, exist_ok=True)
    logf = logdir / f"{label}.log"
    attempt = 0
    while True:
        attempt += 1
        t0 = time.time()
        with logf.open("w", encoding="utf-8", errors="replace") as lf:
            lf.write("$ " + " ".join(cmd) + "\n")
            lf.flush()
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE if capture_stdout else subprocess.DEVNULL,
                                    stderr=subprocess.PIPE, text=True, errors="replace", cwd=str(cwd) if cwd else None,
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            err_chunks: list[str] = []
            out_chunks: list[str] = []

            def pump(stream, sink):
                for line in iter(stream.readline, ""):
                    sink.append(line)
                stream.close()

            threads = [threading.Thread(target=pump, args=(proc.stderr, err_chunks), daemon=True)]
            if capture_stdout:
                threads.append(threading.Thread(target=pump, args=(proc.stdout, out_chunks), daemon=True))
            for th in threads:
                th.start()
            reason = None
            while proc.poll() is None:
                if cancel_check and cancel_check():
                    reason = "cancelled"
                elif time.time() - t0 > timeout:
                    reason = "timeout"
                if reason:
                    proc.kill()
                    break
                time.sleep(0.25)
            proc.wait()
            for th in threads:
                th.join(timeout=5)
            stderr = "".join(err_chunks)
            lf.write(stderr)
        dt = round(time.time() - t0, 2)
        log_event(project_root, kind="tool", label=label, rc=proc.returncode, seconds=dt, attempt=attempt,
                  reason=reason)
        if reason == "cancelled":
            raise Cancelled(f"{label}: cancelled by user", "delete the CANCEL file and run `bjj studio resume`", logf)
        if reason is None and proc.returncode == 0:
            return subprocess.CompletedProcess(cmd, 0, "".join(out_chunks), stderr)
        transient = reason == "timeout" or "resource temporarily unavailable" in stderr.lower()
        if attempt <= retries and transient:
            LOG.warning("%s failed (%s), retry %d/%d", label, reason or proc.returncode, attempt, retries)
            continue
        tail = stderr.strip().splitlines()[-3:] if stderr.strip() else []
        msg = f"{label} failed ({'timeout after %ss' % int(timeout) if reason == 'timeout' else 'exit %s' % proc.returncode})"
        if tail:
            msg += ": " + " | ".join(tail)
        raise StudioError(msg, _hint_for(stderr) if reason != "timeout" else
                          "raise settings.timeout or render a shorter draft first", logf)


@contextmanager
def stage(project, name: str, fp: str) -> Iterator[dict]:
    """Checkpointed stage.  Usage::

        with stage(proj, "analyze", fp) as ctx:
            if ctx["skip"]: return
            ... work ...; ctx["outputs"] = [...]
    """
    ctx = {"skip": project.stage_is_current(name, fp), "outputs": [], "extra": {}}
    if ctx["skip"]:
        log_event(project.root, kind="stage", stage=name, status="skipped_current", fingerprint=fp)
        LOG.info("stage %s: up to date (fingerprint %s) - skipped", name, fp)
        yield ctx
        return
    if project.cancelled():
        raise Cancelled(f"{name}: cancel requested before start", "delete the CANCEL file and resume")
    project.mark(name, "running", fp=fp)
    log_event(project.root, kind="stage", stage=name, status="running", fingerprint=fp)
    t0 = time.time()
    try:
        yield ctx
    except Cancelled as exc:
        project.mark(name, "cancelled", error=str(exc))
        log_event(project.root, kind="stage", stage=name, status="cancelled")
        raise
    except Exception as exc:
        project.mark(name, "failed", error=str(exc))
        log_event(project.root, kind="stage", stage=name, status="failed", error=str(exc))
        raise
    project.mark(name, "done", fp=fp, outputs=ctx["outputs"], seconds=round(time.time() - t0, 1), **ctx["extra"])
    log_event(project.root, kind="stage", stage=name, status="done", seconds=round(time.time() - t0, 1))
