# Legacy ExamTrack data merge

The old ExamTrack frontend is now Focal's shared frontend at the repository root (`src/`). Focal web, Focal desktop, and Folio all share one Supabase project and one account. This note just documents how the merge happened; it isn't a guide to resetting or rebuilding production data.

## Data and migration history

`supabase/migrations/0010_examtrack_data.sql` brought ExamTrack's `attempts`, `mistakes`, and `user_state` entities (plus the `mistake-attachments` bucket) into Focal's project. The `scripts/examtrack-merge.mjs` script is still around strictly for intentionally moving data from an old ExamTrack project into an existing Focal account; it signs in as the student and keeps row timestamps and attachment ownership paths intact.

Here's how the shared sync layers fit together now:

- `0011_canonical_study_sessions.sql`: introduced canonical `study_sessions` and `study_session_segments` with lifecycle writes through `study_session_mutate`. `0018_single_table_study_sessions.sql` folded those into one `study_sessions` table with embedded intervals while keeping the client API and calendar payload unchanged.
- `0012_examtrack_cursor_sync.sql`: added cursor reads and versioned generic changes for ExamTrack rows; compatibility tables stay projections rather than a second sync protocol.
- `0013_study_session_offline_timing.sql`: added server-clock estimates, monotonic elapsed deltas, durable `timing_at`, and offline boundary reconstruction. Older queued lifecycle commands without timing fields are handled conservatively as zero elapsed time.

See [`sync-protocol.md`](./sync-protocol.md) for the current contract and check commands.

## How clients connect today

- Focal Web and Focal Desktop share the same Supabase client and account. Study-session commands queue durably in account-scoped IndexedDB, while regular records use the cursor/change RPCs.
- Folio shares Focal Auth. Its session lifecycle calls the canonical session RPC, and its mistake and attempt sync uses cursor reads and versioned `sync_apply_changes` calls.

`VITE_FOCAL_WEB_URL` is only the link to open the hosted web app; it doesn't choose a database.

## Keeping data safe

Always apply forward migrations in numeric order and read any migration assertions carefully if one fails. Never delete rows, drop tables, or reset a production database just to get a migration through. If a legacy import or migration runs into existing rows, pause and reconcile them with a reviewed, user-scoped plan. Those assertions are there to protect student history from being overwritten.
