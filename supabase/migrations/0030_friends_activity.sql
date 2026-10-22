-- Friends v2: a status line, a choice to hide subjects, and per-day activity so the page can draw
-- timelines, heatmaps and subject splits. friends_list now takes the viewer's time zone so "today"
-- and day buckets match their calendar.
begin;

alter table public.friend_profiles
  add column status_message text not null default '' check (char_length(status_message) <= 60),
  add column share_subjects boolean not null default true;

drop function public.friends_me();
drop function public.friends_update_profile(text, boolean);
drop function public.friends_list();

create function public.friends_me()
returns table (code text, display_name text, status_message text, share_exams boolean, share_subjects boolean)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  insert into public.friend_profiles (user_id) values (v_uid) on conflict do nothing;
  return query select p.code, p.display_name, p.status_message, p.share_exams, p.share_subjects
    from public.friend_profiles p where p.user_id = v_uid;
end $$;

create function public.friends_update_profile(p_display_name text, p_status_message text, p_share_exams boolean, p_share_subjects boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  insert into public.friend_profiles (user_id, display_name, status_message, share_exams, share_subjects)
  values (v_uid, left(btrim(coalesce(p_display_name, '')), 40), left(btrim(coalesce(p_status_message, '')), 60),
    coalesce(p_share_exams, false), coalesce(p_share_subjects, true))
  on conflict (user_id) do update set display_name = excluded.display_name, status_message = excluded.status_message,
    share_exams = excluded.share_exams, share_subjects = excluded.share_subjects;
end $$;

-- The caller ('me'), friends, and pending requests. Activity is only filled for me and friends:
-- daily = {date: ms} for the last 84 days, today_blocks = [[start, end|null]] for today,
-- subjects = {subject: ms} for the last 30 days (hidden when the owner turns subjects off).
create function public.friends_list(p_tz text)
returns table (
  user_id uuid, display_name text, status_message text, status text,
  studying_since timestamptz, studying_subject text, studying_kind text,
  total_ms bigint, daily jsonb, today_blocks jsonb, subjects jsonb, exams jsonb
)
language sql security definer set search_path = '' stable as $$
  with me as (select (select auth.uid()) as id),
  tz as (select coalesce((select t.name from pg_catalog.pg_timezone_names t where t.name = p_tz limit 1), 'UTC') as name),
  bounds as (
    select tz.name, (now() at time zone tz.name)::date as today,
      date_trunc('day', now() at time zone tz.name) at time zone tz.name as today_start
    from tz
  ),
  people as (
    select me.id as user_id, 'me'::text as status from me where me.id is not null
    union all
    select case when f.user_id = me.id then f.friend_id else f.user_id end,
      case when f.accepted then 'friend' when f.user_id = me.id then 'outgoing' else 'incoming' end
    from public.friendships f, me where me.id in (f.user_id, f.friend_id)
  ),
  -- Every timed or logged block (not plans). shortcut: a block that crosses midnight counts on its start day.
  blocks as (
    select s.user_id, s.subject_id, b.started, b.ended,
      greatest(0, extract(epoch from (coalesce(b.ended, now()) - b.started)) * 1000) as ms,
      (b.started at time zone bounds.name)::date as day
    from public.study_sessions s
    join people p on p.user_id = s.user_id and p.status in ('me', 'friend')
    cross join bounds
    cross join lateral jsonb_array_elements(s.segments) g
    cross join lateral (select (g ->> 'started_at')::timestamptz as started, (g ->> 'ended_at')::timestamptz as ended) b
    where s.cancelled_at is null and b.started <= now()
      and (s.completed or s.started_at is not null or s.segment_started_at is not null or s.paused_at is not null)
  )
  select p.user_id, coalesce(nullif(pr.display_name, ''), 'Unnamed'),
    case when p.status in ('me', 'friend') then coalesce(pr.status_message, '') else '' end, p.status,
    live.segment_started_at, case when p.status = 'me' or coalesce(pr.share_subjects, true) then live.subject_id end, live.kind,
    coalesce((select sum(b.ms)::bigint from blocks b where b.user_id = p.user_id), 0),
    (select jsonb_object_agg(d.day, d.ms) from (
      select b.day, sum(b.ms)::bigint as ms from blocks b, bounds
      where b.user_id = p.user_id and b.day > bounds.today - 84 group by b.day) d),
    (select jsonb_agg(jsonb_build_array(greatest(b.started, bounds.today_start), b.ended) order by b.started)
      from blocks b, bounds where b.user_id = p.user_id and coalesce(b.ended, now()) > bounds.today_start),
    case when p.status = 'me' or coalesce(pr.share_subjects, true) then (select coalesce(jsonb_object_agg(d.subject, d.ms), '{}'::jsonb) from (
      select coalesce(b.subject_id, '') as subject, sum(b.ms)::bigint as ms from blocks b, bounds
      where b.user_id = p.user_id and b.day > bounds.today - 30 group by 1) d) end,
    case when p.status = 'me' or (p.status = 'friend' and coalesce(pr.share_exams, false)) then x.exams end
  from people p
  left join public.friend_profiles pr on pr.user_id = p.user_id
  left join lateral (
    select s.segment_started_at, s.subject_id, s.kind from public.study_sessions s
    where p.status in ('me', 'friend') and s.user_id = p.user_id
      and s.segment_started_at is not null and s.cancelled_at is null
    order by s.segment_started_at desc limit 1
  ) live on true
  left join lateral (
    select jsonb_agg(e order by e ->> 'completedAt' desc) as exams from (
      select jsonb_build_object('subject', a.payload ->> 'subject', 'title', a.payload ->> 'title',
        'rawScore', a.payload -> 'rawScore', 'rawMax', a.payload -> 'rawMax', 'completedAt', a.payload ->> 'completedAt') as e
      from public.attempts a
      where p.status in ('me', 'friend') and a.user_id = p.user_id and a.deleted_at is null and a.payload is not null
      order by a.payload ->> 'completedAt' desc limit 10
    ) recent
  ) x on true;
$$;

revoke all on function public.friends_me(), public.friends_update_profile(text, text, boolean, boolean), public.friends_list(text) from public, anon;
grant execute on function public.friends_me(), public.friends_update_profile(text, text, boolean, boolean), public.friends_list(text) to authenticated;

commit;
