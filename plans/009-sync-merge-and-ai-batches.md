# Plan 009: Merge concurrent SAC/ATAR edits by id; keep completed AI batches

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If a STOP condition occurs, stop and report; do
> not improvise. Do NOT edit `plans/README.md`; the reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 67a4c42..HEAD -- src/lib/app-sync.ts src/lib/mistake-ai.ts`
> If anything changed, compare the excerpts below with the live code; a mismatch is a STOP condition.

## Status

- **Priority**: P2 · **Effort**: M · **Risk**: MED · **Depends on**: none · **Category**: bug
- **Planned at**: commit `67a4c42`, 2026-11-10

## Why this matters

Two unrelated cases where finished work is thrown away:

**A. Sync.** SAC records and saved ATAR estimates each sync as one row holding the whole array
(`user_state` rows `sacRecords` and `atarEstimates`, payload `{ value: [...], updated_at }`). When two
devices edit the list before syncing, the later one gets a "stale" answer and is rebased. The
rebase merges object keys, and both sides changed the key `value`, so the remote array wins
outright and the local SAC or estimate silently disappears.

**B. AI.** Mistake autofill and photo analysis run in batches and throw on the first failed batch,
discarding every batch that already succeeded (and the paid model calls behind them).

## Current state

### A. `src/lib/app-sync.ts`

```ts
// :460
function mergeConcurrentValue(entity: Entity, rowId: string, base: unknown, local: unknown, remote: unknown): unknown {
  if (entity === "user_state" && rowId === "learning" &&
    isRecord(base) && isRecord(local) && isRecord(remote) &&
    isRecord(base.value) && isRecord(local.value) && isRecord(remote.value)) {
    return { ...remote, value: mergeLearningWorkspace(local.value as never, remote.value as never) }
  }
  if (entity === "mistakes" && isRecord(base) && isRecord(local) && isRecord(remote)) { ... }
  if (isRecord(base) && isRecord(local) && isRecord(remote)) return mergeObject(base, local, remote)
  return sameValue(remote, base) ? local : remote
}

// :487
function mergeObject(base, local, remote) {
  ...
    if (sameValue(localValue, before)) { if (remoteValue !== undefined) merged[key] = remoteValue }
    else if (sameValue(remoteValue, before)) { if (localValue !== undefined) merged[key] = localValue }
    else if (remoteValue !== undefined) merged[key] = remoteValue      // both changed: remote wins
```

It is called from `rebaseOutbox` as
`mergeConcurrentValue(latest.entity, latest.rowId, latest.basePayload, latest.payload, currentPayload)`.
`basePayload` is the server row the local edit was made on (may be `null` for a row that did not exist).
`sameValue` (deep equality) is imported from `./app-rows`. Row layout is in `src/lib/app-rows.ts:25-41`:
`["sacRecords", data.sacRecords, data.sacRecordsUpdatedAt]` and `["atarEstimates", data.atarEstimates, data.atarEstimatesUpdatedAt]`, each pushed as `{ value, updated_at: updatedAt }`.
Every `SacRecord` and `SavedAtarEstimate` has a string `id`. New ATAR estimates are prepended
(`App.tsx`: `atarEstimates: [estimate, ...current.atarEstimates]`); SAC records are appended by `ops.saveSacRecord`.

### B. `src/lib/mistake-ai.ts`

```ts
// ~:186, inside the batch loop of the autofill function
    let batchAutofills: MistakeAutofill[]
    try {
      batchAutofills = (await result.output).autofills
    } catch (error) {
      const cause = streamError ?? error
      throw new Error(formatMistakeAIError(cause), { cause })
    }
    ...
    autofills.push(...batchAutofills)
  }
```

Image analysis (~:545-551) similarly throws on question N and drops drafts 1..N-1. The same file's
`editMistakesWithInstruction` already reports progress per batch through an `onBatch` callback
(~:271); that is the pattern to copy.

Repo rules (`AGENTS.md`): minimal code, no new abstractions, no new dependencies, no new tests.
`docs/sync-protocol.md` must be read before touching sync code; the relevant line is "Web changes
include `expected_seq`, so the server either commits against the version the client read or returns
the canonical row for a field-aware rebase."

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (fresh worktree) | `bun install --frozen-lockfile` | exit 0 |
| Typecheck + lint | `bun run check` | exit 0 (2 known warnings in `toggle.tsx`, `friends-page.tsx`) |
| Tests | `bun test` | 48 pass, 0 fail |
| Web build | `bun run build` | exit 0 |
| Desktop frontend build | `bun run build:desktop` | exit 0 (AI code only ships in this build) |

## Scope

**In scope**: `src/lib/app-sync.ts` (`mergeConcurrentValue` and one small helper beside it), `src/lib/mistake-ai.ts`, and the direct callers of the two AI functions changed in step 2 (find with grep; expected in `src/components/mistakes-page.tsx`, `mistake-sheet.tsx` or an autofill dialog), `docs/sync-protocol.md` (one sentence).

**Out of scope**: `src/lib/app-rows.ts`, `src/lib/sync.ts`, `src/lib/study-session-sync.ts`, `server/mcp/*`, Supabase functions, the row layout (do not split the arrays into per-record rows; Folio and the MCP server read this layout), `mergeObject` itself.

## Git workflow

Commit in your worktree, one commit per step; plain imperative sentence messages. Do not push.

## Steps

### Step 1: three-way merge by id for the two list rows

In `mergeConcurrentValue`, before the generic `mergeObject` branch, add a branch for
`entity === "user_state" && (rowId === "sacRecords" || rowId === "atarEstimates")` when `local` and
`remote` are records whose `value` is an array. Treat a missing/`null` `base` as an empty list.
Merge with one small local function `mergeById(base, local, remote)` over items with a string `id`:

- start from the remote list (remote order kept);
- for each id in base: if local deleted it and remote left it unchanged (`sameValue` to base) → drop it; if local changed it and remote left it unchanged → use local's version; if both changed or remote deleted it → remote wins (same rule `mergeObject` uses);
- ids only in local (added locally) → add them: at the front for `atarEstimates`, at the end for `sacRecords`;
- if any item lacks a string `id`, fall back to today's behaviour for the whole row.

Return `{ ...remote, value: merged, updated_at: <the later of local.updated_at and remote.updated_at as strings> }`.
`rebaseOutbox` already skips the write when the merge equals the remote payload, so "nothing local
to keep" still sends nothing.

Add one sentence to `docs/sync-protocol.md` in the "Durable feed" section: SAC records and ATAR
estimates rebase per record id.

**Verify**: `bun run check` → exit 0; `bun test` → 48 pass. In the report, trace: base `[a, b]`,
local `[a, b, c]` (added c), remote `[a', b]` (edited a) → merged `[a', b, c]` for `sacRecords`.

### Step 2: keep completed AI batches

- Autofill: give the function an optional `onBatch?: (autofills: MistakeAutofill[]) => void` parameter in the same position/style as `editMistakesWithInstruction`'s, call it after each successful batch, and update the caller(s) to apply each batch as it arrives (the app already applies autofills through `applyAutofills` in `App.tsx`, passed down as a prop; find the prop name with `grep -rn "applyAutofills\|onApplyAutofills" src`). On a later failure the thrown error must say how many mistakes were completed before it failed. If a caller shows a review/preview step before applying, keep that step: collect what `onBatch` delivered and, on failure, show the partial preview together with the error instead of nothing.
- Image analysis (~:545-551): on a failure at question N, return the drafts already produced together with the error rather than throwing them away. Use whatever shape the caller needs with the least change (for example the same optional per-item callback); do not invent a result wrapper type if a callback does it.

**Verify**: `bun run check` → exit 0; `bun test` → 48 pass; `bun run build` and `bun run build:desktop` → exit 0.

## Test plan

No new tests (repo rule). The traced merge case goes in the report.

## Done criteria

- [ ] `bun run check`, `bun test`, `bun run build`, `bun run build:desktop` exit 0
- [ ] `grep -n "sacRecords\|atarEstimates" src/lib/app-sync.ts` shows the new merge branch
- [ ] `git status` shows only in-scope files
- [ ] Report includes the traced merge

## STOP conditions

- Excerpts do not match the live code.
- The AI callers apply results only after a whole run in a way that cannot take partial results without redesigning a dialog: do step 1, commit, and report what step 2 would need.
- Any change would alter what is written to the server for a non-conflicting edit.

## Maintenance notes

- Other whole-array `user_state` rows (`subjects`, `trackedExamIds`, `completedExamIds`, `completedSubjects`) are string lists and still resolve remote-wins on a true conflict; a set-union merge for them is a possible follow-up.
- Reviewer: check the merge never resurrects a record the remote side deleted.
