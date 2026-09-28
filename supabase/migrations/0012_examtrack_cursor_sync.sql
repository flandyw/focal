-- Put ExamTrack attempts, mistakes and settings on the ordered sync feed. The direct
-- tables remain read projections for Folio's existing mistake client; their trigger
-- forwards legacy writes into the same feed and feed projections never echo back.
begin;

create or replace function public.sync_project_examtrack_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_projection text := coalesce(current_setting('focal.sync_projection', true), 'off');
  v_payload jsonb := '{}'::jsonb;
  v_state record;
  v_key text;
  v_stamp text;
begin
  if new.entity in ('attempts', 'mistakes') then
    perform set_config('focal.sync_projection', 'on', true);
    if new.operation = 'delete' then
      execute format(
        'insert into public.%I (user_id, id, payload, updated_at, deleted_at) values ($1, $2::uuid, null, $3, $3) on conflict (user_id, id) do update set payload = null, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at',
        new.entity
      ) using new.user_id, new.row_id, new.updated_at;
    elsif new.row_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      execute format(
        'insert into public.%I (user_id, id, payload, updated_at, deleted_at) values ($1, $2::uuid, $3, $4, null) on conflict (user_id, id) do update set payload = excluded.payload, updated_at = excluded.updated_at, deleted_at = null',
        new.entity
      ) using new.user_id, new.row_id, new.payload, new.updated_at;
    end if;
    perform set_config('focal.sync_projection', v_old_projection, true);
    return new;
  end if;

  if new.entity = 'user_state' then
    for v_state in
      select s.row_id, s.operation, s.payload, s.updated_at
        from public.sync_state s
       where s.user_id = new.user_id
         and s.entity = 'user_state' and s.row_id <> 'user_state'
         and s.row_id not in ('activeExamTimer', 'activeSacTimer', 'activeExamTimerUpdatedAt', 'activeSacTimerUpdatedAt')
         and s.operation = 'put'
       order by s.row_id
    loop
      v_payload := v_payload || jsonb_build_object(v_state.row_id, v_state.payload -> 'value');
      v_stamp := v_state.payload ->> 'updated_at';
      if v_stamp is not null then
        case v_state.row_id
          when 'trackedExamIds' then v_payload := v_payload || jsonb_build_object('trackedExamIdsUpdatedAt', v_stamp);
          when 'completedExamIds' then v_payload := v_payload || jsonb_build_object('completedExamIdsUpdatedAt', v_stamp);
          when 'subjects' then v_payload := v_payload || jsonb_build_object('subjectsUpdatedAt', v_stamp);
          when 'sacRecords' then v_payload := v_payload || jsonb_build_object('sacRecordsUpdatedAt', v_stamp);
          when 'atarEstimates' then v_payload := v_payload || jsonb_build_object('atarEstimatesUpdatedAt', v_stamp);
          else null;
        end case;
      end if;
    end loop;
    perform set_config('focal.sync_projection', 'on', true);
    insert into public.user_state (user_id, payload, updated_at)
    values (new.user_id, v_payload,
      coalesce((select max(s.updated_at) from public.sync_state s
        where s.user_id = new.user_id and s.entity = 'user_state'), now()))
    on conflict (user_id) do update set payload = excluded.payload, updated_at = excluded.updated_at;
    perform set_config('focal.sync_projection', v_old_projection, true);
    return new;
  end if;
  return new;
end;
$$;

create or replace function public.sync_examtrack_direct_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_entity text := tg_table_name;
  v_row_id text;
  v_payload jsonb;
  v_operation text;
  v_device text := 'legacy-direct';
  v_key text;
  v_value jsonb;
  v_stamp text;
  v_change uuid;
begin
  if coalesce(current_setting('focal.sync_projection', true), 'off') = 'on' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then v_uid := old.user_id; else v_uid := new.user_id; end if;
  if (select auth.uid()) is not null and (select auth.uid()) <> v_uid then
    raise exception 'Cannot publish changes for another user' using errcode = '42501';
  end if;

  if v_entity in ('attempts', 'mistakes') then
    if tg_op = 'DELETE' then
      v_row_id := old.id::text;
      v_operation := 'delete';
      v_payload := null;
    else
      v_row_id := new.id::text;
      v_operation := case when new.deleted_at is not null or new.payload is null then 'delete' else 'put' end;
      v_payload := case when v_operation = 'put' then new.payload else null end;
    end if;
    v_change := gen_random_uuid();
    insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
    values (v_uid, v_change, v_device, v_entity, v_row_id, v_operation, v_payload, public.sync_next_lamport(v_uid));
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- Legacy whole-document user_state writes are split into independent keyed rows.
  -- Live timer fields are intentionally excluded; study_session_mutate owns those.
  if tg_op = 'DELETE' then
    for v_key in select old_keys.key from jsonb_object_keys(old.payload) as old_keys(key) loop
      if v_key in ('activeExamTimer', 'activeSacTimer', 'activeExamTimerUpdatedAt', 'activeSacTimerUpdatedAt')
         or v_key ~ 'UpdatedAt$' then continue; end if;
      v_change := gen_random_uuid();
      insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
      values (v_uid, v_change, v_device, 'user_state', v_key, 'delete', null, public.sync_next_lamport(v_uid));
    end loop;
    return old;
  end if;

  for v_key, v_value in select key, value from jsonb_each(new.payload)
  loop
    if v_key in ('activeExamTimer', 'activeSacTimer', 'activeExamTimerUpdatedAt', 'activeSacTimerUpdatedAt')
       or v_key ~ 'UpdatedAt$' then continue; end if;
    v_stamp := coalesce(
      case v_key
        when 'trackedExamIds' then new.payload ->> 'trackedExamIdsUpdatedAt'
        when 'completedExamIds' then new.payload ->> 'completedExamIdsUpdatedAt'
        when 'subjects' then new.payload ->> 'subjectsUpdatedAt'
        when 'sacRecords' then new.payload ->> 'sacRecordsUpdatedAt'
        when 'atarEstimates' then new.payload ->> 'atarEstimatesUpdatedAt'
        else null
      end,
      v_value ->> 'updatedAt', new.updated_at::text
    );
    v_change := gen_random_uuid();
    insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
    values (v_uid, v_change, v_device, 'user_state', v_key, 'put',
      jsonb_build_object('value', v_value, 'updated_at', v_stamp), public.sync_next_lamport(v_uid));
  end loop;
  if tg_op = 'UPDATE' then
    for v_key in
      select old_keys.key from jsonb_object_keys(old.payload) as old_keys(key)
       where old_keys.key not in ('activeExamTimer', 'activeSacTimer', 'activeExamTimerUpdatedAt', 'activeSacTimerUpdatedAt')
         and old_keys.key !~ 'UpdatedAt$'
         and not (new.payload ? old_keys.key)
    loop
      v_change := gen_random_uuid();
      insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
      values (v_uid, v_change, v_device, 'user_state', v_key, 'delete', null, public.sync_next_lamport(v_uid));
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.strip_examtrack_timer_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.payload := new.payload - 'activeExamTimer' - 'activeSacTimer'
    - 'activeExamTimerUpdatedAt' - 'activeSacTimerUpdatedAt';
  return new;
end;
$$;

drop trigger if exists sync_project_examtrack_row_after_change on public.sync_state;
create trigger sync_project_examtrack_row_after_change
after insert or update on public.sync_state
for each row when (new.entity in ('attempts', 'mistakes', 'user_state'))
execute function public.sync_project_examtrack_row();

drop trigger if exists sync_examtrack_timer_state_before_write on public.user_state;
create trigger sync_examtrack_timer_state_before_write
before insert or update on public.user_state
for each row execute function public.strip_examtrack_timer_state();

drop trigger if exists sync_examtrack_attempts_to_log on public.attempts;
create trigger sync_examtrack_attempts_to_log
after insert or update or delete on public.attempts
for each row execute function public.sync_examtrack_direct_write();

drop trigger if exists sync_examtrack_mistakes_to_log on public.mistakes;
create trigger sync_examtrack_mistakes_to_log
after insert or update or delete on public.mistakes
for each row execute function public.sync_examtrack_direct_write();

drop trigger if exists sync_examtrack_user_state_to_log on public.user_state;
create trigger sync_examtrack_user_state_to_log
after insert or update or delete on public.user_state
for each row execute function public.sync_examtrack_direct_write();

-- Some deployments may still have a pre-0011 timer object in the direct projection.
update public.user_state
   set payload = payload - 'activeExamTimer' - 'activeSacTimer'
       - 'activeExamTimerUpdatedAt' - 'activeSacTimerUpdatedAt'
 where payload ? 'activeExamTimer' or payload ? 'activeSacTimer'
    or payload ? 'activeExamTimerUpdatedAt' or payload ? 'activeSacTimerUpdatedAt';

-- Backfill the merged tables and split any pre-existing singleton into keyed feed rows.
do $$
declare
  r record;
  k text;
  v jsonb;
  stamp text;
  p jsonb;
begin
  for r in select user_id, id, payload, updated_at, deleted_at from public.attempts loop
    if not exists (select 1 from public.sync_state s where s.user_id = r.user_id and s.entity = 'attempts' and s.row_id = r.id::text) then
      insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport, created_at)
      values (r.user_id, gen_random_uuid(), 'migration-0012', 'attempts', r.id::text,
        case when r.deleted_at is null and r.payload is not null then 'put' else 'delete' end,
        case when r.deleted_at is null then r.payload else null end,
        public.sync_next_lamport(r.user_id), r.updated_at);
    end if;
  end loop;
  for r in select user_id, id, payload, updated_at, deleted_at from public.mistakes loop
    if not exists (select 1 from public.sync_state s where s.user_id = r.user_id and s.entity = 'mistakes' and s.row_id = r.id::text) then
      insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport, created_at)
      values (r.user_id, gen_random_uuid(), 'migration-0012', 'mistakes', r.id::text,
        case when r.deleted_at is null and r.payload is not null then 'put' else 'delete' end,
        case when r.deleted_at is null then r.payload else null end,
        public.sync_next_lamport(r.user_id), r.updated_at);
    end if;
  end loop;
  for r in select user_id, payload, updated_at from public.user_state loop
    for k, v in select key, value from jsonb_each(r.payload)
    loop
      if k in ('activeExamTimer', 'activeSacTimer', 'activeExamTimerUpdatedAt', 'activeSacTimerUpdatedAt') or k ~ 'UpdatedAt$' then continue; end if;
      if exists (select 1 from public.sync_state s where s.user_id = r.user_id and s.entity = 'user_state' and s.row_id = k) then continue; end if;
      stamp := coalesce(case k
        when 'trackedExamIds' then r.payload ->> 'trackedExamIdsUpdatedAt'
        when 'completedExamIds' then r.payload ->> 'completedExamIdsUpdatedAt'
        when 'subjects' then r.payload ->> 'subjectsUpdatedAt'
        when 'sacRecords' then r.payload ->> 'sacRecordsUpdatedAt'
        when 'atarEstimates' then r.payload ->> 'atarEstimatesUpdatedAt'
        else null end, v ->> 'updatedAt', r.updated_at::text);
      p := jsonb_build_object('value', v, 'updated_at', stamp);
      insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport, created_at)
      values (r.user_id, gen_random_uuid(), 'migration-0012', 'user_state', k, 'put', p,
        public.sync_next_lamport(r.user_id), r.updated_at);
    end loop;
  end loop;
end;
$$;

-- Versioned app-row writes use the sync row's current sequence as a compare-and-set.
-- A stale client gets the canonical row and can merge/rebase its durable outbox entry.
alter function public.sync_apply_changes(jsonb) rename to sync_apply_changes_v4_legacy;
revoke all on function public.sync_apply_changes_v4_legacy(jsonb) from public, anon, authenticated;
alter function public.sync_apply_changes_v4_legacy(jsonb) set search_path = '';

create function public.sync_apply_changes(p_changes jsonb)
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
    if coalesce(v_entity, '') not in ('attempts', 'mistakes', 'user_state') or v_row_id is null or v_change is null then
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

revoke all on function public.sync_apply_changes(jsonb) from public, anon;
grant execute on function public.sync_apply_changes(jsonb) to authenticated;
alter function public.sync_apply_changes(jsonb) set search_path = '';

commit;
