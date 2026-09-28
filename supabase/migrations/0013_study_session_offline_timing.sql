-- Preserve offline lifecycle boundaries without trusting device wall clocks. New clients
-- persist an optional server-clock estimate plus elapsed time since the prior lifecycle
-- boundary. The old command implementation remains as the transition validator/receipt
-- authority; this wrapper corrects its receipt-time boundaries in the same transaction.
begin;

alter table public.study_sessions
  add column if not exists timing_at timestamptz;

alter function public.study_session_mutate(jsonb) rename to study_session_mutate_v1;
revoke all on function public.study_session_mutate_v1(jsonb) from public, anon, authenticated;
alter function public.study_session_mutate_v1(jsonb) set search_path = '';

create function public.study_session_mutate(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_expected_user_id uuid;
  v_existing_request jsonb;
  v_existing_result jsonb;
  v_receipt_found boolean := false;
  v_session_id text := nullif(p_command ->> 'session_id', '');
  v_action text := p_command ->> 'action';
  v_received_at timestamptz := clock_timestamp();
  v_accepted_at timestamptz;
  v_prior public.study_sessions%rowtype;
  v_prior_found boolean := false;
  v_result jsonb;
  v_applied boolean;
  v_event_at timestamptz;
  v_base_at timestamptz;
  v_occurrence timestamptz;
  v_elapsed_ms bigint;
  v_shift interval := interval '0 seconds';
  v_segment_start timestamptz;
  v_active_ms bigint;
  v_phase text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_command is null or jsonb_typeof(p_command) <> 'object' then
    raise exception 'validation_failed: command must be an object' using errcode = '22023';
  end if;
  if p_command ? 'expected_user_id' then
    begin v_expected_user_id := (p_command ->> 'expected_user_id')::uuid;
    exception when others then raise exception 'account_mismatch: expected_user_id must match the authenticated account' using errcode = '42501'; end;
    if v_expected_user_id is distinct from v_uid then
      raise exception 'account_mismatch: expected_user_id must match the authenticated account' using errcode = '42501';
    end if;
  end if;
  -- A command accepted before account pinning is retried with expected_user_id added.
  -- Preserve its receipt identity by accepting exactly the old request minus that guard.
  if p_command ? 'expected_user_id' then
    begin
      select r.request, r.result into v_existing_request, v_existing_result
        from public.study_session_mutation_receipts r
       where r.user_id = v_uid and r.mutation_id = (p_command ->> 'mutation_id')::uuid;
      v_receipt_found := found;
    exception when invalid_text_representation then
      v_receipt_found := false;
    end;
    if v_receipt_found and v_existing_request = (p_command - 'expected_user_id') then
      return v_existing_result;
    end if;
  end if;

  if v_action in ('start', 'pause', 'resume', 'phase_change', 'complete', 'cancel') then
    -- Older durable outboxes may still contain pre-timing commands. Treat absent timing
    -- conservatively as zero; new clients always persist the explicit monotonic delta.
    if not (p_command ? 'elapsed_since_previous_ms') then
      v_elapsed_ms := 0;
    else
      if jsonb_typeof(p_command -> 'elapsed_since_previous_ms') <> 'number'
         or (p_command ->> 'elapsed_since_previous_ms') !~ '^[0-9]+$' then
        raise exception 'validation_failed: elapsed_since_previous_ms must be an integer' using errcode = '22023';
      end if;
      begin v_elapsed_ms := (p_command ->> 'elapsed_since_previous_ms')::bigint;
      exception when others then raise exception 'validation_failed: elapsed_since_previous_ms must be an integer' using errcode = '22023'; end;
    end if;
    if v_elapsed_ms < 0 or v_elapsed_ms > 604800000 then
      raise exception 'timing_invalid: elapsed duration is outside the accepted seven-day range' using errcode = '22023';
    end if;
    if p_command ? 'occurred_at' and p_command -> 'occurred_at' <> 'null'::jsonb then
      if jsonb_typeof(p_command -> 'occurred_at') <> 'string' then
        raise exception 'validation_failed: occurred_at must be an ISO timestamp or null' using errcode = '22023';
      end if;
      begin v_occurrence := (p_command ->> 'occurred_at')::timestamptz;
      exception when others then raise exception 'validation_failed: occurred_at must be an ISO timestamp or null' using errcode = '22023'; end;
      if v_occurrence < v_received_at - interval '30 days' or v_occurrence > v_received_at + interval '5 seconds' then
        raise exception 'timing_invalid: occurred_at is outside the accepted server-clock window' using errcode = '22023';
      end if;
    end if;
  end if;

  select s.* into v_prior from public.study_sessions s
   where s.user_id = v_uid and s.id = v_session_id for update;
  v_prior_found := found;

  -- The original RPC serializes commands, validates transitions and owns idempotency.
  -- Its receipt is corrected below before this transaction can commit.
  v_result := public.study_session_mutate_v1(p_command);
  v_applied := coalesce((v_result ->> 'applied')::boolean, false);
  if not v_applied or v_action not in ('start', 'pause', 'resume', 'phase_change', 'complete', 'cancel') then
    return v_result;
  end if;

  select r.accepted_at into v_accepted_at
    from public.study_session_mutation_receipts r
   where r.user_id = v_uid and r.mutation_id = (p_command ->> 'mutation_id')::uuid;
  -- A replay returns the saved, already-corrected result. Never re-apply its timing shift.
  if v_accepted_at < v_received_at then return v_result; end if;

  if v_occurrence is not null then
    v_event_at := v_occurrence;
  elsif v_action = 'start' and (not v_prior_found or v_prior.state = 'planned') then
    v_event_at := v_received_at;
  else
    v_base_at := coalesce(v_prior.timing_at,
      case when v_prior.state = 'running' then v_prior.segment_started_at
           when v_prior.state = 'paused' then v_prior.paused_at
           else v_prior.updated_at end,
      v_received_at);
    v_event_at := v_base_at + (v_elapsed_ms * interval '1 millisecond');
  end if;

  if v_prior_found then
    if not (v_action = 'start' and v_prior.state = 'planned')
       and v_event_at < coalesce(v_prior.timing_at, v_prior.segment_started_at, v_prior.paused_at, v_prior.created_at) then
      raise exception 'timing_invalid: lifecycle boundary precedes the previous durable boundary' using errcode = '22023';
    end if;
    if v_occurrence is not null and v_prior.timing_at is not null and
       abs(extract(epoch from (v_event_at - v_prior.timing_at)) * 1000 - v_elapsed_ms) > 15000 then
      raise exception 'timing_invalid: server-clock estimate disagrees with monotonic elapsed time' using errcode = '22023';
    end if;
  end if;

  if v_prior_found and v_prior.state = 'running'
     and v_action in ('pause', 'phase_change', 'complete', 'cancel')
     and v_event_at <= v_prior.segment_started_at then
    -- Segments are strictly positive-length rows; this one-millisecond floor is the
    -- conservative restart recovery boundary, not an inferred offline study duration.
    v_event_at := v_prior.segment_started_at + interval '1 millisecond';
  end if;

  -- A client without a reconstructible server-clock anchor can still report exact
  -- monotonic deltas. During fast replay those deltas can place the newest boundary in
  -- the server's future. Shift this session's already-recorded timeline back as a whole;
  -- interval lengths and pause gaps stay exact and no canonical timestamp is future-dated.
  if v_event_at > v_received_at then
    v_shift := v_event_at - v_received_at;
    update public.study_session_segments g
       set started_at = g.started_at - v_shift,
           ended_at = case when g.ended_at is null then null else g.ended_at - v_shift end
     where g.user_id = v_uid and g.session_id = v_session_id;
    update public.study_sessions s
       set created_at = s.created_at - v_shift,
           started_at = case when s.started_at is null then null else s.started_at - v_shift end,
           paused_at = case when s.paused_at is null then null else s.paused_at - v_shift end,
           completed_at = case when s.completed_at is null then null else s.completed_at - v_shift end,
           cancelled_at = case when s.cancelled_at is null then null else s.cancelled_at - v_shift end,
           segment_started_at = case when s.segment_started_at is null then null else s.segment_started_at - v_shift end,
           timing_at = case when s.timing_at is null then null else s.timing_at - v_shift end
     where s.user_id = v_uid and s.id = v_session_id;
    v_event_at := v_received_at;
  end if;

  select s.segment_started_at, s.phase into v_segment_start, v_phase
    from public.study_sessions s where s.user_id = v_uid and s.id = v_session_id;
  if v_action in ('pause', 'phase_change', 'complete', 'cancel') and v_prior_found and v_prior.state = 'running' then
    v_segment_start := case when v_shift <> interval '0 seconds'
      then v_prior.segment_started_at - v_shift else v_prior.segment_started_at end;
    if v_segment_start is null or v_event_at < v_segment_start then
      raise exception 'timing_invalid: active boundary precedes its segment start' using errcode = '22023';
    end if;
    v_active_ms := greatest(0, floor(extract(epoch from (v_event_at - v_segment_start)) * 1000))::bigint;
    update public.study_session_segments g set ended_at = v_event_at
     where g.user_id = v_uid and g.session_id = v_session_id
       and g.started_at = v_segment_start and g.ended_at is not null;
    update public.study_sessions s set accumulated_active_ms = coalesce(v_prior.accumulated_active_ms, 0) + v_active_ms
     where s.user_id = v_uid and s.id = v_session_id;
  end if;

  if v_action = 'start' and (not v_prior_found or v_prior.state = 'planned') then
    update public.study_sessions s set
      created_at = least(s.created_at, v_event_at), started_at = v_event_at,
      segment_started_at = v_event_at, timing_at = v_event_at, updated_at = v_received_at
     where s.user_id = v_uid and s.id = v_session_id;
    update public.study_session_segments g set started_at = v_event_at
     where g.user_id = v_uid and g.session_id = v_session_id and g.ended_at is null;
  elsif v_action = 'resume' then
    update public.study_sessions s set segment_started_at = v_event_at, timing_at = v_event_at, updated_at = v_received_at
     where s.user_id = v_uid and s.id = v_session_id;
    update public.study_session_segments g set started_at = v_event_at
     where g.user_id = v_uid and g.session_id = v_session_id and g.ended_at is null;
  elsif v_action = 'phase_change' and v_prior.state = 'running' then
    update public.study_sessions s set segment_started_at = v_event_at, timing_at = v_event_at, updated_at = v_received_at
     where s.user_id = v_uid and s.id = v_session_id;
    update public.study_session_segments g set started_at = v_event_at
     where g.user_id = v_uid and g.session_id = v_session_id and g.ended_at is null;
  else
    update public.study_sessions s set
      paused_at = case when v_action = 'pause' then v_event_at else s.paused_at end,
      completed_at = case when v_action = 'complete' then v_event_at else s.completed_at end,
      cancelled_at = case when v_action = 'cancel' then v_event_at else s.cancelled_at end,
      timing_at = v_event_at, updated_at = v_received_at
     where s.user_id = v_uid and s.id = v_session_id;
  end if;

  v_result := v_result || jsonb_build_object(
    'server_now', v_received_at,
    'session', public.study_session_payload(v_uid, v_session_id)
  );
  update public.study_session_mutation_receipts r set result = v_result
   where r.user_id = v_uid and r.mutation_id = (p_command ->> 'mutation_id')::uuid;
  return v_result;
end;
$$;

revoke all on function public.study_session_mutate(jsonb) from public, anon;
grant execute on function public.study_session_mutate(jsonb) to authenticated;
alter function public.study_session_mutate(jsonb) set search_path = '';

-- Pin long-running client requests to the account whose local outbox/cursor they use.
-- Legacy clients remain compatible through the original overloads.
create function public.sync_read_changes(p_after bigint, p_limit integer, p_expected_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_expected_user_id is distinct from (select auth.uid()) then
    raise exception 'account_mismatch: expected_user_id must match the authenticated account' using errcode = '42501';
  end if;
  return public.sync_read_changes(p_after, p_limit);
end;
$$;
revoke all on function public.sync_read_changes(bigint, integer, uuid) from public, anon;
grant execute on function public.sync_read_changes(bigint, integer, uuid) to authenticated;
alter function public.sync_read_changes(bigint, integer, uuid) set search_path = '';

create function public.sync_apply_changes(p_changes jsonb, p_expected_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_expected_user_id is distinct from (select auth.uid()) then
    raise exception 'account_mismatch: expected_user_id must match the authenticated account' using errcode = '42501';
  end if;
  return public.sync_apply_changes(p_changes);
end;
$$;
revoke all on function public.sync_apply_changes(jsonb, uuid) from public, anon;
grant execute on function public.sync_apply_changes(jsonb, uuid) to authenticated;
alter function public.sync_apply_changes(jsonb, uuid) set search_path = '';

commit;
