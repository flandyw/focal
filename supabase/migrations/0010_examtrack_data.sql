-- Merges ExamTrack's data tables into the Focal project.
--
-- ExamTrack only has its own Supabase project because the study timer had to cross a
-- project boundary. With one project, `attempts`, `mistakes` and `user_state` become
-- plain tables here and the second Supabase client in both apps goes away.
--
-- Column shapes are copied verbatim from ExamTrack's migrations so the web and Android
-- clients need no data-layer change - only env vars pointing at this project.
--
-- ponytail: in ExamTrack's project these three tables feed the change log, because Folio
-- used to read mistakes through the log. Both clients actually read the tables directly
-- (`ExamTrackSyncService` in Folio, `syncAppData` in ExamTrack), so the log projection is
-- deliberately not ported: porting it would append a lamport-ordered LWW copy of every
-- write to a database that no longer has two projects to reconcile. The upgrade path is
-- the canonical `study_sessions` command protocol, which replaces log-projected rows for
-- every entity rather than extending this one.

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  payload jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  constraint attempts_payload_object check (payload is null or jsonb_typeof(payload) = 'object'),
  constraint attempts_deleted_payload check (deleted_at is null or payload is null)
);

create table if not exists public.mistakes (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  payload jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  constraint mistakes_payload_object check (payload is null or jsonb_typeof(payload) = 'object'),
  constraint mistakes_deleted_payload check (deleted_at is null or payload is null)
);

create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_state_payload_object check (jsonb_typeof(payload) = 'object')
);

comment on table public.attempts is 'ExamTrack practice-exam attempts. Merged from the ExamTrack project; pending normalisation in the canonical sync rewrite.';
comment on table public.mistakes is 'ExamTrack mistake cards. Merged from the ExamTrack project; pending normalisation in the canonical sync rewrite.';
comment on table public.user_state is 'ExamTrack singleton app state. Merged from the ExamTrack project; scheduled for deletion once its fields become their own rows.';

-- ---------------------------------------------------------------------------
-- RLS and grants: identical ownership model to ExamTrack's project
-- ---------------------------------------------------------------------------

alter table public.attempts enable row level security;
alter table public.mistakes enable row level security;
alter table public.user_state enable row level security;

drop policy if exists "attempts select own rows" on public.attempts;
create policy "attempts select own rows" on public.attempts for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "attempts insert own rows" on public.attempts;
create policy "attempts insert own rows" on public.attempts for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "attempts update own rows" on public.attempts;
create policy "attempts update own rows" on public.attempts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "attempts delete own rows" on public.attempts;
create policy "attempts delete own rows" on public.attempts for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "mistakes select own rows" on public.mistakes;
create policy "mistakes select own rows" on public.mistakes for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "mistakes insert own rows" on public.mistakes;
create policy "mistakes insert own rows" on public.mistakes for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "mistakes update own rows" on public.mistakes;
create policy "mistakes update own rows" on public.mistakes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "mistakes delete own rows" on public.mistakes;
create policy "mistakes delete own rows" on public.mistakes for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "user_state select own rows" on public.user_state;
create policy "user_state select own rows" on public.user_state for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "user_state insert own rows" on public.user_state;
create policy "user_state insert own rows" on public.user_state for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "user_state update own rows" on public.user_state;
create policy "user_state update own rows" on public.user_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.attempts to authenticated;
grant select, insert, update, delete on public.mistakes to authenticated;
grant select, insert, update, delete on public.user_state to authenticated;

-- ---------------------------------------------------------------------------
-- Mistake attachment storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mistake-attachments',
  'mistake-attachments',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Object paths are `<user_id>/<file>`, so the merged import has to rewrite the folder
-- prefix from the ExamTrack auth id to the Focal auth id. See scripts/examtrack-merge.mjs.
drop policy if exists "Users read their mistake attachments" on storage.objects;
create policy "Users read their mistake attachments"
on storage.objects for select
to authenticated
using (
  bucket_id = 'mistake-attachments'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Users upload their mistake attachments" on storage.objects;
create policy "Users upload their mistake attachments"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'mistake-attachments'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Users delete their mistake attachments" on storage.objects;
create policy "Users delete their mistake attachments"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'mistake-attachments'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- ---------------------------------------------------------------------------
-- Assertions: the merged tables must start empty, or the import will silently merge
-- two histories. ExamTrack's own log rows are not copied across; see the header.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from public.attempts)
     or exists (select 1 from public.mistakes)
     or exists (select 1 from public.user_state) then
    raise exception
      'attempts/mistakes/user_state already hold rows. Empty them before running the ExamTrack import, or the merge will combine two histories.';
  end if;

  if exists (
    select 1 from public.sync_state
     where entity in ('attempts', 'mistakes', 'user_state')
  ) or exists (
    select 1 from public.sync_log
     where entity in ('attempts', 'mistakes', 'user_state')
  ) then
    raise exception
      'The change log already projects attempts/mistakes/user_state. Migration 0010 makes the tables authoritative, so those log rows are a second source of truth that must be cleared first.';
  end if;

  if to_regclass('public.attempts') is null
     or to_regclass('public.mistakes') is null
     or to_regclass('public.user_state') is null then
    raise exception 'ExamTrack merge tables are missing';
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_log'
  ) then
    raise exception 'sync_log is missing from the supabase_realtime publication';
  end if;
end;
$$;

commit;
