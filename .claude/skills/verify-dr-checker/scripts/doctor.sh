#!/usr/bin/env bash
# Read-only: is the instance on <port> ours, up, on this checkout, and talking to Supabase?
# Usage: doctor.sh [port]   Exit 0 = worth driving.
set -uo pipefail
PORT="${1:-3123}"
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
PIDFILE="$ROOT/.verify/run/$PORT.pid"
fail() { echo "FAIL: $*"; exit 1; }

[ -f "$PIDFILE" ] || fail "no pid file $PIDFILE (not started by launch.sh)"
PID=$(cat "$PIDFILE")
kill -0 "$PID" 2>/dev/null || fail "pid $PID not running"
LISTENER=$(lsof -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
[ -n "$LISTENER" ] || fail "nothing listening on $PORT"
# the listener is a child of the npx process we started
pgrep -P "$PID" >/dev/null || [ "$LISTENER" = "$PID" ] || fail "listener $LISTENER is not under our pid $PID"
echo "ok: pid $PID owns port $PORT"
echo "ok: checkout $(git -C "$ROOT" rev-parse --abbrev-ref HEAD)@$(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet || echo ' (dirty)')"
echo "ok: node $("$HOME/.nvm/versions/node/v24.16.0/bin/node" -v)"
BODY=$(curl -s "http://127.0.0.1:$PORT/api/domains?pageSize=20") || fail "/api/domains unreachable"
echo "$BODY" | grep -q '"total"' || fail "/api/domains did not return a listing: ${BODY:0:200}"
echo "ok: /api/domains total=$(echo "$BODY" | sed -n 's/.*"total": *\([0-9]*\).*/\1/p') (Supabase: $(grep '^SUPABASE_URL=' "$ROOT/.env" | cut -d= -f2))"
