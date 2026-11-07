-- Scheduled DR refresh. A directory DR is only re-checked when someone submits
-- the domain again, so most history stops growing; 540 of 613 directory domains
-- cross 30 days within a week of 2026-11-07. Every 15 minutes, 10 stale domains
-- go back through the url queue (process-queue does the Ahrefs call, retries and
-- history), which paces that wave at ~960 a day, far under the worker's capacity.

-- Re-queues up to p_limit directory domains whose ok DR has gone stale, as one
-- batch, so domain_history keeps growing without a user resubmitting them. The
-- interval matches CACHE_TTL_DAYS (tests/refreshCadence.test.ts). A url row from
-- the last day means the domain is queued, in flight, or just failed
-- transiently, so it is retried daily rather than every run.
create or replace function public.enqueue_dr_refresh(p_limit integer default 10)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_domains text[];
  v_batch   uuid;
begin
  -- overlapping runs would otherwise both see a domain as due and queue it twice
  perform pg_advisory_xact_lock(hashtext('enqueue_dr_refresh'));

  select array_agg(domain order by checked_at) into v_domains
  from (
    select d.domain, d.checked_at
    from domains d
    where d.status = 'ok'
      and d.checked_at < now() - interval '30 days'
      and not exists (
        select 1 from urls u
        where u.domain = d.domain and u.created_at > now() - interval '1 day'
      )
    order by d.checked_at
    limit p_limit
  ) due;

  if v_domains is null then
    return 0;
  end if;

  insert into batches (filename, total_urls, processed_urls, status)
  values ('Scheduled DR refresh', cardinality(v_domains), 0, 'pending')
  returning id into v_batch;

  insert into urls (batch_id, original_url, domain)
  select v_batch, d, d from unnest(v_domains) as d;

  return cardinality(v_domains);
end;
$$;

revoke execute on function public.enqueue_dr_refresh(integer) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'dr-refresh';
select cron.schedule('dr-refresh', '*/15 * * * *', $$select public.enqueue_dr_refresh(10)$$);
