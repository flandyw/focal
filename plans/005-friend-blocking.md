# Plan 005: Let users block people and default new profiles to friend requests

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If a STOP condition occurs, stop and report; do
> not improvise. Do NOT edit `plans/README.md`; the reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 67a4c42..HEAD -- supabase/migrations src/components/friends-page.tsx docs/deployment.md`
> If anything changed, compare the excerpts below with the live code; a mismatch is a STOP condition.

## Status

- **Priority**: P1 · **Effort**: M · **Risk**: MED · **Depends on**: none · **Category**: security
- **Planned at**: commit `67a4c42`, 2026-11-10

## Why this matters

Focal's users are school students. Anyone who learns a username can add them; unless the owner
opted into requests, the friendship is accepted at once, and an accepted friend sees minute-level
study times and live "studying now" status. Removing a friend only deletes the row: the same
person can re-add immediately and be auto-accepted again. There is no way to block someone.

## Current state

- `supabase/migrations/0035_friends_auto_accept.sql:5`: `alter table public.friend_profiles add column require_requests boolean not null default false;`
- `supabase/migrations/0037_friend_usernames.sql` holds the latest `friends_add` (no later migration redefines it; confirm with `grep -ln "function public.friends_add" supabase/migrations/*.sql`, expected: 0029, 0035, 0037):

```sql
create function public.friends_add(p_code text default null, p_username text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_friend uuid;
  v_require boolean;
  v_username text := lower(regexp_replace(btrim(p_username), '^@', ''));
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_username is not null then
    ...
    select p.user_id, p.require_requests into v_friend, v_require from public.friend_profiles p where p.username = v_username;
  else
    select p.user_id, p.require_requests into v_friend, v_require from public.friend_profiles p where p.code = upper(btrim(p_code));
  end if;
  if v_friend is null then raise exception 'No account found. Check the username and try again.' using errcode = 'P0002'; end if;
  if v_friend = v_uid then raise exception 'That is your own account. Share your username with a friend.' using errcode = '22023'; end if;
  ...
  insert into public.friendships (user_id, friend_id, accepted) values (v_uid, v_friend, not v_require)
  on conflict (user_id, friend_id) do update set accepted = public.friendships.accepted or excluded.accepted;
end $$;
```

- Same file, `friends_remove(p_user_id uuid)`: deletes `friendships` rows in both directions and `friend_nicknames` rows in both directions.
- House style for these functions (copy it exactly): `language plpgsql security definer set search_path = ''`, first statement checks `auth.uid()` and raises `'Not authenticated' using errcode = '28000'`, every table schema-qualified (`public.`), and the migration ends with `revoke all on function ... from public, anon;` and `grant execute on function ... to authenticated;`. Friend tables have RLS enabled and no client table grants (see `0043_friend_study_sessions.sql` for the newest example of a table created that way). Migrations are wrapped in `begin; ... commit;`.
- Latest migration is `0043_friend_study_sessions.sql`; yours is `0044_friend_blocks.sql`. Migrations are immutable once written: never edit 0001-0043.
- `src/components/friends-page.tsx`: all RPCs go through the local helper `call(fn, args, failure)` (~:300), which sets `pending`, toasts errors, and reloads lists. "Remove friend" button at ~:793 calls `friends_remove`. The profile section has the `require_requests` checkbox at ~:732. `people` rows carry `user_id`, `username`, `status`. Lists are loaded by `load()`, `loadCheers()`, `loadExtras()`.
- Design rules (`PRODUCT.md`): minimal, existing components only (`Button`, `Dialog`, etc. from `src/components/ui`), no new colours, status never by colour alone, WCAG AA.
- Repo rules (`AGENTS.md`): minimal code, no new dependencies, no new tests.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (fresh worktree) | `bun install --frozen-lockfile` | exit 0 |
| Typecheck + lint | `bun run check` | exit 0 (2 known warnings in `toggle.tsx`, `friends-page.tsx`) |
| Tests | `bun test` | 48 pass, 0 fail |
| Web build | `bun run build` | exit 0 |
| Desktop frontend build | `bun run build:desktop` | exit 0 |

Never run `supabase db push` or anything else against a remote database. If Docker is available
you may validate the migration against a local stack (`bunx supabase start` then
`bunx supabase db reset`); if not, say plainly in the report that the SQL was not executed.

## Scope

**In scope**: `supabase/migrations/0044_friend_blocks.sql` (create), `src/components/friends-page.tsx`, `docs/deployment.md` (one sentence naming 0044 next to 0043), `docs/friend-study-sessions.md` only if it needs a sentence about blocking.

**Out of scope**: migrations 0001-0043, other friends components (`friend-study-sessions.tsx`), `server/`, notification code, existing friendships and existing `require_requests` values.

## Git workflow

Commit in your worktree; message is a plain imperative sentence. Do not push.

## Steps

### Step 1: migration `0044_friend_blocks.sql`

Inside one `begin; ... commit;`:

1. `create table public.friend_blocks (user_id uuid not null references auth.users on delete cascade, blocked_id uuid not null references auth.users on delete cascade, created_at timestamptz not null default now(), primary key (user_id, blocked_id), check (user_id <> blocked_id));` then `alter table public.friend_blocks enable row level security;` and `revoke all on public.friend_blocks from anon, authenticated;` (match how 0043 locks its tables).
2. `friends_block(p_user_id uuid) returns void`: auth check; reject self; insert the block `on conflict do nothing`; then delete the friendship and nicknames in both directions exactly as `friends_remove` does. Cap blocks per user at 500 with the `'54000'` errcode pattern used for "Too many friends".
3. `friends_unblock(p_user_id uuid) returns void`: auth check; delete the caller's block row.
4. `friends_blocked() returns table (user_id uuid, username text, display_name text)`: auth check; the caller's blocks joined to `public.friend_profiles` (left join; a blocked account may have no profile), newest first.
5. `create or replace function public.friends_add(p_code text default null, p_username text default null)`: copy the 0037 body verbatim and add one check right after the "own account" check: if a `friend_blocks` row exists in either direction between `v_uid` and `v_friend`, raise the same `'No account found. Check the username and try again.'` with errcode `'P0002'` (a blocked person must not learn they are blocked). Keeping the same signature preserves existing grants; restate the revoke/grant anyway.
6. `alter table public.friend_profiles alter column require_requests set default true;` with a comment: new profiles ask before accepting; existing profiles keep their choice.
7. Check whether shared study sessions can still reach a blocked person: read how `0043_friend_study_sessions.sql` validates invitees (it requires accepted friends of the host). Since blocking deletes the friendship, no change should be needed; confirm and say so in the report. Existing room memberships: if 0043 has a membership table, also delete the blocked pair's pending invitations in `friends_block` only if that can be done with one simple `delete`; otherwise leave it and report.
8. End with revoke/grant for the three new functions and `friends_add`.

**Verify**: `grep -c "security definer set search_path = ''" supabase/migrations/0044_friend_blocks.sql` → 4; `grep -n "grant execute" supabase/migrations/0044_friend_blocks.sql` → covers all four functions. If Docker is available: `bunx supabase db reset` → exit 0.

### Step 2: UI in `friends-page.tsx`

- Next to "Remove friend" (~:793) add a "Block" button (`variant="outline"`, same size) that calls `call("friends_block", { p_user_id: selected.person.user_id }, "Could not block this person.")`, then toasts "Blocked" and closes the selection the same way removal does. Also offer "Block" beside "Decline" on an incoming request (~:427).
- In the profile/sharing section near the `require_requests` checkbox, add a short "Blocked people" list loaded from `friends_blocked` (load it where `loadExtras` loads its data; follow that function's error handling), each row with the name (`display_name || @username || "Deleted account"`) and an "Unblock" button calling `friends_unblock`. Render nothing when the list is empty.
- New profiles: wherever the client seeds a default profile object or falls back (`profile?.require_requests ?? false`), leave existing behaviour; the server default now decides for new accounts.
- Keep to existing components and class names used in this file; every button has an accessible name including the person's name, as the existing ones do (`aria-label={`... ${personName(person)}...`}`).

**Verify**: `bun run check` → exit 0 with no new warnings; `bun test` → 48 pass; `bun run build` and `bun run build:desktop` → exit 0.

### Step 3: docs

`docs/deployment.md`: add `0044_friend_blocks.sql` to the sentence listing required friends migrations.

**Verify**: `grep -n "0044" docs/deployment.md` → one match.

## Test plan

No new tests (repo rule). SQL is verified by local reset when Docker exists, otherwise by review; say which.

## Done criteria

- [ ] `supabase/migrations/0044_friend_blocks.sql` exists; no earlier migration is modified (`git status`)
- [ ] `bun run check`, `bun test`, `bun run build`, `bun run build:desktop` exit 0
- [ ] `grep -n "friends_block\|friends_unblock\|friends_blocked" src/components/friends-page.tsx` → all three present
- [ ] Report says whether the migration was executed locally

## STOP conditions

- A migration after 0037 redefines `friends_add`, or the 0037 body differs from the excerpt.
- The friends list RPC (latest definition in `0041_friends_list_speed.sql`) would still show a blocked person for a reason other than a `friendships` row (then blocking needs a change there; report it).
- The UI change needs files outside scope.

## Maintenance notes

- The migration must be applied by the maintainer (`supabase db push` from the repo root) before the UI ships, or the new buttons will error. Until then old clients are unaffected.
- Product decision to confirm: new accounts now default to friend requests. Existing users who never chose stay on auto-accept; a one-time prompt for them is deferred.
- Folio shares this database: check whether Folio calls `friends_add`; its signature is unchanged.
