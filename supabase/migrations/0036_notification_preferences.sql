begin;

alter table public.push_subscriptions add column preferences jsonb not null default '{}'::jsonb;
update public.push_subscriptions set preferences = jsonb_build_object('planned', planned, 'friends', friends, 'cheers', friends);

-- One event source for web push and authenticated desktop polling. Bodies stay private on lock screens.
create function public.notification_events(p_user_id uuid, p_preferences jsonb, p_since timestamptz)
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
    select 'study:' || s.user_id::text || ':' || s.id, 'A friend started studying.', '/?view=friends', s.started_at
    from config c
    join public.friendships f on f.accepted and p_user_id in (f.user_id, f.friend_id)
    join public.study_sessions s on s.user_id = case when f.user_id = p_user_id then f.friend_id else f.user_id end
    where (c.p ->> 'friends')::boolean and s.segment_started_at is not null and s.cancelled_at is null and not s.completed
    union all
    select 'cheer:' || r.sender_id::text || ':' || extract(epoch from r.created_at)::text,
      'A friend sent you a cheer.', '/?view=friends', r.created_at
    from config c
    join public.friend_cheers r on r.recipient_id = p_user_id
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

create function public.desktop_notification_events(p_preferences jsonb, p_since timestamptz)
returns table(event_key text, body text, path text, due_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  return query select * from public.notification_events((select auth.uid()), p_preferences, p_since);
end $$;

create or replace function public.push_claim()
returns table(subscription_id uuid, endpoint text, p256dh text, auth text, event_key text, body text, path text)
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_deliveries d where d.claimed_at < now() - interval '7 days';
  return query
  with candidates as (
    select p.id, p.endpoint, p.p256dh, p.auth, e.event_key, e.body, e.path, e.due_at
    from public.push_subscriptions p
    cross join lateral public.notification_events(p.user_id,
      p.preferences || jsonb_build_object('planned', p.planned, 'friends', p.friends), p.enabled_at) e
    left join public.push_deliveries d on d.subscription_id = p.id and d.event_key = e.event_key
    where d.subscription_id is null or (d.delivered_at is null and d.claimed_at < now() - interval '5 minutes')
    order by e.due_at, p.id, e.event_key
    -- ponytail: 50 deliveries per tick; increase dispatch capacity if this queue regularly fills.
    limit 50
  ), claimed as (
    insert into public.push_deliveries as d(subscription_id, event_key)
    select c.id, c.event_key from candidates c
    on conflict on constraint push_deliveries_pkey do update set claimed_at = now()
      where d.delivered_at is null and d.claimed_at < now() - interval '5 minutes'
    returning d.subscription_id, d.event_key
  )
  select c.id, c.endpoint, c.p256dh, c.auth, c.event_key, c.body, c.path
  from candidates c join claimed d on d.subscription_id = c.id and d.event_key = c.event_key;
end $$;

revoke all on function public.notification_events(uuid, jsonb, timestamptz), public.desktop_notification_events(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.desktop_notification_events(jsonb, timestamptz) to authenticated;
grant execute on function public.notification_events(uuid, jsonb, timestamptz) to service_role;

commit;
