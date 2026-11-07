-- pg_cron logs every run in cron.job_run_details and never deletes them. With the
-- 10 s worker backstop that is ~10,000 rows a day, and the table reached 843 MB of
-- an 862 MB database (free tier: 0.5 GB). Keep one week; autovacuum reuses the space.
select cron.unschedule(jobid) from cron.job where jobname = 'cron-history-cleanup';
select cron.schedule(
  'cron-history-cleanup',
  '17 * * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
