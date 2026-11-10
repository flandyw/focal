# Plan 002: Show SACs and MCP events on the right day and time

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If a STOP condition occurs, stop and report; do
> not improvise. Do NOT edit `plans/README.md`; the reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 67a4c42..HEAD -- src/lib/day-plan.ts server/mcp/records.ts server/mcp/insights.ts`
> If anything changed, compare the excerpts below with the live code; a mismatch is a STOP condition.

## Status

- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: bug
- **Planned at**: commit `67a4c42`, 2026-11-10

## Why this matters

Users are in Victoria, Australia (UTC+10/+11). Two date bugs:

1. A SAC's `scheduledAt` is a plain `YYYY-MM-DD` (from `<Input type="date">` in `src/components/sac-sheet.tsx:148`). The day plan parses it with `new Date(...)`, which is UTC midnight, so every SAC on Today and Calendar shows a start time of "10:00 am" or "11:00 am" that nobody entered.
2. The MCP tool `list_events` filters with `startTime.slice(0, 10)`. Events are stored as UTC ISO strings, so a 09:00 Melbourne exam on 6 October is stored as `2026-10-05T22:00:00.000Z` and is returned for the 5th, not the 6th. `save_event` also stores a caller-supplied `startTime` verbatim (possibly `+11:00`), so string sorting and the string comparison in `get_overview` are wrong for mixed formats.

## Current state

The excerpts below are abridged; they match when the logic is the same. Comment, whitespace and
line-number differences are not a mismatch.

`src/lib/day-plan.ts`:

```ts
// :82
function timeOf(iso: string | number) {
  const parsed = new Date(iso)
  if (!Number.isFinite(parsed.getTime())) return undefined
  return parsed.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
}
// :100
function sacItem(record: SacRecord): DayItem {
  return {
    kind: "sac", id: record.id, title: record.title,
    detail: [record.subject, record.unit, record.sacNumber].filter(Boolean).join(" · "),
    minutes: record.durationMinutes,
    startTime: timeOf(record.scheduledAt) ?? "",
    completed: isCompletedSac(record),
  }
}
// :276
  for (const record of data.sacRecords) {
    if (localDate(new Date(record.scheduledAt)) !== date) continue
    items.push(sacItem(record))
  }
```

`server/mcp/records.ts:442-447`:

```ts
  define("list_events", "List calendar events (SACs, exams, assignments, homework, other) in a date range.",
    { from: day.optional(), to: day.optional(), limit }, "read", async ({ from, to, limit }) => {
      const { data } = await readAll()
      return data.events.filter((e) => (!from || e.startTime.slice(0, 10) >= from) && (!to || e.startTime.slice(0, 10) <= to))
        .toSorted((a, b) => a.startTime.localeCompare(b.startTime)).slice(0, limit)
    })
```

`save_event` (same file, ~line 458-463) computes
`const startTime = a.startTime ?? (a.date && a.startClock ? localInstant(a.date, a.startClock, a.timeZone) : undefined)` and likewise `endTime`; `localInstant` already returns `toISOString()` output, a caller-supplied `a.startTime` is stored as given.

`server/mcp/insights.ts:67`:

```ts
      upcomingEvents: data.events.filter((e) => !e.isFinished && e.startTime >= now.toISOString()).toSorted((a, b) => a.startTime.localeCompare(b.startTime)).slice(0, 5)
```

Conventions: `localDate(date: Date)` in `src/lib/learning-workspace.ts:166` returns the local `YYYY-MM-DD` and is the house helper (72 call sites); check whether `server/mcp/records.ts` already imports it or a local-day helper from `server/mcp/util.ts` and use what is there. The MCP server runs with `TZ=Australia/Melbourne` (`docs/mcp.md`), so "local" on the server is the user's zone. Minimal code, no new helpers unless unavoidable, no new tests.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (fresh worktree) | `bun install --frozen-lockfile` | exit 0 |
| Typecheck + lint | `bun run check` | exit 0 (2 known warnings in `toggle.tsx`, `friends-page.tsx`) |
| Tests | `bun test` | 48 pass, 0 fail |
| Web build | `bun run build` | exit 0 |

## Scope

**In scope**: `src/lib/day-plan.ts`, `server/mcp/records.ts`, `server/mcp/insights.ts`.

**Out of scope**: `src/lib/sac.ts`, `src/components/*`, `server/mcp/util.ts` (`localInstant` is correct), `server/mcp/store.ts` (another plan edits it), stored data formats.

## Git workflow

Commit in your worktree; message style is a plain imperative sentence, e.g.
`Fix calendar event completion and day boundaries`. Do not push.

## Steps

### Step 1: SAC day and time

In `day-plan.ts`: the SAC loop compares the date part directly:
`if (record.scheduledAt.slice(0, 10) !== date) continue`. In `sacItem`, a date-only value has no
time: `startTime: record.scheduledAt.length > 10 ? timeOf(record.scheduledAt) ?? "" : ""`.
First run `grep -n "scheduledAt" src/lib/day-plan.ts` and apply the same treatment to any other
`new Date(record.scheduledAt)` on a SAC in this file.

**Verify**: `grep -n "new Date(record.scheduledAt)" src/lib/day-plan.ts` → no matches; `bun run check` → exit 0.

### Step 2: MCP events

- `list_events`: filter on the local date of the instant (`localDate(new Date(e.startTime))`), sort with `Date.parse(a.startTime) - Date.parse(b.startTime)`.
- `save_event`: do NOT change it. It stores a caller-supplied `startTime` verbatim, offset included, and `server/mcp/tools.test.ts:197` asserts that (`2026-10-06T09:00:00+11:00` is returned as given). Stored timestamps therefore have mixed formats, which is why every reader must compare with `Date.parse`, never as strings.
- `insights.ts:67`: compare `Date.parse(e.startTime) >= now.getTime()` and sort by `Date.parse`.

**Verify**: `grep -n "startTime.slice(0, 10)\|startTime.localeCompare" server/mcp/records.ts server/mcp/insights.ts` → no matches; `bun run check` → exit 0; `bun test` → 48 pass; `bun run build` → exit 0.

## Test plan

No new tests (repo rule: `AGENTS.md` forbids adding tests). `bun test` must stay at 48 pass
(`server/mcp/tools.test.ts` exercises MCP tools).

## Done criteria

- [ ] Both greps above return no matches
- [ ] `bun run check`, `bun test`, `bun run build` exit 0
- [ ] `git status` shows only the three in-scope files

## STOP conditions

- Excerpts do not match the live code.
- `scheduledAt` turns out to carry a time anywhere it is written (check `grep -rn "scheduledAt:" src server | head -20`); then the date-only assumption is false.
- `bun test` fails after step 2 in a way that shows a test encodes the UTC-slice behaviour: report it rather than editing the test.

## Maintenance notes

- If SACs ever gain a time of day, `sacItem` already shows it for values longer than a date.
- Reviewer: check the `list_events` filter uses the server's local zone on purpose (documented `TZ`).
