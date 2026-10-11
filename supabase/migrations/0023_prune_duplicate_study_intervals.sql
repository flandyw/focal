-- Timer retries must not leave synthetic 1ms intervals or repeat the same work.
begin;

create function public.prune_study_intervals()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_segments jsonb;
  v_ms bigint;
begin
  if new.kind <> 'focus' or not new.completed or new.cancelled_at is not null then return new; end if;
  -- Use exact timestamps, not the UI's minute labels. Real short study remains study.
  select coalesce(jsonb_agg(segment order by (segment ->> 'started_at')::timestamptz), '[]'::jsonb)
    into v_segments from (
      select distinct on ((g ->> 'started_at')::timestamptz, (g ->> 'ended_at')::timestamptz, g ->> 'phase') g as segment
      from jsonb_array_elements(new.segments) with ordinality as blocks(g, position)
      where g ->> 'ended_at' is not null
        and (g ->> 'ended_at')::timestamptz - (g ->> 'started_at')::timestamptz >= interval '1 second'
        -- ponytail: scan this account's intervals for exact copies; index normalized timestamps if history makes this costly.
        and not exists (
          select 1 from public.study_sessions other, jsonb_array_elements(other.segments) previous
          where other.user_id = new.user_id and other.id <> new.id and other.kind = 'focus'
            and other.subject_id is not distinct from new.subject_id
            and other.completed and other.cancelled_at is null
            and (previous ->> 'started_at')::timestamptz = (g ->> 'started_at')::timestamptz
            and (previous ->> 'ended_at')::timestamptz = (g ->> 'ended_at')::timestamptz
            and previous ->> 'phase' is not distinct from g ->> 'phase'
        )
      order by (g ->> 'started_at')::timestamptz, (g ->> 'ended_at')::timestamptz, g ->> 'phase', position
    ) kept;
  if v_segments is distinct from new.segments or jsonb_array_length(v_segments) = 0 then
    new.segments := v_segments;
    select coalesce(sum(round(extract(epoch from ((g ->> 'ended_at')::timestamptz - (g ->> 'started_at')::timestamptz)) * 1000)), 0)::bigint
      into v_ms from jsonb_array_elements(v_segments) g;
    new.accumulated_active_ms := v_ms;
    new.metadata := new.metadata || '{"auto_pruned_intervals":true}'::jsonb;
    if jsonb_array_length(v_segments) = 0 then
      new.cancelled_at := clock_timestamp();
    else
      new.started_at := (v_segments -> 0 ->> 'started_at')::timestamptz;
      select max((g ->> 'ended_at')::timestamptz) into new.completed_at from jsonb_array_elements(v_segments) g;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.prune_study_intervals() from public, anon, authenticated;
create trigger prune_study_intervals_before_write before insert or update on public.study_sessions
  for each row execute function public.prune_study_intervals();

-- Run the same policy against existing history and publish every changed row.
do $$
declare
  v_row record;
  v_updated public.study_sessions%rowtype;
begin
  for v_row in select user_id, id, segments, cancelled_at from public.study_sessions
    where kind = 'focus' and completed and cancelled_at is null order by user_id, id loop
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
