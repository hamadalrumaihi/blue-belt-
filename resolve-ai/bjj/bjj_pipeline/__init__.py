"""Blue Belt Media BJJ footage pipeline.

Stages (see docs/WORKFLOW.md):
  A organize  -> bjj_pipeline.organize
  B analyze   -> bjj_pipeline.analyze
  C rank      -> bjj_pipeline.quality
  D plan      -> bjj_pipeline.plan
  E build     -> bjj_pipeline.resolve_bridge (DaVinci Resolve scripting API)
  F render    -> bjj_pipeline.presets

Everything runs locally. No footage ever leaves the machine.
"""

__version__ = "0.1.0"
