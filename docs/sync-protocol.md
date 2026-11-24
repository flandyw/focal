# Shared sync protocol

Focal Desktop, Focal Web, and Folio all share one Supabase Auth project and one user-scoped change feed. Realtime only nudges clients to wake up; the feed cursor is the real source of truth for changes. Study-session lifecycles run on their own transactional protocol over canonical session rows.

## Study sessions

`study_sessions` is the single shared table for study sessions. Each row holds its time blocks in a `segments` JSON array, plus a `completed` flag and `metadata`. Both desktop and web write through `study_session_mutate` and read via `sync_read_changes`, so every calendar renders the same session IDs and intervals. There's no separate interval table or app-specific cloud session store.

Migration `0018_single_table_study_sessions.sql` copies all existing intervals into their session rows, checks the copied count, and drops `study_session_segments` and the old mutation wrappers in one transaction. The client DTO stays the same. Retry receipts and the generic sync feed are transport plumbing, not a second copy of your sessions.

Clients compute live elapsed time as:

```text
accumulated_active_ms + max(0, estimated_server_now - segment_started_at)
```

The shared web and desktop frontend uses the DTO and validator in `src/lib/sync/sessionContract.ts`. Folio uses the same JSON field names and calls `study_session_mutate`; it must never write `study_sessions` through `sync_apply_changes` or the `sync_changes` compatibility view.

Every command carries a UUID `mutation_id`, UUID `device_id`, and `expected_revision`. Lifecycle commands can also send `occurred_at` (estimated from a server-clock anchor) and `elapsed_since_previous_ms` (measured on a monotonic clock). If wall-clock time isn't anchored, the server rebuilds boundaries from elapsed deltas and shifts the replayed timeline as needed. It never trusts device wall clocks or reconnect receipt times. Untimed legacy commands fall back to server receipt time; an explicit zero elapsed time conservatively adds only the positive-interval floor. `timing_at` stores the previous boundary durably.

The server reads the owner from `auth.uid()`, serialises mutations per user, locks the session row, updates segments and revision in one transaction, logs a feed event, and saves the exact response in `study_session_mutation_receipts`. Newer clients also pin requests to their local outbox/cursor owner via `expected_user_id`, so the RPC rejects a request if the signed-in account changed between queueing and sending (legacy callers may omit it). Replaying the same request returns the saved receipt; reusing a `mutation_id` with a different payload is rejected.

There's only one kind of session. A row stores its `segments` and a `completed` flag, and everything else is derived from those:

- **completed**: the study happened. `log` creates a completed session, and `save_progress` with `completed` toggles it. Completed blocks must already be in the past.
- **running**: derived from an open interval (`segment_started_at` is set). `start`, `pause`, `resume`, `phase_change`, and `complete` drive the live timer.
- **paused**: derived when `paused_at` is set on an unfinished session.
- **continued**: `resume` also accepts a completed, timed focus session (migration `0027`). It reopens the session as paused at `completed_at` and resumes it in one transaction so the new interval joins the earlier ones (`save_progress` with `completed: false` isn't a continue; it turns the session back into scheduled study and drops the worked time). Focal remembers the session's previous blocks on the device that hit Continue, so discarding runs `complete` followed by `save_progress` with those blocks instead of `cancel`. Running and paused sessions still accept `save_progress` for title, subject, and metadata.
- **scheduled**: derived when not completed and never timed. `create` builds one from `blocks`, and `start` replaces the planned slot with the actual run.
- **deleted**: `cancelled_at` is set. `cancel` deletes any session (done or not); the row stays as a tombstone so other devices pick up the deletion, and any later commands receive `session_terminal`.

Any session that isn't running or paused can be edited: `save_progress` accepts `blocks` (replacing the session's blocks, up to 100, each at most 24 hours, non-overlapping) and `completed`. A session with no blocks can't be marked completed. Normal concurrency races return structured outcomes like `stale_revision`, `session_terminal`, `invalid_transition`, and `already_running`.

**Switching subjects** stays inside one session, one subject at a time, with no new table or session kind. `metadata.subjectSwitches` stores `[{ at, subjectId }]` in order: each subject runs from `at` until the next switch, and `subject_id` is always the latest one. Helpers `studySessionSwitches` / `studySessionSubjectSpans` (in Folio: `focalSubjectSwitches` / `focalSubjectSpans`) slice blocks at each switch. If the list's final subject doesn't match `subject_id`, a client that only edits `subject_id` overruled it and the list is ignored. A switch within one minute of the previous one replaces it as a quick correction. Timers record switches when you change subjects mid-session, the editor stores per-block subjects as switches, and Progress credits each subject with its own time. Server-side rules (short-fragment merging, duplicate pruning, manual merge, friend stats) still key on `subject_id` alone.

Migration `0017` added `log` for past study: an `expected_revision: 0` command with 1–100 explicit `blocks` (`start`/`end` timestamps), a title, and a subject. The server checks for positive, non-overlapping, already-finished blocks (up to 24 hours each), then atomically creates a completed session, its segments, receipt, and feed wakeup. Because those dates are student-entered history rather than timer clock estimates, the seven-day timer replay window doesn't apply. Migration `0020` replaced the old `state` column with `completed`, moved planned slots from `metadata.schedule` into `segments`, and made every non-running session editable and deletable. Desktop saves locally and publishes through normal sync; signed-in web saves via the RPC, while signed-out web sessions stay in that browser and aren't auto-uploaded on sign-in.

## Durable feed

`sync_log.seq` is the feed cursor. `sync_read_changes(after, limit)` returns ordered rows after that cursor, falling back to a full snapshot only when `after` is negative or older than the retained feed floor. A valid cursor isn't invalidated just because older rows exist.

Study-session feed rows carry the full canonical session DTO (including segments), while ordinary entities keep their own merge rules. Focal Web attempts and mistakes use stable `row_id` keys, and settings use one `user_state` row per key. Web writes include `expected_seq`, so the server either commits against the version the client read or returns the canonical row for a field-aware rebase. SAC records and ATAR estimates rebase per record ID. Mistake rebases keep non-overlapping question edits and union review-history entries by ID. Generic writes use `sync_apply_changes` receipts for idempotency. Realtime messages don't carry trusted state; they just trigger a cursor pull. Clients also pull on reconnect, returning to the foreground, and a low-frequency safety poll.

## Local durability

Account restoration listens to Auth session events; a network-only user check must never wipe a restored session when you're offline. The account UI separates `restoring`, `reconnecting`, and `sign-in-required` from sync delivery status. A failed login keeps the current account's local owner and queued work until you explicitly sign out or sign into another account. Normal sign-out only signs out this device; it never revokes Folio or other devices.

Both app and session RPCs verify the active session against the outbox owner before sending. On a 401, the client runs one SDK-coordinated token refresh and retries once. Auth failures pause the queued write without counting a retry attempt; reconnects, foreground returns, token refreshes, and safety polls resume it. The server's `expected_user_id` check remains the final safeguard if an account switches mid-flight.

Desktop and web share one IndexedDB outbox (`src/lib/outbox.ts`) with two write-ahead lanes: every change hits IndexedDB before the network is touched, and stays there until the server responds. One flusher per account runs across tabs using Web Locks. Network or server errors keep the entry and back off; an expired session holds it without burning an attempt; a plain 400/409/413/422 is treated as a refusal. Flushes kick off on enqueue, startup, reconnect, focus, visibility change, token refresh, realtime wakeup, peer-tab signals, and a timer.

- **Session commands** (`study-session-sync.ts`, store `session-outbox`). Every timer action, plan, log, edit, and delete is a command with a single minted `mutation_id`. Once a command may have reached the server, it's frozen so retries are byte-identical and replay the server's receipt. Commands for one session run one at a time, oldest first, with each queued step expecting the latest known revision plus the steps ahead of it. Unsent `save_progress` commands for the same session fold together. Timing (`occurred_at`, `elapsed_since_previous_ms`) is recorded the moment the student acts, not when it's sent. On a stale answer, lifecycle commands retry against the server's row under a fresh `mutation_id` with timing dropped (up to five times) so the server can check if the transition still applies. A stale edit of values (`blocks`, `completed`) never overwrites another device's change; it's dropped and reported. A lifecycle command refused only as `timing_invalid` (for example after a sleeping laptop pauses the monotonic clock) retries under a new `mutation_id` first without `occurred_at`, then without any timing, so a pause or finish is never lost to clock drift. Other refusals are reported and dropped. Server rows for a session with unanswered local commands are held back from live timers until that session's queue drains, then the newest row takes over. Meanwhile, the calendar shows queued plans, logs, edits, and deletions right away.
- **App rows** (`app-sync.ts`, stores `outbox`/`rows`). Same write-ahead rules, using `expected_seq` compare-and-set and field-aware rebasing. Receipts save the row at its new `seq` in the same transaction that clears the outbox entry. If the server refuses a batch, it retries one change at a time so one bad row can't block the rest; any refused change is parked for five minutes and retried rather than dropped (refusals usually mean a migration hasn't been applied yet).

Known ceiling: React state saves to `localStorage` and diffs into the outbox inside an effect, so a crash in the few milliseconds between an edit and that effect can lose that edit.

Focal Web timer metadata (year, provider, paper, marks, reading/writing limits, workspace items, and SAC details) lives inside canonical session metadata. Live timer state and its old updated-at markers are no longer written to `user_state`. The one-time backfill in migration `0011` moves legacy active timers and intervals into canonical storage before clearing the old embedded keys, and migration `0018` folds intervals into the session row without changing session IDs or client APIs.

Migration `0012_examtrack_cursor_sync.sql` backfills existing attempts, mistakes, and settings into the feed while keeping `attempts`, `mistakes`, and `user_state` as compatibility projections. Folio reads shared mistakes and Focal Web attempts via account-scoped cursor reads, and queues mistake edits through versioned `sync_apply_changes` calls with durable expected sequences. Scheduling edits keep remote question content intact, and review history unions by stable ID. Folio's own notebook practice attempts stay local. Custom subjects share the same cursor RPC, and the web client no longer reads or writes whole tables.

The portable command sequence in `src/lib/sync/vectors/session-command-sequence.json` gives a reference start, pause, and resume sequence under one stable device ID.

## Security and migrations

Always apply Supabase migrations in order. Migration `0011_canonical_study_sessions.sql` keeps user records intact, backfills the latest materialised study-session row, imports embedded Focal Web timers only when no canonical session with that ID exists yet, and drops the old LWW study-session rows. Migration `0013_study_session_offline_timing.sql` adds monotonic/server-anchored offline timing while preserving the same command RPC and receipt protocol. Migration `0018` replaces the wrapper stack with one mutation implementation and one session table. RLS blocks direct writes to sessions; signed-in clients go through the canonical mutation and cursor-read RPCs.

Migration `0021` lets the versioned (`expected_seq`) branch of `sync_apply_changes` accept `events` and `timetable_config` (before that, those writes raised `22023` and never reached the log).

Both `sync_apply_changes` and the `sync_changes` view reject `study_sessions` writes so an older generic LWW client can't create a second copy of a session.

## Short study fragments

Migration `0022` merges completed focus fragments under two minutes for the same subject when they're separated by five minutes or less. It runs on completion/logging and cleans up existing history too. Original intervals keep their exact active time and breaks; overlaps, unknown subjects, exams, and work on another subject in between stay separate. Groups cap at 100 blocks or the command metadata size limit.

The receiving session keeps its ID, absorbed rows become revisioned tombstones, and both enter the regular cursor feed. Original metadata stays in `metadata.auto_merge_sources`, and mutation receipts return the merged timeline idempotently. Folio adopts that timeline (including the earlier start) from both receipts and feed updates. Offline sessions merge once uploaded; signed-out guest logs aren't part of this shared policy.

Migration `0023` strips closed intervals shorter than one second and exact duplicate intervals (inside one session or across completed focus sessions of the same subject). It runs on focus completion or edits and repairs older completed history, turning empty sessions into tombstones and syncing the cleanup to both apps. Matching checks exact timestamps rather than minute labels, so genuine short intervals in the same minute stay intact.

Focal never rebases stale timed commands onto a different timeline. Folio freezes its entire pending command batch in durable preferences before each RPC (including mutation IDs, timing, and revisions) so timeouts or restarts replay the exact same receipt instead of duplicating intervals. Newer local actions reconcile once the frozen batch is acknowledged.

Migration `0024` extends cleanup to running and paused exam/SAC sessions (including existing ones), keeping open intervals and lifecycle timestamps intact so resuming still works. It also trims bursts of three or more closed intervals under 30 seconds starting in the same minute, phase, and device, a targeted heuristic for chatter that rounds to `0m` while leaving isolated short intervals alone. Unfinished focus sessions keep their interval positions for Folio's positional replay and get cleaned up on completion. Folio checkpoints can't undo an acknowledged remote pause, and exam mutation receipts replace pruned local intervals as soon as the journal settles.

## Checks

The seven existing test files (`bun run test`) must stay green, and don't add new tests (see `AGENTS.md`). Verify changes with:

- `bun run check`: typecheck (`vp check --no-fmt --no-lint`) and lint (`vp lint`) across the root app.
- `bun run test`: the seven existing test files.
- `bun run typecheck`: the shared TypeScript contract and Focal client.
- `bun run build`: browser production build.
- `bun run build:desktop`: desktop frontend build.
