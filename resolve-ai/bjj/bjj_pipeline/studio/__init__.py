"""BBM Studio - the integrated production workflow built on bjj_pipeline.

One production = one folder ("project dir") holding a versioned project.json,
asset index, analysis cache, timeline versions, renders, QC reports, revision
log and job log.  Every stage reads and writes that one state, so a new
session (or a crash) resumes from the last good checkpoint.

Stages:  ingest -> analyze -> reference (optional) -> plan -> render(draft)
         -> qc -> [revise -> render -> qc]* -> export(final)

Nothing here uploads footage or calls paid services.  See docs/STUDIO.md.
"""
SCHEMA_VERSION = 1
