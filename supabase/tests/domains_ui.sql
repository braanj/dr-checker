-- Scenario test for dr_change, domain_trends and per-kind rate limits. Always
-- ends in an exception, so everything rolls back. Success = "SCENARIO OK".
do $$
declare
  v_change numeric;
  v_count integer;
  v_list numeric[];
  v_ok boolean;
begin
  insert into public.domains (domain, status, dr) values ('dui-a.test', 'ok', 40);
  insert into public.domain_history (domain, dr, checked_at) values ('dui-a.test', 40, now() - interval '2 days');
  select dr_change into v_change from public.domains where domain = 'dui-a.test';
  if v_change is not null then
    raise exception 'SCENARIO FAIL: one reading → dr_change %, expected null', v_change;
  end if;

  insert into public.domain_history (domain, dr, checked_at) values ('dui-a.test', 45, now() - interval '1 day');
  select dr_change into v_change from public.domains where domain = 'dui-a.test';
  if v_change is distinct from 5 then
    raise exception 'SCENARIO FAIL: 40 → 45 gave dr_change %, expected 5', v_change;
  end if;

  insert into public.domain_history (domain, dr, checked_at) values ('dui-a.test', 42, now());
  select dr_change into v_change from public.domains where domain = 'dui-a.test';
  if v_change is distinct from -3 then
    raise exception 'SCENARIO FAIL: 45 → 42 gave dr_change %, expected -3', v_change;
  end if;

  -- history for a domain without a domains row must not error
  insert into public.domain_history (domain, dr, checked_at) values ('dui-orphan.test', 10, now());

  insert into public.domain_history (domain, dr, checked_at)
  select 'dui-b.test', 20 + g, now() - (g || ' hours')::interval from generate_series(1, 15) g;

  select count(*) into v_count
  from public.domain_trends(array['dui-a.test', 'dui-b.test', 'dui-none.test'], 12);
  if v_count <> 15 then
    raise exception 'SCENARIO FAIL: domain_trends returned % rows, expected 15 (3 + 12)', v_count;
  end if;

  select array_agg(dr order by checked_at desc) into v_list
  from public.domain_trends(array['dui-a.test'], 12);
  if v_list is distinct from array[42, 45, 40]::numeric[] then
    raise exception 'SCENARIO FAIL: dui-a trend % , expected {42,45,40}', v_list;
  end if;

  -- per-kind rate limits
  if not public.register_check_request('198.51.100.9', 2, 'check')
     or not public.register_check_request('198.51.100.9', 2, 'check') then
    raise exception 'SCENARIO FAIL: first two check requests should pass';
  end if;
  v_ok := public.register_check_request('198.51.100.9', 2, 'check');
  if v_ok then
    raise exception 'SCENARIO FAIL: third check request should be limited';
  end if;
  if not public.register_check_request('198.51.100.9', 2, 'export') then
    raise exception 'SCENARIO FAIL: export bucket should be independent of check';
  end if;

  -- backfill statement (same as the migration)
  update public.domains set dr_change = null where domain = 'dui-a.test';
  update public.domains d set dr_change = s.change
  from (select domain,
               dr - lead(dr) over w as change,
               row_number() over w as rn
        from public.domain_history
        window w as (partition by domain order by checked_at desc)) s
  where s.domain = d.domain and s.rn = 1;
  select dr_change into v_change from public.domains where domain = 'dui-a.test';
  if v_change is distinct from -3 then
    raise exception 'SCENARIO FAIL: backfill gave dr_change %, expected -3', v_change;
  end if;

  raise exception 'SCENARIO OK';
end;
$$;
