# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Focal is a VCE study app: practice exams, mistakes, calendar, study timer, progress. It ships as a browser app, a Tauri desktop app, and a separate native Android app. `AGENTS.md` sets the working style (minimal code) and **forbids writing tests**.

## Commands

Bun workspace (`web` is the only workspace member); run `bun install` at the root.

```sh
bun run dev                  # desktop frontend, port 1420 (vite.config.ts at root wraps web/)
bun run tauri dev            # desktop shell + local ChatGPT sidecar + frontend
bun run --cwd web dev        # browser frontend (no AI)
bun run check                # typecheck + lint (CI gate); `make check` is the same
bun run typecheck            # tsc for root, tsconfig.node.json, and web/tsconfig.app.json
bun run lint[:fix]           # oxlint src web/src scripts
bun run build                # typecheck + desktop vite build into dist/
bun run --cwd web build      # tsc -b + browser build (what verify-web CI runs, along with `bun run lint` in web/)
cd android-native && ./gradlew :app:assembleDebug
```

There is no test suite. Verify with typecheck, lint, builds, or running the app. `make build` bumps the version, commits, and installs a macOS `.app`; don't run it casually.

## Architecture

**One frontend, two hosts.** `web/src` is the only UI. The root `vite.config.ts` merges `web/vite.config.ts` with `root: "web"` and defines `VITE_EMBEDDED_EXAMS=true`, which is what turns the desktop build into the "embedded" variant (`AI_ENABLED` in `web/src/lib/host.ts`). Native behaviour is injected through the mutable `examHost` object in `web/src/lib/host.ts`; `web/src/lib/desktop.ts` fills it in (save dialogs, local SQLite study history, Supabase session storage) only when `isTauri()`. Keep Tauri imports out of the browser path.

**Root `src/` is shared contracts, not an app.** It holds `types.ts`, `lib/sync/sessionContract.ts` (the study-session DTO/validator imported by both root and `web/`, and mirrored by Android/Folio), `lib/storage/*` (SQLite via `@tauri-apps/plugin-sql`), the Supabase client, and `PastStudyForm`. `web/` imports it via relative paths like `../../../src/...`. The `@` alias maps to each package's own `src`. React is deduped to web's copy.

**Local AI sidecar.** Desktop AI uses Sign in with ChatGPT: `vendor/siwc` (vendored upstream, don't edit casually) + `server/` (`local.ts` is a Bun HTTP server on `127.0.0.1:41731`, `chatgpt.ts`, `keystore.ts`). `scripts/build-chatgpt-sidecar.ts` compiles it with `bun build --compile` into `src-tauri/binaries/focal-chatgpt-<triple>`, and Tauri launches it as an `externalBin` (`src-tauri/src/commands/chatgpt.rs`). `tauri dev/build` hooks run this build automatically. The server also hosts `/api/mistakes-pdf` (shared handler in `web/server/mistakes-pdf.ts`, also exposed via a Vite dev plugin and `web/api/` for Vercel). The browser build has no AI.

**Sync.** Desktop, web, Android, and the sibling app Folio share one Supabase project (`supabase/migrations`, apply from repo root with `supabase db push`). Two protocols:
- Generic cursor change feed (`sync_read_changes`) for ordinary records (attempts, mistakes, user_state, events…); realtime is only a wakeup.
- Study sessions are a separate transactional protocol: one `study_sessions` table with intervals in a `segments` JSON array, mutated only via `study_session_mutate` with a `mutation_id`, `device_id`, and `expected_revision`. Never write sessions through `sync_apply_changes`.

Read `docs/sync-protocol.md` before touching either. Historical `examtrack` storage keys and protocol identifiers are intentionally unchanged for saved-data compatibility; don't rename them.

**Desktop local DB.** SQLite migrations in `src-tauri/migrations/` are immutable once released. Add a new numbered file and register it in `database_migrations()` in `src-tauri/src/lib.rs` (migration 1 has a Windows checksum quirk; see the comment there). Old desktop assessment/project data is retained but no longer surfaced; Progress reads local-only history without rewriting it.

**Android** (`android-native/`) is an independent Kotlin/Compose app with its own SQLite, outbox, and Notion sync; it reads Supabase config from the root `.env`. It implements the same session protocol (`CanonicalSessionProtocol.kt`).

## Conventions and gotchas

- Env: `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` in the root `.env` (desktop) or `web/.env.local` (web). Never a service-role key in the frontend.
- `web/tsconfig.app.json` is strict about unused locals/params and `erasableSyntaxOnly` (no enums or parameter properties) — stricter than root `tsconfig.json`.
- Design direction (`PRODUCT.md`, `web/DESIGN.md`): precise, minimal, utilitarian; single blue accent; light and dark equally polished; no gradient text, side-stripes, or glassmorphism. `.impeccable.md` is an older, partly stale design brief (describes a file-management app).
- Stale docs: `PROVIDERS.md` describes an OpenRouter/Ollama provider layer that no longer exists (`src/lib/providers` is gone), and `docs/architecture-simplification.md` is a plan for the removed desktop calendar/App.tsx. Trust the code over them.
