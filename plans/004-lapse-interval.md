# Plan 004: Keep a lapsed card's halved interval

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If a STOP condition occurs, stop and report; do
> not improvise. Do NOT edit `plans/README.md`; the reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 67a4c42..HEAD -- src/lib/exam-data.ts`
> If it changed, compare the excerpt below with the live code; a mismatch is a STOP condition.

## Status

- **Priority**: P2 · **Effort**: S · **Risk**: MED (changes review schedules) · **Depends on**: none · **Category**: bug
- **Planned at**: commit `67a4c42`, 2026-11-10

## Why this matters

Mistake cards use spaced repetition. When a mature card is rated "again", the code computes half
its interval, then unconditionally overwrites it with the short retry delay. The card comes back
after the retry, and a following "good" restarts it at about 2 days: a card at 60 days falls to 2-3
days instead of about 30, inflating review load after every lapse. The halving is dead code today.

## Current state

`src/lib/exam-data.ts`, function `previewMistakeReview` (~:436-500):

```ts
  if (rating === "again") {
    state = current.state === "new" || current.state === "learning" ? "learning" : "relearning"
    intervalDays = current.state === "review" ? Math.max(1, Math.round(current.intervalDays * 0.5)) : current.intervalDays
    easeFactor = Math.max(MINIMUM_EASE_FACTOR, easeFactor - 0.2)
    lapses += 1
  } else if (rating === "hard") {
    ...
    intervalDays = state === "learning" || state === "relearning" ? 1 : Math.max(1, Math.round(Math.max(1, current.intervalDays) * 1.2))
  } else if (rating === "good") {
    state = "review"
    intervalDays = current.state === "new" || current.state === "learning"
      ? 3
      : current.state === "relearning"
        ? Math.max(2, current.intervalDays)
        : ...
  }
  ...
  const completedTime = Date.parse(completedAt)
  const elapsed = mistake.lastReviewedAt ? Math.max(0, completedTime - Date.parse(mistake.lastReviewedAt)) / DAY_MS : 0
  if (rating === "good" || rating === "easy")
    intervalDays = Math.round(intervalDays * settings.spacingMultiplier + Math.max(0, elapsed - current.intervalDays) * 0.25)
  intervalDays = rating === "again" ? settings.retryHours / 24 : Math.min(settings.maximumIntervalDays, Math.max(1, intervalDays))

  return {
    rating, state,
    dueAt: pacedMistakeDueAt(mistake.id, completedTime + intervalDays * DAY_MS, settings, mistakes, completedTime),
    intervalDays,
    ...
    resolved: state === "review" && intervalDays >= 21,
  }
```

`recordMistakeReview` stores `intervalDays: next.intervalDays` on the card and in `reviewHistory`.
`getMistakeSchedule(mistake)` reads it back as `current.intervalDays`.

Conventions: minimal code, no new tests (`AGENTS.md`); `server/mcp` reuses this function, so MCP reviews change too (intended).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (fresh worktree) | `bun install --frozen-lockfile` | exit 0 |
| Typecheck + lint | `bun run check` | exit 0 (2 known warnings in `toggle.tsx`, `friends-page.tsx`) |
| Tests | `bun test` | 48 pass, 0 fail |
| Web build | `bun run build` | exit 0 |

## Scope

**In scope**: `src/lib/exam-data.ts` (function `previewMistakeReview` only).

**Out of scope**: validation/migration code in the same file, `MistakeReviewPreferences`, UI, stored data shapes, `app-sync.ts`.

## Git workflow

Commit in your worktree; message is a plain imperative sentence. Do not push.

## Steps

### Step 1: use the retry delay only for the due time

On "again", the stored `intervalDays` stays the value computed in the `again` branch (halved for a
card in `review`, unchanged otherwise, floor 1 for a review card), clamped to
`settings.maximumIntervalDays`; only `dueAt` uses `settings.retryHours / 24`. Target shape:

```ts
  intervalDays = Math.min(settings.maximumIntervalDays, Math.max(rating === "again" ? 0 : 1, intervalDays))
  const dueInDays = rating === "again" ? settings.retryHours / 24 : intervalDays
  ...
    dueAt: pacedMistakeDueAt(mistake.id, completedTime + dueInDays * DAY_MS, settings, mistakes, completedTime),
```

Then check every other reader of `current.intervalDays` in this function for a relearning card
that now carries a multi-day interval:
- "hard" from relearning sets 1: leave it.
- "good" from relearning returns `Math.max(2, current.intervalDays)`: now the halved value, which is the point.
- the `elapsed - current.intervalDays` bonus: for a relearning card this is now smaller or zero; fine.
- `resolved` is false on "again" because `state` is not `review`: unchanged.

Also `grep -n "intervalDays" src/lib/exam-data.ts src/lib/*.ts src/components/*.tsx | grep -v "exam-data.ts"`
and read each use that could show a relearning card's interval to the user (labels like "next
review in N days"). If any label would now show the halved interval where it showed the retry
delay, make it read from `dueAt` instead, or report it if that needs out-of-scope files.

**Verify**: `bun run check` → exit 0; `bun test` → 48 pass; `bun run build` → exit 0. In the report,
state the resulting `intervalDays` and approximate `dueAt` for: a review card at 60 days rated
"again" (expect 30, due after the retry delay), then rated "good" (expect about `30 × spacingMultiplier`).

## Test plan

No new tests (repo rule). If an existing test encodes the old value, report it; do not edit tests.

## Done criteria

- [ ] `bun run check`, `bun test`, `bun run build` exit 0
- [ ] `git status` shows only `src/lib/exam-data.ts` (plus a label file only if step 1 required it and it is reported)
- [ ] Report states the two traced values

## STOP conditions

- The excerpt does not match the live code.
- A validator in this file (`migrateAppData`) rejects cards whose `intervalDays` is fractional or below 1 in a way that the old retry fraction satisfied but the new values do not, or vice versa.
- Cards already in relearning (stored with the small retry fraction) would break; they should simply continue under the old value until their next review.

## Maintenance notes

- This is a behaviour change the maintainer should confirm: lapsed cards return to roughly half their old interval rather than restarting. Existing relearning cards are not rewritten.
- The sync conflict merge (`app-sync.ts` `mergeConcurrentValue`) copies `intervalDays` as a schedule field; no change needed.
