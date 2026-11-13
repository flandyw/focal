# Development

Focal has one React frontend for web and desktop. Run commands from the repository root; there is no separate `web/` package.

## Prerequisites

Install Node.js (the version in `.node-version` satisfies Vite+), [Bun](https://bun.sh/) (the repository specifies `bun@1.4.2`) and Git. Native desktop development also needs Rust and the platform prerequisites in the [Tauri setup guide](https://v2.tauri.app/start/prerequisites/). On Linux, desktop session restoration also needs an available Secret Service and `secret-tool`.

```sh
git clone https://github.com/flandyw/focal.git
cd focal
bun install
cp .env.example .env.local
bun run dev
```

The browser app runs at `http://localhost:5173`. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to `.env.local` to use account features. The app can be used locally without an account; sync and other account-backed features need a configured Supabase project. See [deployment](deployment.md) for migrations and server-only settings.

The frontend toolchain is [Vite+](https://viteplus.dev/): Vite, Vitest, Oxlint, Oxfmt, and type checks share `vite.config.ts`. Bun remains the package manager and the server/sidecar runtime. With the optional global `vp` CLI, use `vp install`, `vp dev`, `vp run check`, `vp test`, and `vp run build:desktop`; otherwise use the scripts below. `vp run check` checks both TypeScript projects. `vp build` alone bundles the frontend; `bun run build` also runs the typecheck gate.

Formatting is available with `bun run fmt` or `bun run fmt:check`. It is not a CI gate yet, to preserve the existing source style.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Web development server on port 5173. |
| `bun run dev:desktop` | Desktop-mode frontend on port 1420; does not launch the native shell. |
| `bun run tauri dev` | Native shell and desktop frontend; builds the local ChatGPT sidecar first. |
| `bun run check` | Typecheck and lint the frontend, server, API, and scripts. |
| `bun run test` | Run the seven existing test files with Vite+/Vitest; do not add new tests. |
| `bun run build` | Typecheck and build the web frontend. |
| `bun run build:desktop` | Typecheck and build the desktop frontend; does not package the native app. |
| `bun run tauri build` | Build a native bundle; requires the Tauri toolchain. |
| `bun run build:chatgpt-sidecar` | Build the desktop sidecar. |
| `bun run start` | Serve the built app and API using Bun. |

Verify changes with `bun run check`, `bun run test`, `bun run build`, and `bun run build:desktop`. The small existing test suite (seven files) must keep passing; do not add new tests. Exercise affected behavior in the app when appropriate.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/` | Shared React UI, domain logic, local storage, and sync. |
| `src-tauri/` | Tauri shell, native integration, and sidecar lifecycle. |
| `server/`, `vendor/siwc/` | API handlers, MCP server, and local ChatGPT service. |
| `api/` | Hosted API entry points. |
| `supabase/migrations/` | Account, sync, and feature schema migrations. |
| `public/` | Browser assets and reference datasets. |
| `vcaa/`, `vtac/` | Reference-data import tools. |
| `docs/` | Guides and technical references. |

`src/lib/class-timetable-core.ts` implements school timetable cycles; `src/lib/timetable.ts` handles exam scheduling. Preserve historical `examtrack` storage keys and sync identifiers. Existing SQLite data and coursework files are not cleanup targets. Local SQLite migrations are immutable after release: add a new version and register it in `src-tauri/src/lib.rs`.
