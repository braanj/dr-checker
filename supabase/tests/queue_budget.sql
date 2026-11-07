-- Scenario test for the weighted rate limit (queue budget). Safe to run against any
-- project: it ALWAYS ends with an exception, so every row it writes is rolled back.
-- Success is reported as the error text "SCENARIO OK"; anything else
-- ("SCENARIO FAIL: ...") names the first mismatch.
do $$
declare
  v_ip constant text := 'scenario-queue-budget';
begin
  if not public.register_check_request(v_ip, 100, 'rows', 60, 3600) then
    raise exception 'SCENARIO FAIL: 60 of 100 refused on an empty budget';
  end if;
  if not public.register_check_request(v_ip, 100, 'rows', 40, 3600) then
    raise exception 'SCENARIO FAIL: 60 + 40 = 100 refused, but it is exactly the limit';
  end if;
  if public.register_check_request(v_ip, 100, 'rows', 1, 3600) then
    raise exception 'SCENARIO FAIL: 101st row allowed';
  end if;
  if (select count(*) from public.check_requests where ip = v_ip) <> 2 then
    raise exception 'SCENARIO FAIL: a refused request was recorded';
  end if;

  update public.check_requests set created_at = now() - interval '61 minutes' where ip = v_ip;
  if not public.register_check_request(v_ip, 100, 'rows', 100, 3600) then
    raise exception 'SCENARIO FAIL: budget did not refill after the window';
  end if;

  if not public.register_check_request(v_ip, 10, 'check') then
    raise exception 'SCENARIO FAIL: the rows budget leaked into the check bucket';
  end if;

  raise exception 'SCENARIO OK';
end;
$$;
