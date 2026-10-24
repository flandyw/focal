-- Adding by friend code now makes a friendship straight away, unless the code's owner has turned on
-- require_requests. Requests already pending are accepted.
begin;

alter table public.friend_profiles add column require_requests boolean not null default false;

update public.friendships set accepted = true where not accepted;

drop function public.friends_me();
drop function public.friends_update_profile(text, text, boolean, boolean);

create function public.friends_me()
returns table (code text, display_name text, status_message text, share_exams boolean, share_subjects boolean, require_requests boolean)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  insert into public.friend_profiles (user_id) values (v_uid) on conflict do nothing;
  return query select p.code, p.display_name, p.status_message, p.share_exams, p.share_subjects, p.require_requests
    from public.friend_profiles p where p.user_id = v_uid;
end $$;

create function public.friends_update_profile(p_display_name text, p_status_message text, p_share_exams boolean, p_share_subjects boolean, p_require_requests boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  insert into public.friend_profiles (user_id, display_name, status_message, share_exams, share_subjects, require_requests)
  values (v_uid, left(btrim(coalesce(p_display_name, '')), 40), left(btrim(coalesce(p_status_message, '')), 60),
    coalesce(p_share_exams, false), coalesce(p_share_subjects, true), coalesce(p_require_requests, false))
  on conflict (user_id) do update set display_name = excluded.display_name, status_message = excluded.status_message,
    share_exams = excluded.share_exams, share_subjects = excluded.share_subjects, require_requests = excluded.require_requests;
end $$;

create or replace function public.friends_add(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_friend uuid;
  v_require boolean;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select p.user_id, p.require_requests into v_friend, v_require from public.friend_profiles p where p.code = upper(btrim(p_code));
  if v_friend is null then raise exception 'No one has that friend code' using errcode = 'P0002'; end if;
  if v_friend = v_uid then raise exception 'That is your own friend code' using errcode = '22023'; end if;
  if (select count(*) from public.friendships where user_id = v_uid) >= 200 then
    raise exception 'Too many friends' using errcode = '54000';
  end if;
  update public.friendships set accepted = true where user_id = v_friend and friend_id = v_uid;
  if not found then
    insert into public.friendships (user_id, friend_id, accepted) values (v_uid, v_friend, not v_require)
    on conflict (user_id, friend_id) do update set accepted = public.friendships.accepted or excluded.accepted;
  end if;
end $$;

revoke all on function public.friends_me(), public.friends_update_profile(text, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.friends_me(), public.friends_update_profile(text, text, boolean, boolean, boolean) to authenticated;

commit;
