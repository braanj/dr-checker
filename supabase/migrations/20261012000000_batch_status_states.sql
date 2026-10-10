-- ============================================================================
-- Batch status states (step 4):
--   pending    queued, no row claimed yet (set by /api/check)
--   processing first row claimed (claim_pending_urls flips it)
--   completed  finished, at least one row has a DR
--   failed     finished, every row is an error
-- ============================================================================

create or replace function public.bump_batch_progress()
returns trigger language plpgsql as $$
declare
  v_total     integer;
  v_processed integer;
  v_errors    integer;
begin
  if (tg_op = 'UPDATE' and old.status <> new.status and new.status in ('done', 'error')) then
    -- Lock the batch row first: concurrent url updates of the same batch
    -- then serialize here, and the count below (a fresh READ COMMITTED
    -- snapshot taken after the lock) sees the other transaction's row.
    -- Without it two parallel updates can both count n-1 and leave the
    -- batch stuck at "processing" forever.
    select total_urls into v_total from public.batches where id = new.batch_id for update;

    select count(*) filter (where status in ('done', 'error')),
           count(*) filter (where status = 'error')
    into v_processed, v_errors
    from public.urls
    where batch_id = new.batch_id;

    -- finished: `failed` when no row got a DR, otherwise `completed`
    update public.batches
    set processed_urls = v_processed,
        status = case
          when v_processed < v_total then 'processing'
          when v_errors >= v_total then 'failed'
          else 'completed'
        end
    where id = new.batch_id;
  end if;
  return new;
end;
$$;

create or replace function public.claim_pending_urls(p_limit integer default 5)
returns table (id uuid, domain text, attempts integer)
language plpgsql
as $$
begin
  return query
  with claimed as (
    update public.urls
    set status = 'processing',
        claimed_at = now(),
        attempts = urls.attempts + 1
    where urls.id in (
      select u.id
      from public.urls u
      where (u.status = 'pending' and u.available_at <= now())
         or (u.status = 'processing' and u.claimed_at < now() - interval '2 minutes')
      order by u.available_at
      limit p_limit
      for update skip locked
    )
    returning urls.id, urls.domain, urls.attempts, urls.batch_id
  ),
  -- a queued batch becomes `processing` when its first row is claimed
  started as (
    update public.batches b
    set status = 'processing'
    where b.status = 'pending'
      and b.id in (select c.batch_id from claimed c)
  )
  select c.id, c.domain, c.attempts from claimed c;
end;
$$;
revoke execute on function public.claim_pending_urls(integer) from public, anon, authenticated;

-- one-time backfill: finished batches where no row got a DR
with counts as (
  select batch_id, count(*) as n, count(*) filter (where status = 'error') as e
  from public.urls
  group by batch_id
)
update public.batches b
set status = 'failed'
from counts c
where c.batch_id = b.id
  and b.status = 'completed'
  and c.n = b.total_urls
  and c.e = c.n;
