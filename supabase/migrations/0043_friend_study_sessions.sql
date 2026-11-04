-- Shared company is separate from personal study: room clocks never change somebody's timer.
begin;

create table public.friend_study_sessions (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  note text not null default '' check (char_length(note) <= 500),
  kind text not null check (kind in ('desk', 'round')),
  visibility text not null check (visibility in ('friends', 'invite')),
  starts_at timestamptz not null,
  focus_minutes int not null check (focus_minutes between 1 and 180),
  break_minutes int not null check (break_minutes between 0 and 30),
  ends_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.friend_study_members (
  session_id uuid not null references public.friend_study_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('invited', 'going', 'joined', 'left', 'declined')),
  invited_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index friend_study_sessions_owner on public.friend_study_sessions(owner_id, starts_at);
create index friend_study_members_user on public.friend_study_members(user_id, session_id);
alter table public.friend_study_sessions enable row level security;
alter table public.friend_study_members enable row level security;
revoke all on public.friend_study_sessions, public.friend_study_members from public, anon, authenticated;

-- Cancelling shared plans only removes untouched personal plans. Running/completed study is history.
create function public.friend_study_cancel_plan(p_room uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.study_sessions%rowtype; v_lamport bigint;
begin
  v_lamport := public.sync_next_lamport(p_user);
  update public.study_sessions set cancelled_at = clock_timestamp(), updated_at = clock_timestamp(), revision = revision + 1
    where user_id = p_user and id = 'friend-study:' || p_room
      and metadata ->> 'friendStudySession' = p_room::text
      and started_at is null and segment_started_at is null and paused_at is null
      and not completed and cancelled_at is null
    returning * into v_row;
  if found then
    insert into public.sync_log(user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
    values (p_user, gen_random_uuid(), p_room::text, 'study_sessions', v_row.id, 'put',
      jsonb_build_object('revision', v_row.revision), v_lamport);
  end if;
end $$;
revoke all on function public.friend_study_cancel_plan(uuid, uuid) from public, anon, authenticated;

create function public.friend_study_invite(p_id uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_room public.friend_study_sessions%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select * into v_room from public.friend_study_sessions where id = p_id for update;
  if not found or v_room.owner_id <> v_uid then raise exception 'Only the host can invite friends' using errcode = '42501'; end if;
  if v_room.ended_at is not null or v_room.ends_at <= now() then raise exception 'This session has ended'; end if;
  if p_members is null or cardinality(p_members) not between 1 and 32 then raise exception 'Select 1–32 friends'; end if;
  if exists (select 1 from unnest(p_members) u(id) where u.id is null or u.id = v_uid or not exists (
    select 1 from public.friendships f where f.accepted and
      ((f.user_id = v_uid and f.friend_id = u.id) or (f.friend_id = v_uid and f.user_id = u.id))
  )) then raise exception 'You can only invite accepted friends' using errcode = '42501'; end if;
  if (select count(*) from public.friend_study_members where session_id = p_id)
     + (select count(distinct u.id) from unnest(p_members) u(id) where not exists (
       select 1 from public.friend_study_members m where m.session_id = p_id and m.user_id = u.id)) > 33 then
    raise exception 'A session can have up to 32 invited friends';
  end if;
  -- A decline is respected: repeated clicks never resend an invitation.
  insert into public.friend_study_members(session_id, user_id, status)
    select p_id, u.id, 'invited' from unnest(p_members) u(id) on conflict do nothing;
end $$;

create function public.friend_study_withdraw(p_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  perform 1 from public.friend_study_sessions where id = p_id and owner_id = (select auth.uid()) for update;
  if not found then raise exception 'Only the host can withdraw invitations' using errcode = '42501'; end if;
  delete from public.friend_study_members where session_id = p_id and user_id = p_user_id and status = 'invited';
end $$;

create function public.friend_study_create(p_id uuid, p_title text, p_note text, p_kind text,
  p_visibility text, p_starts_at timestamptz, p_focus_minutes int, p_break_minutes int, p_members uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_start timestamptz; v_result jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  perform public.sync_next_lamport(v_uid);
  if exists (select 1 from public.friend_study_sessions where id = p_id and owner_id = v_uid) then return p_id; end if;
  if p_id is null or p_title is null or char_length(btrim(p_title)) not between 1 and 80
    or p_note is null or char_length(p_note) > 500
    or p_kind is null or p_kind not in ('desk', 'round')
    or p_visibility is null or p_visibility not in ('friends', 'invite')
    or p_focus_minutes is null or p_focus_minutes not between 1 and 180
    or p_break_minutes is null or p_break_minutes not between 0 and 30 then
    raise exception 'Enter a title, a valid session type and a duration of 1–180 minutes' using errcode = '22023';
  end if;
  v_start := coalesce(p_starts_at, now());
  if not isfinite(v_start) or v_start < now() - interval '1 minute' or v_start > now() + interval '90 days' then
    raise exception 'Choose a start time within the next 90 days';
  end if;
  if (select count(*) from public.friend_study_sessions where owner_id = v_uid and ended_at is null and ends_at > now()) >= 20 then
    raise exception 'You can host up to 20 active or upcoming sessions';
  end if;
  if p_starts_at is null and exists (
    select 1 from public.friend_study_members m join public.friend_study_sessions r on r.id = m.session_id
    where m.user_id = v_uid and m.status = 'joined' and r.ended_at is null and r.ends_at > now()
  ) then raise exception 'Leave your current shared session before starting another'; end if;
  insert into public.friend_study_sessions(id, owner_id, title, note, kind, visibility, starts_at, focus_minutes, break_minutes, ends_at)
  values (p_id, v_uid, btrim(p_title), btrim(p_note), p_kind, p_visibility, v_start, p_focus_minutes, p_break_minutes,
    v_start + case when p_kind = 'desk' then interval '12 hours' else make_interval(mins => p_focus_minutes + p_break_minutes) end);
  insert into public.friend_study_members(session_id, user_id, status)
    values (p_id, v_uid, case when p_starts_at is null then 'joined' else 'going' end);
  if coalesce(cardinality(p_members), 0) > 0 then perform public.friend_study_invite(p_id, p_members); end if;
  if p_starts_at is not null then
    v_result := public.study_session_mutate(jsonb_build_object('mutation_id', gen_random_uuid(), 'session_id', 'friend-study:' || p_id,
      'expected_revision', 0, 'action', 'create', 'app', 'examtrack', 'kind', 'focus', 'phase', 'focus', 'device_id', p_id,
      'title', btrim(p_title), 'metadata', jsonb_build_object('friendStudySession', p_id, 'description', p_note),
      'blocks', jsonb_build_array(jsonb_build_object('start', v_start, 'end', v_start + make_interval(mins => p_focus_minutes)))));
    if (v_result ->> 'applied')::boolean is distinct from true then raise exception 'Could not save your study plan'; end if;
  end if;
  return p_id;
end $$;

create function public.friend_study_respond(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_room public.friend_study_sessions%rowtype;
  v_status text; v_result jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select * into v_room from public.friend_study_sessions where id = p_id for update;
  if not found then raise exception 'This session is unavailable'; end if;
  if v_room.owner_id <> v_uid and not exists (select 1 from public.friendships f where f.accepted and
    ((f.user_id = v_uid and f.friend_id = v_room.owner_id) or (f.friend_id = v_uid and f.user_id = v_room.owner_id))) then
    raise exception 'This session is only available to the host’s friends' using errcode = '42501';
  end if;
  select status into v_status from public.friend_study_members where session_id = p_id and user_id = v_uid;
  if v_status is null and v_room.visibility <> 'friends' then raise exception 'You need an invitation to join' using errcode = '42501'; end if;
  -- Lock the room before the personal sync lane, matching host cancellation.
  perform public.sync_next_lamport(v_uid);
  if p_action is null or p_action not in ('accept', 'join', 'decline', 'leave') then raise exception 'Unknown invitation response'; end if;
  if p_action in ('accept', 'join') and (v_room.ended_at is not null or v_room.ends_at <= now()) then
    raise exception 'This session has ended. You can still study solo.';
  end if;
  if p_action = 'join' and v_room.starts_at > now() then raise exception 'This session has not started yet'; end if;
  if v_status is null and (select count(*) from public.friend_study_members where session_id = p_id) >= 33 then
    raise exception 'This session is full';
  end if;
  if p_action = 'join' and exists (
    select 1 from public.friend_study_members m join public.friend_study_sessions r on r.id = m.session_id
    where m.user_id = v_uid and m.status = 'joined' and m.session_id <> p_id and r.ended_at is null and r.ends_at > now()
  ) then raise exception 'Leave your current shared session before joining another'; end if;
  if p_action = 'accept' and v_room.starts_at > now() and not exists (
    select 1 from public.study_sessions where user_id = v_uid and id = 'friend-study:' || p_id
  ) then
    v_result := public.study_session_mutate(jsonb_build_object('mutation_id', gen_random_uuid(), 'session_id', 'friend-study:' || p_id,
      'expected_revision', 0, 'action', 'create', 'app', 'examtrack', 'kind', 'focus', 'phase', 'focus', 'device_id', p_id,
      'title', v_room.title, 'metadata', jsonb_build_object('friendStudySession', p_id, 'description', v_room.note),
      'blocks', jsonb_build_array(jsonb_build_object('start', v_room.starts_at, 'end', v_room.starts_at + make_interval(mins => v_room.focus_minutes)))));
    if (v_result ->> 'applied')::boolean is distinct from true then raise exception 'Could not save your study plan'; end if;
  end if;
  if p_action in ('decline', 'leave') then perform public.friend_study_cancel_plan(p_id, v_uid); end if;
  insert into public.friend_study_members as m(session_id, user_id, status)
    values (p_id, v_uid, case p_action when 'accept' then case when v_status = 'joined' then 'joined' else 'going' end when 'join' then 'joined' when 'decline' then 'declined' else 'left' end)
    on conflict (session_id, user_id) do update set status = excluded.status;
end $$;

create function public.friend_study_end(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_member uuid;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  update public.friend_study_sessions set ended_at = coalesce(ended_at, now()) where id = p_id and owner_id = v_uid;
  if not found then raise exception 'Only the host can end this session' using errcode = '42501'; end if;
  for v_member in select user_id from public.friend_study_members where session_id = p_id order by user_id loop
    perform public.friend_study_cancel_plan(p_id, v_member);
  end loop;
end $$;

create function public.friend_study_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
    'my_status', (select status from public.friend_study_members where session_id = r.id and user_id = (select auth.uid())),
    'host_name', coalesce((select coalesce(nullif(display_name, ''), '@' || username) from public.friend_profiles where user_id = r.owner_id), 'A friend'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'status', m.status,
      'name', coalesce(nullif(p.display_name, ''), '@' || p.username, 'A friend')) order by m.invited_at)
      from public.friend_study_members m left join public.friend_profiles p on p.user_id = m.user_id
      where m.session_id = r.id and (m.user_id = r.owner_id or exists (
        select 1 from public.friendships f where f.accepted and
          ((f.user_id = r.owner_id and f.friend_id = m.user_id) or (f.friend_id = r.owner_id and f.user_id = m.user_id))))
      and (m.status in ('going', 'joined') or r.owner_id = (select auth.uid()) or m.user_id = (select auth.uid()))), '[]'::jsonb)
  ) order by r.starts_at), '[]'::jsonb)
  from (
    select s.* from public.friend_study_sessions s
    where s.ends_at > now() - interval '1 day' and (s.ended_at is null or s.ended_at > now() - interval '1 day')
    and (s.owner_id = (select auth.uid()) or (
      exists (select 1 from public.friendships f where f.accepted and
        ((f.user_id = s.owner_id and f.friend_id = (select auth.uid())) or (f.friend_id = s.owner_id and f.user_id = (select auth.uid()))))
      and (s.visibility = 'friends' or exists (select 1 from public.friend_study_members m where m.session_id = s.id and m.user_id = (select auth.uid())))
    ))
    order by (s.ended_at is null and s.ends_at > now() and exists (
      select 1 from public.friend_study_members m where m.session_id = s.id and m.user_id = (select auth.uid()) and m.status = 'joined')) desc,
      (s.ended_at is null and s.ends_at > now() and exists (
      select 1 from public.friend_study_members m where m.session_id = s.id and m.user_id = (select auth.uid()) and m.status = 'invited')) desc,
      (s.ended_at is null and s.ends_at > now()) desc, s.starts_at limit 100
  ) r;
$$;

revoke all on function public.friend_study_create(uuid, text, text, text, text, timestamptz, int, int, uuid[]),
  public.friend_study_invite(uuid, uuid[]), public.friend_study_withdraw(uuid, uuid), public.friend_study_respond(uuid, text), public.friend_study_end(uuid), public.friend_study_list() from public, anon;
grant execute on function public.friend_study_create(uuid, text, text, text, text, timestamptz, int, int, uuid[]),
  public.friend_study_invite(uuid, uuid[]), public.friend_study_withdraw(uuid, uuid), public.friend_study_respond(uuid, text), public.friend_study_end(uuid), public.friend_study_list() to authenticated;

create trigger friend_study_invitation_push after insert on public.friend_study_members
  for each row when (new.status = 'invited') execute function public.push_wakeup();

create or replace function public.notification_events(p_user_id uuid, p_preferences jsonb, p_since timestamptz)
returns table(event_key text, body text, path text, due_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with settings as (
    select '{"planned":true,"friends":true,"cheers":true,"deadlines":false,"daily":false,"lead_minutes":0,"deadline_days":1,"daily_time":"18:00","quiet":false,"quiet_start":"22:00","quiet_end":"08:00","timezone":"UTC"}'::jsonb || p_preferences as p
  ), config as (
    select p,
      case when exists (select 1 from pg_catalog.pg_timezone_names where name = p ->> 'timezone')
        then p ->> 'timezone' else 'UTC' end as tz,
      greatest(0, least(60, (p ->> 'lead_minutes')::int)) as lead,
      greatest(0, least(7, (p ->> 'deadline_days')::int)) as days,
      (p ->> 'daily_time')::time as daily_time
    from settings
  ), events as (
    select 'plan:' || s.id || ':' || extract(epoch from b.starts)::text as event_key,
      case when c.lead = 0 then 'Your planned study is starting now.'
        else 'Your planned study starts in ' || c.lead || ' minutes.' end as body,
      '/?timer=calendar'::text as path, b.starts - make_interval(mins => c.lead) as due_at
    from config c
    join public.study_sessions s on s.user_id = p_user_id
    cross join lateral jsonb_array_elements(case
      when jsonb_typeof(s.segments) = 'array' and jsonb_array_length(s.segments) > 0 then s.segments
      when jsonb_typeof(coalesce(s.metadata #> '{schedule,blocks}', s.metadata #> '{legacy_metadata,schedule,blocks}')) = 'array'
        then coalesce(s.metadata #> '{schedule,blocks}', s.metadata #> '{legacy_metadata,schedule,blocks}')
      else '[]'::jsonb end) g
    cross join lateral (select public.push_timestamp(coalesce(g ->> 'started_at', g ->> 'start')) as starts) b
    where (c.p ->> 'planned')::boolean and not s.completed and s.cancelled_at is null
      and s.started_at is null and s.segment_started_at is null and s.paused_at is null
    union all
    select 'study:' || s.user_id::text || ':' || s.id,
      coalesce(n.nickname, '@' || fp.username, 'A friend') || ' started studying.', '/?view=friends', s.started_at
    from config c
    join public.friendships f on f.accepted and p_user_id in (f.user_id, f.friend_id)
    join public.study_sessions s on s.user_id = case when f.user_id = p_user_id then f.friend_id else f.user_id end
    left join public.friend_profiles fp on fp.user_id = s.user_id
    left join public.friend_nicknames n on n.user_id = p_user_id and n.friend_id = s.user_id
    where (c.p ->> 'friends')::boolean and s.segment_started_at is not null and s.cancelled_at is null and not s.completed
    union all
    select 'cheer:' || r.sender_id::text || ':' || extract(epoch from r.created_at)::text,
      coalesce(n.nickname, '@' || fp.username, 'A friend') || ' sent you a cheer.', '/?view=friends', r.created_at
    from config c
    join public.friend_cheers r on r.recipient_id = p_user_id
    left join public.friend_profiles fp on fp.user_id = r.sender_id
    left join public.friend_nicknames n on n.user_id = p_user_id and n.friend_id = r.sender_id
    where (c.p ->> 'cheers')::boolean and exists (select 1 from public.friendships f where f.accepted
      and ((f.user_id = r.sender_id and f.friend_id = r.recipient_id)
        or (f.user_id = r.recipient_id and f.friend_id = r.sender_id)))
    union all
    select 'deadline:' || e.row_id || ':' || (b.starts at time zone c.tz)::date,
      'You have an upcoming exam, SAC or assignment. Check your calendar.', '/?timer=calendar',
      least((((b.starts at time zone c.tz)::date - c.days) + c.daily_time) at time zone c.tz, b.starts)
    from config c
    join public.sync_state e on e.user_id = p_user_id and e.entity = 'events' and e.operation = 'put'
    cross join lateral (select public.push_timestamp(e.payload ->> 'startTime') as starts) b
    where (c.p ->> 'deadlines')::boolean and e.payload ->> 'eventType' in ('exam', 'sac', 'assignment', 'homework', 'practice-sac')
      and coalesce(e.payload ->> 'isFinished', 'false') <> 'true' and e.payload ->> 'deleted_at' is null
      and (b.starts at time zone c.tz)::date >= (now() at time zone c.tz)::date
    union all
    select 'sac:' || (s ->> 'id') || ':' || (b.starts at time zone c.tz)::date,
      'You have an upcoming SAC. Check your SAC schedule.', '/?timer=sac',
      case when s ->> 'scheduledAt' ~ '^\d{4}-\d{2}-\d{2}$'
        then (((b.starts at time zone c.tz)::date - c.days) + c.daily_time) at time zone c.tz
        else least((((b.starts at time zone c.tz)::date - c.days) + c.daily_time) at time zone c.tz, b.starts) end
    from config c
    join public.sync_state u on u.user_id = p_user_id and u.entity = 'user_state' and u.row_id = 'sacRecords' and u.operation = 'put'
    cross join lateral jsonb_array_elements(case when jsonb_typeof(u.payload -> 'value') = 'array'
      then u.payload -> 'value' else '[]'::jsonb end) s
    cross join lateral (select case when s ->> 'scheduledAt' ~ '^\d{4}-\d{2}-\d{2}$'
      then public.push_timestamp((s ->> 'scheduledAt') || 'T00:00:00Z') at time zone 'UTC' at time zone c.tz
      else public.push_timestamp(s ->> 'scheduledAt') end as starts) b
    where (c.p ->> 'deadlines')::boolean and s ->> 'completedAt' is null
      and nullif(s ->> 'id', '') is not null
      and (s ->> 'score' is null or s ->> 'maxScore' is null)
      and (b.starts at time zone c.tz)::date >= (now() at time zone c.tz)::date
    union all
    select 'daily:' || (now() at time zone c.tz)::date, 'Make some time for study today. Your next session is waiting.',
      '/?timer=focus', ((now() at time zone c.tz)::date + c.daily_time) at time zone c.tz
    from config c where (c.p ->> 'daily')::boolean
      -- A nudge after the day's study is noise that teaches people to mute Focal.
      and not exists (select 1 from public.study_sessions s where s.user_id = p_user_id and s.cancelled_at is null
        and s.started_at >= ((now() at time zone c.tz)::date)::timestamp at time zone c.tz)
    union all
    select 'study-invite:' || m.session_id || ':' || m.user_id,
      'A friend invited you to study together.', '/?view=friends', m.invited_at
    from config c
    join public.friend_study_members m on m.user_id = p_user_id and m.status = 'invited'
    join public.friend_study_sessions r on r.id = m.session_id and r.ended_at is null and r.ends_at > now()
    where (c.p ->> 'friends')::boolean and exists (select 1 from public.friendships f where f.accepted and
      ((f.user_id = r.owner_id and f.friend_id = p_user_id) or (f.friend_id = r.owner_id and f.user_id = p_user_id)))
    union all
    select 'timer:' || t.key, t.body, t.path, t.fire_at
    from config c
    join public.push_timer_alerts t on t.user_id = p_user_id
    where coalesce((c.p ->> t.kind)::boolean, true)
  )
  select distinct e.* from events e cross join config c
  where e.due_at between greatest(p_since, now() - interval '15 minutes') and now()
    and (not (c.p ->> 'quiet')::boolean or not exists (
      select 1 from unnest(array[(now() at time zone c.tz)::time, (e.due_at at time zone c.tz)::time]) h(t)
      where case when (c.p ->> 'quiet_start')::time < (c.p ->> 'quiet_end')::time
        then h.t >= (c.p ->> 'quiet_start')::time and h.t < (c.p ->> 'quiet_end')::time
        else h.t >= (c.p ->> 'quiet_start')::time or h.t < (c.p ->> 'quiet_end')::time end
    ))
  order by e.due_at, e.event_key;
$$;

commit;
