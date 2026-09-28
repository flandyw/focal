# Shared sync protocol

Focal desktop, ExamTrack web, and Folio use the same Supabase Auth project and the same
user-scoped change feed. Realtime is a wakeup; the feed cursor is the durable source of
changes. Session lifecycle is a separate transactional protocol over canonical session rows.

## Study sessions

`study_sessions` is the only canonical live-session record. `study_session_segments` stores
each server-timed active interval. Clients render elapsed time as:

```text
accumulated_active_ms + max(0, estimated_server_now - segment_started_at)
```

The shared DTO and validator live in `src/lib/sync/sessionContract.ts`. Root Focal and
ExamTrack web import this exact module. Folio uses the same JSON field names and calls
`study_session_mutate`; it must not write `study_sessions` through `sync_apply_changes` or
the `sync_changes` compatibility view.

Commands carry a UUID `mutation_id`, UUID `device_id`, and `expected_revision`. The server
derives the owner from `auth.uid()`, serializes mutations per user, locks the session row,
uses server time, changes segments and revision in one transaction, writes a feed event,
and stores the exact result in `study_session_mutation_receipts`. Replaying an identical
request returns that stored result. A reused mutation ID with a different request is rejected.

States are `planned`, `running`, `paused`, `completed`, and `cancelled`; terminal rows are
retained. Supported actions are `create`, `start`, `pause`, `resume`, `phase_change`,
`save_progress`, `complete`, and `cancel`. Expected concurrency is returned as structured
results such as `stale_revision`, `session_terminal`, and `invalid_transition`.

## Durable feed

`sync_log.seq` is the feed cursor. `sync_read_changes(after, limit)` returns ordered rows
after that cursor. It returns a snapshot only when `after` is negative or below the retained
feed floor. A current cursor is not invalidated merely because older rows exist.

Study-session feed rows carry the current canonical session DTO, including its segments;
ordinary entities keep their own merge behavior. ExamTrack attempts and mistakes are stable
`row_id` records; settings use one `user_state` row per setting key. Web changes include
`expected_seq`, so the server either commits against the version the client read or returns
the canonical row for a field-aware rebase. Mistake rebases preserve non-overlapping question
content and union review-history entries by ID. Generic changes use `sync_apply_changes`
receipts for idempotency. Realtime messages contain no state that clients need to trust:
they wake a cursor pull. Clients also pull on reconnect, foreground return, and a low-rate
safety poll.

## Local durability

Focal desktop stores local records and ordered session commands in SQLite. SQLite triggers
write the command in the same transaction as a local study-session record change. ExamTrack
web stores session commands and ordinary app changes in account-scoped IndexedDB before
publishing. Lifecycle commands stay ordered; unsent `save_progress` commands may coalesce by
session. Ordinary writes coalesce only within the same stable entity and row. Replayed RPC
requests keep the same UUID until a receipt arrives; stale expected sequences are rebased
from the returned canonical row.

ExamTrack timer metadata (year, provider, paper, marks, reading/writing limits, workspace
items, and SAC details) remains in canonical session metadata. Live timer state and its old
updated-at markers are no longer written into the `user_state` payload. The one-time
backfill in migration `0011` moves legacy active timers and their known intervals into the
canonical session tables before removing the embedded timer keys.

Migration `0012_examtrack_cursor_sync.sql` backfills existing attempts, mistakes and setting
keys into the feed, then keeps `attempts`, `mistakes` and `user_state` as compatibility
projections. Folio's current mistake compare-and-set writes are forwarded into the feed by
database triggers. Folio stores its mistake/context cursor in its account-scoped cache and
rebuilds those projections from incremental pulls; custom subjects use the same cursor RPC.
Only locally edited mistake IDs are queried before Folio's existing compare-and-set writes.
Those writes still use the compatibility tables rather than versioned `sync_apply_changes`
receipts, so a lost response may repeat an identical projection update. The web client no
longer reads or writes whole tables.

The portable command sequence in `src/lib/sync/vectors/session-command-sequence.json` is
run by ExamTrack's TypeScript test and copied into Folio's Android test resources. Both clients
exercise the same start, pause and resume revisions with one stable device ID.

## Security and migrations

Apply Supabase migrations in order. Migration `0011_canonical_study_sessions.sql` is a
forward migration: it retains user records, deterministically backfills the latest
materialized study-session row, imports embedded ExamTrack timers only when no canonical
session with that ID already exists, and then removes the old study-session LWW materialized
rows. It enables owner-scoped RLS, denies direct session writes, and grants authenticated
users only the command/read RPCs required by clients.

`sync_apply_changes` rejects `study_sessions`; the `sync_changes` view also rejects writes
for that entity. This prevents an old generic LWW client from creating a second session
representation.

## Checks

- `bun run test:logic` runs the root protocol and migration checks.
- `bun run typecheck` checks the shared TypeScript contract and Focal client.
- `cd web && bun test && bun run build` checks ExamTrack behavior and production compilation.
- `supabase/tests/study_session_commands.test.sql` exercises command replay, stale races,
  terminal protection, cursor reads, snapshots, server timing, and RLS with a local Supabase
  database (`supabase test db`).
- `supabase/tests/examtrack_cursor_sync.test.sql` exercises revision receipts, stale writes,
  compatibility projection, Folio mistake preservation, and removal of legacy timer fields.
