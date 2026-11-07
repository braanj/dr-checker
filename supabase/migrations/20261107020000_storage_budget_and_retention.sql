-- Storage cap (audit finding 1). Only uncached domains spent the `rows` budget, and
-- duplicate lines are kept, so one IP could store ~10,000 cached url rows a minute
-- (~8 MB/min against the 0.5 GB free tier), and nothing ever deleted batches.
--   1. kind 'stored': every stored url row, 10,000 per IP per 24 h (server/utils/rateLimit.ts)
--   2. the rate-limit log keeps 2 days, so a 24 h window never undercounts
--   3. batches (and their urls, by cascade) are deleted after 7 days
-- Many IPs at once stay an accepted risk; the post-release size check is the early warning.

alter table public.check_requests drop constraint if exists check_requests_kind_check;
alter table public.check_requests
  add constraint check_requests_kind_check check (kind in ('check', 'export', 'rows', 'stored'));

comment on function public.register_check_request(text, integer, text, integer, integer) is
  'p_window_seconds must stay at or under 1 day: the cleanup cron keeps 2 days of rows.';

select cron.unschedule(jobid) from cron.job where jobname = 'check-requests-cleanup';
select cron.schedule(
  'check-requests-cleanup',
  '0 * * * *',
  $$delete from public.check_requests where created_at < now() - interval '2 days'$$
);

-- results links expire after 7 days (utils/recentChecks.ts RESULTS_KEPT_DAYS)
select cron.unschedule(jobid) from cron.job where jobname = 'batches-retention';
select cron.schedule(
  'batches-retention',
  '23 3 * * *',
  $$delete from public.batches where created_at < now() - interval '7 days'$$
);
