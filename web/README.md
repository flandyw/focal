# ExamTrack

## One Supabase project

ExamTrack and Focal share Focal's Supabase project. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLABLE_KEY` point at it, and `attempts`, `mistakes` and `user_state` are three of its tables, created by `focal/supabase/migrations/0010_examtrack_data.sql`. Apply the migrations from the repository root, not from here:

```bash
cd ..
supabase db push
```

There is no second project and no second sign-in. The `FocalTimerLink` mirror, the `activeExamTimerUpdatedAt` conflict resolution and `src/lib/focal-supabase.ts` are what remain of the old cross-project arrangement, and they are removed in the canonical session rewrite. Until then `VITE_FOCAL_SUPABASE_URL` and `VITE_FOCAL_SUPABASE_PUBLABLE_KEY` still drive the mirror and must still be set on the Vercel deployment. No service-role key is exposed by either client.

A local-first VCE practice exam tracker built with React, Vite, shadcn/ui, Recharts, and KaTeX.

## Development

```bash
bun install
$env:LWC_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
bun run dev
```

## Supabase

1. Use the Focal Supabase project. Run every SQL file in `focal/supabase/migrations` in numeric order.
2. Copy `.env.example` to `.env.local` and add that project's URL and publishable key from the Connect dialog.
3. In Authentication → Providers → Email, disable **Confirm email** for password-only signup without callbacks.
4. To move existing data across from the old ExamTrack project, run `scripts/examtrack-merge.mjs` from the repository root. See `docs/examtrack-merge.md`.

Attempts, mistakes, review history, question-level results, timing evidence, and tracked official exams stay available in local storage and sync after email/password sign-in. Never put a secret or service-role key in the Vite environment variables.

Mistake cards use a due-card study queue with Again, Hard, Good, and Easy ratings. Scheduling state is stored inside each mistake's synced JSON payload, so the feature does not require an additional database migration.

Student data stays in browser storage. Use the app menu to export or import a validated JSON backup.
Mistake photos sent to ChatGPT pass through the local server and are not saved by ExamTrack.

For a production build, set a stable `LWC_SECRET`, then run `bun run build` followed by `bun run start`. The default in-memory ChatGPT session store logs users out when the server restarts; configure the SDK's shared `sessionStore` for multi-instance or durable deployments.

## Vercel

Import the Focal repository into Vercel with the root directory set to `web`, add a stable `LWC_SECRET`, and connect an Upstash Redis database from the Vercel Marketplace. ExamTrack accepts either `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` or Vercel's `KV_REST_API_URL` + writable `KV_REST_API_TOKEN`; Vercel deployments fail fast without durable session storage. Redeploy after adding the variables.

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
