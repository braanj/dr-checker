-- ============================================================================
-- DR Checker schema (end state, see specs/adr/0001-domain-directory.md)
-- Fresh installs: run this in the Supabase SQL editor.
-- Existing projects: apply supabase/migrations/ with `supabase db push`
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- One row per submitted check (typed list or CSV). Anonymous: the
-- unguessable id in the results link is the only key.
create table if not exists public.batches (
  id             uuid primary key default gen_random_uuid(),
  filename       text not null,
  total_urls     integer not null default 0,
  processed_urls integer not null default 0,
  status         text not null default 'pending'
                 check (status in ('pending', 'processing', 'completed', 'failed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.urls (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.batches (id) on delete cascade,
  original_url  text not null,
  domain        text not null,
  dr            numeric,
  status        text not null default 'pending'
                check (status in ('pending', 'processing', 'done', 'error')),
  error_message text,
  -- provenance: where the DR came from and when it was actually fetched
  source        text check (source in ('live', 'cache', 'stale', 'no_data')),
  checked_at    timestamptz,
  -- retries / stuck-row recovery (see claim_pending_urls)
  attempts      integer not null default 0,
  available_at  timestamptz not null default now(),
  claimed_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_urls_batch_id on public.urls (batch_id);
create index if not exists idx_urls_claimable
  on public.urls (status, available_at)
  where status in ('pending', 'processing');

-- The public directory and the DR cache. 'ok' rows are fresh for 30 days,
-- 'no_data' rows for 7 (TTLs live in supabase/functions/_shared/cache.ts).
-- Transient Ahrefs failures are never written here.
create table if not exists public.domains (
  domain     text primary key,
  dr         numeric,
  status     text not null check (status in ('ok', 'no_data')),
  checked_at timestamptz not null default now()
);
create index if not exists idx_domains_dr on public.domains (dr);
create index if not exists idx_domains_checked_at on public.domains (checked_at);

-- Per-IP request log for /api/check rate limiting.
create table if not exists public.check_requests (
  id         bigint generated always as identity primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_check_requests_ip_created on public.check_requests (ip, created_at);

-- keep `updated_at` fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_batches_updated_at on public.batches;
create trigger trg_batches_updated_at
  before update on public.batches
  for each row execute function public.set_updated_at();

drop trigger if exists trg_urls_updated_at on public.urls;
create trigger trg_urls_updated_at
  before update on public.urls
  for each row execute function public.set_updated_at();

-- Roll batch.processed_urls / status up whenever a url row finishes.
-- Rows inserted already resolved (cache hits) are pre-counted by
-- /api/check, since this only fires on UPDATE.
create or replace function public.bump_batch_progress()
returns trigger language plpgsql as $$
declare
  v_total     integer;
  v_processed integer;
begin
  if (tg_op = 'UPDATE' and old.status <> new.status and new.status in ('done', 'error')) then
    -- Lock the batch row first: concurrent url updates of the same batch
    -- then serialize here, and the count below (a fresh READ COMMITTED
    -- snapshot taken after the lock) sees the other transaction's row.
    -- Without it two parallel updates can both count n-1 and leave the
    -- batch stuck at "processing" forever.
    select total_urls into v_total from public.batches where id = new.batch_id for update;

    select count(*) into v_processed
    from public.urls
    where batch_id = new.batch_id and status in ('done', 'error');

    update public.batches
    set processed_urls = v_processed,
        status = case when v_processed >= v_total then 'completed' else 'processing' end
    where id = new.batch_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bump_batch_progress on public.urls;
create trigger trg_bump_batch_progress
  after update on public.urls
  for each row execute function public.bump_batch_progress();

-- ----------------------------------------------------------------------------
-- Atomic claim: up to p_limit rows that are pending and due, plus any
-- 'processing' rows whose worker died (claimed > 2 minutes ago). Each claim
-- counts as an attempt. FOR UPDATE SKIP LOCKED keeps concurrent
-- invocations (webhook + cron) from double-processing a row.
-- ----------------------------------------------------------------------------

drop function if exists public.claim_pending_urls(integer);
create function public.claim_pending_urls(p_limit integer default 5)
returns table (id uuid, domain text, attempts integer)
language plpgsql
as $$
begin
  return query
  update public.urls
  set status = 'processing',
      claimed_at = now(),
      attempts = urls.attempts + 1
  where urls.id in (
    select u.id
    from public.urls u
    where (u.status = 'pending' and u.available_at <= now())
       or (u.status = 'processing' and u.claimed_at < now() - interval '2 minutes')
    order by u.available_at
    limit p_limit
    for update skip locked
  )
  returning urls.id, urls.domain, urls.attempts;
end;
$$;

-- ----------------------------------------------------------------------------
-- Rate limiting: records the request and returns true, or returns false if
-- the IP already made p_limit requests in the last minute.
-- ----------------------------------------------------------------------------

create or replace function public.register_check_request(p_ip text, p_limit integer default 10)
returns boolean
language plpgsql
as $$
declare
  v_recent integer;
begin
  -- serialize concurrent requests from the same IP so the count is exact
  perform pg_advisory_xact_lock(hashtext(p_ip));

  select count(*) into v_recent
  from public.check_requests
  where ip = p_ip and created_at > now() - interval '1 minute';

  if v_recent >= p_limit then
    return false;
  end if;

  insert into public.check_requests (ip) values (p_ip);
  return true;
end;
$$;

-- RPCs are server-only (service role).
revoke execute on function public.claim_pending_urls(integer) from public, anon, authenticated;
revoke execute on function public.register_check_request(text, integer) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Row Level Security: enabled with NO policies, so nothing is readable with
-- the anon key. All access goes through the server's service-role client.
-- ----------------------------------------------------------------------------

alter table public.batches enable row level security;
alter table public.urls enable row level security;
alter table public.domains enable row level security;
alter table public.check_requests enable row level security;

-- ----------------------------------------------------------------------------
-- Live sync: broadcast client-facing fields to the public channel
-- 'batch:<batch id>'. Knowing the batch id is the only way to listen.
-- ----------------------------------------------------------------------------

create or replace function public.broadcast_url_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'original_url', new.original_url,
      'domain', new.domain,
      'dr', new.dr,
      'status', new.status,
      'error_message', new.error_message,
      'source', new.source,
      'checked_at', new.checked_at
    ),
    'url',
    'batch:' || new.batch_id::text,
    false
  );
  return null;
end;
$$;

create or replace function public.broadcast_batch_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'total_urls', new.total_urls,
      'processed_urls', new.processed_urls,
      'status', new.status
    ),
    'batch',
    'batch:' || new.id::text,
    false
  );
  return null;
end;
$$;

drop trigger if exists trg_broadcast_url on public.urls;
create trigger trg_broadcast_url
  after update on public.urls
  for each row execute function public.broadcast_url_change();

drop trigger if exists trg_broadcast_batch on public.batches;
create trigger trg_broadcast_batch
  after update on public.batches
  for each row execute function public.broadcast_batch_change();

-- ----------------------------------------------------------------------------
-- Worker triggering (ADR 0002)
-- ----------------------------------------------------------------------------

-- 1. single-row lease: at most one drain loop at a time -----------------------
create table if not exists public.worker_lease (
  id         smallint primary key default 1 check (id = 1),
  holder     uuid,
  expires_at timestamptz not null default '-infinity'
);
insert into public.worker_lease (id) values (1) on conflict (id) do nothing;
alter table public.worker_lease enable row level security;

-- Acquire, or renew if already held by p_holder. Concurrent callers serialize
-- on the row lock; the loser re-checks the WHERE against the winner's row and
-- gets false.
create or replace function public.acquire_worker_lease(p_holder uuid, p_ttl_seconds integer default 60)
returns boolean
language plpgsql
as $$
begin
  update public.worker_lease
  set holder = p_holder,
      expires_at = now() + make_interval(secs => p_ttl_seconds)
  where id = 1
    and (holder is null or holder = p_holder or expires_at < now());
  return found;
end;
$$;

create or replace function public.release_worker_lease(p_holder uuid)
returns void
language plpgsql
as $$
begin
  update public.worker_lease
  set holder = null, expires_at = '-infinity'
  where id = 1 and holder = p_holder;
end;
$$;

-- 2. the only caller of the edge function --------------------------------------
create or replace function public.kick_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_url    text;
begin
  -- cheap guard (idx_urls_claimable): never wake the worker for nothing
  if not exists (
    select 1 from public.urls u
    where (u.status = 'pending' and u.available_at <= now())
       or (u.status = 'processing' and u.claimed_at < now() - interval '2 minutes')
  ) then
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'worker_secret';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'worker_url';

  if v_secret is null or v_url is null then
    raise warning 'kick_worker: vault entries worker_secret/worker_url missing; worker not started';
    return;
  end if;

  -- async: queued now, sent by pg_net after commit
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;

-- 3. statement-level trigger replaces the per-row dashboard webhook ---------
create or replace function public.urls_kick_worker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from inserted where status = 'pending') then
    perform public.kick_worker();
  end if;
  return null;
end;
$$;

drop trigger if exists trg_urls_kick_worker on public.urls;
create trigger trg_urls_kick_worker
  after insert on public.urls
  referencing new table as inserted
  for each statement execute function public.urls_kick_worker();

-- 4. server-only ---------------------------------------------------------------
revoke execute on function public.acquire_worker_lease(uuid, integer) from public, anon, authenticated;
revoke execute on function public.release_worker_lease(uuid) from public, anon, authenticated;
revoke execute on function public.kick_worker() from public, anon, authenticated;
revoke execute on function public.urls_kick_worker() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- pg_cron: hourly cleanup of the rate-limit log
-- ----------------------------------------------------------------------------

select cron.unschedule(jobid) from cron.job where jobname = 'check-requests-cleanup';
select cron.schedule(
  'check-requests-cleanup',
  '0 * * * *',
  $$delete from public.check_requests where created_at < now() - interval '1 day'$$
);

-- ----------------------------------------------------------------------------
-- pg_cron backstop (ADR 0002): every 10 s, kick_worker() starts the worker
-- only if rows are due (retries after backoff, stuck-row reclaim). It reads
-- the function URL and shared secret from Vault — run
-- scripts/provision-worker-secret.sh once per project; nothing to edit here.
-- ----------------------------------------------------------------------------

select cron.unschedule(jobid) from cron.job where jobname = 'process-queue-backstop';
select cron.schedule('process-queue-backstop', '10 seconds', $$select public.kick_worker()$$);
