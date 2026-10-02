#!/bin/sh
# Entrypoint. Headless modes start node directly. Headed mode needs a display:
# Xvfb is started in the background on a fixed display and node starts
# regardless, so a display problem shows up as browserReady:false on /health
# instead of a container that never answers.
set -e
MODE="${HEADLESS:-new}"
if [ "$MODE" = "headed" ]; then
  if command -v Xvfb >/dev/null 2>&1; then
    export DISPLAY="${DISPLAY:-:99}"
    rm -f "/tmp/.X${DISPLAY#:}-lock"
    echo "[start] HEADLESS=headed: starting Xvfb on $DISPLAY"
    Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp -ac >/tmp/xvfb.log 2>&1 &
    i=0
    while [ $i -lt 50 ] && ! [ -S "/tmp/.X11-unix/X${DISPLAY#:}" ]; do
      i=$((i + 1))
      sleep 0.1
    done
    if [ -S "/tmp/.X11-unix/X${DISPLAY#:}" ]; then
      echo "[start] Xvfb ready after ${i}00ms"
    else
      echo "[start] WARNING: Xvfb did not come up; browser launch will fail (see /health)"
    fi
  else
    echo "[start] WARNING: HEADLESS=headed but Xvfb is not installed"
  fi
else
  echo "[start] HEADLESS=$MODE: starting node directly"
fi
exec node src/server.mjs
