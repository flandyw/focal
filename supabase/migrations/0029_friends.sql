-- Friends and a study leaderboard. Users add each other by a share code; a request becomes a
-- friendship once the other side adds back (or accepts). Friends see each other's live study,
-- total and weekly study time, and recent exam results only when the owner opts in.
-- Tables are reachable only through these security-definer RPCs; emails are never exposed.
begin;

create table public.friend_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  display_name text not null default '' check (char_length(display_name) <= 40),
  share_exams boolean not null default false
);

-- One row per request, requester first. accepted = true makes it a friendship both ways.
create table public.friendships (
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  accepted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index friendships_friend_idx on public.friendships (friend_id);

alter table public.friend_profiles enable row level security;
alter table public.friendships enable row level security;
revoke all on public.friend_profiles, public.friendships from anon, authenticated;

create function public.friends_me()
returns table (code text, display_name text, share_exams boolean)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  insert into public.friend_profiles (user_id) values (v_uid) on conflict do nothing;
  return query select p.code, p.display_name, p.share_exams from public.friend_profiles p where p.user_id = v_uid;
end $$;

create function public.friends_update_profile(p_display_name text, p_share_exams boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  insert into public.friend_profiles (user_id, display_name, share_exams)
  values (v_uid, left(btrim(coalesce(p_display_name, '')), 40), coalesce(p_share_exams, false))
  on conflict (user_id) do update set display_name = excluded.display_name, share_exams = excluded.share_exams;
end $$;

-- Sends a request, or accepts one the other user already sent.
create function public.friends_add(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_friend uuid;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select p.user_id into v_friend from public.friend_profiles p where p.code = upper(btrim(p_code));
  if v_friend is null then raise exception 'No one has that friend code' using errcode = 'P0002'; end if;
  if v_friend = v_uid then raise exception 'That is your own friend code' using errcode = '22023'; end if;
  if (select count(*) from public.friendships where user_id = v_uid) >= 200 then
    raise exception 'Too many friends' using errcode = '54000';
  end if;
  update public.friendships set accepted = true where user_id = v_friend and friend_id = v_uid;
  if not found then
    insert into public.friendships (user_id, friend_id) values (v_uid, v_friend) on conflict do nothing;
  end if;
end $$;

create function public.friends_accept(p_user_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.friendships set accepted = true where user_id = p_user_id and friend_id = (select auth.uid());
$$;

-- Removes a friend, cancels an outgoing request or declines an incoming one.
create function public.friends_remove(p_user_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.friendships
  where (user_id = (select auth.uid()) and friend_id = p_user_id)
     or (user_id = p_user_id and friend_id = (select auth.uid()));
$$;

-- The caller ('me'), friends, and pending requests. Study data is only filled for me and friends.
-- Worked time counts every non-deleted session that was actually timed or logged (not plans).
create function public.friends_list()
returns table (
  user_id uuid, display_name text, status text,
  studying_since timestamptz, studying_subject text, studying_kind text,
  total_ms bigint, week_ms bigint, exams jsonb
)
language sql security definer set search_path = '' stable as $$
  with me as (select (select auth.uid()) as id),
  people as (
    select me.id as user_id, 'me'::text as status from me where me.id is not null
    union all
    select case when f.user_id = me.id then f.friend_id else f.user_id end,
      case when f.accepted then 'friend' when f.user_id = me.id then 'outgoing' else 'incoming' end
    from public.friendships f, me where me.id in (f.user_id, f.friend_id)
  )
  select p.user_id, coalesce(nullif(pr.display_name, ''), 'Unnamed'), p.status,
    live.segment_started_at, live.subject_id, live.kind,
    coalesce(t.total_ms, 0), coalesce(t.week_ms, 0),
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
    select sum(ms)::bigint as total_ms,
      sum(ms) filter (where started >= now() - interval '7 days')::bigint as week_ms
    from public.study_sessions s,
      lateral jsonb_array_elements(s.segments) g,
      lateral (select (g ->> 'started_at')::timestamptz as started) b,
      lateral (select greatest(0, extract(epoch from (coalesce((g ->> 'ended_at')::timestamptz, now()) - started)) * 1000) as ms) d
    where p.status in ('me', 'friend') and s.user_id = p.user_id and s.cancelled_at is null
      and (s.completed or s.started_at is not null or s.segment_started_at is not null or s.paused_at is not null)
  ) t on true
  left join lateral (
    select jsonb_agg(e order by e ->> 'completedAt' desc) as exams from (
      select jsonb_build_object('subject', a.payload ->> 'subject', 'title', a.payload ->> 'title',
        'rawScore', a.payload -> 'rawScore', 'rawMax', a.payload -> 'rawMax', 'completedAt', a.payload ->> 'completedAt') as e
      from public.attempts a
      where p.status in ('me', 'friend') and a.user_id = p.user_id and a.deleted_at is null and a.payload is not null
      order by a.payload ->> 'completedAt' desc limit 10
    ) recent
  ) x on true
  order by coalesce(t.week_ms, 0) desc;
$$;

revoke all on function public.friends_me(), public.friends_update_profile(text, boolean), public.friends_add(text), public.friends_accept(uuid),
  public.friends_remove(uuid), public.friends_list() from public, anon;
grant execute on function public.friends_me(), public.friends_update_profile(text, boolean), public.friends_add(text), public.friends_accept(uuid),
  public.friends_remove(uuid), public.friends_list() to authenticated;

commit;
