-- ============================================================================
-- ADR 0003 (Part B): site metadata. A separate fetch-meta edge function,
-- started every minute by kick_meta_worker() (Vault: worker_secret +
-- meta_worker_url), claims due domains and stores title/description and a
-- favicon in the public `favicons` bucket.
-- ============================================================================

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

select cron.unschedule(jobid) from cron.job where jobname = 'fetch-meta';
select cron.schedule('fetch-meta', '* * * * *', $$select public.kick_meta_worker()$$);
