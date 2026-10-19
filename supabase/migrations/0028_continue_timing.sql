-- Continuing finished study (0027) checked the client's monotonic elapsed time against the
-- session's last boundary. Across a finished session that clock is not continuous -- it was
-- reset when the session finished and restarts on every reload -- so a continue was refused
-- with timing_invalid. The reopened session now has no timing boundary: the resume is placed
-- at the client's server-clock estimate when it sends one, and at receipt time otherwise,
-- never back at the moment the session finished.
begin;

create or replace function public.study_session_mutate(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
  v_replayed boolean;
  v_reopen public.study_sessions%rowtype;
  v_elapsed bigint;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  perform public.sync_next_lamport(v_uid);
  select exists(select 1 from public.study_session_mutation_receipts
    where user_id = v_uid and mutation_id = (p_command ->> 'mutation_id')::uuid) into v_replayed;
  -- Reopen as paused; the ordinary resume below then applies the revision check, interval,
  -- receipt and feed event. Nothing commits unless the resume does.
  if not v_replayed and p_command ->> 'action' = 'resume' and jsonb_typeof(p_command -> 'expected_revision') = 'number' then
    select * into v_reopen from public.study_sessions
      where user_id = v_uid and id = p_command ->> 'session_id' for update;
    if found and v_reopen.kind = 'focus' and v_reopen.completed and v_reopen.cancelled_at is null
       and v_reopen.segment_started_at is null and v_reopen.started_at is not null and v_reopen.completed_at is not null
       and v_reopen.revision = (p_command ->> 'expected_revision')::bigint then
      -- Without a server-clock estimate the resume lands at paused_at + elapsed; anchoring the pause
      -- that far before now places it at receipt time instead of crediting the gap since finishing.
      v_elapsed := case when jsonb_typeof(p_command -> 'elapsed_since_previous_ms') = 'number'
        and (p_command ->> 'elapsed_since_previous_ms') ~ '^[0-9]+$' then (p_command ->> 'elapsed_since_previous_ms')::bigint else 0 end;
      update public.study_sessions set completed = false, completed_at = null, timing_at = null,
        paused_at = case when jsonb_typeof(p_command -> 'occurred_at') = 'string' then v_reopen.completed_at
          else clock_timestamp() - least(v_elapsed, 604800000) * interval '1 millisecond' end
        where user_id = v_uid and id = v_reopen.id;
    else
      v_reopen := null;
    end if;
  end if;
  v_result := public.study_session_mutate_unmerged(p_command);
  if v_reopen.id is not null and (v_result ->> 'applied')::boolean is distinct from true then
    raise exception 'Could not continue this session: %', coalesce(v_result ->> 'reason', 'not applied');
  end if;
  if not v_replayed and (v_result ->> 'applied')::boolean and p_command ->> 'action' in ('complete', 'log', 'save_progress') then
    perform public.merge_short_study_sessions(v_uid, p_command ->> 'session_id');
    v_result := v_result || jsonb_build_object('session', public.study_session_payload(v_uid, p_command ->> 'session_id'),
      'change_seq', (select max(seq) from public.sync_log where user_id = v_uid));
    update public.study_session_mutation_receipts set result = v_result
      where user_id = v_uid and mutation_id = (p_command ->> 'mutation_id')::uuid;
  end if;
  return v_result;
end;
$$;
revoke all on function public.study_session_mutate(jsonb) from public, anon;
grant execute on function public.study_session_mutate(jsonb) to authenticated;

commit;
