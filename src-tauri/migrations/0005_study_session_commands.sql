-- Session mutations are kept in a non-coalescing local outbox. The record write and
-- command enqueue share this SQLite transaction; generic rows keep their existing LWW queue.
alter table sync_outbox add column attempted_at text;

drop trigger if exists records_enqueue_sync_after_insert;
drop trigger if exists records_enqueue_sync_after_payload_update;

create trigger records_enqueue_sync_after_insert
after insert on records
begin
  insert into sync_cursor (account_id, cursor_seq, lamport, updated_at)
  select account_id, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') from sync_local_context
   where singleton = 1
  on conflict (account_id) do update set lamport = sync_cursor.lamport + 1;

  insert into sync_outbox (
    change_id, account_id, entity, row_id, operation, payload, created_at,
    retry_count, last_error, next_attempt_at, blocked_at, lamport
  )
  select
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2, 3) || '-' || substr('89ab', (random() & 3) + 1, 1) ||
      substr(lower(hex(randomblob(2))), 2, 3) || '-' || lower(hex(randomblob(6))),
    context.account_id, new.kind, new.id, 'put', new.payload,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, null, null, null,
    (select cursor.lamport from sync_cursor as cursor where cursor.account_id = context.account_id)
  from sync_local_context as context
  where context.singleton = 1 and new.kind <> 'study_sessions'
    and not exists (select 1 from sync_record_suppress where entity = new.kind and row_id = new.id and payload = new.payload)
  on conflict (account_id, entity, row_id) do update set
    change_id = excluded.change_id, operation = excluded.operation, payload = excluded.payload,
    created_at = excluded.created_at, lamport = excluded.lamport, retry_count = 0,
    last_error = null, next_attempt_at = null, blocked_at = null, attempted_at = null;

  delete from sync_record_suppress where entity = new.kind and row_id = new.id and payload = new.payload;
end;

create trigger records_enqueue_sync_after_payload_update
after update of payload on records
when old.payload <> new.payload
begin
  insert into sync_cursor (account_id, cursor_seq, lamport, updated_at)
  select account_id, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') from sync_local_context
   where singleton = 1
  on conflict (account_id) do update set lamport = sync_cursor.lamport + 1;

  insert into sync_outbox (
    change_id, account_id, entity, row_id, operation, payload, created_at,
    retry_count, last_error, next_attempt_at, blocked_at, lamport
  )
  select
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2, 3) || '-' || substr('89ab', (random() & 3) + 1, 1) ||
      substr(lower(hex(randomblob(2))), 2, 3) || '-' || lower(hex(randomblob(6))),
    context.account_id, new.kind, new.id, 'put', new.payload,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, null, null, null,
    (select cursor.lamport from sync_cursor as cursor where cursor.account_id = context.account_id)
  from sync_local_context as context
  where context.singleton = 1 and new.kind <> 'study_sessions'
    and not exists (select 1 from sync_record_suppress where entity = new.kind and row_id = new.id and payload = new.payload)
  on conflict (account_id, entity, row_id) do update set
    change_id = excluded.change_id, operation = excluded.operation, payload = excluded.payload,
    created_at = excluded.created_at, lamport = excluded.lamport, retry_count = 0,
    last_error = null, next_attempt_at = null, blocked_at = null, attempted_at = null;

  delete from sync_record_suppress where entity = new.kind and row_id = new.id and payload = new.payload;
end;

create trigger study_sessions_enqueue_command_after_insert
after insert on records
when new.kind = 'study_sessions'
begin
  insert into sync_cursor (account_id, cursor_seq, lamport, updated_at)
  select account_id, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') from sync_local_context
   where singleton = 1
  on conflict (account_id) do update set lamport = sync_cursor.lamport + 1;

  insert into sync_outbox (
    change_id, account_id, entity, row_id, operation, payload, created_at,
    retry_count, last_error, next_attempt_at, blocked_at, lamport
  )
  select valueset.mutation_id, c.account_id, 'study_session_commands', valueset.mutation_id, 'put',
         json_object('mutation_id', valueset.mutation_id, 'session_id', valueset.session_id,
           'expected_revision', valueset.expected_revision, 'action', valueset.action, 'device_id', '',
           'app', valueset.app, 'kind', valueset.kind, 'phase', valueset.phase, 'title', valueset.title,
           'subject_id', valueset.subject_id, 'metadata', json(valueset.metadata)),
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, null, null, null,
         (select clock.lamport from sync_cursor clock where clock.account_id = c.account_id)
    from sync_local_context c
    cross join (
      select
        lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
          substr(lower(hex(randomblob(2))), 2, 3) || '-' || substr('89ab', (random() & 3) + 1, 1) ||
          substr(lower(hex(randomblob(2))), 2, 3) || '-' || lower(hex(randomblob(6))) as mutation_id,
        case when json_extract(new.payload, '$.execution.state') = 'in-progress' then 'start' else 'create' end as action,
        new.id as session_id,
        coalesce(json_extract(new.payload, '$.revision'), 0) as expected_revision,
        case
          when json_extract(new.payload, '$.integrations.examtrack.kind') in ('exam', 'sac') then json_extract(new.payload, '$.integrations.examtrack.kind')
          when json_extract(new.payload, '$.integrations.folio.kind') = 'exam' then 'exam'
          else 'focus'
        end as kind,
        case
          when json_extract(new.payload, '$.integrations.examtrack.phase') in ('reading', 'writing') then json_extract(new.payload, '$.integrations.examtrack.phase')
          when json_extract(new.payload, '$.integrations.folio.phase') in ('reading', 'writing') then json_extract(new.payload, '$.integrations.folio.phase')
          else 'focus'
        end as phase,
        coalesce(json_extract(new.payload, '$.title'), '') as title,
        coalesce(json_extract(new.payload, '$.subjectIds[0]'), json_extract(new.payload, '$.integrations.examtrack.subject')) as subject_id,
        case when json_extract(new.payload, '$.createdVia') = 'examtrack' then 'examtrack'
             when json_extract(new.payload, '$.integrations.folio.type') = 'folio' then 'folio' else 'focal' end as app,
        json(json_remove(new.payload, '$.execution', '$.status', '$.deleted_at', '$.activeDurations', '$.activeMillis',
          '$.startedAt', '$.pausedAt', '$.completedAt', '$.updated_at', '$.revision', '$.last_modified_device_id')) as metadata
    ) valueset
   where c.singleton = 1
     and not exists (select 1 from sync_record_suppress where entity = new.kind and row_id = new.id and payload = new.payload)
  on conflict (account_id, entity, row_id) do update set
    change_id = excluded.change_id, payload = excluded.payload, created_at = excluded.created_at,
    lamport = excluded.lamport, retry_count = 0, last_error = null, next_attempt_at = null, blocked_at = null,
    attempted_at = null;

  delete from sync_record_suppress where entity = new.kind and row_id = new.id and payload = new.payload;
end;

create trigger study_sessions_enqueue_command_after_payload_update
after update of payload on records
when new.kind = 'study_sessions' and old.payload <> new.payload
begin
  insert into sync_cursor (account_id, cursor_seq, lamport, updated_at)
  select account_id, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') from sync_local_context
   where singleton = 1
  on conflict (account_id) do update set lamport = sync_cursor.lamport + 1;

  insert into sync_outbox (
    change_id, account_id, entity, row_id, operation, payload, created_at,
    retry_count, last_error, next_attempt_at, blocked_at, lamport
  )
  select valueset.mutation_id, c.account_id, 'study_session_commands',
         case when valueset.action = 'save_progress' then 'save:' || valueset.session_id else valueset.mutation_id end,
         'put',
         json_object('mutation_id', valueset.mutation_id, 'session_id', valueset.session_id,
           'expected_revision', valueset.expected_revision, 'action', valueset.action, 'device_id', '',
           'app', valueset.app, 'kind', valueset.kind, 'phase', valueset.phase, 'title', valueset.title,
           'subject_id', valueset.subject_id, 'metadata', json(valueset.metadata)),
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, null, null, null,
         (select clock.lamport from sync_cursor clock where clock.account_id = c.account_id)
    from sync_local_context c
    cross join (
      select
        lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
          substr(lower(hex(randomblob(2))), 2, 3) || '-' || substr('89ab', (random() & 3) + 1, 1) ||
          substr(lower(hex(randomblob(2))), 2, 3) || '-' || lower(hex(randomblob(6))) as mutation_id,
        case
          when json_extract(new.payload, '$.deleted_at') is not null then 'cancel'
          when json_extract(new.payload, '$.execution.state') = 'completed' and json_extract(old.payload, '$.execution.state') <> 'completed' then 'complete'
          when json_extract(new.payload, '$.execution.state') = 'in-progress'
            and json_extract(old.payload, '$.execution.state') <> 'in-progress' then 'start'
          when json_extract(new.payload, '$.execution.state') = 'in-progress'
            and coalesce(json_array_length(new.payload, '$.execution.intervals'), 0) > 0
            and json_extract(new.payload, '$.execution.intervals[' || (json_array_length(new.payload, '$.execution.intervals') - 1) || '].end') is null
            and coalesce(json_array_length(old.payload, '$.execution.intervals'), 0) > 0
            and json_extract(old.payload, '$.execution.intervals[' || (json_array_length(old.payload, '$.execution.intervals') - 1) || '].end') is not null then 'resume'
          when json_extract(new.payload, '$.execution.state') = 'in-progress'
            and coalesce(json_array_length(new.payload, '$.execution.intervals'), 0) > 0
            and json_extract(new.payload, '$.execution.intervals[' || (json_array_length(new.payload, '$.execution.intervals') - 1) || '].end') is not null
            and coalesce(json_array_length(old.payload, '$.execution.intervals'), 0) > 0
            and json_extract(old.payload, '$.execution.intervals[' || (json_array_length(old.payload, '$.execution.intervals') - 1) || '].end') is null then 'pause'
          else 'save_progress'
        end as action,
        new.id as session_id,
        coalesce(json_extract(new.payload, '$.revision'), 0) as expected_revision,
        case
          when json_extract(new.payload, '$.integrations.examtrack.kind') in ('exam', 'sac') then json_extract(new.payload, '$.integrations.examtrack.kind')
          when json_extract(new.payload, '$.integrations.folio.kind') = 'exam' then 'exam'
          else 'focus'
        end as kind,
        case
          when json_extract(new.payload, '$.integrations.examtrack.phase') in ('reading', 'writing') then json_extract(new.payload, '$.integrations.examtrack.phase')
          when json_extract(new.payload, '$.integrations.folio.phase') in ('reading', 'writing') then json_extract(new.payload, '$.integrations.folio.phase')
          else 'focus'
        end as phase,
        coalesce(json_extract(new.payload, '$.title'), '') as title,
        coalesce(json_extract(new.payload, '$.subjectIds[0]'), json_extract(new.payload, '$.integrations.examtrack.subject')) as subject_id,
        case when json_extract(new.payload, '$.createdVia') = 'examtrack' then 'examtrack'
             when json_extract(new.payload, '$.integrations.folio.type') = 'folio' then 'folio' else 'focal' end as app,
        json(json_remove(new.payload, '$.execution', '$.status', '$.deleted_at', '$.activeDurations', '$.activeMillis',
          '$.startedAt', '$.pausedAt', '$.completedAt', '$.updated_at', '$.revision', '$.last_modified_device_id')) as metadata
    ) valueset
   where c.singleton = 1
     and not exists (select 1 from sync_record_suppress where entity = new.kind and row_id = new.id and payload = new.payload)
  on conflict (account_id, entity, row_id) do update set
    change_id = excluded.change_id, operation = excluded.operation, payload = excluded.payload,
    created_at = excluded.created_at, lamport = excluded.lamport, retry_count = 0,
    last_error = null, next_attempt_at = null, blocked_at = null, attempted_at = null;

  delete from sync_record_suppress where entity = new.kind and row_id = new.id and payload = new.payload;
end;

-- Pending generic session writes cannot be replayed through sync_apply_changes anymore.
-- Convert them into save commands; pulled canonical rows rebase to the server revision.
update sync_outbox
   set entity = 'study_session_commands', row_id = change_id,
       payload = json_object(
         'mutation_id', change_id, 'session_id', row_id,
         'expected_revision', coalesce(json_extract(payload, '$.revision'), 0),
         'action', case when operation = 'delete' then 'cancel' else 'save_progress' end,
         'device_id', '', 'app', 'focal', 'kind', 'focus', 'phase', 'focus',
         'title', coalesce(json_extract(payload, '$.title'), ''),
         'subject_id', json_extract(payload, '$.subjectIds[0]'),
         'metadata', json(json_remove(coalesce(payload, '{}'), '$.execution', '$.status', '$.deleted_at'))
       ),
       operation = 'put',
       attempted_at = null
 where entity = 'study_sessions';

create index if not exists sync_outbox_ordered_idx on sync_outbox (account_id, lamport, created_at);

create trigger study_sessions_enqueue_cancel_after_delete
after delete on records
when old.kind = 'study_sessions'
begin
  insert into sync_cursor (account_id, cursor_seq, lamport, updated_at)
  select account_id, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') from sync_local_context
   where singleton = 1
  on conflict (account_id) do update set lamport = sync_cursor.lamport + 1;

  insert into sync_outbox (
    change_id, account_id, entity, row_id, operation, payload, created_at,
    retry_count, last_error, next_attempt_at, blocked_at, lamport
  )
  select valueset.mutation_id, context.account_id, 'study_session_commands', valueset.mutation_id, 'put',
         json_object('mutation_id', valueset.mutation_id, 'session_id', valueset.session_id,
           'expected_revision', valueset.expected_revision, 'action', 'cancel', 'device_id', '',
           'app', valueset.app, 'kind', valueset.kind, 'phase', valueset.phase, 'title', valueset.title,
           'subject_id', valueset.subject_id, 'metadata', json(valueset.metadata)),
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, null, null, null,
         (select clock.lamport from sync_cursor clock where clock.account_id = context.account_id)
    from sync_local_context context
    cross join (
      select
        lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
          substr(lower(hex(randomblob(2))), 2, 3) || '-' || substr('89ab', (random() & 3) + 1, 1) ||
          substr(lower(hex(randomblob(2))), 2, 3) || '-' || lower(hex(randomblob(6))) as mutation_id,
        old.id as session_id,
        coalesce(json_extract(old.payload, '$.revision'), 0) as expected_revision,
        case
          when json_extract(old.payload, '$.integrations.examtrack.kind') in ('exam', 'sac') then json_extract(old.payload, '$.integrations.examtrack.kind')
          when json_extract(old.payload, '$.integrations.folio.kind') = 'exam' then 'exam'
          else 'focus'
        end as kind,
        case
          when json_extract(old.payload, '$.integrations.examtrack.phase') in ('reading', 'writing') then json_extract(old.payload, '$.integrations.examtrack.phase')
          when json_extract(old.payload, '$.integrations.folio.phase') in ('reading', 'writing') then json_extract(old.payload, '$.integrations.folio.phase')
          else 'focus'
        end as phase,
        coalesce(json_extract(old.payload, '$.title'), '') as title,
        coalesce(json_extract(old.payload, '$.subjectIds[0]'), json_extract(old.payload, '$.integrations.examtrack.subject')) as subject_id,
        case when json_extract(old.payload, '$.createdVia') = 'examtrack' then 'examtrack'
             when json_extract(old.payload, '$.integrations.folio.type') = 'folio' then 'folio' else 'focal' end as app,
        json(json_remove(old.payload, '$.execution', '$.status', '$.deleted_at', '$.activeDurations', '$.activeMillis',
          '$.startedAt', '$.pausedAt', '$.completedAt', '$.updated_at', '$.revision', '$.last_modified_device_id')) as metadata
    ) valueset
   where context.singleton = 1
  on conflict (account_id, entity, row_id) do update set
    change_id = excluded.change_id, operation = excluded.operation, payload = excluded.payload,
    created_at = excluded.created_at, lamport = excluded.lamport, retry_count = 0,
    last_error = null, next_attempt_at = null, blocked_at = null, attempted_at = null;
end;
