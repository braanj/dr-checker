-- ============================================================================
-- ADR 0002: one paced drain loop, started by a statement-level trigger and a
-- due-rows-only cron, authenticated with a shared secret held in Vault.
-- Requires Vault entries `worker_secret` and `worker_url`
-- (scripts/provision-worker-secret.sh). Without them kick_worker() only warns.
-- ============================================================================

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

drop trigger if exists "process-queue" on public.urls;  -- dashboard webhook (ADR 0001)
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

-- 5. backstop: no key in cron.job, and no HTTP call unless rows are due --------
select cron.unschedule(jobid) from cron.job where jobname = 'process-queue-backstop';
select cron.schedule('process-queue-backstop', '10 seconds', $$select public.kick_worker()$$);
