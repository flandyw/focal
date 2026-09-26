begin;

-- Let the caller's SELECT grant and sync_log RLS policy govern compatibility reads.
alter view public.sync_changes set (security_invoker = true);

do $$
begin
  if not exists (
    select 1 from pg_class
     where oid = 'public.sync_changes'::regclass
       and 'security_invoker=true' = any(reloptions)
  ) or not exists (
    select 1 from pg_class
     where oid = 'public.sync_log'::regclass and relrowsecurity
  ) or not has_table_privilege('authenticated', 'public.sync_changes', 'SELECT')
    or not has_table_privilege('authenticated', 'public.sync_log', 'SELECT') then
    raise exception 'sync_changes must use the authenticated caller and sync_log RLS for reads';
  end if;
end;
$$;

commit;
