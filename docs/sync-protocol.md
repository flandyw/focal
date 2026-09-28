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

Commands carry a UUID `mutation_id`, UUID `device_id`, and `expected_revision`. Lifecycle
commands may include `occurred_at`, estimated from a server-clock anchor, and
`elapsed_since_previous_ms`, measured with a monotonic clock. When wall-clock time is not
anchored, the server reconstructs boundaries from elapsed deltas and shifts the replayed
timeline as needed; it never trusts device wall time or reconnect receipt time. Missing timing
fields on legacy queued commands conservatively mean zero elapsed time. The `timing_at`
column is the durable previous boundary.

The server derives the owner from `auth.uid()`, serializes mutations per user, locks the
session row, changes segments and revision in one transaction, writes a feed event, and stores
the exact result in `study_session_mutation_receipts`. New clients pin requests to their
local outbox/cursor owner with `expected_user_id`; the RPC rejects a request if the active Auth
identity changed between queue selection and network submission. Legacy calls may omit it.
Replaying an identical request returns
that stored result. A reused mutation ID with a different request is rejected.

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

Focal desktop stores local records and ordered session commands in SQLite. Native Android
uses the same mutation/cursor APIs and a durable non-coalescing session-command queue. The
server does not impose a single-active-session constraint; clients may have concurrent
canonical sessions. Android timers persist elapsed-realtime deadlines and boot counts; a
reboot cuts continuity instead of inventing study time. ExamTrack web stores session commands and ordinary app changes in
account-scoped IndexedDB before publishing. Lifecycle commands stay ordered; unsent
`save_progress` commands may coalesce by session. Ordinary writes coalesce only within the
same stable entity and row. Replayed RPC requests keep the same UUID until a receipt arrives;
stale revisions/sequences are rebased only when the requested transition remains valid.

ExamTrack timer metadata (year, provider, paper, marks, reading/writing limits, workspace
items, and SAC details) remains in canonical session metadata. Live timer state and its old
updated-at markers are no longer written into the `user_state` payload. The one-time
backfill in migration `0011` moves legacy active timers and their known intervals into the
canonical session tables before removing the embedded timer keys.

Migration `0012_examtrack_cursor_sync.sql` backfills existing attempts, mistakes and setting
keys into the feed, then keeps `attempts`, `mistakes` and `user_state` as compatibility
projections. Folio reads shared mistake and ExamTrack attempt rows through account-scoped
cursor reads; queued mistake edits use versioned `sync_apply_changes` writes with durable
expected sequences. Scheduling edits preserve remote question content and review history is
unioned by stable ID. Folio's notebook practice attempts remain local. Custom subjects use
the same cursor RPC. The web client no longer reads or writes whole tables.

The portable command sequence in `src/lib/sync/vectors/session-command-sequence.json` is
run by ExamTrack's TypeScript test and copied into Folio's Android test resources. Both clients
exercise the same start, pause and resume revisions with one stable device ID.

## Security and migrations

Apply Supabase migrations in order. Migration `0011_canonical_study_sessions.sql` retains
user records, backfills the latest materialized study-session row, imports embedded ExamTrack
timers only when no canonical session with that ID already exists, and removes the old
study-session LWW materialized rows. Migration `0013_study_session_offline_timing.sql` adds
monotonic/server-anchored offline timing while retaining the same command RPC and receipt
protocol. Session RLS denies direct writes; authenticated users use the canonical mutation
and cursor-read RPCs.

`sync_apply_changes` rejects `study_sessions`; the `sync_changes` view also rejects writes
for that entity. This prevents an old generic LWW client from creating a second session
representation.

## Checks

- `bun run test:logic` runs the root protocol and migration checks.
- `bun run typecheck` checks the shared TypeScript contract and Focal client.
- `cd web && bun test && bun run build` checks ExamTrack behavior and production compilation.
- `bun run check:study-sessions` and `bun run test:logic` check session migrations,
  protocol behavior and shared conformance vectors; `bun run typecheck` checks the shared
  TypeScript contract.
- `supabase/tests/study_session_commands.test.sql` and
  `supabase/tests/study_session_offline_timing.test.sql` exercise lifecycle, replay,
  offline timing, terminal protection, cursor reads and RLS against local Supabase
  (`supabase test db`). `supabase/tests/examtrack_cursor_sync.test.sql` covers revision
  receipts, stale writes, compatibility projections and legacy timer cleanup.
- `cd web && bun test && bun run build`; `cd ../folio && ./gradlew :app:testDebugUnitTest`.
