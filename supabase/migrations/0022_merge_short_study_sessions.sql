-- One server policy for Focal and Folio. Originals remain recoverable tombstones.
begin;

create function public.merge_short_study_sessions(p_user uuid, p_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_session public.study_sessions%rowtype;
  v_other public.study_sessions%rowtype;
  v_sources jsonb;
  v_changed boolean := false;
begin
  -- ponytail: serialize per account using the existing sync lock; split by subject if contention becomes material.
  perform public.sync_next_lamport(p_user);
  select * into v_session from public.study_sessions where user_id = p_user and id = p_id for update;
  if not found or not v_session.completed or v_session.cancelled_at is not null
     or v_session.kind <> 'focus' or v_session.subject_id is null or v_session.started_at is null
     or v_session.segment_started_at is not null
     or jsonb_array_length(v_session.segments) = 0
     or (v_session.accumulated_active_ms >= 120000 and not (v_session.metadata ? 'auto_merge_sources')) then return; end if;
  v_sources := coalesce(v_session.metadata -> 'auto_merge_sources', '[]'::jsonb);
  loop
    select s.* into v_other from public.study_sessions s
    where s.user_id = p_user and s.id <> p_id and s.kind = 'focus'
      and s.subject_id = v_session.subject_id and s.completed and s.cancelled_at is null
      and s.segment_started_at is null and s.started_at is not null
      and jsonb_array_length(s.segments) > 0
      and (s.accumulated_active_ms < 120000 or s.metadata ? 'auto_merge_sources')
      -- Never combine overlapping work, which could be separate devices counting the same time.
      and ((s.completed_at <= v_session.started_at and s.completed_at >= v_session.started_at - interval '5 minutes')
        or (s.started_at >= v_session.completed_at and s.started_at <= v_session.completed_at + interval '5 minutes'))
      -- A different subject between fragments is a real change of activity.
      and not exists (select 1 from public.study_sessions intervening
        where intervening.user_id = p_user and intervening.id not in (p_id, s.id)
          and intervening.cancelled_at is null and intervening.started_at is not null
          and intervening.subject_id is distinct from v_session.subject_id
          and intervening.started_at < greatest(s.started_at, v_session.started_at)
          and coalesce(intervening.completed_at, intervening.paused_at, intervening.updated_at)
            > least(s.completed_at, v_session.completed_at))
    order by s.started_at, s.id limit 1 for update;
    exit when not found;
    if not v_changed and not (v_session.metadata ? 'auto_merge_sources') then
      v_sources := jsonb_build_array(jsonb_build_object('id', v_session.id, 'title', v_session.title, 'metadata', v_session.metadata));
    end if;
    v_sources := v_sources || coalesce(v_other.metadata -> 'auto_merge_sources',
      jsonb_build_array(jsonb_build_object('id', v_other.id, 'title', v_other.title, 'metadata', v_other.metadata)));
    -- ponytail: cap at the editor's 100-block and command metadata limits; raise both limits together for larger groups.
    exit when jsonb_array_length(v_session.segments) + jsonb_array_length(v_other.segments) > 100
      or octet_length((v_session.metadata || jsonb_build_object('auto_merge_sources', v_sources))::text) > 60000;
    select jsonb_agg(g || jsonb_build_object('session_id', p_id) order by (g ->> 'started_at')::timestamptz, g ->> 'id')
      into v_session.segments from jsonb_array_elements(v_session.segments || v_other.segments) g;
    v_session.started_at := least(v_session.started_at, v_other.started_at);
    v_session.completed_at := greatest(v_session.completed_at, v_other.completed_at);
    v_session.accumulated_active_ms := v_session.accumulated_active_ms + v_other.accumulated_active_ms;
    v_session.metadata := v_session.metadata || jsonb_build_object('auto_merge_sources', v_sources);
    update public.study_sessions set cancelled_at = clock_timestamp(), updated_at = clock_timestamp(), revision = revision + 1
      where user_id = p_user and id = v_other.id;
    insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
      values (p_user, gen_random_uuid(), 'auto-merge', 'study_sessions', v_other.id, 'put',
        jsonb_build_object('revision', v_other.revision + 1), public.sync_next_lamport(p_user));
    v_changed := true;
  end loop;
  if v_changed then
    update public.study_sessions set started_at = v_session.started_at, completed_at = v_session.completed_at,
      accumulated_active_ms = v_session.accumulated_active_ms, segments = v_session.segments,
      metadata = v_session.metadata, updated_at = clock_timestamp(), revision = revision + 1
      where user_id = p_user and id = p_id;
    insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
      values (p_user, gen_random_uuid(), 'auto-merge', 'study_sessions', p_id, 'put',
        jsonb_build_object('revision', v_session.revision + 1), public.sync_next_lamport(p_user));
  end if;
end;
$$;
revoke all on function public.merge_short_study_sessions(uuid, text) from public, anon, authenticated;

alter function public.study_session_mutate(jsonb) rename to study_session_mutate_unmerged;
revoke all on function public.study_session_mutate_unmerged(jsonb) from public, anon, authenticated;
create function public.study_session_mutate(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
  v_replayed boolean;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  perform public.sync_next_lamport(v_uid);
  select exists(select 1 from public.study_session_mutation_receipts
    where user_id = v_uid and mutation_id = (p_command ->> 'mutation_id')::uuid) into v_replayed;
  v_result := public.study_session_mutate_unmerged(p_command);
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

-- Collapse existing fragmentation too, keeping the latest session's identity.
do $$
declare v_row record;
begin
  for v_row in select user_id, id from public.study_sessions
    where kind = 'focus' and completed and cancelled_at is null and accumulated_active_ms < 120000
    order by user_id, started_at desc, id loop
    perform public.merge_short_study_sessions(v_row.user_id, v_row.id);
  end loop;
end;
$$;
commit;
