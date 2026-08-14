-- ============================================================================
-- DR Checker schema
-- Run this in the Supabase SQL editor (or `supabase db push`)
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table if not exists public.batches (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
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
  user_id       uuid not null references auth.users (id) on delete cascade,
  original_url  text not null,
  domain        text not null,
  dr            numeric,
  status        text not null default 'pending'
                check (status in ('pending', 'processing', 'done', 'error')),
  error_message text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_urls_batch_id on public.urls (batch_id);
create index if not exists idx_urls_status_pending on public.urls (status) where status = 'pending';
create index if not exists idx_batches_user_id on public.batches (user_id);

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
create or replace function public.bump_batch_progress()
returns trigger language plpgsql as $$
declare
  v_total     integer;
  v_processed integer;
begin
  if (tg_op = 'UPDATE' and old.status <> new.status and new.status in ('done', 'error')) then
    select total_urls into v_total from public.batches where id = new.batch_id;

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
-- domain_summary: one row per unique domain ever checked, with its most
-- recent DR and check date. Powers the public "previously processed
-- domains" table on the upload page. Reads go through a server route using
-- the service role key, so this is intentionally NOT filtered by user —
-- it's a shared, cross-user history of everything the app has looked up.
-- ----------------------------------------------------------------------------

create or replace view public.domain_summary as
select distinct on (domain)
  domain,
  dr,
  updated_at as checked_at
from public.urls
where status = 'done'
order by domain, updated_at desc;

-- ----------------------------------------------------------------------------
-- Atomic claim function: marks up to p_limit pending rows as 'processing'
-- and returns them. FOR UPDATE SKIP LOCKED means concurrent invocations of
-- the edge function (different batches, different users, overlapping cron
-- + webhook triggers) never grab the same row twice.
-- ----------------------------------------------------------------------------

create or replace function public.claim_pending_urls(p_limit integer default 5)
returns table (id uuid, domain text)
language plpgsql
as $$
begin
  return query
  update public.urls
  set status = 'processing'
  where urls.id in (
    select u.id
    from public.urls u
    where u.status = 'pending'
    order by u.created_at
    limit p_limit
    for update skip locked
  )
  returning urls.id, urls.domain;
end;
$$;

-- ----------------------------------------------------------------------------
-- Row Level Security — each user only ever sees their own batches/urls.
-- All writes from the app go through the server (service role), which
-- bypasses RLS, so these policies are effectively "read-only for the owner".
-- ----------------------------------------------------------------------------

alter table public.batches enable row level security;
alter table public.urls enable row level security;

create policy "users read own batches"
  on public.batches for select
  using (auth.uid() = user_id);

create policy "users read own urls"
  on public.urls for select
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Realtime: publish changes on both tables so the client can subscribe
-- ----------------------------------------------------------------------------

alter publication supabase_realtime add table public.batches;
alter publication supabase_realtime add table public.urls;

-- ----------------------------------------------------------------------------
-- pg_cron backstop: calls the process-queue edge function every 10s so
-- processing continues even if the insert-triggered webhook invocation
-- was missed, crashed mid-batch, or the project cold-started.
--
-- Replace <PROJECT_REF> and <ANON_OR_SERVICE_KEY> after deploying the
-- function. Safe to re-run; unschedules any previous job of the same name.
-- ----------------------------------------------------------------------------

select cron.unschedule(jobid)
from cron.job
where jobname = 'process-queue-backstop';

select cron.schedule(
  'process-queue-backstop',
  '10 seconds',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.functions.supabase.co/process-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);
