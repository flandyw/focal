# Plan 010: Clear reachable high-severity dependency advisories

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If a STOP condition occurs, stop and report; do
> not improvise. Do NOT edit `plans/README.md`; the reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 67a4c42..HEAD -- package.json bun.lock`
> If either changed, re-run `bun audit` and work from the fresh output.

## Status

- **Priority**: P3 · **Effort**: S · **Risk**: LOW-MED · **Depends on**: none · **Category**: migration (investigate, then fix what is safe)
- **Planned at**: commit `67a4c42`, 2026-11-10

## Why this matters

`bun audit` reports 30 advisories (10 high, 14 moderate, 6 low) at this commit. Most are in
`undici` 7.x (fixed in 7.30.1), pulled in transitively; one high advisory names `zod` `<4.6.6`,
where the tree holds both `zod@4.6.7` (direct, not affected) and `zod@3.25.76` (transitive via
`@ai-sdk/*`, `@modelcontextprotocol/sdk`, `shadcn`). Nobody has checked which of these run in a
shipped path: the hosted server (`server.ts`, `api/`, `server/`), the MCP server, the desktop
sidecar (compiled with Bun, which uses its own HTTP client rather than `undici`), or only dev tooling.

## Current state

- `package.json` already uses `"overrides": { "katex": "^0.19.0" }`; that is the house way to pin a transitive dependency.
- Package manager is Bun (`"packageManager": "bun@1.4.2"`), lockfile `bun.lock`. `vendor/siwc` is vendored code with its own imports; do not edit it.
- Baseline: `bun run check` exits 0; `bun test` → 48 pass; `bun run build` and `bun run build:desktop` exit 0.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (fresh worktree) | `bun install --frozen-lockfile` | exit 0 |
| Audit | `bun audit` | lists advisories |
| Why is it installed | `bun why undici` (and `bun why zod`) | dependency paths |
| Typecheck + lint | `bun run check` | exit 0 (2 known warnings in `toggle.tsx`, `friends-page.tsx`) |
| Tests | `bun test` | 48 pass, 0 fail |
| Web build | `bun run build` | exit 0 |
| Desktop frontend build | `bun run build:desktop` | exit 0 |
| Sidecar build | `bun run build:chatgpt-sidecar` | exit 0 (skip and say so if it cannot build here) |

## Scope

**In scope**: `package.json` (`overrides` and version ranges of existing dependencies only), `bun.lock`.

**Out of scope**: source code, `vendor/siwc/**`, `src-tauri/Cargo.*`, adding or removing dependencies, any major-version bump of a direct dependency.

## Git workflow

Commit in your worktree; plain imperative sentence message, e.g. `Pin undici past its 7.30 advisories`. Do not push.

## Steps

### Step 1: map the advisories

Run `bun audit` and save the full output for the report. For each package with a high advisory, run
`bun why <package>` and record which direct dependency pulls it in and whether that dependency is
used by shipped server code (`grep -rn "from \"<direct-dep>" server api server.ts src | head`) or
only by tooling (`shadcn` CLI, `supabase` CLI, `vite`, `oxlint`).

**Verify**: you can state, per high advisory, "pulled in by X; reachable in <hosted server | MCP | sidecar | browser | dev only>".

### Step 2: do not update parents

Skip this step. A first attempt showed that updating the direct parents moves `ai` ahead of the
pinned `@ai-sdk/react` (`4.0.133`) and breaks typecheck with TS2344 in `src/components/chat-page.tsx:139`.
Do not run `bun update` on `ai`, `@ai-sdk/*`, `@modelcontextprotocol/sdk` or `shadcn`. Go straight to
step 3 and change only the transitive package through `overrides`.

### Step 3: override what remains, same major only

If `undici` 7.x below 7.30.1 is still installed, add `"undici": "^7.30.1"` to `overrides` (all
dependents must already accept 7.x; check with `bun why undici`) and `bun install`. Do the same for
any other high advisory whose fix is a patch/minor of the same major. For `zod`: if the flagged copy
is the transitive 3.x one, do not force it to 4.x; record it as not fixable here.

**Verify**: same four gates pass; `bun audit` shows fewer high advisories than step 1, and the report lists every one that remains with the reason.

## Test plan

No new tests (repo rule). The four gates are the regression check.

## Done criteria

- [ ] `bun run check`, `bun test`, `bun run build`, `bun run build:desktop` exit 0
- [ ] `git status` shows only `package.json` and `bun.lock`
- [ ] Report contains before/after `bun audit` summary lines and the reachability table from step 1

## STOP conditions

- A fix needs a major-version bump of a direct dependency, or an override across majors.
- An override breaks a gate: remove that one override, `bun install`, re-run the gates, continue with the other overrides, and report the one that could not be applied. Stop only if the gates fail with no overrides applied.
- After `bun install`, `git diff bun.lock` shows version changes for `ai`, `@ai-sdk/react` or any direct dependency (the override must move only the overridden package).
- `bun install` cannot reach the registry: report, change nothing.

## Maintenance notes

- CI installs with `--frozen-lockfile`; the committed `bun.lock` must come from the Bun version in `packageManager` (1.4.2). Check `bun --version` before committing and say which version wrote the lockfile.
- Remaining advisories in dev-only tooling are low priority; the report's table tells the maintainer which those are.
