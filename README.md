<div align="center">

![Focal](./banner.png)

# Focal

## ExamTrack integration

Focal includes a first-class ExamTrack workspace with practice summaries, due-mistake counts, secure drill-through to the hosted app, and an action that schedules a targeted review session in Focal.

ExamTrack exam and SAC timers also mirror their lifecycle into Focal. Starting one creates an in-progress study session, pause/resume preserves exact active intervals, completion feeds normal Focal analytics, and discard removes the mirrored session. While ExamTrack owns a timer, Focal shows it in the study-timer slot and prevents a second local timer from starting.

The two apps intentionally keep separate Supabase projects. Each app holds a second, explicitly connected session for the other app's database:

1. Apply Focal migrations only to the Focal project and ExamTrack migrations only to the ExamTrack project.
2. Set Focal's `VITE_EXAMTRACK_URL`, `VITE_EXAMTRACK_SUPABASE_URL`, and `VITE_EXAMTRACK_SUPABASE_PUBLISHABLE_KEY` for the hosted ExamTrack app/project.
3. Set ExamTrack's `VITE_FOCAL_SUPABASE_URL` and `VITE_FOCAL_SUPABASE_PUBLISHABLE_KEY` for the Focal project.
4. Connect the separate account from each app's ExamTrack/Focal integration screen.

Focal queries `attempts` and `mistakes` using the connected ExamTrack user's short-lived session. ExamTrack publishes timer transitions using the connected Focal user's short-lived session. Each database's row-level-security policies enforce ownership, and the production integration rejects non-HTTPS endpoints. Never use a Supabase service-role key in either client.

**A fast, minimal desktop study organiser for VCE students.**

Manage coursework files, plan sessions around a configurable timetable, and track progress across subjects — all from a native desktop app.

[![Release](https://img.shields.io/github/v/release/flandolf/focal?style=flat-square&color=171717)](https://github.com/flandolf/focal/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/flandolf/focal/verify.yml?branch=main&style=flat-square&color=171717&label=build)](https://github.com/flandolf/focal/actions)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-171717?style=flat-square)](https://github.com/flandolf/focal/releases)
[![Stack](https://img.shields.io/badge/stack-Tauri%202%20%7C%20React%2019-171717?style=flat-square)](https://github.com/flandolf/focal)

</div>

---

## Features

### Library

- **Project management** — group coursework by subject, unit (1–4), and deadline type (`SAC`, `Exam`, `Assignment`). Each project owns a folder on disk with the subject's default subfolders (SACs / Notes / Past-Papers / Exam-Revision / Resources).
- **Project templates** — save assessment scaffolds with custom icons, subfolders, and checklists to spin up new projects in a click.
- **File organisation** — drag-and-drop into project folders (or paste `file://` URLs), bulk tag, rename, move between subfolders, copy paths, undo toast.
- **Checklists & dependencies** track subtasks per assessment and surface what blocks what in Today.

### Plan

- **Timetable** — configurable cycle length (default 10-day VCE rotation), per-day period editing with subjects / locations / breaks, school holidays, weekend support, manual day override.
- **Calendar** — month / week grid, multi-day events, drag-to-reschedule, batch select / complete / merge / delete, study priorities, prep balance, month brief.
- **Repeat next week** — duplicate an event or plan a study session one week later while preserving its local time and clearing completion state.
- **Deadline notifications** — in-app toasts plus optional native OS notifications at *due now*, *today*, *tomorrow*, and *soon* (≤72 hours).
- **Text to Events** — paste a teacher notice or rough plan; the AI extracts draft calendar events you can review and approve.
- **Adaptive planner** — estimate assessment effort, preview a conflict-free seven-day plan around classes and existing calendar items, then approve the generated study blocks. Capacity gaps remain visible instead of being overbooked.
- **Academic inbox** — collect downloaded files and teacher notes, review suggested assessment destinations, then copy or attach them without losing the originals.

### Focus & Review

- **Customisable Pomodoro** — work / break / long-break durations, full-screen Focus view, recovery dialog on reopen, overtime study mode, post-session reflection (confidence 1–5, blockers, next-action).
- **VCE prep packs** — add type-specific SAC, exam, or assignment preparation steps to an assessment, with checklist progress, completed study time, deadline countdown, and latest confidence in one place.
- **Results and topic mastery** — record marks, feedback, and topic evidence so weak areas can influence the next adaptive plan.
- **Study from files** — generate source-bound active-recall cards from readable project files and review them on a lightweight spaced schedule.
- **AI Auto Rename** proposes consistent, descriptive filenames for dumped files (optionally using file-content snippets as context).
- **Analytics** — total time, daily average, streak, study-time trend, subject breakdown, completion rate, efficiency, time-of-day, and consistency heatmap across 7d / 30d / 3mo / 1yr / All.
- **Global search** (⌘K / Ctrl K) and a dense keyboard-shortcut layer everywhere.
- **Shortcut guide** — press `?`, use the title-bar help button, or open it from global search to see every keyboard command.

### Sync

- **Supabase multi-device sync** — optional account-driven sync through an idempotent change log, durable local outbox, and realtime updates.
- **Notion sync** — optional two-way sync keyed by stable Focal IDs, with automatic duplicate-page repair.
- **Data export** — portable JSON backup/restore for assessments, sessions, and events, CSV export, plus privacy-safe diagnostics.

---

## Tech Stack

| Layer | Tools |
| --- | --- |
| Frontend | React 19 · TypeScript (strict) · Tailwind v4 · Radix primitives · Recharts · Framer Motion · Sonner · `lucide-react` · `react-day-picker` · `date-fns` |
| Desktop shell | Tauri v2 (Rust) — SQLite local database · device-only credential storage · filesystem watcher · dialogs · notifications · updater |
| Type & colour | Sora Variable (display) · Geist (UI) · single-accent palette, dark and light modes equally considered |
| AI | OpenRouter, local Ollama, or Login with ChatGPT, with structured output (Auto Rename, Text-to-Events) |
| Cloud | Optional Supabase Auth + a compacted Postgres change log + Realtime, backed by a durable SQLite outbox. Notion rows carry stable Focal identity fields. |

---

## Development

```bash
bun install
bun run dev          # Vite dev server on port 1420
bun run tauri dev    # Full Tauri desktop app in dev mode
```

```bash
bun run check        # types + lint + every logic self-check
bun run typecheck    # tsc --noEmit
bun run lint         # oxlint
bun run lint:fix     # oxlint auto-fix
```

Focused self-checks live in `scripts/` and are collected by `bun run test:logic`. Adding a new AI provider is documented in [`PROVIDERS.md`](./PROVIDERS.md).

Local SQLite migrations are immutable after release. Do not edit `src-tauri/migrations/0001_local_database.sql`; add version 2 or later and register it in `src-tauri/src/lib.rs`.

---

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| ⌘K / Ctrl K | Global search |
| ⌘N / Ctrl N | New assessment |
| ⌘⇧N | New calendar event |
| ⌘⇧S | New study session |
| ⌘+ / ⌘− / ⌘0 | Zoom in / out / reset |
| H | Go to Home (Today) |
| T | Go to Plan |
| A | Go to Review |
| `[` | Toggle sidebar (outside input fields) |
| `?` | Show keyboard shortcuts |
| 1–7 | Jump to Settings sections |

Single-key shortcuts (H, T, A, I, `[`, `/`, and `?`) fire only when no input has focus.

---

## Supabase Sync Setup

Focal works locally without signing in. To enable multi-device sync:

1. Create a Supabase project.
2. Apply every file in `supabase/migrations/` in numeric order (or run them with the Supabase CLI).
3. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Confirm `sync_changes` is in the `supabase_realtime` publication. Migration `0004` rebuilds the old per-table schema; `0005` removes the legacy helpers and verifies RLS, grants, triggers, and Realtime membership.
5. Run `bun run dev` or `bun run tauri dev`, then sign in from Settings → Account.

Do not put a Supabase service-role or secret key in `.env` — the desktop client only uses the publishable key. Notion is a separate, optional calendar integration; enable it from Settings → Notion Sync after creating an integration token.

### Login with ChatGPT

Focal uses `@opencoredev/loginwithchatgpt-*` through a local Bun sidecar by default. The sidecar is compiled and bundled by `bun run tauri dev` / `bun run tauri build`, listens only on `localhost:41731`, and persists its encrypted session store under Focal's app-data directory. The ChatGPT model picker is populated from the signed-in account and uses a current Codex client version so newer account models can be returned; no OpenAI API key is used. A hosted handler remains supported by setting `VITE_CHATGPT_BASE_PATH` to its `/api/chatgpt` URL before building and configuring its `LWC_SECRET`, `LWC_CLIENT_VERSION`, allowed origins, and shared session store.

---

## Production Build

```bash
bun run build     # tsc + Vite production build
make build        # Lint-fix, version bump, Tauri compile, install to /Applications (macOS)
```

`make` targets: `dev` · `tauri-dev` · `build` · `build-only` · `install` · `lint` · `lint-fix` · `typecheck` · `check` · `clean` · `distclean` · `format` · `bump-version` · `release` · `release-dry-run`. Pull requests and `main` are verified without publishing. A matching `app-v<version>` tag ships native bundles for macOS (arm64 + x86_64), Linux, and Windows; built `.app` files land in `src-tauri/target/release/bundle/macos/`.

The release workflow also signs updater artifacts and uploads `latest.json` for Tauri's updater. Keep `TAURI_SIGNING_PRIVATE_KEY` set in GitHub Actions secrets; published GitHub releases are what installed apps check for updates.

---

## Assessment Types

VCE ships three: `sac`, `exam`, `assignment`. Calendar events extend with `homework`, `event`, `other`, and `practice-sac`. Add a new deadline type in `src/lib/types.ts` if your school needs one (e.g. `GAT`).
