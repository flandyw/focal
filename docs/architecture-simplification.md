# Focal: deletion-first architecture simplification

Status: partially implemented: shared calendar context menu, planning record row writes,
and atomic event conversion. Stages 3–5 remain proposed; project writes and remote/import
compatibility APIs still retain array operations.
Scope: desktop first; preserve the web/Android protocol and all user data.

## Goal

Reduce the number of representations, write paths, and places a feature must change.
Moving 2,000 lines from `App.tsx` into ten hooks is not simplification. Each stage must
remove production code or remove a demonstrated source of correctness bugs. No new
framework, store library, generic repository, command bus, or plugin system.

## What the code currently pays for

- `App.tsx` is approximately 2,650 lines. It builds session inputs, coordinates persistence,
  separately triggers Notion, handles undo, and owns many independent dialog states.
- `CalendarGrid.tsx` had four copies of the event context menu; `DayDetail.tsx` had a fifth.
  These now share `CalendarItemMenu.tsx`, including conversion. Both entry points call the
  same `handleConvertEventToSession` callback in `App.tsx`.
- `useEvents` and `useStudySessions` save arrays and then call `recordLocalUpsert`.
  `database.ts` already stores rows, but its public API still speaks whole JSON files.
  Full-array replacements retain snapshot/concurrency concerns that row storage should eliminate.
- A study session has `schedule`, `execution`, `reflection`, and `integrations`, plus
  deprecated aliases for times, status, active durations, notes, completion, and source.
  `studySessions.ts` installs enumerable getters and a custom `toJSON` to reconcile them.
  The meaning of `activeDurations` changes between planned and completed sessions.
- Local writes already feed Notion through `sync/sinks.ts`, while `App.tsx` also invokes
  `pushSessionChange`, `pushEventChange`, and `requestNotionSync` throughout its handlers.
  Integration transport leaks into feature/UI code.
- Event conversion needs a draft, a saving guard, and a session-ID retry map because creation
  and event deletion are separate operations. That map is not durable across app restarts.

## Target: three responsibilities, not three new frameworks

```text
View / form
  -> existing entity mutation functions
       -> SQLite record + durable outgoing intent, committed together
            -> existing cloud sync and Notion workers
```

Views own selection, navigation, form drafts, and presentation. Entity functions own
validation and mutations. Workers own authentication, transport, receipts, retries,
conflicts, and integration metadata. React state is a projection of committed records,
not another authority. Remote application must not enqueue its own cloud changes again.

Keep events and study sessions distinct: a scheduled appointment is not a timer lifecycle.
Keep the shared `sessionContract.ts`, authenticated RPC, revision checks, server clock,
actual intervals, account isolation, and receipt semantics. Do not unify the two cloud
protocols just to make the client look smaller.

## Stage 1 — remove duplicated presentation (implemented for context menus)

One explicit `CalendarItemMenu`, with edit, optional conversion, completion, and delete
callbacks. Month/week layouts and day-detail cards keep their existing rendering and
selection semantics. Session menus never offer event conversion. No action registry.

Next: consolidate repeated event/session draft-to-input mapping only when both callers
actually have the same semantics. Do not force the different forms into a configurable
mega-form. Verify keyboard context menus and pointer menus in month/week/day views.

## Stage 2 — make local writes one operation (highest leverage)

Change the existing storage API to row-level operations by record kind and ID. Introduce
only the concrete operations needed by existing hooks: put/update/delete and an atomic
multi-record mutation for merge/conversion. Keep ordering as a row field where required.

A local mutation commits records and durable outgoing intent in one SQLite transaction;
then emits one invalidation/wakeup. Audit existing triggers first: do not enqueue twice.
Session publication retains its canonical RPC semantics and must recover from durable
local state, including cancellation, without depending on an in-memory callback.

Migrate one entity at a time, then delete:

- Whole-array replacement from normal add/update/delete paths.
- UI-snapshot reconstruction and paired `save*` / `recordLocal*` calls in those paths.
- Duplicate notification/wakeup logic in individual mutations.
- JSON-filename addressing from runtime record APIs. Keep JSON names only for import/export.

Conversion becomes one transaction: create session, remove event, record outgoing intents.
Cloud delivery may still be eventual; local atomicity does not imply a distributed
transaction. Stable IDs and idempotent reconciliation must survive a crash/restart.
Only after this exists, delete `convertedSessionsRef` and the conversion-specific retry
branch in `App.tsx`. Never replace them with unsafe delete-first behavior.

Checks: rollback at each local write failure; concurrent remote/local edits; app restart
between commit and delivery; signed-out writes; account switch; conversion retry.

### Stage 2 rollout record — events

Initial event-only checkpoint (before the session/conversion increment below):

- `useEvents` no longer saves/reconstructs whole arrays or pairs saves with
  `recordLocalUpsert` / `recordLocalSoftDelete`. All its mutation paths, including
  integration writes, deduplication, auto-finish, restore, and merge, use row operations.
- `commands/events.rs` pins event mutations to one native SQLite transaction. Existing
  record triggers enqueue puts and Notion upserts; deletes enqueue their cloud intent
  in the transaction, which also triggers linked-page archival. No new triggers/schema.
- Updates patch the committed row instead of a UI snapshot. Conditional integration and
  auto-finish updates reject changed records. Existing row positions survive edits.
- One post-commit invalidation/wakeup replaces per-mutation notifications. Failed
  transactions neither invalidate React state nor start cloud delivery.
- Production physical LOC delta for this increment: **−24**, including native command
  code and registration, excluding its `#[cfg(test)]` module, docs, and the pre-existing
  shared-menu changes. Removed all `saveEvents`, `mutateEvents`, and `recordLocal*`
  call sites from `useEvents`; legacy whole-array APIs remain for other entities/imports.

Checks passed: `bun run check`, all 34 `bun run test:logic` checks, and
`cargo test --manifest-path src-tauri/Cargo.toml row_writes_and_intents_rollback_together --lib`.
The native check covers signed-out intents, Notion-trigger failure rollback, multi-row
rollback, successful deletion, null/absent metadata comparison, and stale conditional
updates. Restart/delivery and account-switch interaction checks remain unverified.

At this checkpoint, session publication and conversion still used their old paths.
The session/conversion increment below supersedes those boundaries. UI-owned Notion pushes
and planning-dialog state are intentionally unchanged. Manual keyboard/focus/screen-reader
verification is still required.

### Stage 2 rollout record — sessions and conversion

- `useStudySessions` no longer writes whole arrays or pairs saves with `recordLocal*`.
  Updates read committed rows and apply the existing session normalization/patch boundary.
  Native compare-and-swap rejects intervening edits rather than overwriting timer evidence.
  Merge, merge undo, duplicate repair, and session-backup replacement are transactional.
- Local migration 7 adds a per-account session outbox, containing committed records and
  deletion tombstones, plus durable event-conversion receipts. The canonical RPC worker
  still derives commands from session records; the web/Android protocol is unchanged.
  Offline deletion history survives database close/reopen, including unreceived intervals.
- Conversion commits session creation, event deletion, cloud/Notion intents, and its receipt
  together. A retry after restart returns the original session identity. Restoring the event
  explicitly allows a fresh conversion. Removed `convertedSessionsRef` and the paired
  add/update/delete retry branch from `App.tsx`; failure still retains the form draft.
- Receipts clear only the matching account/session/intent generation, preserving edits
  made during delivery. Signed-out first-account intents are adopted with the existing
  ownership policy. Mutations captured for a signed-in account reject a changed database
  account; publication checks account identity before each RPC and excludes foreign rows.
- Pull/reduction protects pending session intents. Failed histories remain durable and do
  not starve unrelated sessions. Polling now retries publication as well as pulling changes.
  Invalid RPC transitions do not acknowledge their intent; incompatible terminal histories
  remain pending rather than being silently erased.
- Runtime planning reads and locks address record kinds/IDs. One post-commit invalidation
  covers both entities in conversion. Removed unused `writeLocalDataArray` and replaced
  filename-based sync reads with record-kind reads.
- Fixed Notion acknowledgement comparison to ignore JSON key ordering and optional
  top-level null metadata, but retain intents for genuinely newer records/nested changes.

Production physical LOC delta for this increment: **+361**; cumulative Stage 2: **+337**
against the shared-menu checkpoint (`342d1a3`). Includes native transaction/validation code,
local migration, shared storage/persistence changes, and backup boundary; excludes docs,
tests, lockfile, and both native `#[cfg(test)]` modules. This increment is a correctness
investment, not a claimed LOC reduction: it removes the demonstrated split-conversion,
in-memory-deletion-history, stale-row-update, and acknowledgement-ordering failure modes.
The final 25% reduction target has **not** been met.

Checks passed: `bun run check`, all 34 `bun run test:logic` checks, and all 12
`cargo test --manifest-path src-tauri/Cargo.toml --lib` tests. Native checks inject failures
at record/outbox/receipt writes, close/reopen the database before retry/delivery, verify
stable conversion identity, preserve deleted timer intervals, and reject account/stale
snapshot changes. Logic checks replay a serialized offline discard through cancellation,
verify generation/account-scoped acknowledgement, and exercise Notion structural comparison.
Full app restart/auth-switch/network UI interaction remains unverified.

Remaining compatibility boundaries: legacy session aliases and form DTO normalization;
project mutation arrays; remote application/echo suppression and import/export array APIs;
legacy session publication fallback for pre-migration records. Notion ownership and planning
state are still Stage 4/5 work. No destructive cloud migration or server changes were made.

## Stage 3 — one session model inside the app

Use `schedule.blocks`, `execution.state/intervals`, `reflection`, and `integrations`
throughout desktop feature code. Retain `StudySessionDraft` as a form DTO, not a second
persisted model. Forms explicitly convert drafts once at their mutation boundary.

Migrate consumers in small groups: calendar/analytics, planning forms, assistant/planner,
then timer and integrations. Replace `activeDurations` with explicitly named planned
blocks or actual intervals at every caller; never infer study evidence from an event's
finished flag. Keep interval validation and overnight/DST handling.

After all callers migrate, delete deprecated fields from `StudySession`,
`attachCompatibilityView`, `legacyActiveDurations`, and legacy patch branches from
`updateStudySession`. Legacy import normalization stays at the import boundary; old
backups must still load. Shared cloud DTO conversion remains a boundary adapter.

Checks: old backups; planned blocks do not count as completed study; completed manual
logs; pause/resume; multiple blocks; overnight intervals; canonical DTO round trips.

## Stage 4 — remove Notion from UI mutation handlers

Make committed local mutations and applied remote mutations the only sources of Notion
intent. Verify every mutation class reaches the durable Notion outbox before removing
manual pushes; session writes currently take a special path in `recordLocalUpsert`.

Then remove per-feature `push*Change` calls and automatic `requestNotionSync` calls from
`App.tsx`. Keep explicit user sync/retry controls. The Notion worker updates integration
metadata without echoing endless mirror writes. Preserve conflict UI and failed intents.

Checks: create/edit/delete/merge/convert from UI, assistant, cloud, and Notion; conflicts;
network failures; VCAA exclusions; linked-page archives; no mirror loops or lost edits.

## Stage 5 — simplify dialog state, then shrink App

Replace mutually exclusive planning-dialog booleans, selected records, initial dates,
mode, and reset keys with one discriminated planning-dialog state:
`closed | event | session | convert`. Store only the source ID plus the draft/initial
values that cannot be derived. Unrelated search/settings dialogs stay independent.

Delete impossible state combinations and repeated setter/reset sequences. Pass one
stable conversion opener to menus and the event dialog. Keep form-specific saving state
inside the form; errors retain drafts. Undo uses the atomic mutations from stage 2.

Only then move the remaining planning-dialog rendering out of `App.tsx` if it improves
ownership. Moving code without deleting duplicate behavior is not an acceptance criterion.

## Rollout and acceptance

Order: shared menu -> row writes/atomic conversion -> canonical session consumers ->
Notion ownership -> dialog state. Do not rewrite sync, storage, forms, and lifecycle together.
No destructive cloud schema migration is required by this plan.

For each stage, record production LOC delta (excluding docs/tests), removed APIs/call
sites, and any remaining compatibility boundary. Aim for at least a 25% reduction in the
affected mutation/dialog/model code after all stages; this is a target, not a measured
estimate. Reject abstractions whose configuration/wrappers replace the deleted lines.

Run `bun run check` and `bun run test:logic` at every stage. For shared-contract changes,
also run web and Android conformance checks from `docs/sync-protocol.md`; when changing
server behavior, run the Supabase SQL checks. Add only the smallest failure/round-trip
checks needed for the stage. Manually verify focus, Escape/cancel, keyboard menus, and
screen-reader labels; source-level wiring checks are not interaction tests.
