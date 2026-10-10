#!/usr/bin/env bash
# Provision or rotate the process-queue worker secret (ADR 0002).
# Sets the edge-function secret WORKER_SECRET and the Vault entries
# worker_secret + worker_url + meta_worker_url to matching values.
# Never prints the secret.
#
# Usage: SUPABASE_ACCESS_TOKEN=... scripts/provision-worker-secret.sh <project-ref>
# Rotation: rerun it. Calls made between the two updates may get a 401;
# kick_worker()'s cron retries within 10 s.
set -euo pipefail

REF="${1:?usage: $0 <project-ref>}"
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}"

SECRET="$(openssl rand -hex 32)"

# The secret and the access token never appear in a process's argv (visible
# in `ps`): they go through a private temp dir and stdin instead.
TMP="$(mktemp -d)"
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT
URL="https://${REF}.supabase.co/functions/v1/process-queue"
META_URL="https://${REF}.supabase.co/functions/v1/fetch-meta"

( umask 077; printf 'WORKER_SECRET=%s\n' "$SECRET" > "$TMP/secrets.env" )
npx -y supabase@2.109.0 secrets set --project-ref "$REF" --env-file "$TMP/secrets.env" >/dev/null
echo "function secret WORKER_SECRET set"

# Values are hex and a URL (no quotes), so plain literals are safe.
SQL="do \$\$
begin
  if exists (select 1 from vault.secrets where name = 'worker_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'worker_secret'), '${SECRET}');
  else
    perform vault.create_secret('${SECRET}', 'worker_secret');
  end if;
  if exists (select 1 from vault.secrets where name = 'worker_url') then
    perform vault.update_secret((select id from vault.secrets where name = 'worker_url'), '${URL}');
  else
    perform vault.create_secret('${URL}', 'worker_url');
  end if;
  if exists (select 1 from vault.secrets where name = 'meta_worker_url') then
    perform vault.update_secret((select id from vault.secrets where name = 'meta_worker_url'), '${META_URL}');
  else
    perform vault.create_secret('${META_URL}', 'meta_worker_url');
  end if;
end
\$\$;"

( umask 077; printf 'Authorization: Bearer %s\n' "$SUPABASE_ACCESS_TOKEN" > "$TMP/auth.header" )
if ! STATUS="$(printf '%s' "$SQL" \
  | python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' \
  | curl -s -o /dev/null -w '%{http_code}' -X POST \
      "https://api.supabase.com/v1/projects/${REF}/database/query" \
      -H @"$TMP/auth.header" \
      -H "Content-Type: application/json" \
      --data-binary @-)"; then
  echo "vault update failed: could not reach the Supabase Management API" >&2
  exit 1
fi

if [[ "$STATUS" != 2* ]]; then
  echo "vault update failed (HTTP ${STATUS})" >&2
  exit 1
fi
echo "vault entries worker_secret + worker_url + meta_worker_url set"
