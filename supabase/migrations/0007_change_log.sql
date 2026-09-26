-- Focal sync v3: one append-only change log with a server sequence, a materialized
-- current-state table, idempotent receipts and cursor reads.
--
-- Compatibility contract: `sync_changes` stops being a table and becomes a view over
-- the log, so every existing writer (Focal desktop, Focal Android, ExamTrack web,
-- Folio Android) keeps inserting and reading exactly the columns it uses today while
-- new clients read by cursor and publish through `sync_apply_changes`.
--
-- Run with: supabase db push   (or psql -f against the Focal project)

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

-- Current state per row, tombstones included. A tombstone is never dropped, so a
-- stale put from an offline device can never resurrect a deleted row.
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

-- Highest sequence deleted by compaction. A client cursor below the floor must take
-- a snapshot instead of tailing, because the changes it missed no longer exist.
create table if not exists public.sync_floors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  floor_seq bigint not null,
  updated_at timestamptz not null default now()
);

alter table public.sync_change_receipts add column if not exists seq bigint;
create index if not exists sync_change_receipts_accepted_idx
  on public.sync_change_receipts (accepted_at);

-- ---------------------------------------------------------------------------
-- Carry the v2 log across before `sync_changes` stops being a table
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.sync_changes') is not null
     and to_regclass('public.sync_log') is not null then
    insert into public.sync_log (seq, user_id, change_id, client_id, entity, row_id, operation, payload, lamport, created_at)
    select c.revision, c.user_id, c.change_id, c.device_id, c.entity, c.row_id, c.operation, c.payload,
           c.revision, c.created_at
      from public.sync_changes c
     on conflict do nothing;

    insert into public.sync_state (user_id, entity, row_id, operation, payload, lamport, client_id, seq, updated_at)
    select c.user_id, c.entity, c.row_id, c.operation, c.payload, c.revision, c.device_id, c.revision, c.created_at
      from public.sync_changes c
     on conflict (user_id, entity, row_id) do update
        set operation = excluded.operation,
            payload = excluded.payload,
            lamport = excluded.lamport,
            client_id = excluded.client_id,
            seq = excluded.seq,
            updated_at = excluded.updated_at
      where (excluded.lamport, excluded.client_id) > (public.sync_state.lamport, public.sync_state.client_id);

    insert into public.sync_change_receipts (user_id, change_id, accepted_at, seq)
    select c.user_id, c.change_id, c.created_at, c.revision
      from public.sync_changes c
     on conflict (user_id, change_id) do nothing;
  end if;
end;
$$;

do $$
declare
  v_head bigint;
begin
  select coalesce(max(seq), 0) into v_head from public.sync_log;
  perform setval('public.sync_log_seq', greatest(v_head, (select last_value from public.sync_log_seq)));
end;
$$;

-- ---------------------------------------------------------------------------
-- v2 triggers and helpers are superseded by the log's own triggers
-- ---------------------------------------------------------------------------

drop trigger if exists reject_replayed_focal_sync_change_before_insert on public.sync_changes;
drop trigger if exists compact_focal_sync_changes_after_insert on public.sync_changes;
drop trigger if exists prune_old_focal_sync_receipts_after_insert on public.sync_changes;
drop function if exists public.reject_replayed_focal_sync_change() cascade;
drop function if exists public.compact_focal_sync_changes() cascade;
drop function if exists public.prune_old_focal_sync_receipts() cascade;
drop function if exists public.set_sync_metadata() cascade;
drop function if exists public.set_updated_at() cascade;

drop table if exists public.sync_changes cascade;

-- ---------------------------------------------------------------------------
-- Compatibility view: the exact v2 surface, backed by the log
-- ---------------------------------------------------------------------------

create view public.sync_changes as
  select l.seq as revision,
         l.user_id,
         l.change_id,
         l.client_id as device_id,
         l.entity,
         l.row_id,
         l.operation,
         l.payload,
         l.lamport,
         l.created_at
    from public.sync_log l
   where l.user_id = (select auth.uid())
     and (select auth.uid()) is not null;

comment on view public.sync_changes is
  'Compatibility view over sync_log for pre-v3 clients. Writes go through sync_apply_changes; reads here are already cursor based.';

-- A per-user lamport that is never lower than anything the server has seen, so a
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

create or replace function public.sync_changes_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if new.user_id is not null and new.user_id <> v_uid then
    raise exception 'Cannot publish changes for another user' using errcode = '42501';
  end if;

  insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
  values (
    v_uid,
    new.change_id,
    coalesce(nullif(new.device_id, ''), 'legacy'),
    new.entity,
    new.row_id,
    coalesce(new.operation, 'put'),
    nullif(new.payload, 'null'::jsonb),
    public.sync_next_lamport(v_uid)
  )
  on conflict (user_id, change_id) do nothing;

  -- INSTEAD OF: a null return means the row is already in the log (idempotent replay).
  return null;
end;
$$;

create trigger sync_changes_insert_instead
instead of insert on public.sync_changes
for each row execute function public.sync_changes_insert();

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
  insert into public.sync_change_receipts (user_id, change_id, accepted_at, seq)
  values (new.user_id, new.change_id, new.created_at, new.seq)
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

-- Compaction folds nothing (sync_state already holds it) and only deletes log rows a
-- live client can no longer need. The floor moves with it so lagging clients snapshot.
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
      select r.seq into v_seq from public.sync_change_receipts r
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
      'floor', v_floor,
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
-- Privileges: the RPCs are the only write path, and they force the caller's identity
-- ---------------------------------------------------------------------------

alter table public.sync_log enable row level security;
alter table public.sync_state enable row level security;
alter table public.sync_clocks enable row level security;
alter table public.sync_floors enable row level security;
alter table public.sync_change_receipts enable row level security;

drop policy if exists "sync log select own rows" on public.sync_log;
create policy "sync log select own rows"
on public.sync_log for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.sync_log, public.sync_state, public.sync_clocks, public.sync_floors from anon, authenticated;
revoke all on public.sync_change_receipts from anon, authenticated;
grant select on public.sync_log to authenticated;
grant select on public.sync_changes to authenticated;

revoke all on function public.sync_apply_changes(jsonb) from public, anon;
revoke all on function public.sync_read_changes(bigint, integer) from public, anon;
revoke all on function public.sync_next_lamport(uuid) from public, anon, authenticated;
revoke all on function public.sync_changes_insert() from public, anon, authenticated;
revoke all on function public.sync_record_receipt() from public, anon, authenticated;
revoke all on function public.sync_project_state() from public, anon, authenticated;
revoke all on function public.compact_sync_log() from public, anon, authenticated;
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
     or to_regclass('public.sync_changes') is null then
    raise exception 'Focal sync v3 tables or the compatibility view are missing';
  end if;

  if (select relkind from pg_class where oid = 'public.sync_changes'::regclass) <> 'v' then
    raise exception 'sync_changes must be a view over the log, not a table';
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
     where tgrelid = 'public.sync_changes'::regclass
       and tgname = 'sync_changes_insert_instead' and not tgisinternal
  ) then
    raise exception 'The compatibility view needs an INSTEAD OF insert trigger';
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
       and tablename in ('sync_state', 'sync_floors', 'sync_clocks', 'sync_change_receipts')
  ) then
    raise exception 'Private sync tables must not expose an RLS policy';
  end if;
end;
$$;

commit;
