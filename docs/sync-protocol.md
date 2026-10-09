# Shared sync protocol

Focal desktop, Focal Web, and Folio use the same Supabase Auth project and the same
user-scoped change feed. Realtime is a wakeup; the feed cursor is the durable source of
changes. Session lifecycle is a separate transactional protocol over canonical session rows.

## Study sessions

`study_sessions` is the single shared session table. Each row contains its time
blocks in the `segments` JSON array, a `completed` flag, and `metadata`.
Desktop and web both write that row through `study_session_mutate` and read it through
`sync_read_changes`; their respective calendars render the same session IDs and intervals.
There is no separate interval table or app-specific cloud session store.

Migration `0018_single_table_study_sessions.sql` copies all existing intervals into their
session rows, verifies the copied count, and drops `study_session_segments` and the old
mutation wrappers in one transaction. The client DTO stays unchanged. Retry receipts and
the generic sync feed remain transport infrastructure, not alternative session records.

Clients render elapsed time as:

```text
accumulated_active_ms + max(0, estimated_server_now - segment_started_at)
```

The shared DTO and validator live in `src/lib/sync/sessionContract.ts`. Root Focal and
Focal Web import this exact module. Folio uses the same JSON field names and calls
`study_session_mutate`; it must not write `study_sessions` through `sync_apply_changes` or
the `sync_changes` compatibility view.

Commands carry a UUID `mutation_id`, UUID `device_id`, and `expected_revision`. Lifecycle
commands may include `occurred_at`, estimated from a server-clock anchor, and
`elapsed_since_previous_ms`, measured with a monotonic clock. When wall-clock time is not
anchored, the server reconstructs boundaries from elapsed deltas and shifts the replayed
timeline as needed; it never trusts device wall time or reconnect receipt time. Missing timing
fields on untimed legacy commands use server receipt time; explicitly supplied zero elapsed
time conservatively adds only the positive-interval floor. The `timing_at`
column is the durable previous boundary.

The server derives the owner from `auth.uid()`, serializes mutations per user, locks the
session row, changes segments and revision in one transaction, writes a feed event, and stores
the exact result in `study_session_mutation_receipts`. New clients pin requests to their
local outbox/cursor owner with `expected_user_id`; the RPC rejects a request if the active Auth
identity changed between queue selection and network submission. Legacy calls may omit it.
Replaying an identical request returns
that stored result. A reused mutation ID with a different request is rejected.

There is one kind of session. A row has times (`segments`) and a `completed` flag, and nothing
else about its life is stored:

- **completed**: the study happened. `log` creates a completed session; `save_progress` with
  `completed` toggles it. Completed blocks must already have finished.
- **running**: derived, an open interval (`segment_started_at` is set). `start`, `pause`, `resume`,
  `phase_change` and `complete` drive the live timer.
- **paused**: derived, `paused_at` is set on an unfinished session.
- **scheduled**: derived, not completed and never timed. `create` makes one from `blocks`;
  `start` replaces its slot with the real run.
- **deleted**: `cancelled_at` is set. `cancel` deletes any session, done or not; the row is kept
  as a tombstone so every device learns of the removal, and later commands get `session_terminal`.

Any session that is not running or paused can be edited: `save_progress` accepts `blocks` (they
replace the session's blocks, up to 100, at most 24 hours each, not overlapping) and `completed`.
A session with no blocks cannot be completed. Expected concurrency is returned as structured
results such as `stale_revision`, `session_terminal`, `invalid_transition`, `already_running`.

Migration `0017` added `log` for past study: an expected-revision-zero command with 1–100 explicit
`blocks` (`start`/`end` timestamps), a title and a subject. The server validates positive,
non-overlapping, already-finished blocks (at most 24 hours each), then atomically creates a
completed session, its segments, receipt and feed wakeup. Dates are user-entered historical
evidence, not timer clock estimates, so the seven-day timer replay window does not apply.
Migration `0020` replaced the old `state` column with `completed`, moved planned sessions' slots
from `metadata.schedule` into `segments`, and made every non-running session editable and deletable.
Desktop saves locally and publishes through normal sync. Signed-in web saves through the RPC;
signed-out web sessions stay in that browser and are not uploaded automatically on sign-in.

## Durable feed

`sync_log.seq` is the feed cursor. `sync_read_changes(after, limit)` returns ordered rows
after that cursor. It returns a snapshot only when `after` is negative or below the retained
feed floor. A current cursor is not invalidated merely because older rows exist.

Study-session feed rows carry the current canonical session DTO, including its segments;
ordinary entities keep their own merge behavior. Focal Web attempts and mistakes are stable
`row_id` records; settings use one `user_state` row per setting key. Web changes include
`expected_seq`, so the server either commits against the version the client read or returns
the canonical row for a field-aware rebase. Mistake rebases preserve non-overlapping question
content and union review-history entries by ID. Generic changes use `sync_apply_changes`
receipts for idempotency. Realtime messages contain no state that clients need to trust:
they wake a cursor pull. Clients also pull on reconnect, foreground return, and a low-rate
safety poll.

## Local durability

Desktop and web share one IndexedDB implementation (`src/lib/outbox.ts` plus the two lanes below).
Both lanes are write-ahead: a change is committed to IndexedDB before the network is touched, and
leaves only when the server has answered it. One flusher per account runs across tabs (Web Locks);
a network or server failure keeps the change and backs off, an expired session holds it without
counting an attempt, and a plain 400/409/413/422 is a refusal. Flushes start on enqueue, startup,
reconnect, focus, visibility, token refresh, a realtime wakeup, a peer tab, and a timer.

- **Session commands** (`study-session-sync.ts`, store `session-outbox`). Every timer move, plan, log,
  edit and delete is a command with a `mutation_id` minted once. A command that may have reached the
  server is frozen, so a retry is byte-identical and the server replays its receipt. A session's
  commands go one at a time, oldest first, and a queued chain expects the newest known revision plus
  the commands ahead of it. Unsent `save_progress` commands for one session fold into one.
  Timing (`occurred_at`, `elapsed_since_previous_ms`) is captured when the user acts, not when sent.
  A stale answer retries a lifecycle command against the server's row under a new `mutation_id` with
  timing dropped (up to five times), and the server judges whether the transition still holds. A
  stale edit of values (`blocks`, `completed`) is never laid over another device's change: it is
  dropped and reported. Other refusals are reported and dropped. Server rows for a session with
  unanswered local commands are held back from the timers until the queue for it drains, then the
  newest row is adopted. The calendar list shows queued plan, log, edit and delete commands
  immediately.
- **App rows** (`app-sync.ts`, stores `outbox`/`rows`). Same rules, with `expected_seq`
  compare-and-set and the field-aware rebase described below. A receipt records the row at its new
  seq in the same transaction that removes the entry. A batch the server refuses is re-sent one
  change at a time so one bad row cannot hold up the rest; the refused change is parked for five
  minutes and retried, never dropped (a refusal is usually a migration that is not applied yet).

Known ceiling: React state is saved to localStorage and diffed into the outbox by an effect, so a
crash in the few milliseconds between an edit and that effect loses the edit.

Focal Web timer metadata (year, provider, paper, marks, reading/writing limits, workspace
items, and SAC details) remains in canonical session metadata. Live timer state and its old
updated-at markers are no longer written into the `user_state` payload. The one-time
backfill in migration `0011` moves legacy active timers and their known intervals into the
canonical storage before removing the embedded timer keys. Migration `0018` then folds the
intervals into the session row without changing any session IDs or client APIs.

Migration `0012_examtrack_cursor_sync.sql` backfills existing attempts, mistakes and setting
keys into the feed, then keeps `attempts`, `mistakes` and `user_state` as compatibility
projections. Folio reads shared mistake and Focal Web attempt rows through account-scoped
cursor reads; queued mistake edits use versioned `sync_apply_changes` writes with durable
expected sequences. Scheduling edits preserve remote question content and review history is
unioned by stable ID. Folio's notebook practice attempts remain local. Custom subjects use
the same cursor RPC. The web client no longer reads or writes whole tables.

The portable command sequence in `src/lib/sync/vectors/session-command-sequence.json` is
run by Focal Web's TypeScript test and copied into Folio's Android test resources. Both clients
exercise the same start, pause and resume revisions with one stable device ID.

## Security and migrations

Apply Supabase migrations in order. Migration `0011_canonical_study_sessions.sql` retains
user records, backfills the latest materialized study-session row, imports embedded Focal Web
timers only when no canonical session with that ID already exists, and removes the old
study-session LWW materialized rows. Migration `0013_study_session_offline_timing.sql` adds
monotonic/server-anchored offline timing while retaining the same command RPC and receipt
protocol. Migration `0018` replaces the wrapper stack with one mutation implementation and
one session table. Session RLS denies direct writes; authenticated users use the canonical mutation
and cursor-read RPCs.

Migration `0021` lets the versioned (`expected_seq`) branch of `sync_apply_changes` accept
`events` and `timetable_config`; before it, those writes raised 22023 and never reached the log.

`sync_apply_changes` rejects `study_sessions`; the `sync_changes` view also rejects writes
for that entity. This prevents an old generic LWW client from creating a second session
representation.

## Checks

This repo has no test suite (see `AGENTS.md`). Verify changes with:

- `bun run check` — typecheck (`tsc --noEmit`) + lint (`oxlint`) for the root app.
- `bun run typecheck` — the shared TypeScript contract and Focal client only.
- `cd web && bun run lint && bun run build` — Focal Web production compilation.
- `bunx --no-install vite build` — desktop bundle (needs `bun run check` first).
