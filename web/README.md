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

AI features are desktop-only: the desktop app runs the official Sign in with ChatGPT DevKit (vendored in `../vendor/siwc`) in a local sidecar (`../server`). The standalone web app has none.

## Vercel

The hosted web app has no AI features: ChatGPT sign-in, autofill, bulk edit, insights, alternatives, photo import and session planning exist only in the desktop app. Mistakes can still be imported from a chatbot by pasting its JSON.

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
