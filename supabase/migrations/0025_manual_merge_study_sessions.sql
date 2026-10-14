-- Save the combined session and tombstone its sources in one transaction.
begin;

create function public.study_session_merge(p_command jsonb, p_sources jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_first public.study_sessions%rowtype;
  v_session public.study_sessions%rowtype;
  v_source jsonb;
  v_command jsonb;
  v_request jsonb;
  v_result jsonb;
  v_rows jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(p_command) is distinct from 'object'
     or p_command ->> 'action' is distinct from 'save_progress'
     or jsonb_typeof(p_command -> 'blocks') is distinct from 'array'
     or jsonb_typeof(p_sources) is distinct from 'array' then
    raise exception 'Invalid merge request' using errcode = '22023';
  end if;
  if p_command ? 'expected_user_id' and (p_command ->> 'expected_user_id')::uuid is distinct from v_uid then
    raise exception 'Account changed. Reopen the calendar.' using errcode = '42501';
  end if;
  if jsonb_array_length(p_sources) not between 2 and 100
     or exists (select 1 from jsonb_array_elements(p_sources) s
       where jsonb_typeof(s -> 'id') is distinct from 'string' or nullif(s ->> 'id', '') is null
         or jsonb_typeof(s -> 'revision') is distinct from 'number' or (s ->> 'revision') !~ '^[1-9][0-9]*$')
     or (select count(distinct s ->> 'id') from jsonb_array_elements(p_sources) s) <> jsonb_array_length(p_sources)
     or p_sources -> 0 ->> 'id' is distinct from p_command ->> 'session_id'
     or p_sources -> 0 -> 'revision' is distinct from p_command -> 'expected_revision' then
    raise exception 'Select 2–100 different sessions with their current revisions' using errcode = '22023';
  end if;
  -- The existing mutation receipt also identifies the exact source set on a retry.
  v_command := p_command || jsonb_build_object('merge_sources', p_sources);
  perform public.sync_next_lamport(v_uid);
  select request into v_request from public.study_session_mutation_receipts
    where user_id = v_uid and mutation_id = (v_command ->> 'mutation_id')::uuid;
  if found then
    if v_request - 'expected_user_id' <> v_command - 'expected_user_id' then
      raise exception 'Mutation id was already used for another command' using errcode = '22023';
    end if;
  else
    select * into v_first from public.study_sessions
      where user_id = v_uid and id = p_command ->> 'session_id' for update;
    if not found then raise exception 'A selected session no longer exists'; end if;
    for v_source in select value from jsonb_array_elements(p_sources) loop
      select * into v_session from public.study_sessions
        where user_id = v_uid and id = v_source ->> 'id' for update;
      if not found or v_session.revision <> (v_source ->> 'revision')::bigint
         or v_session.cancelled_at is not null or v_session.segment_started_at is not null
         or (v_session.paused_at is not null and not v_session.completed)
         or v_session.kind <> 'focus' or v_session.subject_id is distinct from v_first.subject_id
         or v_session.completed <> v_first.completed then
        raise exception 'A selected session changed. Select stopped sessions with the same subject and done/planned status.';
      end if;
    end loop;
    if (p_command ? 'completed' and (p_command ->> 'completed')::boolean is distinct from v_first.completed)
       or (p_command ? 'subject_id' and p_command ->> 'subject_id' is distinct from v_first.subject_id) then
      raise exception 'Merging must preserve the subject and done/planned status';
    end if;
    -- Tombstone sources first so the duplicate-interval trigger cannot prune their copied time.
    -- Any failure below rolls back the tombstones, receipts and sync log together.
    for v_source in select value from jsonb_array_elements(p_sources) with ordinality s(value, position) where position > 1 loop
      v_result := public.study_session_mutate_unmerged(jsonb_build_object(
        'mutation_id', gen_random_uuid(), 'session_id', v_source ->> 'id',
        'expected_revision', v_source -> 'revision', 'action', 'cancel',
        'device_id', p_command ->> 'device_id', 'app', p_command ->> 'app'));
      if (v_result ->> 'applied')::boolean is distinct from true then
        raise exception 'Could not merge: %', v_result ->> 'reason';
      end if;
    end loop;
    -- Use the original mutation function so automatic fragment merging cannot absorb unselected sessions.
    v_result := public.study_session_mutate_unmerged(v_command);
    if (v_result ->> 'applied')::boolean is distinct from true then
      raise exception 'Could not merge: %', v_result ->> 'reason';
    end if;
    select * into v_session from public.study_sessions where user_id = v_uid and id = v_first.id;
    if v_session.cancelled_at is not null or exists (
      select 1 from jsonb_array_elements(p_command -> 'blocks') b
      where not exists (select 1 from jsonb_array_elements(v_session.segments) g
        where (g ->> 'started_at')::timestamptz = (b ->> 'start')::timestamptz
          and (g ->> 'ended_at')::timestamptz = (b ->> 'end')::timestamptz)
    ) then
      raise exception 'Interval cleanup would remove study time. These sessions could not be merged.';
    end if;
  end if;
  select jsonb_agg(public.study_session_payload(v_uid, s ->> 'id')) into v_rows
    from jsonb_array_elements(p_sources) s;
  return jsonb_build_object('sessions', v_rows, 'server_now', clock_timestamp());
end;
$$;
revoke all on function public.study_session_merge(jsonb, jsonb) from public, anon;
grant execute on function public.study_session_merge(jsonb, jsonb) to authenticated;

commit;
