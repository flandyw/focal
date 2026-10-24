begin;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  planned boolean not null default true,
  friends boolean not null default true,
  enabled_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);

create table public.push_deliveries (
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  event_key text not null,
  claimed_at timestamptz not null default now(),
  delivered_at timestamptz,
  primary key(subscription_id, event_key)
);

alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;
revoke all on public.push_subscriptions, public.push_deliveries from public, anon, authenticated;
grant all on public.push_subscriptions, public.push_deliveries to service_role;

-- Old imported metadata can contain invalid dates; one bad plan must not block other reminders.
create function public.push_timestamp(p_value text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  return p_value::timestamptz;
exception when others then return null;
end $$;

-- Claim a bounded batch atomically. Overlapping scheduler calls cannot send the same event.
create function public.push_claim()
returns table(subscription_id uuid, endpoint text, p256dh text, auth text, event_key text, body text, path text)
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_deliveries d where d.claimed_at < now() - interval '7 days';
  return query
  with events as (
    select p.id, p.endpoint, p.p256dh, p.auth,
      'plan:' || s.id || ':' || extract(epoch from b.starts)::text as event_key,
      'Your planned study is starting now.'::text as body, '/?timer=calendar'::text as path
    from public.push_subscriptions p
    join public.study_sessions s on s.user_id = p.user_id
    cross join lateral jsonb_array_elements(case
      when jsonb_array_length(s.segments) > 0 then s.segments
      when jsonb_typeof(coalesce(s.metadata #> '{schedule,blocks}', s.metadata #> '{legacy_metadata,schedule,blocks}')) = 'array'
        then coalesce(s.metadata #> '{schedule,blocks}', s.metadata #> '{legacy_metadata,schedule,blocks}')
      else '[]'::jsonb end) g
    cross join lateral (select public.push_timestamp(coalesce(g ->> 'started_at', g ->> 'start')) as starts) b
    where p.planned and not s.completed and s.cancelled_at is null and s.started_at is null
      and s.segment_started_at is null and s.paused_at is null
      and b.starts between greatest(p.enabled_at, now() - interval '15 minutes') and now()
    union all
    select p.id, p.endpoint, p.p256dh, p.auth,
      'study:' || s.user_id::text || ':' || s.id,
      'A friend started studying.', '/?view=friends'
    from public.push_subscriptions p
    join public.friendships f on f.accepted and p.user_id in (f.user_id, f.friend_id)
    join public.study_sessions s on s.user_id = case when f.user_id = p.user_id then f.friend_id else f.user_id end
    where p.friends and s.segment_started_at is not null and s.cancelled_at is null and not s.completed
      and s.started_at between greatest(p.enabled_at, now() - interval '15 minutes') and now()
    union all
    select p.id, p.endpoint, p.p256dh, p.auth,
      'cheer:' || c.sender_id::text || ':' || extract(epoch from c.created_at)::text,
      'A friend sent you a cheer.', '/?view=friends'
    from public.push_subscriptions p
    join public.friend_cheers c on c.recipient_id = p.user_id
    where p.friends and c.created_at between greatest(p.enabled_at, now() - interval '15 minutes') and now()
      and exists (select 1 from public.friendships f where f.accepted
        and ((f.user_id = c.sender_id and f.friend_id = c.recipient_id)
          or (f.user_id = c.recipient_id and f.friend_id = c.sender_id)))
  ), candidates as (
    select distinct e.* from events e
    left join public.push_deliveries d on d.subscription_id = e.id and d.event_key = e.event_key
    where d.subscription_id is null or (d.delivered_at is null and d.claimed_at < now() - interval '5 minutes')
    -- ponytail: 50 deliveries per tick; increase batch capacity if the queue regularly fills.
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

revoke all on function public.push_timestamp(text), public.push_claim() from public, anon, authenticated;
grant execute on function public.push_timestamp(text), public.push_claim() to service_role;

commit;
