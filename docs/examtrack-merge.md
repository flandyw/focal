# Legacy ExamTrack data merge

ExamTrack (now Focal Web) lives in this repository at the repository root (`src/`), and ExamTrack, Focal desktop/native
Android and Folio use the same Supabase project and authenticated account. This document
records the completed project merge; it is not an instruction to reset or recreate production
data.

## Data and migration history

`supabase/migrations/0010_examtrack_data.sql` added the ExamTrack `attempts`, `mistakes` and
`user_state` entities plus the `mistake-attachments` bucket to Focal's project. The retained
`scripts/examtrack-merge.mjs` utility is only for deliberately moving data from a legacy
ExamTrack project into an already-created Focal account. It authenticates as the user and
preserves row timestamps and attachment ownership paths.

The shared sync architecture is now:

- `0011_canonical_study_sessions.sql`: canonical `study_sessions` and
  `study_session_segments`, with lifecycle mutations through `study_session_mutate`.
  `0018_single_table_study_sessions.sql` consolidates these into one `study_sessions`
  table with embedded intervals, preserving the same client API and calendar payload.
- `0012_examtrack_cursor_sync.sql`: cursor reads and versioned generic changes for ExamTrack
  rows; compatibility tables remain projections, not a second client-side sync protocol.
- `0013_study_session_offline_timing.sql`: server-clock estimates, monotonic elapsed deltas,
  durable `timing_at`, and offline boundary reconstruction. Legacy queued lifecycle commands
  without timing fields are treated conservatively as zero elapsed.

See [`sync-protocol.md`](./sync-protocol.md) for the current contract and validation commands.

## Current clients

- Focal Web and Focal desktop share the same Supabase client and account. Session commands
  are durably queued in account-scoped IndexedDB; ordinary rows use the cursor/change RPCs.
- Focal native Android uses `study_session_mutate` and `sync_read_changes`, with a durable
  ordered session-command queue and elapsed-realtime timer recovery.
- Folio shares Focal Auth. Its session lifecycle uses the canonical session RPC; mistake and
  attempt sync uses cursor reads and versioned `sync_apply_changes` changes.

`VITE_FOCAL_WEB_URL` is only the hosted-app drill-through URL. It does not select a database.

## Operational safety

Apply forward migrations in numeric order and inspect migration assertions before acting on
failures. Do not delete rows, drop tables, or reset a production project to make a migration
pass. If a legacy import or migration encounters existing rows, stop and reconcile the data
with a reviewed, user-scoped procedure; the assertion is protecting history from accidental
overwrite.
