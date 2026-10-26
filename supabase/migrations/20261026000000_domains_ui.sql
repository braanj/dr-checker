-- Domains UI: latest DR change per domain, batched sparkline data, and
-- per-kind rate limits (check vs export).

-- 1. dr_change = latest ok reading minus the one before it (null with < 2 readings).
alter table public.domains add column if not exists dr_change numeric;
create index if not exists idx_domains_dr_change on public.domains (dr_change);

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

-- Backfill from existing history.
update public.domains d set dr_change = s.change
from (select domain,
             dr - lead(dr) over w as change,
             row_number() over w as rn
      from public.domain_history
      window w as (partition by domain order by checked_at desc)) s
where s.domain = d.domain and s.rn = 1;

-- 2. Last p_n readings per domain, newest first, for list sparklines.
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

-- 3. Per-kind rate limits.
alter table public.check_requests
  add column if not exists kind text not null default 'check' check (kind in ('check', 'export'));
drop index if exists public.idx_check_requests_ip_created;
create index if not exists idx_check_requests_ip_kind_created on public.check_requests (ip, kind, created_at);

drop function if exists public.register_check_request(text, integer);
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

revoke execute on function public.domain_trends(text[], integer) from public, anon, authenticated;
revoke execute on function public.register_check_request(text, integer, text) from public, anon, authenticated;
