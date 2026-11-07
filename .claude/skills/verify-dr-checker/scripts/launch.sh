#!/usr/bin/env bash
# Start a Nuxt dev server for verification on its own port and wait until it is usable
# (GET /api/domains answers 200, which proves Nitro + the Supabase connection work).
# Usage: launch.sh [port]   (default 3123). Writes .verify/run/<port>.{pid,log}.
set -euo pipefail
PORT="${1:-3123}"
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
RUN="$ROOT/.verify/run"
mkdir -p "$RUN"
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"

if lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "port $PORT is already in use; pick another port or run cleanup.sh $PORT" >&2
  exit 1
fi
[ -f "$ROOT/.env" ] || { echo "missing $ROOT/.env (SUPABASE_URL, keys)" >&2; exit 1; }

cd "$ROOT"
nohup npx nuxt dev --port "$PORT" --host 127.0.0.1 >"$RUN/$PORT.log" 2>&1 &
echo $! >"$RUN/$PORT.pid"

for _ in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/domains?pageSize=20" || true)
  if [ "$code" = "200" ]; then echo "ready http://127.0.0.1:$PORT (pid $(cat "$RUN/$PORT.pid"))"; exit 0; fi
  if ! kill -0 "$(cat "$RUN/$PORT.pid")" 2>/dev/null; then echo "dev server exited; see $RUN/$PORT.log" >&2; exit 1; fi
  sleep 2
done
echo "not ready after 180 s (last /api/domains status: $code); see $RUN/$PORT.log" >&2
exit 1
