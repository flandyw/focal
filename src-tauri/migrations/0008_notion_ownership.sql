-- Record commits, not feature handlers, own mirror intent. Canonical sessions keep
-- their page metadata under integrations.notion. Metadata receipts must not echo.
drop trigger records_enqueue_notion_after_insert;
drop trigger records_enqueue_notion_after_payload_update;

create trigger records_enqueue_notion_after_insert
 after insert on records
 when new.kind in ('events', 'study_sessions')
  and coalesce(json_extract(new.payload, '$.source.type'), '') <> 'vcaa'
  and coalesce(json_extract((select value from preferences where key = 'focal-notion-data-source-id'), '$'), '') <> ''
begin
 insert into notion_outbox (data_source_id, kind, local_id, operation, page_id, created_at, retry_count)
 values (
  json_extract((select value from preferences where key = 'focal-notion-data-source-id'), '$'),
  case new.kind when 'events' then 'event' else 'session' end,
  new.id, 'upsert',
  case new.kind when 'events' then json_extract(new.payload, '$.source.id') else json_extract(new.payload, '$.integrations.notion.id') end,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0
 ) on conflict (data_source_id, kind, local_id) do update set
  operation = 'upsert', page_id = excluded.page_id, created_at = excluded.created_at,
  not_before = null, retry_count = 0, last_error = null, next_attempt_at = null;
end;

create trigger records_enqueue_notion_after_payload_update
 after update of payload on records
 when new.kind in ('events', 'study_sessions')
  and coalesce(json_extract(new.payload, '$.source.type'), '') <> 'vcaa'
  and coalesce(json_extract((select value from preferences where key = 'focal-notion-data-source-id'), '$'), '') <> ''
  -- ponytail: key-order changes can cause one redundant comparison pass, never a
  -- mirror loop. Use json_tree comparison here if imported ordering makes it material.
  and json_remove(old.payload, '$.updated_at', '$.revision', '$.last_modified_device_id', '$.source', '$.integrations.notion')
   <> json_remove(new.payload, '$.updated_at', '$.revision', '$.last_modified_device_id', '$.source', '$.integrations.notion')
begin
 insert into notion_outbox (data_source_id, kind, local_id, operation, page_id, created_at, retry_count)
 values (
  json_extract((select value from preferences where key = 'focal-notion-data-source-id'), '$'),
  case new.kind when 'events' then 'event' else 'session' end,
  new.id, 'upsert',
  case new.kind when 'events' then json_extract(new.payload, '$.source.id') else json_extract(new.payload, '$.integrations.notion.id') end,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0
 ) on conflict (data_source_id, kind, local_id) do update set
  operation = 'upsert', page_id = excluded.page_id, created_at = excluded.created_at,
  not_before = null, retry_count = 0, last_error = null, next_attempt_at = null;
end;
