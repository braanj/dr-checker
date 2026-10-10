-- Scenario test for batch status states (step 4). Safe to run against any
-- project: it ALWAYS ends with an exception, so every change it makes
-- (rows, the queued pg_net kick, broadcast messages) is rolled back.
-- Success is reported as the error text "SCENARIO OK"; anything else
-- ("SCENARIO FAIL: ...") names the first mismatch.
do $$
declare
  v_batch  uuid;
  v_status text;
  v_count  integer;
  v_ids    uuid[];

begin
  -- Scenario 1: pending → processing on claim → failed when every row errors
  insert into public.batches (filename, total_urls, processed_urls, status)
  values ('scenario-1', 2, 0, 'pending') returning id into v_batch;
  insert into public.urls (batch_id, original_url, domain, status, available_at)
  values (v_batch, 's1a.test', 's1a.test', 'pending', '2000-01-01'),
         (v_batch, 's1b.test', 's1b.test', 'pending', '2000-01-01');

  select array_agg(id) into v_ids from public.claim_pending_urls(2);
  if coalesce(array_length(v_ids, 1), 0) <> 2 then
    raise exception 'SCENARIO FAIL: claim returned % rows, expected 2', coalesce(array_length(v_ids, 1), 0);
  end if;
  select status into v_status from public.batches where id = v_batch;
  if v_status <> 'processing' then
    raise exception 'SCENARIO FAIL: after claim, batch is %, expected processing', v_status;
  end if;

  update public.urls set status = 'error' where id = v_ids[1];
  select status into v_status from public.batches where id = v_batch;
  if v_status <> 'processing' then
    raise exception 'SCENARIO FAIL: after 1/2 errors, batch is %, expected processing', v_status;
  end if;

  update public.urls set status = 'error' where id = v_ids[2];
  select status into v_status from public.batches where id = v_batch;
  if v_status <> 'failed' then
    raise exception 'SCENARIO FAIL: after 2/2 errors, batch is %, expected failed', v_status;
  end if;

  -- Scenario 2: one done + one error → completed
  insert into public.batches (filename, total_urls, processed_urls, status)
  values ('scenario-2', 2, 0, 'pending') returning id into v_batch;
  insert into public.urls (batch_id, original_url, domain, status, available_at)
  values (v_batch, 's2a.test', 's2a.test', 'pending', '2000-01-01'),
         (v_batch, 's2b.test', 's2b.test', 'pending', '2000-01-01');

  select array_agg(id) into v_ids from public.claim_pending_urls(2);
  update public.urls set status = 'done', dr = 10 where id = v_ids[1];
  update public.urls set status = 'error' where id = v_ids[2];
  select status into v_status from public.batches where id = v_batch;
  if v_status <> 'completed' then
    raise exception 'SCENARIO FAIL: done + error, batch is %, expected completed', v_status;
  end if;

  -- No scenario batch may be left pending once its rows were claimed
  select count(*) into v_count from public.batches where filename like 'scenario-%' and status = 'pending';
  if v_count <> 0 then
    raise exception 'SCENARIO FAIL: % scenario batches still pending', v_count;
  end if;

  raise exception 'SCENARIO OK';
end;
$$;
