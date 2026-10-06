# Focal

## One Supabase project

This web app and the Focal desktop app share Focal's Supabase project. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLABLE_KEY` point at it, and `attempts`, `mistakes` and `user_state` are three of its tables, created by `focal/supabase/migrations/0010_examtrack_data.sql`. Apply the migrations from the repository root, not from here:

```bash
cd ..
supabase db push
```

There is no second project and no second sign-in. The second Supabase client, the separate-account settings card and the `VITE_FOCAL_SUPABASE_*` variables are gone; `web/` writes with the same client as the rest of the app.

Study sessions use one shared `study_sessions` table through `study_session_mutate` and `sync_read_changes`. Desktop and web write the same rows, and both calendars read them. Actual study intervals live in each row's `segments` JSON array; migration `0018` preserves existing intervals and removes the old interval table and RPC wrappers. Timer commands retain monotonic elapsed deltas and server-clock estimates. Ordinary Focal Web records continue through the generic cursor/change protocol.

A local-first VCE practice exam tracker built with React, Vite, shadcn/ui, Recharts, and KaTeX.

## Development

```bash
bun install
bun run dev
```

## Supabase

1. Use the Focal Supabase project. Run every SQL file in `focal/supabase/migrations` in numeric order.
2. Copy `.env.example` to `.env.local` and add that project's URL and publishable key from the Connect dialog.
3. In Authentication → Providers → Email, disable **Confirm email** for password-only signup without callbacks.
4. To move existing data across from the old standalone ExamTrack project, run `scripts/examtrack-merge.mjs` from the repository root. See `docs/examtrack-merge.md`.

Attempts, mistakes, review history, question-level results, timing evidence, and tracked official exams stay available in local storage and sync after email/password sign-in. Never put a secret or service-role key in the Vite environment variables.

Mistake cards use a due-card study queue with Again, Hard, Good, and Easy ratings. Scheduling state is stored inside each mistake's synced JSON payload, so the feature does not require an additional database migration.

Student data stays in browser storage. Use the app menu to export or import a validated JSON backup.
Mistake photos sent to ChatGPT pass through the local server and are not saved by Focal.

Sign in with ChatGPT (the OpenAI DevKit, vendored in `../vendor/siwc`) runs only in a local server on your own computer: `bun run dev`, or `bun run build` then `bun run start`. Credentials are encrypted with a key held in the OS credential store (macOS Keychain, Linux Secret Service via `secret-tool`, Windows DPAPI) under `~/.focal` (override with `FOCAL_DATA_DIR`). The sign-in callback uses `127.0.0.1:8787` (`FOCAL_CHATGPT_REDIRECT_PORT`). Run `bun install` in the repository root too, since the DevKit's dependencies live there.

## Vercel

The hosted deployment serves the app without ChatGPT: Sign in with ChatGPT only works when Focal runs on the user's own machine, so the ChatGPT cards explain that instead of connecting.

## Checks

```bash
bun test
bun run lint
bun run build
```

## VCAA reference data

`public/vcaa-grade-distributions.json` contains official 2021–2025 examination grade distributions. Regenerate it from the VCAA pages with:

```bash
bun run vcaa:import
```

`public/vcaa-exam-resources.json` contains official examination papers, specifications, samples, assessment guides, and external assessment reports. Refresh it with:

```bash
bun run vcaa:resources
```

`public/vtac-scaling-reports.json` contains the official 2021–2025 VTAC scaling tables. Regenerate it directly from the published PDFs with:

```bash
bun run vtac:import
```

The importer uses PDF.js and does not require Poppler or `pdftotext`.
