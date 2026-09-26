# Sync protocol v3

Canonical spec for Focal ↔ ExamTrack ↔ Folio sync. This file is the contract; the SQL
migrations and both client implementations are implementations of it. Anything that
disagrees with this document is a bug in the implementation.

- Focal project: `supabase/migrations/0007_change_log.sql`
- ExamTrack project: `supabase/migrations/20260926020000_change_log.sql`
- Focal client: `src/lib/sync/`
- Folio client: `app/src/main/java/com/folio/notes/sync/`
- Conformance vectors: `src/lib/sync/vectors/conformance.json` (copied to
  `folio/app/src/test/resources/conformance.json`; both runners assert the same
  SHA-256 so the copies cannot drift)

## Model

Every change is an immutable operation:

| field | meaning |
| --- | --- |
| `seq` | server-assigned, globally monotonic. **The only ordering authority.** |
| `user_id` | owner. Always `auth.uid()`; clients cannot set it. |
| `change_id` | client-generated UUID. The idempotency key. |
| `client_id` | stable per-install device id. Tiebreak, never an ordering key. |
| `entity`, `row_id` | what changed. `row_id` is stable for the life of the row. |
| `operation` | `put` or `delete`. A delete may carry a JSON object of integration metadata. |
| `payload` | `put` only: the new value. |
| `lamport` | client logical clock, monotonic per client. |

`sync_state` materializes the current value of every `(user_id, entity, row_id)`,
including tombstones. `sync_floors` records the sequence below which log rows have been
compacted away.

## Rules

1. **A local write is the event.** It commits locally and enqueues in the same
   transaction, then wakes the flusher. Nothing in the UI ever waits for the network.
2. **Push is idempotent.** `sync_apply_changes` returns one receipt per change with its
   assigned `seq`. A change leaves the outbox only on receipt. Replays are free.
3. **Pull is a cursor.** `sync_read_changes(after)` returns `mode: "changes"` with rows
   ordered by `seq`, or `mode: "snapshot"` with the whole materialized state. A client
   whose cursor is below `sync_floors` gets the snapshot. There is no other way to read
   changes and no timestamp comparison anywhere.
4. **Realtime is a wakeup, never a payload.** A `postgres_changes` INSERT on `sync_log`
   means "there is work". The client responds by pulling from its cursor. A dropped,
   duplicated or reordered message costs at most one poll interval and never data.
5. **Echo suppression is by identity.** A change whose `client_id` is this install is
   not applied locally — the local write already happened. Never compare payloads to
   decide whether a change is "already applied".
6. **Last writer wins by `(lamport, client_id)`.** The comparison is total, so two
   devices that never see each other converge. Wall clocks are never used for ordering.
7. **Tombstones are permanent.** A delete updates `sync_state` and is never removed, so
   a stale device cannot resurrect a deleted row, and compaction cannot hide a delete.
8. **Conflicts on the same row are surfaced, not guessed.** When a remote change lands on
   a row this device has pending, the change is parked in the inbox and the user is
   shown both versions. Where a merge is provably safe (see below) no prompt appears.
9. **One in-flight push and one in-flight pull per account**, each promise-cached. A
   second request joins the running one and re-runs if work arrived meanwhile.
10. **Bounded queues.** The outbox holds at most one change per `(account, entity, row_id)`,
    so a burst of edits coalesces instead of growing without limit.

## Where the pieces live

| Concern | File | Note |
| --- | --- | --- |
| Rules: ordering, tombstones, echo suppression, coalescing, backoff | `src/lib/sync/reduce.ts` | pure, and the only part tested twice |
| Publish and read | `src/lib/sync/transport.ts` | the only file that knows the RPC names |
| Remote change → local state | `src/lib/sync/applier.ts` | the only place a local record is written |
| Durable queue, cursor, clock, applied versions | `src/lib/sync/persistence.ts` | one serialized writer, so ordering is a property of the code |
| Outbound mirrors (Notion) | `src/lib/sync/sinks.ts` | fed from local writes and applied changes |
| Session lifecycle, one push loop, one pull loop, status | `src/lib/sync/engine.ts` | |
| Study-session duplicate repair | `src/lib/sync/sessions.ts` | |
| Local schema | `src-tauri/migrations/0004_change_log.sql` | |
| Server schema | `supabase/migrations/0007_change_log.sql` | |

## Entities

One log serves every app, so both projects allow the same entity set and each client applies
only what it understands. Rows for entities an app does not store sit in its applied-state
table and cost it nothing.

| entity | policy | why |
| --- | --- | --- |
| `projects`, `events`, `custom_subjects`, `hidden_subjects`, `timetable_config`, `user_settings` | row LWW, inbox-parked collision | one editor per field in practice; a genuine two-device edit deserves a prompt |
| `study_sessions` | row LWW, inbox-parked collision, merge on the client | checkpoints arrive from several clients; the client merges by fingerprint and keeps the more detailed execution |
| `mistakes`, `attempts` | row LWW on the server, scheduling-only payloads from Folio | review state is computed, not typed: losing a review is worse than losing a field, so the payload is merged field-wise and the projection is server-authoritative |
| `user_state` | row LWW | single-writer web preference blob |
| `folio_notebooks` | row LWW on metadata, per-key LWW on `order` | a whole-list overwrite loses other devices' folders |
| `folio_pages` | row LWW on page settings and the block manifest | small, and concurrent edits are rare and worth a prompt |
| `folio_strokes` | **one row per stroke, merged by union** | ink is never last-writer-wins. A stroke is immutable once committed; deleting one is a tombstone on that stroke only. Two devices can write the same page at the same time and both sets of strokes survive. |

### Ink

A stroke is committed on pointer-up, or after 2s idle mid-stroke. Its payload is immutable:
`{pageId, tool, colour, width, points, order, createdAt}`. `order` is a fractional index so two
devices can insert between the same neighbours without a rewrite. The renderer sorts by
`(order, strokeId)`.

Consequences the rest of the system depends on:

- Losing a stroke is not representable. There is no code path that replaces a page's stroke set.
- Sync cost is one small row per stroke, not one page snapshot per edit.
- `folio_strokes` is the largest table in the log. A device offline long enough to fall behind
  the floor takes a snapshot, which is the whole stroke set — the only bulk path, and it is a
  bulk path by design.

### Blobs

Images, imported PDFs and page text snapshots are content-addressed: `sha256(bytes)` names a
block, stored at `<user_id>/<hash[:2]>/<hash>` in the `folio-pages` bucket. The page payload
carries only the manifest of hashes and sizes, so the log stays small and a pull is cheap. Blocks
are immutable and deduplicate across notebooks and devices; an upload is a no-op when the object
already exists, and a download is verified by hash before use. A block present but in no
manifest is garbage and may be deleted after 30 days.

## Latency

| path | budget |
| --- | --- |
| edit → durable local write | < 16 ms, never touches the network |
| edit → other device visible | ~150–400 ms typical (push on commit, pull on the realtime ping) |
| edit → other device visible, worst case | one adaptive poll interval: 1 s foreground, 15 s idle, 60 s background |

Poll cadence: 1 s while the window is visible and changed in the last 30 s, 15 s while
visible, 60 s while hidden. A pull also runs on `visibilitychange`, `online`, window
focus, after every successful push, and on demand.

## Failure behaviour

| failure | behaviour |
| --- | --- |
| push fails, transient | exponential backoff 5 s → 300 s, coalesced, retried on the next tick |
| push fails, permanent (RLS, bad payload, 4xx) | blocked after 8 attempts, surfaced with the error and a "retry"/"discard" action |
| process killed mid-push | the change is still in the outbox; resend is idempotent |
| realtime dropped | the adaptive poll covers it; no data loss |
| cursor below floor | snapshot, then tail from the new head |
| clock skew | irrelevant: ordering is `seq` then `(lamport, client_id)` |
| 401 | re-authenticate, outbox untouched |
| account switch | cursor, lamport clock and outbox are namespaced by account; the visible list starts empty |

## Observability

The status surface reports `pending`, `blocked`, `cursorLagMs`, `lastPushMs`,
`lastPullMs`, `snapshotCount` and `pushAttempts`. These are the numbers that decide
whether the sync is healthy; a spinner is not.

## Conformance

`src/lib/sync/vectors/conformance.json` is executed by both clients:

- Focal: `bun scripts/check-sync-conformance.ts` (wired into `bun run test:logic`)
- Folio: `SyncConformanceTests`, reading the copy at `app/src/test/resources/conformance.json`
  (wired into `./gradlew :app:testDebugUnitTest`)

Cases are `reduce` (fold a log batch), `snapshot` (replace from the materialized state),
`coalesce` (collapse a burst) and `backoff` (retry timing). Each is a complete input and a
complete expected output, so a client fails the build if it diverges on any rule — including
the subtle one, that a snapshot must not overwrite a row that still has a queued local edit.

Both runners verify the vector file's SHA-256 with the digest field itself zeroed, and both
repositories hold a copy with the same recorded digest, so an edit to one copy fails the other
build rather than passing unnoticed.

## Applying it

The Focal project: `supabase/migrations/0007_change_log.sql`. It carries the v2 log across,
turns `sync_changes` into a view with an `INSTEAD OF INSERT` trigger, and asserts at the end
that the tables, triggers, grants, publication and view are all in place.

The ExamTrack project: `supabase/migrations/20260926020000_change_log.sql` in the `examtrack`
repository. Same core, plus the triggers that feed web-table writes into the log and project
log winners back, so ExamTrack's web app needs no changes.

Clients that predate v3 keep working: they insert into `sync_changes`, which the trigger folds
into the log with a server-assigned lamport, and they read the same columns they always did.
The one thing they lose is realtime, because Realtime replicates tables and not views, so
ExamTrack's two subscriptions listen to `sync_log` directly.
