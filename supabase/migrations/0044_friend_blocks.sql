begin;

create table public.friend_blocks (
  user_id uuid not null references auth.users on delete cascade,
  blocked_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id),
  check (user_id <> blocked_id)
);
alter table public.friend_blocks enable row level security;
revoke all on public.friend_blocks from public, anon, authenticated;

create function public.friends_block(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_user_id = v_uid then raise exception 'You cannot block yourself.' using errcode = '22023'; end if;
  perform 1 from auth.users where id = v_uid for update;
  if (select count(*) from public.friend_blocks b where b.user_id = v_uid) >= 500
    and not exists (select 1 from public.friend_blocks b where b.user_id = v_uid and b.blocked_id = p_user_id) then
    raise exception 'Too many blocked people' using errcode = '54000';
  end if;
  insert into public.friend_blocks (user_id, blocked_id) values (v_uid, p_user_id) on conflict do nothing;
  delete from public.friendships
    where (user_id = v_uid and friend_id = p_user_id) or (user_id = p_user_id and friend_id = v_uid);
  delete from public.friend_nicknames
    where (user_id = v_uid and friend_id = p_user_id) or (user_id = p_user_id and friend_id = v_uid);
  delete from public.friend_study_members m using public.friend_study_sessions s
    where m.session_id = s.id and m.status = 'invited'
      and ((s.owner_id = v_uid and m.user_id = p_user_id) or (s.owner_id = p_user_id and m.user_id = v_uid));
end $$;

create function public.friends_unblock(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  delete from public.friend_blocks where user_id = v_uid and blocked_id = p_user_id;
end $$;

create function public.friends_blocked()
returns table (user_id uuid, username text, display_name text)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  return query select b.blocked_id, p.username, p.display_name
    from public.friend_blocks b left join public.friend_profiles p on p.user_id = b.blocked_id
    where b.user_id = v_uid order by b.created_at desc;
end $$;

create or replace function public.friends_add(p_code text default null, p_username text default null)
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
  if exists (select 1 from public.friend_blocks b where
    (b.user_id = v_uid and b.blocked_id = v_friend) or (b.user_id = v_friend and b.blocked_id = v_uid)) then
    raise exception 'No account found. Check the username and try again.' using errcode = 'P0002';
  end if;
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

-- New profiles ask before accepting; existing profiles keep their choice.
alter table public.friend_profiles alter column require_requests set default true;

revoke all on function public.friends_block(uuid), public.friends_unblock(uuid), public.friends_blocked(), public.friends_add(text, text) from public, anon;
grant execute on function public.friends_block(uuid), public.friends_unblock(uuid), public.friends_blocked(), public.friends_add(text, text) to authenticated;

commit;
