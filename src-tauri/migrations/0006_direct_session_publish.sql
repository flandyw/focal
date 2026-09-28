-- Study sessions are published straight to the server state machine (study_session_mutate).
-- The triggers that turned every record write into a queued command are gone: a command
-- outbox is a holding pen that only ever grows, and the local record plus the last canonical
-- row is enough to re-derive the difference after any outage.
drop trigger if exists study_sessions_enqueue_command_after_insert;
drop trigger if exists study_sessions_enqueue_command_after_payload_update;
drop trigger if exists study_sessions_enqueue_cancel_after_delete;

-- Anything still parked from before this migration. The server state machine reconciles the
-- open sessions on the next sync pass; dropping the intents is what stops them being replayed.
delete from sync_outbox where entity = 'study_session_commands';
