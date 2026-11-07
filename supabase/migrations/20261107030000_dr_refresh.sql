-- Scheduled DR refresh. A directory DR was re-checked only when someone submitted
-- the domain again, so most history stopped growing. Every 15 minutes, up to 10 ok
-- domains whose reading is older than CACHE_TTL_DAYS go back through the url queue,
-- and process-queue does the Ahrefs call, retries and history. A url row from the
-- last day means a domain is queued, in flight or just failed, so it is retried
-- daily rather than every run.

create or replace function public.enqueue_dr_refresh(p_limit integer default 10)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_domains text[];
  v_batch   uuid;
begin
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
