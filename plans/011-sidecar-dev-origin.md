# Plan 011: Trust the dev-server origin in the sidecar only in dev builds

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If a STOP condition occurs, stop and report; do
> not improvise. Do NOT edit `plans/README.md`; the reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 67a4c42..HEAD -- server/local.ts src-tauri/src/commands/chatgpt.rs`
> The excerpts below are abridged; they match when the logic is the same.

## Status

- **Priority**: P2 · **Effort**: S · **Risk**: LOW · **Depends on**: none (follow-up to plan 006) · **Category**: security
- **Planned at**: commit `67a4c42`, 2026-11-10

## Why this matters

The desktop app starts a local HTTP sidecar on `127.0.0.1:41731` that holds the user's ChatGPT
sign-in and encrypts the saved Supabase session. Its only access control is an allow-list of
request origins, and that list always contains `http://localhost:1420`, the Vite dev-server
address, even in the packaged app. Any other local page served on port 1420 can therefore use the
sidecar of an installed, released Focal. Plan 006 could not fix this because dev and release
launches look identical to the sidecar; the launcher has to tell it.

## Current state

`server/local.ts:9-14`:

```ts
const ALLOWED_ORIGINS = [
  "http://localhost:1420",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
]
```

`ALLOWED_ORIGINS` is passed to `createChatGPTService({ storageDir, allowedOrigins: ALLOWED_ORIGINS })`
and used for the `/api/mistakes-pdf` origin check in the same file. The sidecar can also be run by
hand without Tauri (`bun server/local.ts`), in which case `FOCAL_CHATGPT_MANAGED` is unset.

`src-tauri/src/commands/chatgpt.rs:60-67`, the only place Tauri launches it (dev and release alike):

```rust
    let (mut events, child) = app
        .shell()
        .sidecar("focal-chatgpt")
        .map_err(|error| format!("could not configure ChatGPT sidecar: {error}"))?
        .env("FOCAL_CHATGPT_DATA_DIR", data_directory)
        .env("FOCAL_CHATGPT_MANAGED", "1")
        .spawn()
```

The crate already distinguishes dev from release with `cfg!(debug_assertions)` (see
`src-tauri/src/commands/widgets.rs:66`). `tauri dev` builds with debug assertions; `tauri build` does not.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (fresh worktree) | `bun install --frozen-lockfile` | exit 0 |
| Typecheck + lint | `bun run check` | exit 0 (2 known warnings in `toggle.tsx`, `friends-page.tsx`) |
| Tests | `bun test` | 48 pass, 0 fail |
| Sidecar build | `bun run build:chatgpt-sidecar` | exit 0 |
| Rust check | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0; needs the sidecar binary from the previous row and, on Linux, the WebKitGTK dev packages. If it fails for missing system libraries, say so and rely on review of the one-line change. |

## Scope

**In scope**: `server/local.ts`, `src-tauri/src/commands/chatgpt.rs`.

**Out of scope**: `vendor/siwc/**`, `server/chatgpt.ts`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/**` (plan 006 already changed those on another branch), any other Rust file.

## Git workflow

Commit in your worktree; plain imperative sentence message. Do not push.

## Steps

### Step 1: the launcher says when it is a dev build

In `chatgpt.rs`, add one more `.env(...)` to the chain: `FOCAL_CHATGPT_DEV` set to `"1"` when
`cfg!(debug_assertions)` and `"0"` otherwise.

### Step 2: the sidecar trusts port 1420 only then

In `server/local.ts`, include `"http://localhost:1420"` in `ALLOWED_ORIGINS` only when the sidecar
is unmanaged (`process.env.FOCAL_CHATGPT_MANAGED !== "1"`, i.e. run by hand by a developer) or
`process.env.FOCAL_CHATGPT_DEV === "1"`. Keep the other three origins unconditionally. One short
comment explaining why.

**Verify**: `bun run check` → exit 0; `bun test` → 48 pass; `bun run build:chatgpt-sidecar` → exit 0;
`cargo check --manifest-path src-tauri/Cargo.toml` → exit 0 or reported as not runnable with the reason.
Then, from the repo root, confirm the behaviour without starting Tauri (port 41799 is arbitrary; use a temp data dir):

```sh
D=$(mktemp -d)
FOCAL_CHATGPT_PORT=41799 FOCAL_CHATGPT_DATA_DIR=$D FOCAL_CHATGPT_MANAGED=1 FOCAL_CHATGPT_DEV=0 bun server/local.ts </dev/zero & P=$!; sleep 2
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS -H "Origin: http://localhost:1420" http://127.0.0.1:41799/api/mistakes-pdf   # expect 403
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS -H "Origin: tauri://localhost" http://127.0.0.1:41799/api/mistakes-pdf       # expect 204
kill $P
```

(The managed sidecar exits when stdin closes, hence `</dev/zero`. If the OS keychain is needed at
startup and unavailable here so the server cannot start, report that and skip this check.)

## Test plan

No new tests (repo rule).

## Done criteria

- [ ] `bun run check`, `bun test`, `bun run build:chatgpt-sidecar` exit 0
- [ ] The curl check prints 403 then 204, or is reported as not runnable with the reason
- [ ] `git status` shows only the two in-scope files

## STOP conditions

- The sidecar is launched from anywhere else (`grep -rn "focal-chatgpt" src-tauri/src scripts | grep -v "^src-tauri/src/commands/chatgpt.rs"` shows another spawn).
- `tauri dev` does not build with debug assertions in this project (check `src-tauri/Cargo.toml` profiles for `debug-assertions = false` under `[profile.dev]`).

## Maintenance notes

- Before release, run `bun run tauri dev` once and confirm ChatGPT sign-in still works in the dev window, and the packaged app once.
- A per-launch secret header would be stronger than origin checks; deferred.
