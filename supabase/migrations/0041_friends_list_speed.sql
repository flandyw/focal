-- friends_list scanned every study block once per person and per column, read shared exams nobody
-- could see, and checked the time zone through pg_timezone_names, which reads the tz files on each call.
-- Aggregate each column once per user, and validate the zone by using it.
begin;

create function public.friends_tz(p_tz text) returns text
language plpgsql stable set search_path = '' as $$
begin
  perform now() at time zone p_tz;
  return coalesce(p_tz, 'UTC');
exception when others then return 'UTC';
end $$;
revoke all on function public.friends_tz(text) from public, anon, authenticated;

create or replace function public.friends_list(p_tz text)
returns table (
  user_id uuid, display_name text, username text, nickname text, status_message text, status text,
  studying_since timestamptz, studying_subject text, studying_kind text,
  total_ms bigint, daily jsonb, today_blocks jsonb, subjects jsonb, exams jsonb
)
language sql security definer set search_path = '' stable as $$
  with me as (select (select auth.uid()) as id),
  tz as (select public.friends_tz(p_tz) as name),
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
  -- Every timed or logged block (not plans), split at the viewer’s local midnight below.
  blocks as (
    select s.user_id, s.subject_id, b.started, b.ended,
      greatest(0, extract(epoch from (coalesce(b.ended, now()) - b.started)) * 1000) as ms
    from public.study_sessions s
    join people p on p.user_id = s.user_id and p.status in ('me', 'friend')
    cross join lateral jsonb_array_elements(s.segments) g
    cross join lateral (select (g ->> 'started_at')::timestamptz as started, (g ->> 'ended_at')::timestamptz as ended) b
    where s.cancelled_at is null and b.started <= now()
      and (s.completed or s.started_at is not null or s.segment_started_at is not null or s.paused_at is not null)
  ),
  daily_blocks as (
    select b.user_id, coalesce(b.subject_id, '') as subject, d.day::date as day,
      greatest(0, extract(epoch from (
        least(coalesce(b.ended, now()), (d.day + interval '1 day') at time zone bounds.name)
        - greatest(b.started, d.day at time zone bounds.name)
      )) * 1000) as ms
    from blocks b cross join bounds
    cross join lateral generate_series(
      greatest((b.started at time zone bounds.name)::date, bounds.today - 83)::timestamp,
      least((coalesce(b.ended, now()) at time zone bounds.name)::date, bounds.today)::timestamp,
      interval '1 day'
    ) d(day)
  ),
  totals as (select b.user_id, sum(b.ms)::bigint as ms from blocks b group by 1),
  daily as (
    select d.user_id, jsonb_object_agg(d.day, d.ms) as daily from (
      select b.user_id, b.day, sum(b.ms)::bigint as ms from daily_blocks b where b.ms > 0 group by 1, 2) d
    group by 1
  ),
  subjects as (
    select d.user_id, jsonb_object_agg(d.subject, d.ms) as subjects from (
      select b.user_id, b.subject, sum(b.ms)::bigint as ms from daily_blocks b, bounds
      where b.ms > 0 and b.day > bounds.today - 30 group by 1, 2) d
    group by 1
  ),
  today as (
    select b.user_id, jsonb_agg(jsonb_build_array(greatest(b.started, bounds.today_start), b.ended,
      case when b.user_id = me.id or coalesce(pr.share_subjects, true) then coalesce(b.subject_id, '') end) order by b.started) as blocks
    from blocks b cross join bounds cross join me
    left join public.friend_profiles pr on pr.user_id = b.user_id
    where coalesce(b.ended, now()) > bounds.today_start
    group by 1
  )
  select p.user_id, coalesce(nullif(pr.display_name, ''), '@' || pr.username, 'Unnamed'), pr.username, n.nickname,
    case when p.status in ('me', 'friend') then coalesce(pr.status_message, '') else '' end, p.status,
    live.segment_started_at, case when p.status = 'me' or coalesce(pr.share_subjects, true) then live.subject_id end, live.kind,
    coalesce(t.ms, 0), d.daily, y.blocks,
    case when p.status = 'me' or coalesce(pr.share_subjects, true) then coalesce(j.subjects, '{}'::jsonb) end,
    case when p.status = 'me' or (p.status = 'friend' and coalesce(pr.share_exams, false)) then coalesce(x.exams, '[]'::jsonb) end
  from people p
  left join totals t on t.user_id = p.user_id
  left join daily d on d.user_id = p.user_id
  left join subjects j on j.user_id = p.user_id
  left join today y on y.user_id = p.user_id
  left join public.friend_profiles pr on pr.user_id = p.user_id
  left join public.friend_nicknames n on n.user_id = (select auth.uid()) and n.friend_id = p.user_id and p.status = 'friend'
  left join lateral (
    select s.segment_started_at, s.subject_id, s.kind from public.study_sessions s
    where p.status in ('me', 'friend') and s.user_id = p.user_id
      and s.segment_started_at is not null and s.cancelled_at is null
    order by s.segment_started_at desc limit 1
  ) live on true
  left join lateral (
    select jsonb_agg(e order by e ->> 'completedAt' desc) as exams from (
      select jsonb_build_object('subject', a.payload ->> 'subject', 'title', a.payload ->> 'title',
        'provider', a.payload ->> 'provider', 'examYear', a.payload -> 'examYear',
        'paper', a.payload ->> 'paper', 'referenceId', a.payload ->> 'referenceId',
        'rawScore', a.payload -> 'rawScore', 'rawMax', a.payload -> 'rawMax', 'completedAt', a.payload ->> 'completedAt') as e
      from public.attempts a
      where (p.status = 'me' or (p.status = 'friend' and coalesce(pr.share_exams, false)))
        and a.user_id = p.user_id and a.deleted_at is null and a.payload is not null
      order by a.payload ->> 'completedAt' desc limit 10
    ) recent
  ) x on true;
$$;

create or replace function public.friends_day(p_day date, p_tz text)
returns table (user_id uuid, started timestamptz, ended timestamptz, subject_id text)
language sql security definer set search_path = '' stable as $$
  with me as (select (select auth.uid()) as id),
  tz as (select public.friends_tz(p_tz) as name),
  win as (select (p_day::timestamp at time zone tz.name) as s, ((p_day + 1)::timestamp at time zone tz.name) as e from tz),
  people as (
    select me.id as user_id from me where me.id is not null
    union
    select case when f.user_id = me.id then f.friend_id else f.user_id end
    from public.friendships f, me where f.accepted and me.id in (f.user_id, f.friend_id)
  )
  select s.user_id, greatest(b.started, win.s), least(coalesce(b.ended, now()), win.e),
    case when s.user_id = (select auth.uid()) or coalesce(pr.share_subjects, true) then coalesce(s.subject_id, '') end
  from public.study_sessions s
  join people p on p.user_id = s.user_id
  left join public.friend_profiles pr on pr.user_id = s.user_id
  cross join win
  cross join lateral jsonb_array_elements(s.segments) g
  cross join lateral (select (g ->> 'started_at')::timestamptz as started, (g ->> 'ended_at')::timestamptz as ended) b
  where s.cancelled_at is null and b.started <= now()
    and (s.completed or s.started_at is not null or s.segment_started_at is not null or s.paused_at is not null)
    and b.started < win.e and coalesce(b.ended, now()) > win.s
    and p_day between (now() at time zone 'UTC')::date - 90 and (now() at time zone 'UTC')::date + 1
  order by 2;
$$;

commit;
