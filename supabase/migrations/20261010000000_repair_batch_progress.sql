-- Recount batches whose processed_urls/status drifted before the
-- bump_batch_progress row-lock fix (ADR 0001). Idempotent: only touches
-- batches whose stored counters disagree with their url rows.
with counts as (
  select batch_id, count(*) filter (where status in ('done', 'error')) as n
  from public.urls
  group by batch_id
)
update public.batches b
set processed_urls = c.n,
    status = case when c.n >= b.total_urls then 'completed' else 'processing' end
from counts c
where c.batch_id = b.id
  and b.status in ('pending', 'processing', 'completed')
  and (b.processed_urls <> c.n
       or b.status <> case when c.n >= b.total_urls then 'completed' else 'processing' end);
