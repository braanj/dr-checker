-- ADR 0003 Part B fix: a domain whose fetch-meta runs never finish (run
-- killed mid-domain) is finalized as `error` after 3 unfinished claims,
-- instead of being reclaimed every 2 minutes forever. Finished outcomes
-- (ok/error) already clear claimed_at and reset attempts (metaOutcome.ts).

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
revoke execute on function public.claim_meta_domains(integer) from public, anon, authenticated;
