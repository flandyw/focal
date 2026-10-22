-- Fair study comparisons and private encouragement between accepted friends.
begin;

-- shortcut: keep the latest cheer per pair; add an event log if full cheer history is needed.
create table public.friend_cheers (
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sender_id, recipient_id),
  check (sender_id <> recipient_id)
);
create index friend_cheers_recipient_idx on public.friend_cheers (recipient_id);
alter table public.friend_cheers enable row level security;
revoke all on public.friend_cheers from public, anon, authenticated;

create function public.friends_cheer(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_sent timestamptz;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  -- Hold the friendship until the cheer is saved, including during concurrent removal.
  perform 1 from public.friendships f
    where f.accepted and ((f.user_id = v_uid and f.friend_id = p_user_id)
      or (f.user_id = p_user_id and f.friend_id = v_uid)) for share;
  if not found then raise exception 'You can only cheer an accepted friend' using errcode = '42501'; end if;

  insert into public.friend_cheers as c (sender_id, recipient_id) values (v_uid, p_user_id)
  on conflict (sender_id, recipient_id) do update set created_at = excluded.created_at
    where c.created_at <= excluded.created_at - interval '24 hours'
  returning created_at into v_sent;
  if v_sent is null then raise exception 'You can cheer this friend again after 24 hours' using errcode = '22023'; end if;
end $$;

create function public.friends_cheers()
returns table (sender_id uuid, recipient_id uuid, sender_name text, created_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select c.sender_id, c.recipient_id, coalesce(nullif(p.display_name, ''), 'Unnamed'), c.created_at
  from public.friend_cheers c
  left join public.friend_profiles p on p.user_id = c.sender_id
  where (select auth.uid()) in (c.sender_id, c.recipient_id)
    and c.created_at > now() - interval '7 days'
    and exists (select 1 from public.friendships f where f.accepted
      and ((f.user_id = c.sender_id and f.friend_id = c.recipient_id)
        or (f.user_id = c.recipient_id and f.friend_id = c.sender_id)))
  order by c.created_at desc;
$$;

revoke all on function public.friends_cheer(uuid), public.friends_cheers() from public, anon;
grant execute on function public.friends_cheer(uuid), public.friends_cheers() to authenticated;

-- Keep comparison days accurate across midnight and daylight-saving changes.
create or replace function public.friends_list(p_tz text)
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
    select b.user_id, b.subject_id, d.day::date as day,
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
  )
  select p.user_id, coalesce(nullif(pr.display_name, ''), 'Unnamed'),
    case when p.status in ('me', 'friend') then coalesce(pr.status_message, '') else '' end, p.status,
    live.segment_started_at, case when p.status = 'me' or coalesce(pr.share_subjects, true) then live.subject_id end, live.kind,
    coalesce((select sum(b.ms)::bigint from blocks b where b.user_id = p.user_id), 0),
    (select jsonb_object_agg(d.day, d.ms) from (
      select b.day, sum(b.ms)::bigint as ms from daily_blocks b, bounds
      where b.user_id = p.user_id and b.ms > 0 and b.day > bounds.today - 84 group by b.day) d),
    (select jsonb_agg(jsonb_build_array(greatest(b.started, bounds.today_start), b.ended) order by b.started)
      from blocks b, bounds where b.user_id = p.user_id and coalesce(b.ended, now()) > bounds.today_start),
    case when p.status = 'me' or coalesce(pr.share_subjects, true) then (select coalesce(jsonb_object_agg(d.subject, d.ms), '{}'::jsonb) from (
      select coalesce(b.subject_id, '') as subject, sum(b.ms)::bigint as ms from daily_blocks b, bounds
      where b.user_id = p.user_id and b.ms > 0 and b.day > bounds.today - 30 group by 1) d) end,
    case when p.status = 'me' or (p.status = 'friend' and coalesce(pr.share_exams, false)) then coalesce(x.exams, '[]'::jsonb) end
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
        'provider', a.payload ->> 'provider', 'examYear', a.payload -> 'examYear',
        'paper', a.payload ->> 'paper', 'referenceId', a.payload ->> 'referenceId',
        'rawScore', a.payload -> 'rawScore', 'rawMax', a.payload -> 'rawMax', 'completedAt', a.payload ->> 'completedAt') as e
      from public.attempts a
      where p.status in ('me', 'friend') and a.user_id = p.user_id and a.deleted_at is null and a.payload is not null
      order by a.payload ->> 'completedAt' desc limit 10
    ) recent
  ) x on true;
$$;

revoke all on function public.friends_list(text) from public, anon;
grant execute on function public.friends_list(text) to authenticated;

commit;
