#!/bin/sh
# Entrypoint: only the headed mode needs a display. Headless modes start node
# directly so a missing or failing Xvfb can never stop the worker.
set -e
if [ "${HEADLESS:-new}" = "headed" ] && command -v xvfb-run >/dev/null 2>&1; then
  echo "[start] HEADLESS=headed: starting under Xvfb"
  exec xvfb-run -a --server-args="-screen 0 1280x800x24" node src/server.mjs
fi
echo "[start] HEADLESS=${HEADLESS:-new}: starting node directly"
exec node src/server.mjs
