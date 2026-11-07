#!/usr/bin/env bash
# Stop only the dev server launch.sh started on <port>. Keeps .verify/artifacts (the proof).
# Usage: cleanup.sh [port]
set -uo pipefail
PORT="${1:-3123}"
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
PIDFILE="$ROOT/.verify/run/$PORT.pid"
[ -f "$PIDFILE" ] || { echo "nothing to clean on $PORT"; exit 0; }
PID=$(cat "$PIDFILE")
# children first (nuxt spawns its server as a child of npx), then our pid
for c in $(pgrep -P "$PID"); do pkill -TERM -P "$c" 2>/dev/null; kill -TERM "$c" 2>/dev/null; done
kill -TERM "$PID" 2>/dev/null
sleep 2
lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1 && echo "WARN: port $PORT still listening" || echo "stopped $PID, port $PORT free"
rm -f "$PIDFILE"
echo "artifacts kept in $ROOT/.verify/artifacts"
