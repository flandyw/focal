-- Drop the user_state projection table. Nothing reads it.
--
-- public.user_state was a convenience mirror of the user_state rows in sync_state, written
-- by sync_project_examtrack_row. Every client reads those rows through sync_read_changes, and
-- every realtime subscription in every client is on sync_log, not on this table. The only
-- writer is scripts/examtrack-merge.mjs, which is a one-off import for the merged-away
-- ExamTrack project and is updated in the same commit to stop using it.
--
-- This is the user_state half only. public.attempts and public.mistakes are still read
-- directly by src/lib/examtrack.ts (ExamTrackView), so they and their ingest triggers stay
-- until that view is ported to the ordered feed.
begin;

-- 1. Stop projecting into it. The trigger's WHEN clause is narrowed so a user_state log row
--    no longer wakes a projection that has nothing left to write.
create or replace function public.sync_project_examtrack_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_projection text := coalesce(current_setting('focal.sync_projection', true), 'off');
begin
  if new.entity = 'attempts' or new.entity = 'mistakes' then
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
  end if;
  return new;
end;
$$;

drop trigger if exists sync_project_examtrack_row_after_change on public.sync_state;
create trigger sync_project_examtrack_row_after_change
after insert or update on public.sync_state
for each row when (new.entity in ('attempts', 'mistakes'))
execute function public.sync_project_examtrack_row();

-- 2. Drop the two triggers that lived on the table itself. Order matters: the table cannot be
--    dropped while a trigger is attached to it.
drop trigger if exists sync_examtrack_timer_state_before_write on public.user_state;
drop trigger if exists sync_examtrack_user_state_to_log on public.user_state;

-- 3. strip_examtrack_timer_state existed only to serve the before-write trigger above.
drop function if exists public.strip_examtrack_timer_state();

-- 4. Now the table. Its policies and grants go with it.
drop table if exists public.user_state;

commit;
