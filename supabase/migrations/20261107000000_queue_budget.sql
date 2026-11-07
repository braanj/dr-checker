-- Per-IP budget on queued (uncached) domains. The request limit alone let one IP
-- queue 10,000 domains a minute against a worker that clears about 140 a minute,
-- so everyone else waited hours. A rate-limit row now carries a weight, and a
-- kind is limited on the sum of weights over its window.

alter table public.check_requests
  add column if not exists weight integer not null default 1 check (weight > 0);
alter table public.check_requests drop constraint if exists check_requests_kind_check;
alter table public.check_requests
  add constraint check_requests_kind_check check (kind in ('check', 'export', 'rows'));

drop function if exists public.register_check_request(text, integer, text);
-- p_window_seconds must stay under 1 day: the cleanup cron deletes older rows.
create or replace function public.register_check_request(
  p_ip text,
  p_limit integer default 10,
  p_kind text default 'check',
  p_weight integer default 1,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
as $$
declare
  v_used integer;
begin
  -- serialize concurrent requests from the same IP and kind so the sum is exact
  perform pg_advisory_xact_lock(hashtext(p_ip || ':' || p_kind));

  select coalesce(sum(weight), 0) into v_used
  from public.check_requests
  where ip = p_ip and kind = p_kind and created_at > now() - make_interval(secs => p_window_seconds);

  if v_used + p_weight > p_limit then
    return false;
  end if;

  insert into public.check_requests (ip, kind, weight) values (p_ip, p_kind, p_weight);
  return true;
end;
$$;

revoke execute on function public.register_check_request(text, integer, text, integer, integer) from public, anon, authenticated;
