# Plan 001: Gate releases and pull requests on real verification; fix tooling docs

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If a STOP condition occurs, stop and report; do
> not improvise. Do NOT edit `plans/README.md`; the reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 67a4c42..HEAD -- .github Makefile AGENTS.md CLAUDE.md docs/development.md docs/sync-protocol.md .gitignore src/components/ui/radio-group.tsx src/components/ui/scroll-area.tsx`
> If anything changed, compare the excerpts below with the live files; a mismatch is a STOP condition.

## Status

- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: dx
- **Planned at**: commit `67a4c42`, 2026-11-10

## Why this matters

Every push to `main` is released to desktop users, whose auto-updater reads
`https://github.com/flandyw/focal/releases/latest/download/latest.json`. Today the job that creates the
GitHub release does not wait for verification, so a push that fails typecheck still publishes an
empty "latest" release and updates break until the next good push. Verification is typecheck + lint
only: no build and no tests, although 48 passing tests exist. Pull requests run no CI at all.

## Current state

`.github/workflows/release.yml` (the only workflow):

- Lines 5-21: `on: push: branches: [main]` with a `paths:` list that omits `api/**`, `server.ts`, `vercel.json`.
- Lines 26-27: `env: VITE_EXAMTRACK_URL: https://vcetracker.vercel.app/` (referenced nowhere in `src`, `server`, `api`).
- Lines 51, 73, 135: `bun-version: 1.3.14`, while `package.json` has `"packageManager": "bun@1.4.2"`.
- Job `vtac` (lines 43-63) scrapes VTAC live; `publish-tauri` has `needs: [version, verify, create-release, vtac]` and downloads its artifact into `public` (lines 113-116). `public/vtac-scaling-reports.json` is also committed.
- Job `verify` ends with `- run: bun run check` (line 80).
- Job `create-release`:
  ```yaml
  create-release:
    needs: version
  ```

Docs that are wrong:

- `AGENTS.md:19`: "**Do not write tests.** ... There is no test suite in this repo and none should be added." and line 36 "Do not add tests."
- `CLAUDE.md:17`: `bun run lint[:fix]           # oxlint src scripts` (real script: `oxlint src scripts server api server.ts vite.config.ts`).
- `CLAUDE.md:24`: "There is no test suite. ... Some Makefile `dev` help text still mentions port 1420, but `make dev` runs the browser build (`bun run dev`)."
- `docs/development.md:33`: "This repository does not maintain a test suite; ..."
- `docs/sync-protocol.md:229`: "This repo has no test suite (see `AGENTS.md`). Verify changes with:"
- `Makefile:10`: `@echo "  make dev            Vite dev server (port 1420)"` (real port: 5173).
- `Makefile` `build` target runs `git add package.json src-tauri/tauri.conf.json`, but `scripts/bump-version.cjs` also rewrites `src-tauri/Cargo.toml`, leaving the tree dirty.

Reality: `server/mcp/tools.test.ts`, `src/lib/paper-matrix.test.ts`, `src/lib/paper-types.test.ts`,
`src/lib/topics.test.ts` exist; `bun test` → 48 pass. Decision: keep them, run them in CI, the rule
becomes "do not add new tests".

Other: `.gitignore` lines 37-39 ignore a removed `/android-native/` tree; nothing ignores
`.focal-chatgpt/`, the sidecar's default data dir (`server/local.ts:24`, `join(process.cwd(), ".focal-chatgpt")`).
`src/components/ui/radio-group.tsx` and `src/components/ui/scroll-area.tsx` are imported nowhere.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (fresh worktree) | `bun install --frozen-lockfile` | exit 0 |
| Typecheck + lint | `bun run check` | exit 0 (2 known warnings: `toggle.tsx` only-export-components, `friends-page.tsx` immutability) |
| Tests | `bun test` | 48 pass, 0 fail |
| Web build | `bun run build` | exit 0 (a >600 kB chunk warning is known) |
| Desktop frontend build | `bun run build:desktop` | exit 0 |

## Scope

**In scope**: `.github/workflows/release.yml`, `.github/workflows/check.yml` (create), `Makefile`,
`AGENTS.md`, `CLAUDE.md`, `docs/development.md`, `docs/sync-protocol.md`, `.gitignore`,
`src/components/ui/radio-group.tsx` (delete), `src/components/ui/scroll-area.tsx` (delete).

**Out of scope**: `package.json`, `bun.lock`, `scripts/bump-version.cjs`, the test files themselves,
the `publish-tauri` build matrix and signing env, anything under `src-tauri/`.

## Git workflow

Commit in your worktree, one commit per step or one for all. Message style is a plain imperative
sentence, e.g. `Keep completed subjects while excluding them from current study`. Do not push.

## Steps

### Step 1: release.yml

1. `create-release`: `needs: [version, verify]`.
2. `verify`: after `bun run check` add three steps: `bun test`, `bun run build`, `bun run build:desktop`. Raise its `timeout-minutes` from 10 to 15.
3. Replace all three `bun-version: 1.3.14` with `bun-version-file: package.json`.
4. Add `"api/**"`, `"server.ts"`, `"vercel.json"` to `on.push.paths`.
5. Run `grep -rn VITE_EXAMTRACK_URL src server api vite.config.ts server.ts`; if no matches, delete the workflow-level `env:` block (lines 26-27). If there are matches, leave it and say so.
6. `vtac` job: add `continue-on-error: true` at job level. In `publish-tauri`, add `continue-on-error: true` to the `actions/download-artifact@v4` step so a failed scrape falls back to the committed `public/vtac-scaling-reports.json`. Add a one-line comment saying so.

**Verify**: `bun -e "const y=require('fs').readFileSync('.github/workflows/release.yml','utf8'); if(/1\.3\.14/.test(y)||!/needs: \[version, verify\]/.test(y)) process.exit(1)"` → exit 0. Also confirm the file is valid YAML: `bun -e "console.log(Object.keys(Bun.YAML.parse(require('fs').readFileSync('.github/workflows/release.yml','utf8')).jobs))"` → lists `version, vtac, verify, create-release, publish-tauri` (if `Bun.YAML` is unavailable, use `python3 -c "import yaml,sys;print(list(yaml.safe_load(open('.github/workflows/release.yml'))['jobs']))"`).

### Step 2: PR workflow

Create `.github/workflows/check.yml`: name `check`, `on: pull_request`, one job on `ubuntu-22.04`,
`timeout-minutes: 15`, steps mirroring `verify` (checkout@v7, setup-bun@v2 with
`bun-version-file: package.json`, the same `actions/cache@v4` block, `bun install --frozen-lockfile`,
`bun run check`, `bun test`, `bun run build`, `bun run build:desktop`). No secrets, default permissions.

**Verify**: parse it as YAML with the same command as step 1 → one job.

### Step 3: docs and Makefile

- `AGENTS.md:19`: replace with a rule that says: do not write new tests; a small existing `bun test` suite (four files) must keep passing; verify with typecheck, lint, `bun test`, builds or running the app. Line 36: "Validate with `bun run check`, `bun test`, `bun run build`, and `bun run build:desktop`. Do not add tests."
- `CLAUDE.md`: fix the lint comment to `# oxlint src scripts server api server.ts vite.config.ts`; add `bun test                     # the four existing test files; do not add more`; rewrite the "There is no test suite" paragraph to match AGENTS.md and delete the sentence about Makefile port 1420.
- `docs/development.md:33` and `docs/sync-protocol.md:229`: same correction, add `bun test` to the listed commands.
- `Makefile:10`: port 5173. `build` target: `git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml`.

**Verify**: `grep -rn "no test suite\|does not maintain a test suite\|port 1420)" AGENTS.md CLAUDE.md docs/development.md docs/sync-protocol.md Makefile` → no matches.

### Step 4: housekeeping

- `.gitignore`: remove the three `/android-native/` lines and their comment; add `.focal-chatgpt/`.
- `grep -rn "radio-group\|scroll-area" src` → if the only hits are the two files themselves, `git rm` both. If anything imports them, leave them and say so.

**Verify**: `bun run check` → exit 0; `bun test` → 48 pass; `bun run build` → exit 0; `bun run build:desktop` → exit 0.

## Test plan

No new tests (repo rule). The four gates above are the verification.

## Done criteria

- [ ] `bun run check`, `bun test`, `bun run build`, `bun run build:desktop` all exit 0
- [ ] Both workflow files parse as YAML; `create-release` needs `verify`; no `1.3.14` remains
- [ ] The step 3 grep returns no matches
- [ ] `git status` shows changes only to in-scope files

## STOP conditions

- An excerpt above does not match the live file.
- `bun run build` or `bun run build:desktop` fails on the untouched tree (report the error; that is itself a finding).
- A fix seems to need `package.json` or `scripts/` changes.

## Maintenance notes

- A workflow change cannot be exercised locally; the first PR and the first push to `main` after merge are the real test. Watch that `create-release` is skipped when `verify` fails.
- Deferred: publishing as a draft release and un-drafting after all platform builds finish (protects against a partial `latest.json`).
