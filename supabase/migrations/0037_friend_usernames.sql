-- Public handles and private, per-viewer friend nicknames. Keep legacy codes for older clients.
begin;

alter table public.friend_profiles add column username text;
update public.friend_profiles set username = 'user_' || lower(code);
alter table public.friend_profiles
  alter column username set default ('user_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  alter column username set not null,
  add constraint friend_profiles_username_key unique (username),
  add constraint friend_profiles_username_format check (username ~ '^[a-z0-9_]{3,24}$');

create table public.friend_nicknames (
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 40 and nickname = btrim(nickname)),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
alter table public.friend_nicknames enable row level security;
revoke all on public.friend_nicknames from public, anon, authenticated;

drop function public.friends_me();
create function public.friends_me()
returns table (code text, username text, display_name text, status_message text, share_exams boolean, share_subjects boolean, require_requests boolean)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  insert into public.friend_profiles (user_id) values (v_uid) on conflict do nothing;
  return query select p.code, p.username, p.display_name, p.status_message, p.share_exams, p.share_subjects, p.require_requests
    from public.friend_profiles p where p.user_id = v_uid;
end $$;

-- Optional username keeps sharing updates from older clients compatible.
drop function public.friends_update_profile(text, text, boolean, boolean, boolean);
create function public.friends_update_profile(p_display_name text, p_status_message text, p_share_exams boolean, p_share_subjects boolean, p_require_requests boolean, p_username text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_username text := lower(regexp_replace(btrim(p_username), '^@', ''));
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_username is not null and v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Use 3–24 letters, numbers or underscores for your username.' using errcode = '22023';
  end if;
  insert into public.friend_profiles (user_id) values (v_uid) on conflict do nothing;
  update public.friend_profiles set
    username = coalesce(v_username, username),
    display_name = left(btrim(coalesce(p_display_name, '')), 40),
    status_message = left(btrim(coalesce(p_status_message, '')), 60),
    share_exams = coalesce(p_share_exams, false), share_subjects = coalesce(p_share_subjects, true),
    require_requests = coalesce(p_require_requests, false)
  where user_id = v_uid;
exception when unique_violation then
  raise exception 'That username is taken. Choose another.' using errcode = '23505';
end $$;

drop function public.friends_add(text);
create function public.friends_add(p_code text default null, p_username text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_friend uuid;
  v_require boolean;
  v_username text := lower(regexp_replace(btrim(p_username), '^@', ''));
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_username is not null then
    if v_username !~ '^[a-z0-9_]{3,24}$' then
      raise exception 'Enter a username with 3–24 letters, numbers or underscores.' using errcode = '22023';
    end if;
    select p.user_id, p.require_requests into v_friend, v_require from public.friend_profiles p where p.username = v_username;
  else
    select p.user_id, p.require_requests into v_friend, v_require from public.friend_profiles p where p.code = upper(btrim(p_code));
  end if;
  if v_friend is null then raise exception 'No account found. Check the username and try again.' using errcode = 'P0002'; end if;
  if v_friend = v_uid then raise exception 'That is your own account. Share your username with a friend.' using errcode = '22023'; end if;
  if exists (select 1 from public.friendships f where
    (f.user_id = v_uid and f.friend_id = v_friend) or (f.user_id = v_friend and f.friend_id = v_uid and f.accepted)) then return; end if;
  update public.friendships set accepted = true where user_id = v_friend and friend_id = v_uid;
  if found then return; end if;
  if (select count(*) from public.friendships f where v_uid in (f.user_id, f.friend_id)) >= 200 then
    raise exception 'Too many friends' using errcode = '54000';
  end if;
  insert into public.friendships (user_id, friend_id, accepted) values (v_uid, v_friend, not v_require)
  on conflict (user_id, friend_id) do update set accepted = public.friendships.accepted or excluded.accepted;
end $$;

create function public.friends_set_nickname(p_user_id uuid, p_nickname text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_nickname text := btrim(coalesce(p_nickname, ''));
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if char_length(v_nickname) > 40 then raise exception 'Nicknames can be at most 40 characters.' using errcode = '22023'; end if;
  perform 1 from public.friendships f where f.accepted
    and ((f.user_id = v_uid and f.friend_id = p_user_id) or (f.user_id = p_user_id and f.friend_id = v_uid))
    for update;
  if not found then raise exception 'You can only nickname an accepted friend.' using errcode = '42501'; end if;
  if v_nickname = '' then
    delete from public.friend_nicknames where user_id = v_uid and friend_id = p_user_id;
  else
    insert into public.friend_nicknames (user_id, friend_id, nickname) values (v_uid, p_user_id, v_nickname)
    on conflict (user_id, friend_id) do update set nickname = excluded.nickname;
  end if;
end $$;

create or replace function public.friends_remove(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  delete from public.friendships
    where (user_id = v_uid and friend_id = p_user_id) or (user_id = p_user_id and friend_id = v_uid);
  delete from public.friend_nicknames
    where (user_id = v_uid and friend_id = p_user_id) or (user_id = p_user_id and friend_id = v_uid);
end $$;

create or replace function public.friends_cheers()
returns table (sender_id uuid, recipient_id uuid, sender_name text, created_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select c.sender_id, c.recipient_id, coalesce(n.nickname, nullif(p.display_name, ''), '@' || p.username), c.created_at
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

revoke all on function public.friends_me(), public.friends_update_profile(text, text, boolean, boolean, boolean, text),
  public.friends_add(text, text), public.friends_set_nickname(uuid, text) from public, anon;
grant execute on function public.friends_me(), public.friends_update_profile(text, text, boolean, boolean, boolean, text),
  public.friends_add(text, text), public.friends_set_nickname(uuid, text) to authenticated;

drop function public.friends_list(text);
create function public.friends_list(p_tz text)
returns table (
  user_id uuid, display_name text, username text, nickname text, status_message text, status text,
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
  select p.user_id, coalesce(nullif(pr.display_name, ''), '@' || pr.username, 'Unnamed'), pr.username, n.nickname,
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
      where p.status in ('me', 'friend') and a.user_id = p.user_id and a.deleted_at is null and a.payload is not null
      order by a.payload ->> 'completedAt' desc limit 10
    ) recent
  ) x on true;
$$;

revoke all on function public.friends_list(text) from public, anon;
grant execute on function public.friends_list(text) to authenticated;

commit;
