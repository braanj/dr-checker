-- Deferred-minor fix: progress broadcasts become private. Browsers subscribe
-- with { private: true } and may only receive batch:* topics; sending with
-- the anon key is denied (no insert policy), so nobody holding a batch link
-- can push fake progress to other viewers.

-- Private broadcasts: anon may RECEIVE batch:* topics; with no insert policy
-- nobody can SEND to them with the public key (no spoofed progress).
drop policy if exists "anon receives batch broadcasts" on realtime.messages;
create policy "anon receives batch broadcasts"
  on realtime.messages
  for select
  to anon, authenticated
  using (realtime.messages.extension = 'broadcast' and realtime.topic() like 'batch:%');

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
    true  -- private: only receivers allowed by RLS on realtime.messages
  );
  return null;
end;
$$;

create or replace function public.broadcast_batch_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'total_urls', new.total_urls,
      'processed_urls', new.processed_urls,
      'status', new.status
    ),
    'batch',
    'batch:' || new.id::text,
    true  -- private: only receivers allowed by RLS on realtime.messages
  );
  return null;
end;
$$;
