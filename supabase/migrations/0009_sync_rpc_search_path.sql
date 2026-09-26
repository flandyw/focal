begin;

-- These public RPCs need definer rights to reach the private sync tables.
-- All relations and non-system functions they call are schema-qualified.
alter function public.sync_apply_changes(jsonb) set search_path = '';
alter function public.sync_read_changes(bigint, integer) set search_path = '';

commit;
