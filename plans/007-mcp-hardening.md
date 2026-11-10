# Plan 007: Harden MCP token handling and survive one invalid row

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If a STOP condition occurs, stop and report; do
> not improvise. Do NOT edit `plans/README.md`; the reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 67a4c42..HEAD -- server/mcp/index.ts server/mcp/store.ts docs/mcp.md`
> If anything changed, compare the excerpts below with the live code; a mismatch is a STOP condition.

## Status

- **Priority**: P2 · **Effort**: M · **Risk**: MED · **Depends on**: none · **Category**: security / bug
- **Planned at**: commit `67a4c42`, 2026-11-10

## Why this matters

The MCP server exposes a whole Focal account to AI clients. Three problems:

1. The docs tell end users to paste the Supabase service-role key (which bypasses every access rule for every user of Focal and Folio) into their local Claude Desktop config.
2. A failed token lookup returns the internal error text (missing env names, Supabase messages) to unauthenticated callers.
3. If a single synced attempt or mistake row fails validation (for example a mistake whose attempt was deleted on another device), every MCP read and write throws "Synced attempts or mistakes failed validation", and the AI cannot even repair it.

## Current state

`server/mcp/index.ts`, `handleMcp` (~:62-75):

```ts
  // The token is a bearer header, or the last URL segment (/mcp/<token>) for connectors that cannot send headers.
  const token = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? new URL(request.url).pathname.split("/")[2] ?? ""
  const unauthorized = (why: string) => { console.warn(`mcp 401: ${why}`); return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": "Bearer" } }) }
  if (!token.startsWith("focal_")) return unauthorized(token ? "bearer token without focal_ prefix" : "no Bearer authorization header")
  let userId: string | null
  try { userId = await resolveToken(token) } catch (error) { return new Response(error instanceof Error ? error.message : "Token lookup failed", { status: 503 }) }
```

`docs/mcp.md` (~:49-62): "Anyone holding a token has full access to its account." then the Claude
Desktop stdio example whose `env` includes `"SUPABASE_SERVICE_ROLE_KEY": "..."`.

`server/mcp/store.ts`, `project(rows)` (~:153-185):

```ts
  const migrated = migrateAppData({
    ...EMPTY_APP_DATA,
    attempts: live(rows, "attempts").map((row) => row.payload),
    mistakes: live(rows, "mistakes").map((row) => row.payload),
  })
  if (!migrated) throw new Error("Synced attempts or mistakes failed validation")
```

`project` is used by `readAll()` and by `updateApp(edit)`, which does
`const before = project(rows); const after = edit(before); if (!migrateAppData(after)) throw ...; const changes = diffAppData(before, after)...`.
Important: `diffAppData(before, after)` emits a **delete** for any row present in `before` and
absent in `after`, and nothing for rows absent from both. So rows that `project` leaves out are
simply invisible to the edit and are never deleted by it. That is the property to preserve.

`migrateAppData` (in `src/lib/exam-data.ts`) validates the whole object and returns `null` on any
invalid attempt or mistake; it also requires every mistake's `attemptId` to exist among the attempts
(~:1014) unless the mistake is standalone.

Tests: `server/mcp/tools.test.ts` mocks `./store`; `bun test` must stay at 48 pass.
Repo rules: minimal code, no new dependencies, no new tests; log lines go to stderr via `console.warn`/`console.error` as the file already does.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (fresh worktree) | `bun install --frozen-lockfile` | exit 0 |
| Typecheck + lint | `bun run check` | exit 0 (2 known warnings in `toggle.tsx`, `friends-page.tsx`) |
| Tests | `bun test` | 48 pass, 0 fail |

## Scope

**In scope**: `server/mcp/index.ts`, `server/mcp/store.ts`, `docs/mcp.md`.

**Out of scope**: `server/mcp/records.ts`, `server/mcp/insights.ts`, `server/mcp/util.ts` (another plan edits records/insights), `src/lib/exam-data.ts`, `src/lib/app-sync.ts` (the app's own projection has the same throw; changing it is deferred), Supabase migrations, the path-token form itself (existing connectors depend on it).

## Git workflow

Commit in your worktree, one commit per step; plain imperative sentence messages. Do not push.

## Steps

### Step 1: no internal error text to unauthenticated callers

In `handleMcp`, the `catch` logs the real error with `console.error("mcp token lookup failed:", ...)`
(message only, never the token) and returns `new Response("Service unavailable", { status: 503 })`.

**Verify**: `grep -n "error.message : \"Token lookup failed\"" server/mcp/index.ts` → no matches; `bun run check` → exit 0.

### Step 2: docs

In `docs/mcp.md`:
- Replace the Claude Desktop stdio example with one that connects to the hosted HTTP server with a bearer header (the form already shown for `claude mcp add --transport http`; for Claude Desktop use the `mcp-remote` style only if the doc already mentions it, otherwise describe stdio as "for the operator's own machine only").
- State plainly that `SUPABASE_SERVICE_ROLE_KEY` belongs only on the server that runs the MCP service, never in an end user's MCP client config, and that the stdio transport needs it and is therefore for the operator only.
- Next to the path-token note, add: a token in the URL path is written to proxy and access logs; prefer the Authorization header, and configure the reverse proxy not to log request paths for `/mcp/` if the path form is used.

**Verify**: `grep -n "SUPABASE_SERVICE_ROLE_KEY" docs/mcp.md` → no occurrence inside a client-config JSON example.

### Step 3: one bad row must not break the account

In `project`, when `migrateAppData` of the full set returns `null`, fall back to keeping only valid rows:

1. Validate attempts one at a time (`migrateAppData({ ...EMPTY_APP_DATA, attempts: [payload] })`), keep the valid ones.
2. Validate each mistake together with the kept attempts (`migrateAppData({ ...EMPTY_APP_DATA, attempts: kept, mistakes: [payload] })`), keep the valid ones.
3. Run `migrateAppData` once more on the kept set; if that still returns `null`, throw the existing error.
4. `console.warn` one line with the counts and row ids left out (ids only, no payloads).

Keep the fast path (whole-set validation succeeds) exactly as it is. Add a one-line comment:
`// shortcut: invalid rows are hidden, not repaired; they stay on the server until fixed in the app.`
Because `updateApp` diffs `before` (which now lacks the bad rows) against `after`, the hidden rows
are neither rewritten nor deleted. Confirm that by reading `diffAppData` in `src/lib/app-rows.ts`.

Performance: the per-row fallback is O(n) calls and only runs when the account is already broken; do not optimise.

**Verify**: `bun run check` → exit 0; `bun test` → 48 pass.

## Test plan

No new tests (repo rule). In the report, trace this case against your code: attempts `[A]`, mistakes
`[m1 → A, m2 → deleted attempt B]` → `project` returns A, m1; a later `updateApp` that edits m1
sends exactly one change (m1) and no delete for m2.

## Done criteria

- [ ] `bun run check`, `bun test` exit 0
- [ ] Steps 1 and 2 greps pass
- [ ] `git status` shows only the three in-scope files
- [ ] Report includes the traced case

## STOP conditions

- Excerpts do not match the live code.
- `migrateAppData` normalises or rewrites valid rows such that validating one at a time yields different objects from validating together (then `diffAppData` could emit spurious writes); compare by reading the function, and report if so.
- `updateApp` would delete hidden rows for any reason.

## Maintenance notes

- The web/desktop projection (`src/lib/app-sync.ts` `projectAppRows`) has the same all-or-nothing throw; aligning it is a separate, riskier change.
- Real fix for the client-side service-role key is a token-exchange endpoint or OAuth on the HTTP server; deferred as a feature.
