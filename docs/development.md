# Development

Focal uses one React frontend for both web and desktop. Run all commands from the repository root (there's no separate `web/` package).

## Prerequisites

Install Node.js (the version in `.node-version` matches Vite+), [Bun](https://bun.sh/) (`bun@1.4.2`), and Git. If you're working on the native desktop app, you'll also need Rust and the platform tools listed in the [Tauri setup guide](https://v2.tauri.app/start/prerequisites/). On Linux, restoring a saved desktop login also needs a running Secret Service and `secret-tool`.

```sh
git clone https://github.com/flandyw/focal.git
cd focal
bun install
cp .env.example .env.local
bun run dev
```

Open `http://localhost:5173` in your browser. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to `.env.local` if you want to test account features. Focal works locally without an account; sync and other account-backed features just need a Supabase project. Check [deployment](deployment.md) for migrations and server-only settings.

The frontend toolchain runs on [Vite+](https://viteplus.dev/), so Vite, Vitest, Oxlint, Oxfmt, and type checks all share `vite.config.ts`. Bun handles package management and runs the server and sidecar. If you have the global `vp` CLI installed, you can run `vp install`, `vp dev`, `vp run check`, `vp test`, and `vp run build:desktop`; otherwise use the Bun scripts below. `vp run check` checks both TypeScript projects, and `bun run build` runs the typecheck gate before bundling (while `vp build` only bundles).

You can format code with `bun run fmt` or check formatting with `bun run fmt:check`. It isn't a CI gate yet so existing source style stays untouched.

## Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | Starts the web dev server on port 5173. |
| `bun run dev:desktop` | Starts the desktop-mode frontend on port 1420 (without launching the native shell). |
| `bun run tauri dev` | Launches the native shell and desktop frontend, building the local ChatGPT sidecar first. |
| `bun run check` | Typechecks and lints the frontend, server, API, and scripts. |
| `bun run test` | Runs the seven existing test files with Vite+/Vitest (don't add new tests). |
| `bun run build` | Typechecks and builds the web frontend. |
| `bun run build:desktop` | Typechecks and builds the desktop frontend (without packaging a native installer). |
| `bun run tauri build` | Builds a native bundle (requires the Tauri toolchain). |
| `bun run build:chatgpt-sidecar` | Compiles the desktop ChatGPT sidecar. |
| `bun run start` | Serves the built app and API using Bun. |

Before wrapping up a change, run `bun run check`, `bun run test`, `bun run build`, and `bun run build:desktop`. The seven existing test files must keep passing, and don't add new tests. When it makes sense, try out the changed flow in the running app too.

## Repository map

| Path | What lives here |
| --- | --- |
| `src/` | Shared React UI, domain logic, local storage, and sync. |
| `src-tauri/` | Tauri shell, native integration, and sidecar lifecycle. |
| `server/`, `vendor/siwc/` | API handlers, MCP server, and local ChatGPT service. |
| `api/` | Hosted API entry points. |
| `supabase/migrations/` | Account, sync, and feature schema migrations. |
| `public/` | Browser assets and VCAA/VTAC reference datasets. |
| `vcaa/`, `vtac/` | Reference-data import scripts. |
| `docs/` | Guides and technical notes. |

A couple of handy things to keep in mind: `src/lib/class-timetable-core.ts` handles school timetable cycles, while `src/lib/timetable.ts` handles exam schedules. Keep historical `examtrack` storage keys and sync identifiers as they are, and don't remove existing SQLite data or coursework files as cleanup. Local SQLite migrations are immutable once shipped, so always add a new numbered file and register it in `src-tauri/src/lib.rs`.
