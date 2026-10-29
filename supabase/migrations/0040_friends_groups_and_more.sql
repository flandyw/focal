-- Friend groups with an optional weekly goal, cheer messages, a per-day session drill-down and
-- friends' upcoming exams (shared with the existing "share exams" setting).
begin;

-- Cheers carry one of a few preset messages.
alter table public.friend_cheers add column message text;

drop function public.friends_cheer(uuid);
create function public.friends_cheer(p_user_id uuid, p_message text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_sent timestamptz;
  v_message text := case when p_message in ('Good luck!', 'Keep going!', 'Join me?', 'Nice work!') then p_message end;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  perform 1 from public.friendships f
    where f.accepted and ((f.user_id = v_uid and f.friend_id = p_user_id)
      or (f.user_id = p_user_id and f.friend_id = v_uid)) for share;
  if not found then raise exception 'You can only cheer an accepted friend' using errcode = '42501'; end if;

  insert into public.friend_cheers as c (sender_id, recipient_id, message) values (v_uid, p_user_id, v_message)
  on conflict (sender_id, recipient_id) do update set created_at = excluded.created_at, message = excluded.message
    where c.created_at <= excluded.created_at - interval '24 hours'
  returning created_at into v_sent;
  if v_sent is null then raise exception 'You can cheer this friend again after 24 hours' using errcode = '22023'; end if;
end $$;

drop function public.friends_cheers();
create function public.friends_cheers()
returns table (sender_id uuid, recipient_id uuid, sender_name text, created_at timestamptz, message text)
language sql security definer set search_path = '' stable as $$
  select c.sender_id, c.recipient_id, coalesce(n.nickname, nullif(p.display_name, ''), '@' || p.username), c.created_at, c.message
  from public.friend_cheers c
  join public.friend_profiles p on p.user_id = c.sender_id
  left join public.friend_nicknames n on n.user_id = (select auth.uid()) and n.friend_id = c.sender_id
  where (select auth.uid()) in (c.sender_id, c.recipient_id)
    and c.created_at > now() - interval '7 days'
    and exists (select 1 from public.friendships f where f.accepted
      and ((f.user_id = c.sender_id and f.friend_id = c.recipient_id)
        or (f.user_id = c.recipient_id and f.friend_id = c.sender_id)))
  order by c.created_at desc;
$$;

-- Groups: owned by one user, members are the owner's accepted friends. goal_minutes = weekly target (0 = none).
create table public.friend_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  goal_minutes int not null default 0 check (goal_minutes between 0 and 10080)
);
create table public.friend_group_members (
  group_id uuid not null references public.friend_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (group_id, user_id)
);
create index friend_group_members_user_idx on public.friend_group_members (user_id);
alter table public.friend_groups enable row level security;
alter table public.friend_group_members enable row level security;
revoke all on public.friend_groups, public.friend_group_members from public, anon, authenticated;

create function public.friends_group_save(p_id uuid, p_name text, p_goal_minutes int, p_members uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := p_id;
  v_name text := left(btrim(coalesce(p_name, '')), 40);
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if v_name = '' then raise exception 'Name your group' using errcode = '22023'; end if;
  if v_id is null then
    if (select count(*) from public.friend_groups where owner_id = v_uid) >= 20 then
      raise exception 'Too many groups' using errcode = '54000';
    end if;
    insert into public.friend_groups (owner_id, name, goal_minutes)
    values (v_uid, v_name, greatest(0, least(10080, coalesce(p_goal_minutes, 0)))) returning id into v_id;
  else
    update public.friend_groups set name = v_name, goal_minutes = greatest(0, least(10080, coalesce(p_goal_minutes, 0)))
    where id = v_id and owner_id = v_uid;
    if not found then raise exception 'Only the owner can edit this group' using errcode = '42501'; end if;
  end if;
  delete from public.friend_group_members where group_id = v_id;
  insert into public.friend_group_members (group_id, user_id)
  select v_id, v_uid
  union
  select v_id, f.friend_id from public.friendships f
    where f.accepted and f.user_id = v_uid and f.friend_id = any (coalesce(p_members, '{}'))
  union
  select v_id, f.user_id from public.friendships f
    where f.accepted and f.friend_id = v_uid and f.user_id = any (coalesce(p_members, '{}'));
  return v_id;
end $$;

create function public.friends_group_delete(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.friend_groups where id = p_id and owner_id = (select auth.uid());
$$;

create function public.friends_groups()
returns table (id uuid, name text, goal_minutes int, owner_id uuid, members uuid[])
language sql security definer set search_path = '' stable as $$
  select g.id, g.name, g.goal_minutes, g.owner_id,
    array(select m.user_id from public.friend_group_members m where m.group_id = g.id)
  from public.friend_groups g
  where exists (select 1 from public.friend_group_members m where m.group_id = g.id and m.user_id = (select auth.uid()))
  order by g.name;
$$;

-- One local day of timed blocks for me and my friends (for the Group study drill-down).
create function public.friends_day(p_day date, p_tz text)
returns table (user_id uuid, started timestamptz, ended timestamptz, subject_id text)
language sql security definer set search_path = '' stable as $$
  with me as (select (select auth.uid()) as id),
  tz as (select coalesce((select t.name from pg_catalog.pg_timezone_names t where t.name = p_tz limit 1), 'UTC') as name),
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

-- Upcoming exams for me and friends who share exams.
create function public.friends_countdowns()
returns table (user_id uuid, title text, starts timestamptz)
language sql security definer set search_path = '' stable as $$
  with me as (select (select auth.uid()) as id),
  people as (
    select me.id as user_id from me where me.id is not null
    union
    select case when f.user_id = me.id then f.friend_id else f.user_id end
    from public.friendships f, me where f.accepted and me.id in (f.user_id, f.friend_id)
  )
  select e.user_id, coalesce(nullif(e.payload ->> 'title', ''), 'Exam'), b.starts
  from people p
  left join public.friend_profiles pr on pr.user_id = p.user_id
  join public.sync_state e on e.user_id = p.user_id and e.entity = 'events' and e.operation = 'put'
  cross join lateral (select public.push_timestamp(e.payload ->> 'startTime') as starts) b
  where (p.user_id = (select auth.uid()) or coalesce(pr.share_exams, false))
    and e.payload ->> 'eventType' = 'exam'
    and coalesce(e.payload ->> 'isFinished', 'false') <> 'true' and e.payload ->> 'deleted_at' is null
    and b.starts between now() and now() + interval '90 days'
  order by b.starts
  limit 60;
$$;

revoke all on function public.friends_cheer(uuid, text), public.friends_cheers(),
  public.friends_group_save(uuid, text, int, uuid[]), public.friends_group_delete(uuid), public.friends_groups(),
  public.friends_day(date, text), public.friends_countdowns() from public, anon;
grant execute on function public.friends_cheer(uuid, text), public.friends_cheers(),
  public.friends_group_save(uuid, text, int, uuid[]), public.friends_group_delete(uuid), public.friends_groups(),
  public.friends_day(date, text), public.friends_countdowns() to authenticated;

commit;
