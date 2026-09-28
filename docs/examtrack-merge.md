# Merging the ExamTrack project into the Focal project

ExamTrack and Focal had their own Supabase projects only because the study timer had to
cross a project boundary. With one project, ExamTrack's data becomes three more tables in
Focal's database, the second Supabase client in each app goes away, and the timer stops
being mirrored.

ExamTrack also moved into this repository, at `web/`, keeping its own `package.json`,
`bun.lock`, `bun test` suite and Vercel deployment. It is a self-contained app rather than
a route in `src/`: merging the two `src/` trees would have collided on seventeen paths,
ten of them shadcn/ui components that have genuinely diverged (Focal is on `radix-ui`,
ExamTrack on `@base-ui/react` + `cmdk`), plus `lib/timetable.ts`, where both apps model
timetables differently. Deduplicating those is its own piece of work.

There is one user, so the identity mapping is a single pair of uids and the merge is a
one-shot export/import rather than a migration that has to be resumable per account.

## What moves

| From ExamTrack's project | To Focal's project | How |
| --- | --- | --- |
| `attempts` | `attempts` | new table, identical shape |
| `mistakes` | `mistakes` | new table, identical shape |
| `user_state` | `user_state` | new table, identical shape |
| `mistake-attachments` bucket | `mistake-attachments` bucket | new bucket, objects re-uploaded under the new uid folder |
| `auth.users` row | the existing Focal account | you sign in again; nothing to copy |
| `sync_log` / `sync_state` rows | *not copied* | see below |

Migration `0010_examtrack_data.sql` creates the three tables, their RLS policies, grants
and the storage bucket with its policies. The column shapes are copied verbatim from
ExamTrack's migrations, so neither client needs a data-layer change.

**ExamTrack's change-log rows are deliberately not copied.** In ExamTrack's project the
three tables feed `sync_log` through `sync_log_row_change`, because Folio used to read
mistakes through the log. It does not any more: `ExamTrackSyncService` reads and patches
the `mistakes` table directly, and `syncAppData` in ExamTrack reads `attempts`, `mistakes`
and `user_state` directly. Copying those log rows would add a lamport-ordered second copy
of every write to a database that no longer has two projects to reconcile, and would make
the import append thousands of log entries for data that is already in the tables. The
migration asserts the log is clean for those three entities before it will run.

## Running the merge

```bash
cd focal
node scripts/examtrack-merge.mjs export --out ../examtrack-export \
  --url <examtrack project url> --token <examtrack access token>
```

Get the access token by signing in to ExamTrack, opening DevTools → Application → Local
Storage → `sb-<project-ref>-auth-token` → `access_token`. The script authenticates as you,
so RLS applies and no service-role key is used or accepted.

Apply the migration, then:

```bash
node scripts/examtrack-merge.mjs import --in ../examtrack-export --to-user <focal auth uid> \
  --url <focal project url> --token <focal access token>
```

The import refuses to run if `--to-user` is not the account the token belongs to, copies
`updated_at` verbatim, keeps tombstones, rewrites the attachment folder prefix from the
old uid to the new one, and reads every table back afterwards so a partial import cannot
look like a successful one. It is idempotent: running it twice writes the same rows.

`updated_at` is never bumped. ExamTrack and Folio resolve `attempts` and `mistakes` by
comparing that timestamp, so a fresh value would make an old row look newer than the local
copy, and the merge would appear to work while silently discarding local edits.

## Repointing the clients

Done: each app now uses one normal Supabase client. What changed is listed in the two
commits titled "Point … at the one Supabase client" and "Settle web/ into the Focal
repository". `FocalTimerLink` and the outbox remain, for the reason in the last section.

**Focal** — `src/lib/examtrack-client.ts` and the `focal-examtrack-auth-session` credential
are deleted. `ExamTrackView` takes the account from `App`, the same way `SettingsView`
does, instead of opening its own auth subscription, and its second sign-in form is now a
prompt to sign in under Settings. `VITE_EXAMTRACK_SUPABASE_*` is gone from `.env.example`,
`vite-env.d.ts` and both workflows. `VITE_EXAMTRACK_URL` stays: it is the drill-through
link, not a database.

**ExamTrack** — `web/src/lib/focal-supabase.ts` and `web/src/hooks/use-focal-account.ts`
are deleted, along with the "Focal timer connection" card in settings.
`SharedStudySessions` takes a `userId` prop instead of subscribing to a second auth
session. `focal-timer.ts` publishes through the shared client. The timer state in
`user_state` (`activeExamTimer`, `activeSacTimer`) is untouched, so this step is safe on
its own.

**Folio** — still to do. `ExamTrackAuthRepository.kt` builds a client from
`BuildConfig.EXAMTRACK_SUPABASE_URL` for the mistake library, and `FocalStudy.kt` builds
another from `BuildConfig.FOCAL_SUPABASE_URL`. After the merge both point at the same
project and `ExamTrackAuthRepository` can use the Focal session. `FocalStudyManager` stays
on the compatibility route until the canonical session API lands. This one is easy to
miss: Folio's mistake library is on ExamTrack's project, not Focal's, so it breaks if it
is left pointing at the old project.

## What this does not fix

The `sync_read_changes` predicate at `0007_change_log.sql:417` still forces a snapshot on
almost every incremental read. It is a one-line fix (compare the cursor against the
compaction floor only) and it is worth doing now rather than after the cutover, but the
rewrite makes it moot.

The timer is untouched. `FocalTimerLink` is still a second representation of an exam or
SAC timer alongside the `activeExamTimer` / `activeSacTimer` fields in `user_state`, and
`pauseExamSession(exam, Date.now())` still reconstructs a remote pause at reception time
rather than at the moment it happened. Both survive this merge because Focal's
`public.study_sessions` table was dropped by migration `0004`: the change log is currently
the only study-session store, so the bridge has somewhere to write and the replacement does
not exist yet. They are removed when the three apps read one canonical `study_sessions`
row.
