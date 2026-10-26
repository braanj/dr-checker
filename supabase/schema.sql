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
  checked_at timestamptz not null default now(),
  dr_change  numeric  -- latest ok reading minus the previous one (maintained by trigger)
);
create index if not exists idx_domains_dr_change on public.domains (dr_change);
create index if not exists idx_domains_dr on public.domains (dr);
create index if not exists idx_domains_checked_at on public.domains (checked_at);

-- Per-IP request log for /api/check rate limiting.
create table if not exists public.check_requests (
  id         bigint generated always as identity primary key,
  ip         text not null,
  kind       text not null default 'check' check (kind in ('check', 'export')),
  created_at timestamptz not null default now()
);
create index if not exists idx_check_requests_ip_kind_created on public.check_requests (ip, kind, created_at);

-- One row per real Ahrefs reading (ADR 0003); written by the worker.
create table if not exists public.domain_history (
  id         bigint generated always as identity primary key,
  domain     text not null,
  dr         numeric not null,
  checked_at timestamptz not null,
  unique (domain, checked_at)  -- also serves "latest first per domain" (backward index scan)
);

-- domains.dr_change = latest reading minus the one before it.
create or replace function public.refresh_dr_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.domains d
  set dr_change = (
    select (array_agg(t.dr order by t.checked_at desc))[1] - (array_agg(t.dr order by t.checked_at desc))[2]
    from (select dr, checked_at from public.domain_history
          where domain = new.domain order by checked_at desc limit 2) t
  )
  where d.domain = new.domain;
  return null;
end;
$$;

drop trigger if exists domain_history_refresh_dr_change on public.domain_history;
create trigger domain_history_refresh_dr_change
  after insert or update on public.domain_history
  for each row execute function public.refresh_dr_change();

-- Last p_n readings per domain, newest first, for list sparklines.
create or replace function public.domain_trends(p_domains text[], p_n integer)
returns table(domain text, dr numeric, checked_at timestamptz)
language sql
stable
set search_path = public
as $$
  select q.domain, h.dr, h.checked_at
  from unnest(p_domains) as q(domain)
  cross join lateral (
    select dr, checked_at from public.domain_history
    where domain = q.domain order by checked_at desc limit p_n
  ) h;
$$;

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

-- Roll batch.processed_urls / status up whenever a url row finishes
-- (processing → completed, or failed when every row is an error).
-- Rows inserted already resolved (cache hits) are pre-counted by
-- /api/check, since this only fires on UPDATE.
create or replace function public.bump_batch_progress()
returns trigger language plpgsql as $$
declare
  v_total     integer;
  v_processed integer;
  v_errors    integer;
begin
  if (tg_op = 'UPDATE' and old.status <> new.status and new.status in ('done', 'error')) then
    -- Lock the batch row first: concurrent url updates of the same batch
    -- then serialize here, and the count below (a fresh READ COMMITTED
    -- snapshot taken after the lock) sees the other transaction's row.
    -- Without it two parallel updates can both count n-1 and leave the
    -- batch stuck at "processing" forever.
    select total_urls into v_total from public.batches where id = new.batch_id for update;

    select count(*) filter (where status in ('done', 'error')),
           count(*) filter (where status = 'error')
    into v_processed, v_errors
    from public.urls
    where batch_id = new.batch_id;

    -- finished: `failed` when no row got a DR, otherwise `completed`
    update public.batches
    set processed_urls = v_processed,
        status = case
          when v_processed < v_total then 'processing'
          when v_errors >= v_total then 'failed'
          else 'completed'
        end
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
  with claimed as (
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
    returning urls.id, urls.domain, urls.attempts, urls.batch_id
  ),
  -- a queued batch becomes `processing` when its first row is claimed
  started as (
    update public.batches b
    set status = 'processing'
    where b.status = 'pending'
      and b.id in (select c.batch_id from claimed c)
  )
  select c.id, c.domain, c.attempts from claimed c;
end;
$$;

-- ----------------------------------------------------------------------------
-- Rate limiting: records the request and returns true, or returns false if
-- the IP already made p_limit requests of that kind in the last minute.
-- ----------------------------------------------------------------------------

create or replace function public.register_check_request(p_ip text, p_limit integer default 10, p_kind text default 'check')
returns boolean
language plpgsql
as $$
declare
  v_recent integer;
begin
  -- serialize concurrent requests from the same IP and kind so the count is exact
  perform pg_advisory_xact_lock(hashtext(p_ip || ':' || p_kind));

  select count(*) into v_recent
  from public.check_requests
  where ip = p_ip and kind = p_kind and created_at > now() - interval '1 minute';

  if v_recent >= p_limit then
    return false;
  end if;

  insert into public.check_requests (ip, kind) values (p_ip, p_kind);
  return true;
end;
$$;

-- RPCs are server-only (service role).
revoke execute on function public.claim_pending_urls(integer) from public, anon, authenticated;
revoke execute on function public.register_check_request(text, integer, text) from public, anon, authenticated;
revoke execute on function public.domain_trends(text[], integer) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Row Level Security: enabled with NO policies, so nothing is readable with
-- the anon key. All access goes through the server's service-role client.
-- ----------------------------------------------------------------------------

alter table public.batches enable row level security;
alter table public.urls enable row level security;
alter table public.domains enable row level security;
alter table public.check_requests enable row level security;
alter table public.domain_history enable row level security;

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
      'checked_at', new.checked_at,
      'attempts', new.attempts,
      'available_at', new.available_at
    ),
    'url',
    'batch:' || new.batch_id::text,
    true  -- private: only receivers allowed by RLS on realtime.messages
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
    true  -- private: only receivers allowed by RLS on realtime.messages
  );
  return null;
end;
$$;

-- Private broadcasts: anon may RECEIVE batch:* topics; with no insert policy
-- nobody can SEND to them with the public key (no spoofed progress).
drop policy if exists "anon receives batch broadcasts" on realtime.messages;
create policy "anon receives batch broadcasts"
  on realtime.messages
  for select
  to anon, authenticated
  using (realtime.messages.extension = 'broadcast' and realtime.topic() like 'batch:%');

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
    -- the function answers only after its drain loop (≤ 150 s wall clock)
    timeout_milliseconds := 150000
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
-- Site metadata (ADR 0003): fetch-meta edge function, started every minute
-- by kick_meta_worker() (Vault: worker_secret + meta_worker_url).
-- ----------------------------------------------------------------------------

create table if not exists public.domain_meta (
  domain       text primary key,
  title        text,
  description  text,
  favicon_path text,
  status       text check (status in ('ok', 'error')),  -- null = never fetched
  error        text,
  fetched_at   timestamptz,
  claimed_at   timestamptz,
  attempts     integer not null default 0
);
alter table public.domain_meta enable row level security;

-- One place for the cadence: never fetched, ok > 30 days, error > 7 days,
-- or claimed > 2 minutes ago and never finished. In-flight rows are not due.
create or replace function public.meta_due(p_status text, p_fetched_at timestamptz, p_claimed_at timestamptz)
returns boolean
language sql
stable
as $$
  select
    not (p_claimed_at is not null
         and p_claimed_at > coalesce(p_fetched_at, '-infinity'::timestamptz)
         and p_claimed_at > now() - interval '2 minutes')
    and (
      p_status is null
      or (p_status = 'ok' and p_fetched_at < now() - interval '30 days')
      or (p_status = 'error' and p_fetched_at < now() - interval '7 days')
      or (p_claimed_at is not null and p_claimed_at > coalesce(p_fetched_at, '-infinity'::timestamptz))
    )
$$;

create or replace function public.claim_meta_domains(p_limit integer default 1)
returns setof text
language plpgsql
as $$
begin
  -- give up on domains whose runs never finished 3 times in a row (crashes,
  -- CPU kills): mark them `error`, so meta_due() waits the normal 7 days
  -- instead of reclaiming them every 2 minutes forever
  update public.domain_meta
  set status = 'error',
      error = 'gave up: 3 runs never finished',
      fetched_at = now(),
      claimed_at = null,
      attempts = 0
  where claimed_at is not null
    and claimed_at > coalesce(fetched_at, '-infinity'::timestamptz)
    and claimed_at < now() - interval '2 minutes'
    and attempts >= 3;

  -- every `ok` domain gets a meta row so it can be locked and claimed
  insert into public.domain_meta (domain)
  select d.domain from public.domains d
  where d.status = 'ok'
    and not exists (select 1 from public.domain_meta x where x.domain = d.domain)
  on conflict (domain) do nothing;

  return query
  update public.domain_meta m
  set claimed_at = now(), attempts = m.attempts + 1
  where m.domain in (
    select x.domain
    from public.domain_meta x
    join public.domains d on d.domain = x.domain and d.status = 'ok'
    where public.meta_due(x.status, x.fetched_at, x.claimed_at)
    order by x.fetched_at nulls first, x.domain
    limit p_limit
    for update of x skip locked
  )
  returning m.domain;
end;
$$;

create or replace function public.kick_meta_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_url    text;
begin
  if not exists (
    select 1 from public.domains d
    left join public.domain_meta x on x.domain = d.domain
    where d.status = 'ok' and public.meta_due(x.status, x.fetched_at, x.claimed_at)
  ) then
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'worker_secret';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'meta_worker_url';
  if v_secret is null or v_url is null then
    raise warning 'kick_meta_worker: vault entries worker_secret/meta_worker_url missing; worker not started';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    body := '{}'::jsonb,
    -- run budget (60 s) + one domain's hard deadline (20 s), with slack
    timeout_milliseconds := 120000
  );
end;
$$;

revoke execute on function public.meta_due(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.claim_meta_domains(integer) from public, anon, authenticated;
revoke execute on function public.kick_meta_worker() from public, anon, authenticated;

-- public-read bucket; size and type limits are enforced server-side too
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('favicons', 'favicons', true, 102400,
        array['image/png','image/x-icon','image/vnd.microsoft.icon','image/jpeg','image/gif','image/webp','image/svg+xml'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

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

-- fetch-meta (ADR 0003): every minute, only when some domain's metadata is due
select cron.unschedule(jobid) from cron.job where jobname = 'fetch-meta';
select cron.schedule('fetch-meta', '* * * * *', $$select public.kick_meta_worker()$$);
