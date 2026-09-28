-- Pre-flight for 0016_drop_examtrack_user_state.sql. Run this FIRST, against the real
-- database. Every check must come back clean, or something outside this repository still
-- reads the table and the drop will break it.
--
-- There is no local Postgres in the dev loop, so this has not been executed. Run it in the
-- Supabase SQL editor.

-- 1. The claim: public.user_state is a pure mirror of user_state rows in sync_state.
--    If these two disagree, the table holds something the log does not and you must not drop it.
select
  (select count(*) from public.user_state) as user_state_rows,
  (select count(*) from public.sync_state where entity = 'user_state') as log_backed_rows,
  (select count(*) from public.user_state u
     where not exists (
       select 1 from public.sync_state s
        where s.user_id = u.user_id and s.entity = 'user_state')) as rows_with_no_log_counterpart;

-- 2. The triggers that must exist for the drop to be safe. Expect 2 rows, and nothing else
--    may be attached to public.user_state.
select tgname, pg_get_triggerdef(t.oid) as definition
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
 where c.relname = 'user_state' and not t.tgisinternal;

-- 3. Nothing outside this repo reads it. Fires if any client or edge function still has a
--    live prepared statement against the table. Expect no rows.
select * from pg_stat_activity
 where query ilike '%from%user_state%' and pid <> pg_backend_pid();

-- 4. No policy or grant should survive the drop, but confirm they are the only dependents.
--    If this returns anything other than the user_state policies, the table is load-bearing.
select policyname, cmd from pg_policies where tablename = 'user_state' order by policyname;

-- 5. attempts/mistakes must be UNTOUCHED by 0016. If these are non-zero, stop: something
--    reads them (ExamTrackView does, by design) and 0016 must not have dropped them.
select 'attempts' as t, count(*) from public.attempts
union all select 'mistakes', count(*) from public.mistakes;


--------------------------------------------------------------------------------
-- Post-flight: run immediately after `supabase db push`.
--------------------------------------------------------------------------------

-- A. The table is gone and the surviving projection still works.
select to_regclass('public.user_state') as should_be_null,
       to_regclass('public.attempts') as should_not_be_null,
       to_regclass('public.mistakes') as should_not_be_null;

-- B. The trigger no longer fires for user_state rows. Expect 0 rows from this insert.
--    Run as a real authenticated user, then roll back.
begin;
  select set_config('request.jwt.claim.sub', '<a-real-user-uuid>', true);
  -- If the old trigger were still attached, the next statement would raise
  -- "relation user_state does not exist". Succeeding is the assertion.
  update public.sync_state set updated_at = now()
   where user_id = '<a-real-user-uuid>'::uuid and entity = 'user_state';
rollback;

-- C. attempts/mistakes projection still works end to end. Insert a sync_state row for a
--    throwaway attempt id and confirm it lands in public.attempts, then roll back.
begin;
  insert into public.sync_state (user_id, entity, row_id, operation, payload, lamport, client_id, seq)
  values ('<a-real-user-uuid>'::uuid, 'attempts',
          '00000000-0000-4000-8000-0000000000ff', 'put',
          '{"subject":"Projection smoke test"}'::jsonb, 999999, 'smoke-test', 999999);
  select count(*) as should_be_1 from public.attempts
   where id = '00000000-0000-4000-8000-0000000000ff'::uuid;
rollback;
