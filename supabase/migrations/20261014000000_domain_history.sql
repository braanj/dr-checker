-- ============================================================================
-- ADR 0003 (Part A): one row per real Ahrefs reading. Written by the
-- process-queue worker on every `ok` result; backfilled from past live checks.
-- ============================================================================

create table if not exists public.domain_history (
  id         bigint generated always as identity primary key,
  domain     text not null,
  dr         numeric not null,
  checked_at timestamptz not null,
  unique (domain, checked_at)  -- also serves "latest first per domain" (backward index scan)
);
alter table public.domain_history enable row level security;

insert into public.domain_history (domain, dr, checked_at)
select distinct on (domain, checked_at) domain, dr, checked_at
from public.urls
where source = 'live' and dr is not null and checked_at is not null
order by domain, checked_at
on conflict (domain, checked_at) do nothing;
