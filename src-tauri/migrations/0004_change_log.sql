-- Local half of sync protocol v3.
--
--   * `sync_outbox.lamport` — the logical clock a change is published with, so two
--     devices that never see each other still order their edits deterministically.
--   * `sync_cursor` — per account: the read cursor, and the clock that hands out
--     lamports. It is bumped in the same SQLite statement that enqueues, so a crash
--     cannot hand out the same lamport twice.
--   * `sync_applied` — the last remote version of each row this device has applied,
--     which is what makes a stale or duplicate change a no-op instead of a rewrite.
--
-- `client_id` is deliberately absent from the outbox: the change's client is whoever
-- pushes it, so the device id is attached at flush time and never stored per row.

alter table sync_outbox add column lamport integer not null default 0;

-- The log speaks `seq` and `client_id`; the v2 tables called them `revision` and
-- `device_id`. Renaming rather than adding keeps one vocabulary across the codebase.
alter table sync_inbox rename column revision to seq;
alter table sync_inbox rename column device_id to client_id;

create index if not exists sync_outbox_lamport_idx on sync_outbox (account_id, lamport);

create table if not exists sync_cursor (
  account_id text primary key,
  cursor_seq integer not null default 0,
  lamport integer not null default 0,
  updated_at text not null default ''
);

create table if not exists sync_applied (
  account_id text not null,
  entity text not null,
  row_id text not null,
  operation text not null check (operation in ('put', 'delete')),
  payload text check (payload is null or json_valid(payload)),
  lamport integer not null default 0,
  client_id text not null default '',
  seq integer not null default 0,
  updated_at text not null default '',
  primary key (account_id, entity, row_id)
);

-- The record triggers are rebuilt rather than extended: SQLite cannot add a statement to
-- an existing trigger body, and the clock has to advance before the enqueue reads it.
drop trigger if exists records_enqueue_sync_after_insert;
drop trigger if exists records_enqueue_sync_after_payload_update;

-- Keep the enqueue and the local write in one durable statement, exactly as v2 did. Only
-- the clock read and its persistence are new; the change id, the coalescing upsert and
-- the echo suppression are unchanged, because those behaviours are load-bearing.
create trigger records_enqueue_sync_after_insert
after insert on records
begin
  insert into sync_cursor (account_id, cursor_seq, lamport, updated_at)
  select account_id, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') from sync_local_context
   where singleton = 1 and account_id <> ''
  on conflict (account_id) do update set lamport = sync_cursor.lamport + 1;

  insert into sync_outbox (
    change_id, account_id, entity, row_id, operation, payload, created_at,
    retry_count, last_error, next_attempt_at, blocked_at, lamport
  )
  select
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
      lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' ||
      lower(hex(randomblob(6))),
    context.account_id,
    new.kind,
    new.id,
    'put',
    new.payload,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    0,
    null,
    null,
    null,
    (select cursor.lamport from sync_cursor as cursor where cursor.account_id = context.account_id)
  from sync_local_context as context
  where context.singleton = 1
    and context.account_id <> ''
    and not exists (
      select 1 from sync_record_suppress
       where entity = new.kind and row_id = new.id and payload = new.payload
    )
  on conflict (account_id, entity, row_id) do update set
    change_id = excluded.change_id,
    operation = excluded.operation,
    payload = excluded.payload,
    created_at = excluded.created_at,
    lamport = excluded.lamport,
    retry_count = 0,
    last_error = null,
    next_attempt_at = null,
    blocked_at = null;

  delete from sync_record_suppress
   where entity = new.kind and row_id = new.id and payload = new.payload;
end;

create trigger records_enqueue_sync_after_payload_update
after update of payload on records
when old.payload <> new.payload
begin
  insert into sync_cursor (account_id, cursor_seq, lamport, updated_at)
  select account_id, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') from sync_local_context
   where singleton = 1 and account_id <> ''
  on conflict (account_id) do update set lamport = sync_cursor.lamport + 1;

  insert into sync_outbox (
    change_id, account_id, entity, row_id, operation, payload, created_at,
    retry_count, last_error, next_attempt_at, blocked_at, lamport
  )
  select
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
      lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' ||
      lower(hex(randomblob(6))),
    context.account_id,
    new.kind,
    new.id,
    'put',
    new.payload,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    0,
    null,
    null,
    null,
    (select cursor.lamport from sync_cursor as cursor where cursor.account_id = context.account_id)
  from sync_local_context as context
  where context.singleton = 1
    and context.account_id <> ''
    and not exists (
      select 1 from sync_record_suppress
       where entity = new.kind and row_id = new.id and payload = new.payload
    )
  on conflict (account_id, entity, row_id) do update set
    change_id = excluded.change_id,
    operation = excluded.operation,
    payload = excluded.payload,
    created_at = excluded.created_at,
    lamport = excluded.lamport,
    retry_count = 0,
    last_error = null,
    next_attempt_at = null,
    blocked_at = null;

  delete from sync_record_suppress
   where entity = new.kind and row_id = new.id and payload = new.payload;
end;
