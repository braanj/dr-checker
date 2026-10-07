-- ============================================================================
-- Domain directory (ADR 0001): domains cache/directory, anonymous batches,
-- retries + stuck-row recovery, broadcast-based live sync, per-IP limits.
-- Upgrades a project created from the previous schema.sql. Fresh installs
-- should run supabase/schema.sql instead.
-- ============================================================================

begin;

-- 1. domains: the public directory and the DR cache -------------------------
create table if not exists public.domains (
  domain     text primary key,
  dr         numeric,
  status     text not null check (status in ('ok', 'no_data')),
  checked_at timestamptz not null default now()
);
create index if not exists idx_domains_dr on public.domains (dr);
create index if not exists idx_domains_checked_at on public.domains (checked_at);
alter table public.domains enable row level security;

insert into public.domains (domain, dr, status, checked_at)
select domain, dr, 'ok', checked_at
from public.domain_summary
where dr is not null
on conflict (domain) do nothing;

-- 2. urls: provenance, retries, stuck-row recovery --------------------------
alter table public.urls
  add column if not exists source       text check (source in ('live', 'cache', 'stale', 'no_data')),
  add column if not exists checked_at   timestamptz,
  add column if not exists attempts     integer not null default 0,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists claimed_at   timestamptz;

update public.urls
set source = 'live', checked_at = updated_at
where status = 'done' and source is null;

-- rows the previous worker left stuck in 'processing' have no claimed_at;
-- give them one so the 2-minute reclaim below picks them up
update public.urls
set claimed_at = updated_at
where status = 'processing' and claimed_at is null;

drop index if exists public.idx_urls_status_pending;
create index if not exists idx_urls_claimable
  on public.urls (status, available_at)
  where status in ('pending', 'processing');

-- 3. accounts out: policies, FKs, columns, then the throwaway users ---------
-- Order matters: user_id FKs are ON DELETE CASCADE, so the columns must be
-- gone before the auth users are deleted or every batch would be wiped.
drop policy if exists "users read own batches" on public.batches;
drop policy if exists "users read own urls" on public.urls;
alter table public.urls drop column if exists user_id;
alter table public.batches drop column if exists user_id;  -- also drops idx_batches_user_id

delete from auth.users where email like '%@dr-checker.local';

-- 4. view replaced by the domains table --------------------------------------
drop view if exists public.domain_summary;

-- 5. progress rollup: lock the batch row before counting (lost-update fix)
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

-- 6. claim: available_at gating + reclaim of stuck rows ---------------------
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
revoke execute on function public.claim_pending_urls(integer) from public, anon, authenticated;

-- 7. per-IP rate limiting ------------------------------------------------------
create table if not exists public.check_requests (
  id         bigint generated always as identity primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_check_requests_ip_created on public.check_requests (ip, created_at);
alter table public.check_requests enable row level security;

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
revoke execute on function public.register_check_request(text, integer) from public, anon, authenticated;

-- 8. live sync: broadcast instead of postgres_changes -----------------------
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

do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'urls') then
    alter publication supabase_realtime drop table public.urls;
  end if;
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'batches') then
    alter publication supabase_realtime drop table public.batches;
  end if;
end;
$$;

commit;

-- 9. cleanup job (outside the transaction: pg_cron manages its own) --------
select cron.unschedule(jobid) from cron.job where jobname = 'check-requests-cleanup';
select cron.schedule(
  'check-requests-cleanup',
  '0 * * * *',
  $$delete from public.check_requests where created_at < now() - interval '1 day'$$
);
