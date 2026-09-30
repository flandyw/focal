-- Past study is evidence, not a running timer. Store its explicit intervals atomically
-- without the offline timer's seven-day clock window or active-session restriction.
begin;
alter function public.study_session_mutate(jsonb) rename to study_session_mutate_timed;
revoke all on function public.study_session_mutate_timed(jsonb) from public, anon, authenticated;

create function public.study_session_mutate(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_mutation uuid;
  v_request jsonb;
  v_result jsonb;
  v_blocks jsonb := p_command -> 'blocks';
  v_block jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_first timestamptz;
  v_last timestamptz;
  v_total bigint := 0;
  v_now timestamptz := clock_timestamp();
begin
  if p_command ->> 'action' is distinct from 'log' then
    return public.study_session_mutate_timed(p_command);
  end if;
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_command ? 'expected_user_id' and (p_command ->> 'expected_user_id')::uuid is distinct from v_uid then
    raise exception 'account_mismatch' using errcode = '42501';
  end if;
  v_mutation := (p_command ->> 'mutation_id')::uuid;
  if v_mutation is null then raise exception 'mutation_id is required'; end if;
  -- Reuse the feed's per-user serialization for same-id retries.
  perform public.sync_next_lamport(v_uid);
  select request, result into v_request, v_result from public.study_session_mutation_receipts
    where user_id = v_uid and mutation_id = v_mutation;
  if found then
    if v_request - 'expected_user_id' <> p_command - 'expected_user_id' then raise exception 'mutation_id_reused'; end if;
    return v_result;
  end if;
  if jsonb_typeof(v_blocks) is distinct from 'array' then raise exception 'Study blocks are required'; end if;
  if jsonb_array_length(v_blocks) not between 1 and 100 then raise exception 'Enter 1–100 study blocks'; end if;
  if nullif(btrim(p_command ->> 'subject_id'), '') is null or nullif(btrim(p_command ->> 'title'), '') is null then
    raise exception 'Subject and title are required';
  end if;
  if coalesce(p_command ->> 'kind', 'focus') <> 'focus' then raise exception 'Past study must be focus study'; end if;
  for v_block in select value from jsonb_array_elements(v_blocks) order by (value ->> 'start')::timestamptz loop
    v_start := (v_block ->> 'start')::timestamptz;
    v_end := (v_block ->> 'end')::timestamptz;
    if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end)
      or v_end <= v_start or v_end > v_now or v_end - v_start > interval '24 hours'
      or (v_last is not null and v_start < v_last) then raise exception 'Invalid, future, or overlapping study blocks'; end if;
    v_first := coalesce(v_first, v_start);
    v_last := v_end;
    v_total := v_total + round(extract(epoch from (v_end - v_start)) * 1000)::bigint;
  end loop;
  -- The existing implementation validates identity, metadata, revision and receipts,
  -- and emits the feed wakeup. Everything below commits in that same transaction.
  v_result := public.study_session_mutate_timed((p_command - 'blocks') || '{"action":"create","kind":"focus","phase":"focus"}'::jsonb);
  if (v_result ->> 'applied')::boolean then
    update public.study_sessions set state = 'completed', started_at = v_first, completed_at = v_last,
      accumulated_active_ms = v_total, timing_at = v_last
      where user_id = v_uid and id = p_command ->> 'session_id';
    insert into public.study_session_segments (user_id, session_id, started_at, ended_at, phase, source_device_id)
      select v_uid, p_command ->> 'session_id', (value ->> 'start')::timestamptz, (value ->> 'end')::timestamptz,
        'focus', p_command ->> 'device_id' from jsonb_array_elements(v_blocks);
    v_result := jsonb_set(v_result, '{session}', public.study_session_payload(v_uid, p_command ->> 'session_id'));
  end if;
  update public.study_session_mutation_receipts set request = p_command, result = v_result
    where user_id = v_uid and mutation_id = v_mutation;
  return v_result;
end;
$$;
revoke all on function public.study_session_mutate(jsonb) from public, anon;
grant execute on function public.study_session_mutate(jsonb) to authenticated;
commit;
