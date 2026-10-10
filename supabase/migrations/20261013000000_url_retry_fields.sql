-- Step 5: the url broadcast also carries retry state (attempts, available_at)
-- so the results table can show "retrying · attempt N of 3" live.

create or replace function public.broadcast_url_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'original_url', new.original_url,
      'domain', new.domain,
      'dr', new.dr,
      'status', new.status,
      'error_message', new.error_message,
      'source', new.source,
      'checked_at', new.checked_at,
      'attempts', new.attempts,
      'available_at', new.available_at
    ),
    'url',
    'batch:' || new.batch_id::text,
    false
  );
  return null;
end;
$$;
