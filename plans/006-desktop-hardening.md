# Plan 006: Narrow desktop permissions, CSP and sidecar origins

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If a STOP condition occurs, stop and report; do
> not improvise. Do NOT edit `plans/README.md`; the reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 67a4c42..HEAD -- src-tauri/capabilities src-tauri/tauri.conf.json server/local.ts src/lib/desktop.ts`
> If anything changed, compare the excerpts below with the live code; a mismatch is a STOP condition.

## Status

- **Priority**: P2 · **Effort**: S · **Risk**: LOW-MED · **Depends on**: none · **Category**: security
- **Planned at**: commit `67a4c42`, 2026-11-10

## Why this matters

The desktop app grants its window more than it uses: it may open any file under the user's home
directory with the system handler, watch the whole home directory, and connect to any HTTPS host
and any localhost port. The bundled sidecar (a local HTTP server on `127.0.0.1:41731` that holds
the ChatGPT sign-in and encrypts the saved Supabase session) trusts the dev-server origin
`http://localhost:1420` even in release builds, so any local page served on that port can use it.
None of this is exploitable alone, but each turns a future script-injection bug into something worse.

## Current state

`src-tauri/capabilities/default.json` (permissions array, abridged):

```json
    { "identifier": "opener:allow-open-path", "allow": [ { "path": "$HOME/**" } ] },
    "opener:allow-open-url",
    "opener:allow-default-urls",
    "dialog:default",
    "fs:allow-download-meta",
    "fs:allow-write-file",
    "fs:scope-download",
    "fs:allow-appdata-read-recursive",
    "fs:allow-appdata-write-recursive",
    { "identifier": "fs:allow-watch", "allow": [ { "path": "$HOME/**" } ] },
```

Uses in the frontend (`grep -rn "openPath\|plugin-fs\|watch" src`): `src/lib/desktop.ts:5-6` imports
`writeFile` and `openPath, openUrl`; `src/lib/storage/database.ts:3` imports `exists, readTextFile`.
Nothing calls `watch`. `openPath` is used once:

```ts
// src/lib/desktop.ts:42
  examHost.report = async (html) => {
    const path = await save({ defaultPath: "exam-progress.html", filters: [{ name: "HTML report", extensions: ["html"] }] })
    if (!path) return
    await writeFile(path, new TextEncoder().encode(html))
    await openPath(path)
  }
```

`src-tauri/tauri.conf.json:25` (the file contains `//` comments; edit it as text, never round-trip through a JSON parser):

```
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data: blob: https://*.supabase.co; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://*.supabase.co wss://*.supabase.co https://openrouter.ai https:"
```

`server/local.ts:9-14`:

```ts
const ALLOWED_ORIGINS = [
  "http://localhost:1420",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
]
```

and at the bottom `if (process.env.FOCAL_CHATGPT_MANAGED === "1") { ... }`: Tauri sets that variable
when it launches the sidecar (see `src-tauri/src/commands/chatgpt.rs`). Check there whether
`tauri dev` also sets it: the dev window is served from `http://localhost:1420` and must keep working.

Repo rules: minimal code, no new tests, `vendor/siwc` is not to be edited.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (fresh worktree) | `bun install --frozen-lockfile` | exit 0 |
| Typecheck + lint | `bun run check` | exit 0 (2 known warnings in `toggle.tsx`, `friends-page.tsx`) |
| Tests | `bun test` | 48 pass, 0 fail |
| Desktop frontend build | `bun run build:desktop` | exit 0 |
| Sidecar build | `bun run build:chatgpt-sidecar` | exit 0 (skip and say so if the target triple cannot be built here) |

A native `tauri build` is not expected in this environment; say so in the report.

## Scope

**In scope**: `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json` (the `csp` string only), `server/local.ts`, `src/lib/desktop.ts` (only if step 1 needs it).

**Out of scope**: `vendor/siwc/**`, `server/chatgpt.ts`, `src-tauri/src/**` (read only), updater config, `src-tauri/gen/**`.

## Git workflow

Commit in your worktree, one commit per step; plain imperative sentence messages. Do not push.

## Steps

### Step 1: capabilities

- Remove the whole `fs:allow-watch` object (confirm first that `grep -rn "watch(" src | grep -v "swatch\|stopwatch"` finds no plugin-fs watch call).
- Narrow `opener:allow-open-path` to HTML files: `"allow": [ { "path": "$HOME/**/*.html" } ]`. Tauri 2 scope `path` entries are glob patterns (the existing `$HOME/**` is itself one), so apply this without further confirmation; `src-tauri/gen/schemas/` is a build artifact and is absent in a fresh checkout, which is expected. Note in the report that the packaged app must be checked once (open the HTML progress report).

**Verify**: `bun -e "const c=JSON.parse(require('fs').readFileSync('src-tauri/capabilities/default.json','utf8')); if(JSON.stringify(c).includes('allow-watch')) process.exit(1)"` → exit 0.

### Step 2: sidecar origin

In `server/local.ts`, include `"http://localhost:1420"` in `ALLOWED_ORIGINS` only when the sidecar is
not the managed release process. Determine from `src-tauri/src/commands/chatgpt.rs` how dev and
release launches differ:
- if `FOCAL_CHATGPT_MANAGED=1` is set only for packaged runs, gate on it;
- if it is set in `tauri dev` too, gate on a build-time signal instead: `scripts/build-chatgpt-sidecar.ts` compiles the sidecar, and `tauri dev` vs `tauri build` may not differ there either. In that case skip this step, report what distinguishes the two, and continue with step 3, rather than breaking `tauri dev`.

**Verify**: `bun run check` → exit 0; `bun run build:chatgpt-sidecar` → exit 0 (or reported as not runnable).

### Step 3: CSP `connect-src`

- Replace `http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*` with the sidecar port only: `http://localhost:41731 http://127.0.0.1:41731`. Before doing so, check whether `tauri dev` uses this same `csp` (look for `devCsp` in `tauri.conf.json`; Vite HMR needs `ws://localhost:1420`). If there is no `devCsp`, add `"devCsp"` with the current (wide) string so dev keeps working and only the packaged app is narrowed.
- The trailing `https:` allows every HTTPS host. Enumerate what the desktop webview really fetches: `grep -rnE "fetch\(|new URL\(|https://" src --include=*.ts --include=*.tsx | grep -v "^src/components/ui"` and read `src/lib/host.ts`, `src/lib/gateway-client.ts` (or wherever `VITE_CHAT_API_URL` is read). If every remote host is fixed (Supabase, OpenRouter, a known chat API origin), list them and drop `https:`. If any host is configured at build time or by the user (`VITE_CHAT_API_URL` is build-time and unknown here), keep `https:` and report that this part was not narrowed and why.

**Verify**: `bun run build:desktop` → exit 0; `grep -c "localhost:\*" src-tauri/tauri.conf.json` → 0 or only inside `devCsp`.

## Test plan

No new tests (repo rule).

## Done criteria

- [ ] `bun run check`, `bun test`, `bun run build:desktop` exit 0
- [ ] `fs:allow-watch` is gone from the capability file
- [ ] `git status` shows only in-scope files
- [ ] Report lists which narrowing was applied and which was left, with the reason

## STOP conditions

- The live files differ in substance from the excerpts (the excerpts are abridged; formatting and comment differences do not count).

Not a STOP condition: if one narrowing in steps 2 or 3 cannot be shown safe from the code (dev
window, sidecar reachability, chat backend), leave that single item unchanged, record why in the
report, and carry on with the remaining items and steps. A working app beats a tighter policy.

## Maintenance notes

- None of this can be exercised without a packaged build: before release, the maintainer should run the packaged app and check sign-in, ChatGPT chat, worksheet PDF export, the HTML progress report opening, and Supabase sync.
- If a per-launch secret for the sidecar is wanted later, Tauri can pass a random token in the sidecar's environment and the webview can read it through a command; deferred.
