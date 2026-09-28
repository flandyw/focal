-- Folio/ExamTrack sync v3: one append-only change log shared by the web app and Folio.
--
-- Every writer joins the same log, whichever direction it comes from:
--   * Folio publishes notebook, page and stroke changes through `sync_apply_changes`.
--   * ExamTrack's web app keeps writing `mistakes`, `attempts` and `user_state`
--     directly; a trigger turns each of those writes into a log entry, so Folio's
--     cursor read sees web edits with no change to the web client.
--   * A projection trigger writes log winners back into those tables, so the web app
--     keeps reading and writing exactly what it does today.
--
-- Run with: supabase db push   (or psql -f against the ExamTrack project)

begin;

-- ---------------------------------------------------------------------------
-- Log, per-user lamport clock, materialized state, compaction floor, receipts
-- ---------------------------------------------------------------------------

create sequence if not exists public.sync_log_seq as bigint;

create table if not exists public.sync_clocks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  clock bigint not null default 0
);

create table if not exists public.sync_log (
  seq bigint not null default nextval('public.sync_log_seq'),
  user_id uuid not null references auth.users(id) on delete cascade,
  change_id uuid not null,
  client_id text not null,
  entity text not null check (entity in (
    -- Focal's own data
    'projects',
    'events',
    'study_sessions',
    'custom_subjects',
    'hidden_subjects',
    'timetable_config',
    'user_settings',
    -- ExamTrack's and Folio's data, which share this log
    'mistakes',
    'attempts',
    'user_state',
    'folio_notebooks',
    'folio_pages',
    'folio_strokes'
  )),
  row_id text not null,
  operation text not null check (operation in ('put', 'delete')),
  payload jsonb,
  lamport bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (seq),
  unique (user_id, change_id),
  constraint sync_log_payload_check check (
    (operation = 'put' and payload is not null)
    or (operation = 'delete' and (payload is null or jsonb_typeof(payload) = 'object'))
  )
);

create index if not exists sync_log_user_seq_idx on public.sync_log (user_id, seq);
create index if not exists sync_log_user_row_idx on public.sync_log (user_id, entity, row_id, seq desc);

-- Current state per row, tombstones included. Folio's ink lives in `folio_strokes`,
-- one row per stroke, so a page merges by union and a stale device cannot drop a stroke
-- it never saw. Tombstones are never deleted, so nothing is resurrected either.
create table if not exists public.sync_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity text not null,
  row_id text not null,
  operation text not null check (operation in ('put', 'delete')),
  payload jsonb,
  lamport bigint not null,
  client_id text not null,
  seq bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, entity, row_id)
);

-- Highest sequence removed by compaction. A client cursor below the floor takes a
-- snapshot instead of tailing, because the changes it missed no longer exist.
create table if not exists public.sync_floors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  floor_seq bigint not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  change_id uuid not null,
  seq bigint not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, change_id)
);

create index if not exists sync_receipts_accepted_idx on public.sync_receipts (accepted_at);

-- ---------------------------------------------------------------------------
-- Backfill: fold any rows already in the log-derived state before clients read it
-- ---------------------------------------------------------------------------

do $$
declare
  v_head bigint;
begin
  select coalesce(max(seq), 0) into v_head from public.sync_log;
  perform setval('public.sync_log_seq', greatest(v_head, (select last_value from public.sync_log_seq)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Lamport allocation
-- ---------------------------------------------------------------------------

-- Never lower than anything already recorded for the user, so a table trigger or a
-- legacy writer always sorts after older client changes instead of losing to them.
create or replace function public.sync_next_lamport(p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lamport bigint;
begin
  insert into public.sync_clocks (user_id, clock) values (p_user_id, 1)
    on conflict (user_id) do update set clock = public.sync_clocks.clock + 1
    returning clock into v_lamport;

  select greatest(v_lamport, coalesce(max(lamport), 0) + 1) into v_lamport
    from public.sync_log
   where user_id = p_user_id;

  update public.sync_clocks set clock = greatest(clock, v_lamport) where user_id = p_user_id;
  return v_lamport;
end;
$$;

-- ---------------------------------------------------------------------------
-- Log triggers: receipt, state projection, compaction
-- ---------------------------------------------------------------------------

create or replace function public.sync_record_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sync_receipts (user_id, change_id, seq)
  values (new.user_id, new.change_id, new.seq)
  on conflict (user_id, change_id) do nothing;
  return new;
end;
$$;

create trigger sync_log_receipt_after_insert
after insert on public.sync_log
for each row execute function public.sync_record_receipt();

-- Last writer wins by (lamport, client_id). The comparison is total, so two devices
-- that never see each other still converge on the same row.
create or replace function public.sync_project_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sync_state as s (user_id, entity, row_id, operation, payload, lamport, client_id, seq, updated_at)
  values (new.user_id, new.entity, new.row_id, new.operation, new.payload, new.lamport, new.client_id, new.seq, new.created_at)
  on conflict (user_id, entity, row_id) do update
     set operation = excluded.operation,
         payload = excluded.payload,
         lamport = excluded.lamport,
         client_id = excluded.client_id,
         seq = excluded.seq,
         updated_at = excluded.updated_at
   where (excluded.lamport, excluded.client_id) > (s.lamport, s.client_id);
  return new;
end;
$$;

create trigger sync_log_state_after_insert
after insert on public.sync_log
for each row execute function public.sync_project_state();

-- Compaction only deletes log rows a live client can no longer need: sync_state already
-- holds the current value of every row. The floor moves with it, so a client that fell
-- behind is told to snapshot rather than silently missing changes.
create or replace function public.compact_sync_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := new.user_id;
  v_head bigint;
  v_cutoff bigint;
  v_deleted bigint;
begin
  -- ponytail: opportunistic compaction, one user per 256 global inserts. The window is
  -- 20k changes per user; a client offline longer than that takes a snapshot instead.
  if mod(new.seq, 256) <> 0 then
    return new;
  end if;

  select coalesce(max(seq), 0) into v_head from public.sync_log where user_id = v_user;
  v_cutoff := v_head - 20000;
  if v_cutoff <= 0 then
    return new;
  end if;

  select max(seq) into v_deleted from public.sync_log where user_id = v_user and seq <= v_cutoff;
  if v_deleted is null then
    return new;
  end if;

  delete from public.sync_log where user_id = v_user and seq <= v_deleted;

  insert into public.sync_floors (user_id, floor_seq, updated_at)
  values (v_user, v_deleted, now())
  on conflict (user_id) do update
    set floor_seq = greatest(public.sync_floors.floor_seq, excluded.floor_seq),
        updated_at = excluded.updated_at;
  return new;
end;
$$;

create trigger compact_sync_log_after_insert
after insert on public.sync_log
for each row execute function public.compact_sync_log();

-- ---------------------------------------------------------------------------
-- Web tables feed the log, log winners feed the web tables
-- ---------------------------------------------------------------------------

-- The web app owns `updated_at` on these tables, so a replayed write collapses to the
-- same change id instead of appending a duplicate entry for an unchanged row.
create or replace function public.sync_log_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_entity text;
  v_row_id uuid;
  v_deleted_at timestamptz;
  v_updated_at timestamptz;
begin
  if coalesce(current_setting('sync.projecting', true), '') = '1' then
    return null;
  end if;

  -- Read through to_jsonb rather than new.<field>: this one function serves three tables,
  -- and a field that exists on `mistakes` does not exist on `user_state`.
  v_entity := case when tg_table_name = 'mistakes' then 'mistakes'
                   when tg_table_name = 'attempts' then 'attempts'
                   else 'user_state' end;
  v_row_id := case when tg_table_name = 'user_state'
                   then (v_row ->> 'user_id')::uuid
                   else (v_row ->> 'id')::uuid end;
  v_deleted_at := case when v_row ? 'deleted_at'
                       then nullif(v_row ->> 'deleted_at', '')::timestamptz
                       else null end;
  v_updated_at := coalesce(v_deleted_at, nullif(v_row ->> 'updated_at', '')::timestamptz, now());

  perform set_config('sync.projecting', '1', true);
  begin
    insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
    values (
      (v_row ->> 'user_id')::uuid,
      -- The web app owns updated_at, so an unchanged row collapses to one change id
      -- instead of appending a duplicate entry for an edit that changed nothing.
      md5(v_entity || v_row ->> 'user_id' || v_row_id::text || v_updated_at::text)::uuid,
      'examtrack',
      v_entity,
      v_row_id::text,
      case when v_deleted_at is null then 'put' else 'delete' end,
      case when v_deleted_at is null
           then v_row -> 'payload'
           else jsonb_build_object('deleted_at', v_deleted_at) end,
      public.sync_next_lamport((v_row ->> 'user_id')::uuid)
    )
    on conflict (user_id, change_id) do nothing;
  exception when others then
    -- Never leave the guard set: a stuck flag would silently stop this table feeding the log.
    perform set_config('sync.projecting', '', true);
    raise;
  end;
  perform set_config('sync.projecting', '', true);

  return null;
end;
$$;

drop trigger if exists sync_log_mistakes_after_write on public.mistakes;
create trigger sync_log_mistakes_after_write
after insert or update on public.mistakes
for each row execute function public.sync_log_row_change();

drop trigger if exists sync_log_attempts_after_write on public.attempts;
create trigger sync_log_attempts_after_write
after insert or update on public.attempts
for each row execute function public.sync_log_row_change();

drop trigger if exists sync_log_user_state_after_write on public.user_state;
create trigger sync_log_user_state_after_write
after insert or update on public.user_state
for each row execute function public.sync_log_row_change();

-- Folio's mistakes carry only scheduling fields; `preserveRemoteFields` keeps the rest.
-- The projection writes the log winner back so the web app sees a Folio review at once.
-- ponytail: when a log change and a web write race, `updated_at` decides, because that
-- is the contract the web app already relies on. The upgrade path is a server-side
-- review clock: replace the wall-clock comparison with the log's lamport.
create or replace function public.sync_project_web_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_at timestamptz;
begin
  if coalesce(current_setting('sync.projecting', true), '') = '1' then
    return null;
  end if;
  if new.entity not in ('mistakes', 'attempts', 'user_state') then
    return null;
  end if;

  v_updated_at := case
    when new.operation = 'delete'
      then coalesce(nullif(new.payload ->> 'deleted_at', '')::timestamptz, new.updated_at)
    else coalesce(nullif(new.payload ->> 'updatedAt', '')::timestamptz,
                  nullif(new.payload ->> 'updated_at', '')::timestamptz, new.updated_at)
  end;

  perform set_config('sync.projecting', '1', true);
  if new.entity = 'user_state' then
    insert into public.user_state as u (user_id, payload, updated_at)
    values (new.user_id, new.payload, v_updated_at)
    on conflict (user_id) do update
      set payload = excluded.payload, updated_at = excluded.updated_at
      where u.updated_at <= excluded.updated_at;
  else
    execute format(
      'insert into public.%I as t (user_id, id, payload, updated_at, deleted_at)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, id) do update
         set payload = excluded.payload, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
         where (t.payload, t.updated_at, t.deleted_at) is distinct from (excluded.payload, excluded.updated_at, excluded.deleted_at)',
      new.entity
    ) using new.user_id, new.row_id::uuid,
      case when new.operation = 'delete' then null else new.payload end,
      v_updated_at,
      case when new.operation = 'delete' then v_updated_at else null end;
  end if;
  perform set_config('sync.projecting', '', true);

  return null;
end;
$$;

create trigger sync_state_project_web_row_after_change
after insert or update on public.sync_state
for each row execute function public.sync_project_web_row();

-- ---------------------------------------------------------------------------
-- Client RPCs: publish with receipts, read by cursor
-- ---------------------------------------------------------------------------

create or replace function public.sync_apply_changes(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item jsonb;
  v_change_id uuid;
  v_seq bigint;
  v_replayed boolean;
  v_receipts jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'p_changes must be a json array' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_changes) loop
    v_change_id := nullif(v_item ->> 'change_id', '')::uuid;
    if v_change_id is null then
      raise exception 'change_id must be a uuid' using errcode = '22023';
    end if;
    if nullif(v_item ->> 'row_id', '') is null then
      raise exception 'row_id is required' using errcode = '22023';
    end if;

    insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
    values (
      v_uid,
      v_change_id,
      coalesce(nullif(v_item ->> 'client_id', ''), 'unknown'),
      v_item ->> 'entity',
      v_item ->> 'row_id',
      coalesce(v_item ->> 'operation', 'put'),
      nullif(v_item -> 'payload', 'null'::jsonb),
      coalesce(nullif(v_item ->> 'lamport', '')::bigint, 0)
    )
    on conflict (user_id, change_id) do nothing
    returning seq into v_seq;

    v_replayed := v_seq is null;
    if v_replayed then
      select r.seq into v_seq from public.sync_receipts r
       where r.user_id = v_uid and r.change_id = v_change_id;
    end if;

    v_receipts := v_receipts || jsonb_build_object(
      'change_id', v_change_id,
      'seq', coalesce(v_seq, 0),
      'replayed', v_replayed
    );
  end loop;

  return jsonb_build_object(
    'receipts', v_receipts,
    'head', (select coalesce(max(seq), 0) from public.sync_log where user_id = v_uid)
  );
end;
$$;

create or replace function public.sync_read_changes(
  p_after bigint default 0,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_floor bigint;
  v_head bigint;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select coalesce(floor_seq, 0) into v_floor from public.sync_floors where user_id = v_uid;
  select coalesce(max(seq), 0) into v_head from public.sync_log where user_id = v_uid;

  -- Behind the floor, or pointing at a row compaction already removed: the cursor can
  -- no longer be tailed, so hand back the materialized state and a fresh head instead.
  if p_after < v_floor
     or exists (select 1 from public.sync_log where user_id = v_uid and seq <= p_after) then
    return jsonb_build_object(
      'mode', 'snapshot',
      'floor', greatest(v_floor, p_after),
      'head', v_head,
      'rows', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'entity', s.entity,
          'row_id', s.row_id,
          'operation', s.operation,
          'payload', s.payload,
          'lamport', s.lamport,
          'client_id', s.client_id,
          'seq', s.seq,
          'updated_at', s.updated_at
        ) order by s.seq), '[]'::jsonb)
          from public.sync_state s
         where s.user_id = v_uid
      )
    );
  end if;

  return jsonb_build_object(
    'mode', 'changes',
    'floor', v_floor,
    'head', v_head,
    'rows', (
      select coalesce(jsonb_agg(to_jsonb(c) - 'user_id' order by c.seq), '[]'::jsonb)
        from (
          select l.seq, l.change_id, l.client_id, l.entity, l.row_id, l.operation, l.payload, l.lamport, l.created_at
            from public.sync_log l
           where l.user_id = v_uid
             and l.seq > p_after
           order by l.seq
           limit greatest(1, least(coalesce(p_limit, 500), 1000))
        ) c
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Content-addressed page blocks: images, PDFs and page text snapshots
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'folio-pages',
  'folio-pages',
  false,
  26214400,
  array['application/json', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read their folio page blocks" on storage.objects;
create policy "Users read their folio page blocks"
on storage.objects for select
to authenticated
using (
  bucket_id = 'folio-pages'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Users upload their folio page blocks" on storage.objects;
create policy "Users upload their folio page blocks"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'folio-pages'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Users delete their folio page blocks" on storage.objects;
create policy "Users delete their folio page blocks"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'folio-pages'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- ---------------------------------------------------------------------------
-- Privileges: the RPCs are the only write path, and they force the caller's identity
-- ---------------------------------------------------------------------------

alter table public.sync_log enable row level security;
alter table public.sync_state enable row level security;
alter table public.sync_clocks enable row level security;
alter table public.sync_floors enable row level security;
alter table public.sync_receipts enable row level security;

drop policy if exists "sync log select own rows" on public.sync_log;
create policy "sync log select own rows"
on public.sync_log for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.sync_log, public.sync_state, public.sync_clocks, public.sync_floors, public.sync_receipts
  from anon, authenticated;
grant select on public.sync_log to authenticated;

revoke all on function public.sync_apply_changes(jsonb) from public, anon;
revoke all on function public.sync_read_changes(bigint, integer) from public, anon;
revoke all on function public.sync_next_lamport(uuid) from public, anon, authenticated;
revoke all on function public.sync_record_receipt() from public, anon, authenticated;
revoke all on function public.sync_project_state() from public, anon, authenticated;
revoke all on function public.compact_sync_log() from public, anon, authenticated;
revoke all on function public.sync_log_row_change() from public, anon, authenticated;
revoke all on function public.sync_project_web_row() from public, anon, authenticated;
grant execute on function public.sync_apply_changes(jsonb) to authenticated;
grant execute on function public.sync_read_changes(bigint, integer) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_log'
  ) then
    execute 'alter publication supabase_realtime add table public.sync_log';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assertions: fail loudly instead of leaving a half-installed protocol
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.sync_log') is null
     or to_regclass('public.sync_state') is null
     or to_regclass('public.sync_floors') is null
     or to_regclass('public.sync_receipts') is null then
    raise exception 'Sync v3 tables are missing';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.sync_log'::regclass
       and tgname = 'sync_log_state_after_insert' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.sync_log'::regclass
       and tgname = 'compact_sync_log_after_insert' and not tgisinternal
  ) then
    raise exception 'Sync log state projection or compaction trigger is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.mistakes'::regclass
       and tgname = 'sync_log_mistakes_after_write' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.attempts'::regclass
       and tgname = 'sync_log_attempts_after_write' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.user_state'::regclass
       and tgname = 'sync_log_user_state_after_write' and not tgisinternal
  ) then
    raise exception 'A web table is not feeding the sync log';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.sync_state'::regclass
       and tgname = 'sync_state_project_web_row_after_change' and not tgisinternal
  ) then
    raise exception 'The log is not projected back into the web tables';
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_log'
  ) then
    raise exception 'sync_log is missing from the Realtime publication';
  end if;

  if not has_function_privilege('authenticated', 'public.sync_apply_changes(jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.sync_read_changes(bigint, integer)', 'EXECUTE') then
    raise exception 'Authenticated clients cannot call the sync RPCs';
  end if;

  if has_table_privilege('authenticated', 'public.sync_log', 'INSERT')
     or has_table_privilege('authenticated', 'public.sync_log', 'UPDATE')
     or has_table_privilege('authenticated', 'public.sync_log', 'DELETE')
     or has_table_privilege('authenticated', 'public.sync_state', 'SELECT') then
    raise exception 'Sync grants do not match the append-only, RPC-only model';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('sync_state', 'sync_floors', 'sync_clocks', 'sync_receipts')
  ) then
    raise exception 'Private sync tables must not expose an RLS policy';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'Users read their folio page blocks'
  ) then
    raise exception 'The folio-pages storage policies are missing';
  end if;
end;
$$;

commit;
