-- Canonical commands are still derived by the existing RPC worker, not queued DTOs.
-- Keep the committed record (including deleted timer history) until it is acknowledged.
create table session_outbox (
  account_id text not null,
  session_id text not null,
  intent_id text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  operation text not null check (operation in ('put', 'delete')),
  payload text not null check (json_valid(payload)),
  primary key (account_id, session_id)
);

-- Conversion receipt survives both a process crash and a later deletion of the session.
create table event_conversions (
  account_id text not null,
  event_id text not null,
  session_id text not null,
  payload text not null check (json_valid(payload)),
  primary key (account_id, event_id)
);
