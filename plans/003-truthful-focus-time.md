# Plan 003: Log focus time truthfully across sleep and midnight

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If a STOP condition occurs, stop and report; do
> not improvise. Do NOT edit `plans/README.md`; the reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 67a4c42..HEAD -- src/hooks/use-study-timer.ts src/lib/study-timer.ts`
> If anything changed, compare the excerpts below with the live code; a mismatch is a STOP condition.

## Status

- **Priority**: P1 · **Effort**: M · **Risk**: MED · **Depends on**: none · **Category**: bug
- **Planned at**: commit `67a4c42`, 2026-11-10

## Why this matters

The focus (Pomodoro / free study) timer counts by wall clock, so after a laptop lid closes or a
phone sleeps it catches up in one large step. The step can cross "work ended" without the block
log noticing when it ended: the block is closed (or merely paused) at wake time, and the whole
sleep is billed as study. Example with default settings (breaks auto-start, focus does not): start
a 25-minute block, close the lid for 2 hours, reopen → about 2.5 hours logged instead of 25
minutes. Separately, the timer page's "blocks today / focus today" totals freeze at midnight while
the timer is idle, because their clock only ticks while the timer runs.

## Current state

The excerpts below are abridged: comments are shortened or omitted and some statements are joined
onto one line. They "match" when the live code has the same logic; differences in comments,
whitespace or line numbers are not a mismatch and not a STOP condition.

`src/hooks/use-study-timer.ts`:

```ts
// :104
  const [now, setNow] = useState(() => Date.now())
// :227 tick loop
  useEffect(() => {
    if (!enabled || !state.running) return
    // Wall clock on purpose: performance.now() stops while a phone sleeps, which would silently lose that time.
    let last = Date.now()
    const interval = window.setInterval(() => {
      const current = Date.now()
      const seconds = Math.max(0, Math.floor((current - last) / 1000))
      last += seconds * 1000
      if (seconds > 0) dispatch({ type: "TICK", settings: settingsRef.current, seconds })
    }, TICK_MS)
    return () => window.clearInterval(interval)
  }, [enabled, state.running])
// :240 block lifecycle
  useEffect(() => {
    const at = serverNow()
    if (!enabled) { pauseBlock(false, at); if (state.running) dispatch({ type: "SET_RUNNING", running: false }); return }
    if (state.studyOvertime || state.mode === "free") {
      if (state.freeStudy) {
        if (openBlockRef.current?.source !== "free-study") closeBlock(at)
        if (state.running) openBlock("free-study", state.cycles, at)
        pauseBlock(state.running, at)
      }
      return
    }
    if (state.mode === "work") {
      // `openBlock` is a no-op while one is already open, so this doubles as the resume path that banks the pause.
      if (state.running) openBlock("pomodoro", state.cycles + 1, at)
      pauseBlock(state.running, at)
      return
    }
    closeBlock(at)
  }, [enabled, state.mode, state.running, state.studyOvertime, state.freeStudy, state.cycles, openBlock, closeBlock, pauseBlock, openBlockRef])
// :319
  // Re-render once a second so "focused for 24m" style labels stay honest.
  useEffect(() => {
    if (!enabled || !state.running) return
    const interval = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(interval)
  }, [enabled, state.running])
// :333
  const blocksToday = useMemo(() => countBlocksToday(blocks, new Date(now)), [blocks, now])
  const focusSecondsToday = useMemo(() => getFocusSecondsToday(blocks, new Date(now)), [blocks, now])
```

`src/lib/study-timer.ts`:

- `advanceTimer(state, settings, seconds)` (~:235-267) applies elapsed seconds and may pass several mode changes (work → break → next work) in one call.
- `loadTimerState` (~:350-396): the free-study branch (`mode === "free" || parsed.freeStudy === true`, ~:360-363) advances by `Math.floor((now - parsed.updatedAt) / 1000)` with no cap; the Pomodoro branch caps with `Math.min(MAX_RESTORE_ELAPSED_SECONDS, ...)` and its comment says "never more than a day".
- `closeOpenBlock(block, endedAt, blocks)` (~:533): `activeSeconds = (endedAt - startedAt - pausedMs) / 1000`; whatever `endedAt` the caller passes is billed.
- The open block is persisted and restored (`loadOpenBlock`, `OPEN_BLOCK_KEY`), so a page reload after sleep has the same problem through `loadTimerState`.

`useTickingNow(intervalMs = 60_000)` in `src/hooks/use-ticking-now.ts` returns a `Date` that refreshes on an interval and on `visibilitychange`; it is the house hook for "now".

The same `at` is what the synced session's lifecycle command is stamped with (follow `closeBlock` /
`pauseBlock` and the "Reconcile the logged session" effect that follows the block effect; it leads to
`src/lib/focus-session.ts`). Read those before changing anything, so the local block log and the
synced session end at the same moment.

Conventions: minimal code, no new abstractions, no new tests (`AGENTS.md`). A deliberate
simplification with a known limit gets a one-line comment `// shortcut: <the limit>, <when to upgrade>`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (fresh worktree) | `bun install --frozen-lockfile` | exit 0 |
| Typecheck + lint | `bun run check` | exit 0 (2 known warnings in `toggle.tsx`, `friends-page.tsx`) |
| Tests | `bun test` | 48 pass, 0 fail |
| Web build | `bun run build` | exit 0 |
| Desktop frontend build | `bun run build:desktop` | exit 0 |

## Scope

**In scope**: `src/hooks/use-study-timer.ts`, `src/lib/study-timer.ts`. `src/lib/focus-session.ts`
only if the end time cannot reach the synced session otherwise, and then only to pass a timestamp through.

**Out of scope**: `src/lib/study-session-sync.ts`, `src/lib/sync/sessionContract.ts`, anything in
`supabase/`, the exam/SAC timers (`exam-timer.ts`, `exam-timer-mode.tsx`), `docs/sync-protocol.md`,
timer UI components. Do not change localStorage keys or the persisted shapes (add optional fields at most).

## Git workflow

Commit in your worktree, one commit per step. Message style is a plain imperative sentence, e.g.
`Fix focus timer extensions at the duration limit`. Do not push.

## Steps

### Step 1: "today" totals follow the clock while idle

Replace the local `now` state and its 15 s interval effect with the house hook:
`const now = useTickingNow(state.running ? 15_000 : 60_000).getTime()` (import from
`./use-ticking-now`). First `grep -n "\bnow\b\|setNow" src/hooks/use-study-timer.ts` and keep every
other reader of `now` working. Fix the stale comment ("once a second").

**Verify**: `grep -n "setNow" src/hooks/use-study-timer.ts` → no matches; `bun run check` → exit 0.

### Step 2: cap free-study restore

In `loadTimerState`'s free-study branch, cap the elapsed seconds with `MAX_RESTORE_ELAPSED_SECONDS`
exactly as the Pomodoro branch does.

**Verify**: `bun run check` → exit 0.

### Step 3: end a work block when the work actually ended

Required behaviour (the code shape is yours, keep it small):

1. When a catch-up step (a `TICK` with many seconds, or the restore in `loadTimerState`) carries the timer past the end of a Pomodoro work period, the open block must be closed with `endedAt = (time the step started) + (work seconds that were left)`, not wake time. A suggested shape: in the tick callback, before dispatching, if the state is a running, non-overtime work period and `seconds > secondsLeft`, store `serverNow() - (seconds - secondsLeft) * 1000` in a ref; the block effect uses that ref's value instead of `serverNow()` for the close and then clears it. The tick callback needs the latest state through a ref (the hook already keeps `settingsRef`; mirror that).
2. If the catch-up lands on a later, not-yet-started work period (mode `work`, not running, `state.cycles` advanced), the block effect today only pauses the stale open block. It must close it instead. Check what `openBlock`'s second argument (cycle number) is stored as on the open block and use it to recognise "this open block belongs to an earlier cycle".
3. Restore path: after a reload, `loadTimerState` has advanced the state but the persisted open block is still open. The first run of the block effect must close it at `updatedAt + secondsLeft` of the saved state when the saved work period ended while the page was closed. Expose the minimum from `study-timer.ts` to compute that (the saved `updatedAt`, `secondsLeft`, `mode`, `running` are in the `STATE_KEY` JSON).
4. The synced session's `complete`/`pause` for that block must carry the same end time. Trace how `at` reaches it and pass the corrected value along the same path.
5. Free study is open-ended: no change beyond step 2. Pomodoro "study overtime" (the user chose to keep working past the bell) must still count; do not cut blocks at the bell when `studyOvertime` is what the timer was in.

**Verify**: `bun run check` → exit 0; `bun test` → 48 pass; `bun run build` and `bun run build:desktop` → exit 0.
Then reason through these three cases against your code and state the logged `activeSeconds` for each in your report:
(a) 25-min block, 10 min in, sleep 2 h, wake with tab open → 25 min;
(b) same but the page is reloaded on wake → 25 min;
(c) 25-min block, 20 min in, sleep 2 min, wake → block still running with 3 min left, nothing closed.

## Test plan

No new tests (repo rule). Verification is the gates plus the three traced cases in the report.

## Done criteria

- [ ] `bun run check`, `bun test`, `bun run build`, `bun run build:desktop` exit 0
- [ ] `grep -n "setNow" src/hooks/use-study-timer.ts` → no matches
- [ ] The free-study restore branch references `MAX_RESTORE_ELAPSED_SECONDS`
- [ ] Report states the traced result for cases (a), (b), (c)
- [ ] `git status` shows only in-scope files

## STOP conditions

- The logic in the live code differs from the excerpts (comment or formatting differences do not count).
- Carrying the end time to the synced session needs a change in `study-session-sync.ts`, the session contract, or a Supabase function. Stop after steps 1-2 plus the local block-log part of step 3, commit that, and report what the synced path would need.
- The server would reject a back-dated `occurred_at` (look for `timing_invalid` handling) in a way that loses the completion: report instead of forcing it.

## Maintenance notes

- Not runnable in CI: a reviewer should exercise sleep/wake on a real device (close the lid mid-block) before release, in both web and desktop builds.
- The 24 h cap means a free-study timer forgotten for days logs at most a day; reducing that further is a product decision.
