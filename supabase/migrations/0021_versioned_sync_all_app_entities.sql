-- The versioned (expected_seq) branch of sync_apply_changes only accepted attempts, mistakes and
-- user_state, but the clients send calendar events and the school timetable the same way. Every
-- such write raised 22023 'invalid versioned sync change', so those rows never reached the log
-- and, riding in a batch with other changes, failed the whole batch with them.
-- Body is migration 0012's function unchanged apart from the entity list.
begin;

create or replace function public.sync_apply_changes(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item jsonb;
  v_entity text;
  v_row_id text;
  v_change uuid;
  v_expected bigint;
  v_current public.sync_state%rowtype;
  v_seq bigint;
  v_receipts jsonb := '[]'::jsonb;
  v_stale jsonb := '[]'::jsonb;
  v_legacy jsonb := '[]'::jsonb;
  v_legacy_result jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'p_changes must be a json array' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_changes) loop
    if not (v_item ? 'expected_seq') then
      v_legacy := v_legacy || jsonb_build_array(v_item);
      continue;
    end if;
    v_entity := v_item ->> 'entity';
    v_row_id := nullif(v_item ->> 'row_id', '');
    v_change := nullif(v_item ->> 'change_id', '')::uuid;
    v_expected := coalesce(nullif(v_item ->> 'expected_seq', '')::bigint, 0);
    if coalesce(v_entity, '') not in ('attempts', 'mistakes', 'user_state', 'events', 'timetable_config')
       or v_row_id is null or v_change is null then
      raise exception 'invalid versioned sync change' using errcode = '22023';
    end if;
    if coalesce(v_item ->> 'operation', '') not in ('put', 'delete') or
       (v_item ->> 'operation' = 'put' and coalesce(v_item -> 'payload', 'null'::jsonb) = 'null'::jsonb) then
      raise exception 'invalid sync operation or payload' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_entity || ':' || v_row_id, 0));
    select r.seq into v_seq from public.sync_change_receipts r where r.user_id = v_uid and r.change_id = v_change;
    if v_seq is not null then
      v_receipts := v_receipts || jsonb_build_array(jsonb_build_object('change_id', v_change, 'seq', v_seq, 'replayed', true));
      continue;
    end if;
    select s.* into v_current from public.sync_state s
     where s.user_id = v_uid and s.entity = v_entity and s.row_id = v_row_id for update;
    if coalesce(v_current.seq, 0) <> v_expected then
      v_stale := v_stale || jsonb_build_array(jsonb_build_object(
        'change_id', v_change,
        'current', case when v_current.user_id is null then null else jsonb_build_object(
          'entity', v_current.entity, 'row_id', v_current.row_id, 'operation', v_current.operation,
          'payload', v_current.payload, 'lamport', v_current.lamport, 'client_id', v_current.client_id,
          'seq', v_current.seq, 'updated_at', v_current.updated_at
        ) end
      ));
      continue;
    end if;
    insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
    values (v_uid, v_change, coalesce(nullif(v_item ->> 'client_id', ''), 'unknown'), v_entity, v_row_id,
      v_item ->> 'operation', nullif(v_item -> 'payload', 'null'::jsonb), public.sync_next_lamport(v_uid))
    returning seq into v_seq;
    v_receipts := v_receipts || jsonb_build_array(jsonb_build_object('change_id', v_change, 'seq', v_seq, 'replayed', false));
  end loop;
  if jsonb_array_length(v_legacy) > 0 then
    v_legacy_result := public.sync_apply_changes_v4_legacy(v_legacy);
    v_receipts := v_receipts || coalesce(v_legacy_result -> 'receipts', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'receipts', v_receipts, 'stale', v_stale,
    'head', (select coalesce(max(l.seq), 0) from public.sync_log l where l.user_id = v_uid)
  );
end;
$$;

commit;
