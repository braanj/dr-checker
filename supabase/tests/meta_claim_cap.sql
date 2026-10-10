-- Scenario test for the fetch-meta reclaim cap. Always ends in an exception,
-- so everything rolls back. Success = error text "SCENARIO OK".
do $$
declare
  v_status text;
  v_claimed timestamptz;
  v_due boolean;
begin
  insert into public.domain_meta (domain, claimed_at, attempts)
  values ('cap-3.test', now() - interval '5 minutes', 3),
         ('cap-2.test', now() - interval '5 minutes', 2);

  perform public.claim_meta_domains(0);  -- finalization runs even when claiming nothing

  select status, claimed_at into v_status, v_claimed from public.domain_meta where domain = 'cap-3.test';
  if v_status is distinct from 'error' or v_claimed is not null then
    raise exception 'SCENARIO FAIL: 3 unfinished claims → status %, claimed_at %, expected error/null', v_status, v_claimed;
  end if;

  select status, public.meta_due(status, fetched_at, claimed_at) into v_status, v_due
  from public.domain_meta where domain = 'cap-2.test';
  if v_status is not null or v_due is distinct from true then
    raise exception 'SCENARIO FAIL: 2 unfinished claims → status %, due %, expected null/true (one more try)', v_status, v_due;
  end if;

  select public.meta_due(status, fetched_at, claimed_at) into v_due from public.domain_meta where domain = 'cap-3.test';
  if v_due is distinct from false then
    raise exception 'SCENARIO FAIL: finalized row is due again immediately';
  end if;

  raise exception 'SCENARIO OK';
end;
$$;
