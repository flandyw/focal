-- Two receipt tables were left to grow without bound.
--
-- sync_change_receipts is the idempotency authority for sync_apply_changes: 0006 shipped a
-- pruner for it, and 0007 dropped that function when it replaced the old sync_changes table
-- without replacing the pruner. Since then every published change has added a row, forever.
--
-- study_session_mutation_receipts has never had a pruner at all: one row per timer command.
--
-- Both are safe to prune on age. A receipt only matters while a client might still be holding
-- the change it acknowledges, and a client that has not been answered in 90 days is not
-- carrying unsent work -- it is carrying a change the log already recorded. The generic receipt
-- pruner additionally keeps any receipt whose log row still exists, so the log stays the
-- authoritative replay record and the receipt is only dropped once the log has compacted past
-- it. Cadence and 256-row window match compact_sync_log so neither can starve the other.
begin;

create or replace function public.prune_sync_receipts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Same opportunistic gate as compact_sync_log: one pass per 256 global inserts.
  if mod(new.seq, 256) <> 0 then
    return new;
  end if;

  delete from public.sync_change_receipts receipt
   where receipt.accepted_at < now() - interval '180 days'
     and not exists (
       select 1 from public.sync_log l
        where l.user_id = receipt.user_id and l.change_id = receipt.change_id
     );

  delete from public.study_session_mutation_receipts receipt
   where receipt.accepted_at < now() - interval '90 days';

  return new;
end;
$$;

drop trigger if exists prune_sync_receipts_after_insert on public.sync_log;
create trigger prune_sync_receipts_after_insert
after insert on public.sync_log
for each row execute function public.prune_sync_receipts();

revoke all on function public.prune_sync_receipts() from public, anon, authenticated;

commit;
