-- Let a user remove logged (completed) study by cancelling it. Same RPC, same wire format.
begin;

create or replace function public.study_session_mutate(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_mutation uuid;
  v_id text;
  v_action text;
  v_device text;
  v_app text;
  v_expected bigint;
  v_now timestamptz := clock_timestamp();
  v_event timestamptz;
  v_occurrence timestamptz;
  v_elapsed bigint := 0;
  v_has_timing boolean;
  v_shift interval;
  v_session public.study_sessions%rowtype;
  v_found boolean;
  v_reason text;
  v_request jsonb;
  v_result jsonb;
  v_lamport bigint;
  v_seq bigint;
  v_phase text;
  v_blocks jsonb;
  v_block jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_last timestamptz;
  v_index integer;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_command is null or jsonb_typeof(p_command) <> 'object' then
    raise exception 'validation_failed: command must be an object' using errcode = '22023';
  end if;
  if p_command ? 'expected_user_id' then
    if (p_command ->> 'expected_user_id')::uuid is distinct from v_uid then
      raise exception 'account_mismatch: expected_user_id must match the authenticated account' using errcode = '42501';
    end if;
  end if;
  v_mutation := (p_command ->> 'mutation_id')::uuid;
  v_id := nullif(p_command ->> 'session_id', '');
  v_action := p_command ->> 'action';
  v_device := p_command ->> 'device_id';
  v_app := coalesce(p_command ->> 'app', 'focal');
  v_expected := coalesce((p_command ->> 'expected_revision')::bigint, 0);
  if v_mutation is null or v_id is null or length(v_id) > 160 or v_expected < 0 then
    raise exception 'validation_failed: invalid session identity or revision' using errcode = '22023';
  end if;
  if v_action is null or v_action not in ('log', 'create', 'start', 'pause', 'resume', 'phase_change', 'save_progress', 'complete', 'cancel') then
    raise exception 'validation_failed: unknown session action' using errcode = '22023';
  end if;
  if v_device is null or v_device !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_app not in ('focal', 'examtrack', 'folio') then
    raise exception 'validation_failed: invalid device or app' using errcode = '22023';
  end if;
  if p_command ? 'kind' and (p_command ->> 'kind' is null or p_command ->> 'kind' not in ('focus', 'exam', 'sac')) then
    raise exception 'validation_failed: invalid study kind' using errcode = '22023';
  end if;
  if p_command ? 'phase' and (p_command ->> 'phase' is null or p_command ->> 'phase' not in ('focus', 'reading', 'writing')) then
    raise exception 'validation_failed: invalid study phase' using errcode = '22023';
  end if;
  if p_command ? 'title' and (jsonb_typeof(p_command -> 'title') <> 'string' or length(p_command ->> 'title') > 512) then
    raise exception 'validation_failed: title must be a string no longer than 512 characters' using errcode = '22023';
  end if;
  if p_command ? 'subject_id' and p_command -> 'subject_id' <> 'null'::jsonb and jsonb_typeof(p_command -> 'subject_id') <> 'string' then
    raise exception 'validation_failed: invalid subject' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_command -> 'metadata', '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_command -> 'metadata', '{}'::jsonb)::text) > 65536 then
    raise exception 'validation_failed: metadata must be an object smaller than 64 KiB' using errcode = '22023';
  end if;

  -- Lock before reading either the receipt or the row: retries and feed commits stay ordered.
  v_lamport := public.sync_next_lamport(v_uid);
  select request, result into v_request, v_result from public.study_session_mutation_receipts
    where user_id = v_uid and mutation_id = v_mutation;
  if found then
    if v_request - 'expected_user_id' <> p_command - 'expected_user_id' then
      raise exception 'mutation_id_reused: mutation_id was already used for another command' using errcode = '22023';
    end if;
    return v_result;
  end if;
  select * into v_session from public.study_sessions where user_id = v_uid and id = v_id for update;
  v_found := found;
  v_now := clock_timestamp();

  if not v_found then
    if v_action not in ('create', 'start', 'log') or v_expected <> 0 then v_reason := 'not_found'; end if;
  elsif v_action in ('create', 'log') then v_reason := 'already_exists';
  elsif v_action = 'pause' and v_session.state = 'paused' then v_reason := 'already_paused';
  elsif v_action in ('start', 'resume') and v_session.state = 'running' then v_reason := 'already_running';
  elsif v_action = 'complete' and v_session.state = 'completed' then v_reason := 'already_completed';
  elsif v_action = 'cancel' and v_session.state = 'cancelled' then v_reason := 'already_cancelled';
  -- Removing logged study: a completed session may be cancelled (retained as a cancelled row that
  -- every client already hides). Anything else terminal stays terminal.
  elsif v_session.state in ('completed', 'cancelled') and v_action <> 'save_progress'
        and not (v_action = 'cancel' and v_session.state = 'completed') then v_reason := 'session_terminal';
  elsif v_expected <> v_session.revision then v_reason := 'stale_revision';
  elsif (v_action = 'start' and v_session.state <> 'planned')
     or (v_action = 'resume' and v_session.state <> 'paused')
     or (v_action = 'pause' and v_session.state <> 'running')
     or (v_action = 'phase_change' and v_session.state not in ('running', 'paused')) then
    v_reason := 'invalid_transition';
  end if;

  if v_reason is null then
    if not v_found then
      v_session.user_id := v_uid;
      v_session.id := v_id;
      v_session.kind := coalesce(p_command ->> 'kind', 'focus');
      v_session.phase := coalesce(p_command ->> 'phase', case when v_session.kind = 'focus' then 'focus' end);
      v_session.state := 'planned';
      v_session.originating_app := v_app;
      v_session.created_at := v_now;
      v_session.revision := 0;
      v_session.accumulated_active_ms := 0;
      v_session.segments := '[]'::jsonb;
      v_session.title := '';
      v_session.metadata := '{}'::jsonb;
    end if;
    v_phase := coalesce(p_command ->> 'phase', v_session.phase);
    if v_action = 'phase_change' and v_phase is null then
      raise exception 'validation_failed: phase_change requires a valid phase' using errcode = '22023';
    end if;
    v_session.title := coalesce(p_command ->> 'title', v_session.title);
    if p_command ? 'subject_id' then v_session.subject_id := nullif(p_command ->> 'subject_id', ''); end if;
    v_session.metadata := coalesce(p_command -> 'metadata', v_session.metadata);

    if v_action = 'log' then
      v_blocks := p_command -> 'blocks';
      if jsonb_typeof(v_blocks) is distinct from 'array' then raise exception 'Study blocks are required'; end if;
      if jsonb_array_length(v_blocks) not between 1 and 100 then raise exception 'Enter 1–100 study blocks'; end if;
      if nullif(btrim(v_session.subject_id), '') is null or nullif(btrim(v_session.title), '') is null then
        raise exception 'Subject and title are required';
      end if;
      if v_session.kind <> 'focus' then raise exception 'Past study must be focus study'; end if;
      for v_block in select value from jsonb_array_elements(v_blocks) order by (value ->> 'start')::timestamptz loop
        v_start := (v_block ->> 'start')::timestamptz;
        v_end := (v_block ->> 'end')::timestamptz;
        if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end)
           or v_end <= v_start or v_end > v_now or v_end - v_start > interval '24 hours'
           or (v_last is not null and v_start < v_last) then
          raise exception 'Invalid, future, or overlapping study blocks';
        end if;
        v_session.started_at := coalesce(v_session.started_at, v_start);
        v_last := v_end;
        v_session.accumulated_active_ms := v_session.accumulated_active_ms + round(extract(epoch from (v_end - v_start)) * 1000)::bigint;
        v_session.segments := v_session.segments || jsonb_build_array(jsonb_build_object(
          'id', gen_random_uuid(), 'session_id', v_id, 'started_at', v_start, 'ended_at', v_end,
          'phase', 'focus', 'source_device_id', v_device));
      end loop;
      v_session.state := 'completed';
      v_session.phase := 'focus';
      v_session.completed_at := v_last;
      v_session.timing_at := v_last;
    elsif v_action in ('start', 'pause', 'resume', 'phase_change', 'complete', 'cancel') then
      v_has_timing := p_command ? 'elapsed_since_previous_ms'
        or (p_command ? 'occurred_at' and p_command -> 'occurred_at' <> 'null'::jsonb);
      if p_command ? 'elapsed_since_previous_ms' then
        if jsonb_typeof(p_command -> 'elapsed_since_previous_ms') <> 'number'
           or (p_command ->> 'elapsed_since_previous_ms') !~ '^[0-9]+$' then
          raise exception 'validation_failed: elapsed_since_previous_ms must be an integer' using errcode = '22023';
        end if;
        v_elapsed := (p_command ->> 'elapsed_since_previous_ms')::bigint;
      end if;
      if v_elapsed < 0 or v_elapsed > 604800000 then
        raise exception 'timing_invalid: elapsed duration is outside the accepted seven-day range' using errcode = '22023';
      end if;
      if p_command ? 'occurred_at' and p_command -> 'occurred_at' <> 'null'::jsonb then
        if jsonb_typeof(p_command -> 'occurred_at') <> 'string' then
          raise exception 'validation_failed: occurred_at must be an ISO timestamp or null' using errcode = '22023';
        end if;
        v_occurrence := (p_command ->> 'occurred_at')::timestamptz;
        if not isfinite(v_occurrence) or v_occurrence < v_now - interval '30 days' or v_occurrence > v_now + interval '5 seconds' then
          raise exception 'timing_invalid: occurred_at is outside the accepted server-clock window' using errcode = '22023';
        end if;
      end if;
      if not v_has_timing then v_event := v_now;
      elsif v_occurrence is not null then v_event := v_occurrence;
      elsif v_action = 'start' then v_event := v_now;
      else v_event := coalesce(v_session.timing_at,
        case when v_session.state = 'running' then v_session.segment_started_at
             when v_session.state = 'paused' then v_session.paused_at else v_session.updated_at end, v_now)
        + v_elapsed * interval '1 millisecond';
      end if;
      if v_found and v_action <> 'start' then
        if v_event < coalesce(v_session.timing_at, v_session.segment_started_at, v_session.paused_at, v_session.created_at) then
          raise exception 'timing_invalid: lifecycle boundary precedes the previous durable boundary' using errcode = '22023';
        end if;
        if v_occurrence is not null and v_session.timing_at is not null
           and abs(extract(epoch from (v_event - v_session.timing_at)) * 1000 - v_elapsed) > 15000 then
          raise exception 'timing_invalid: server-clock estimate disagrees with monotonic elapsed time' using errcode = '22023';
        end if;
      end if;
      if v_session.state = 'running' and v_action in ('pause', 'phase_change', 'complete', 'cancel') then
        v_event := greatest(v_event, v_session.segment_started_at + interval '1 millisecond');
      end if;
      -- Exact offline deltas may run ahead of receipt time. Shift the whole timeline,
      -- not individual lengths, so study minutes and break gaps remain unchanged.
      if v_event > v_now then
        v_shift := v_event - v_now;
        select coalesce(jsonb_agg(value || jsonb_build_object(
          'started_at', (value ->> 'started_at')::timestamptz - v_shift,
          'ended_at', (value ->> 'ended_at')::timestamptz - v_shift) order by ordinality), '[]'::jsonb)
          into v_session.segments from jsonb_array_elements(v_session.segments) with ordinality;
        v_session.created_at := v_session.created_at - v_shift;
        v_session.started_at := v_session.started_at - v_shift;
        v_session.paused_at := v_session.paused_at - v_shift;
        v_session.completed_at := v_session.completed_at - v_shift;
        v_session.cancelled_at := v_session.cancelled_at - v_shift;
        v_session.segment_started_at := v_session.segment_started_at - v_shift;
        v_event := v_now;
      end if;
      if v_session.state = 'running' and v_action in ('pause', 'phase_change', 'complete', 'cancel') then
        v_index := jsonb_array_length(v_session.segments) - 1;
        if v_index < 0 or v_session.segments -> v_index ->> 'ended_at' is not null then
          raise exception 'Running session has no open study interval';
        end if;
        v_session.segments := jsonb_set(v_session.segments, array[v_index::text, 'ended_at'], to_jsonb(v_event));
        v_session.accumulated_active_ms := v_session.accumulated_active_ms
          + greatest(0, floor(extract(epoch from (v_event - v_session.segment_started_at)) * 1000))::bigint;
        v_session.segment_started_at := null;
      end if;
      if v_action in ('start', 'resume') or (v_action = 'phase_change' and v_session.state = 'running') then
        v_session.segments := v_session.segments || jsonb_build_array(jsonb_build_object(
          'id', gen_random_uuid(), 'session_id', v_id, 'started_at', v_event, 'ended_at', null,
          'phase', v_phase, 'source_device_id', v_device));
        v_session.segment_started_at := v_event;
        v_session.started_at := coalesce(v_session.started_at, v_event);
        v_session.created_at := least(v_session.created_at, v_event);
        v_session.paused_at := null;
        v_session.state := 'running';
        v_session.phase := v_phase;
      elsif v_action = 'phase_change' then
        v_session.phase := v_phase;
      elsif v_action = 'pause' then
        v_session.state := 'paused'; v_session.paused_at := v_event;
      elsif v_action in ('complete', 'cancel') then
        v_session.state := case when v_action = 'complete' then 'completed' else 'cancelled' end;
        v_session.completed_at := case when v_action = 'complete' then v_event end;
        v_session.cancelled_at := case when v_action = 'cancel' then v_event end;
        v_session.paused_at := null;
      end if;
      v_session.timing_at := v_event;
    end if;
    v_session.revision := v_session.revision + 1;
    v_session.updated_at := v_now;
    insert into public.study_sessions as s (user_id, id, kind, state, phase, revision, title, subject_id, originating_app,
      created_at, updated_at, started_at, paused_at, completed_at, cancelled_at, accumulated_active_ms, segment_started_at,
      timing_at, metadata, segments)
    values (v_uid, v_id, v_session.kind, v_session.state, v_session.phase, v_session.revision, v_session.title,
      v_session.subject_id, v_session.originating_app, v_session.created_at, v_now, v_session.started_at, v_session.paused_at,
      v_session.completed_at, v_session.cancelled_at, v_session.accumulated_active_ms, v_session.segment_started_at,
      v_session.timing_at, v_session.metadata, v_session.segments)
    on conflict (user_id, id) do update set state = excluded.state, phase = excluded.phase, revision = excluded.revision,
      title = excluded.title, subject_id = excluded.subject_id, created_at = excluded.created_at, updated_at = excluded.updated_at,
      started_at = excluded.started_at, paused_at = excluded.paused_at, completed_at = excluded.completed_at,
      cancelled_at = excluded.cancelled_at, accumulated_active_ms = excluded.accumulated_active_ms,
      segment_started_at = excluded.segment_started_at, timing_at = excluded.timing_at,
      metadata = excluded.metadata, segments = excluded.segments;
    insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
      values (v_uid, v_mutation, v_device, 'study_sessions', v_id, 'put', jsonb_build_object('revision', v_session.revision), v_lamport)
      returning seq into v_seq;
  end if;
  v_result := jsonb_build_object('ok', v_reason is null or v_reason not in ('not_found', 'already_exists', 'invalid_transition'),
    'applied', v_reason is null, 'reason', v_reason, 'server_now', v_now,
    'session', public.study_session_payload(v_uid, v_id));
  if v_seq is not null then v_result := v_result || jsonb_build_object('change_seq', v_seq); end if;
  insert into public.study_session_mutation_receipts (user_id, mutation_id, request, result)
    values (v_uid, v_mutation, p_command, v_result);
  return v_result;
end;
$$;

commit;
