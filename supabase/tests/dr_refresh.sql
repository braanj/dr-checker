-- Scenario test for the scheduled DR refresh (enqueue_dr_refresh). Safe to run
-- against any project: it ALWAYS ends with an exception, so every row it writes is
-- rolled back. Success is reported as the error text "SCENARIO OK"; anything else
-- ("SCENARIO FAIL: ...") names the first mismatch. Real domains that are due get
-- queued too, so assertions look at the scenario domains only.
do $$
declare
  v_queued integer;
  v_batch  uuid;
  v_other  uuid;
begin
  -- older than any real reading, so p_limit picks them before production domains
  insert into public.domains (domain, dr, status, checked_at) values
    ('scenario-refresh-oldest-1.test', 10, 'ok', now() - interval '4000 days'),
    ('scenario-refresh-oldest-2.test', 10, 'ok', now() - interval '3999 days'),
    ('scenario-refresh-oldest-3.test', 10, 'ok', now() - interval '3998 days'),
    ('scenario-refresh-stale.test', 20, 'ok', now() - interval '31 days'),
    ('scenario-refresh-fresh.test', 30, 'ok', now() - interval '29 days'),
    ('scenario-refresh-nodata.test', null, 'no_data', now() - interval '40 days'),
    ('scenario-refresh-recent.test', 40, 'ok', now() - interval '40 days');

  insert into public.batches (filename, total_urls) values ('scenario', 1) returning id into v_other;
  insert into public.urls (batch_id, original_url, domain, created_at)
  values (v_other, 'scenario-refresh-recent.test', 'scenario-refresh-recent.test', now() - interval '23 hours');

  v_queued := public.enqueue_dr_refresh(2);
  if v_queued <> 2 then
    raise exception 'SCENARIO FAIL: p_limit 2 queued %', v_queued;
  end if;
  if (select array_agg(domain order by domain) from public.urls
      where domain like 'scenario-refresh-oldest-%' and batch_id <> v_other)
     is distinct from array['scenario-refresh-oldest-1.test', 'scenario-refresh-oldest-2.test'] then
    raise exception 'SCENARIO FAIL: p_limit did not take the two oldest domains';
  end if;

  v_queued := public.enqueue_dr_refresh(100000);

  select u.batch_id into v_batch from public.urls u
  where u.domain = 'scenario-refresh-stale.test' and u.status = 'pending' and u.attempts = 0;
  if v_batch is null then
    raise exception 'SCENARIO FAIL: stale ok domain not queued as a pending url';
  end if;
  if not exists (
    select 1 from public.batches b
    where b.id = v_batch and b.filename = 'Scheduled DR refresh' and b.status = 'pending'
      and b.processed_urls = 0 and b.total_urls = v_queued
  ) then
    raise exception 'SCENARIO FAIL: refresh batch row is wrong';
  end if;
  if (select count(*) from public.urls where batch_id = v_batch) <> v_queued then
    raise exception 'SCENARIO FAIL: return value % does not match the queued rows', v_queued;
  end if;
  if not exists (select 1 from public.urls where batch_id = v_batch and domain = 'scenario-refresh-oldest-3.test') then
    raise exception 'SCENARIO FAIL: domain left over by p_limit not queued on the next run';
  end if;

  if exists (select 1 from public.urls where domain in ('scenario-refresh-fresh.test', 'scenario-refresh-nodata.test')) then
    raise exception 'SCENARIO FAIL: a fresh or no_data domain was queued';
  end if;
  if (select count(*) from public.urls where domain = 'scenario-refresh-recent.test') <> 1 then
    raise exception 'SCENARIO FAIL: a domain with a url row from the last day was queued again';
  end if;
  if (select count(*) from public.urls where domain like 'scenario-refresh-oldest-%') <> 3 then
    raise exception 'SCENARIO FAIL: an already queued domain was queued twice';
  end if;

  v_queued := public.enqueue_dr_refresh(100000);
  if v_queued <> 0 then
    raise exception 'SCENARIO FAIL: an immediate second run queued %', v_queued;
  end if;

  raise exception 'SCENARIO OK';
end;
$$;
