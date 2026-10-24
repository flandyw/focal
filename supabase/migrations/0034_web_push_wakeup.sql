begin;

create extension if not exists pg_net;

-- Wake the push dispatcher as soon as a friend event lands instead of waiting for the next cron tick.
-- The per-minute cron stays as the backstop for planned reminders and retries; push_claim dedupes overlapping runs.
create function public.push_wakeup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'focal_push_dispatch_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'focal_push_cron_secret';
  if v_url is null or v_secret is null then return null; end if;
  -- pg_net sends after commit, so the dispatcher sees this row.
  perform net.http_post(url := v_url, body := '{}'::jsonb, timeout_milliseconds := 10000,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret));
  return null;
exception when others then
  -- A missing extension or secret must never block saving study or sending a cheer.
  return null;
end $$;

revoke all on function public.push_wakeup() from public, anon, authenticated;

-- Resuming a paused session also sets segment_started_at; the started_at window skips those, matching push_claim.
create trigger study_sessions_push_insert after insert on public.study_sessions
  for each row when (new.segment_started_at is not null and new.started_at > now() - interval '15 minutes')
  execute function public.push_wakeup();
create trigger study_sessions_push_update after update of segment_started_at on public.study_sessions
  for each row when (old.segment_started_at is null and new.segment_started_at is not null
    and new.started_at > now() - interval '15 minutes')
  execute function public.push_wakeup();

-- Repeat cheers update created_at on the existing row.
create trigger friend_cheers_push after insert or update of created_at on public.friend_cheers
  for each row execute function public.push_wakeup();

commit;
