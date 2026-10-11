-- Apply interval cleanup to active and paused exams as well as completed focus study.
begin;

create or replace function public.prune_study_intervals()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_segments jsonb;
  v_ms bigint;
begin
  -- Unfinished focus sessions replay boundaries by interval position; only exam/SAC
  -- journals can safely prune intervals before completion.
  if new.cancelled_at is not null or (not new.completed and (new.started_at is null or new.kind = 'focus')) then return new; end if;
  -- Use exact timestamps, not the UI's minute labels. Real short study remains study.
  select coalesce(jsonb_agg(segment order by (segment ->> 'started_at')::timestamptz), '[]'::jsonb)
    into v_segments from (
      select distinct on ((g ->> 'started_at')::timestamptz, (g ->> 'ended_at')::timestamptz, g ->> 'phase') g as segment
      from jsonb_array_elements(new.segments) with ordinality as blocks(g, position)
      where g ->> 'ended_at' is null or (
        (g ->> 'ended_at')::timestamptz - (g ->> 'started_at')::timestamptz >= interval '1 second'
        -- ponytail: treat 3+ sub-30s intervals in one minute from one device/phase as chatter;
        -- a device boundary identifier would let us replace this heuristic with exact provenance.
        and not ((g ->> 'ended_at')::timestamptz - (g ->> 'started_at')::timestamptz < interval '30 seconds'
          and (select count(*) from jsonb_array_elements(new.segments) fragment
            where fragment ->> 'ended_at' is not null
              and (fragment ->> 'ended_at')::timestamptz - (fragment ->> 'started_at')::timestamptz < interval '30 seconds'
              and date_trunc('minute', (fragment ->> 'started_at')::timestamptz) = date_trunc('minute', (g ->> 'started_at')::timestamptz)
              and fragment ->> 'phase' is not distinct from g ->> 'phase'
              and fragment ->> 'source_device_id' is not distinct from g ->> 'source_device_id') >= 3)
        -- ponytail: scan this account's intervals for exact copies; index normalized timestamps if history makes this costly.
        and not exists (
          select 1 from public.study_sessions other, jsonb_array_elements(other.segments) previous
          where other.user_id = new.user_id and other.id <> new.id and other.kind = new.kind
            and other.subject_id is not distinct from new.subject_id
            and other.completed and other.cancelled_at is null
            and (previous ->> 'started_at')::timestamptz = (g ->> 'started_at')::timestamptz
            and (previous ->> 'ended_at')::timestamptz = (g ->> 'ended_at')::timestamptz
            and previous ->> 'phase' is not distinct from g ->> 'phase'
        ))
      order by (g ->> 'started_at')::timestamptz, (g ->> 'ended_at')::timestamptz, g ->> 'phase', position
    ) kept;
  if v_segments is distinct from new.segments or jsonb_array_length(v_segments) = 0 then
    new.segments := v_segments;
    select coalesce(sum(round(extract(epoch from ((g ->> 'ended_at')::timestamptz - (g ->> 'started_at')::timestamptz)) * 1000)), 0)::bigint
      into v_ms from jsonb_array_elements(v_segments) g;
    new.accumulated_active_ms := v_ms;
    new.metadata := new.metadata || '{"auto_pruned_intervals":true}'::jsonb;
    if new.completed and jsonb_array_length(v_segments) = 0 then
      new.cancelled_at := clock_timestamp();
    elsif new.completed then
      new.started_at := (v_segments -> 0 ->> 'started_at')::timestamptz;
      select max((g ->> 'ended_at')::timestamptz) into new.completed_at from jsonb_array_elements(v_segments) g;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.prune_study_intervals() from public, anon, authenticated;

-- Run the same policy against existing history and publish every changed row.
do $$
declare
  v_row record;
  v_updated public.study_sessions%rowtype;
begin
  for v_row in select user_id, id, segments, cancelled_at from public.study_sessions
    where cancelled_at is null and (completed or started_at is not null) order by user_id, id loop
    perform public.sync_next_lamport(v_row.user_id);
    update public.study_sessions set segments = segments where user_id = v_row.user_id and id = v_row.id
      returning * into v_updated;
    if v_updated.segments is distinct from v_row.segments or v_updated.cancelled_at is distinct from v_row.cancelled_at then
      update public.study_sessions set revision = revision + 1, updated_at = clock_timestamp()
        where user_id = v_row.user_id and id = v_row.id returning * into v_updated;
      insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
        values (v_row.user_id, gen_random_uuid(), 'auto-prune', 'study_sessions', v_row.id, 'put',
          jsonb_build_object('revision', v_updated.revision), public.sync_next_lamport(v_row.user_id));
    end if;
  end loop;
end;
$$;
commit;
