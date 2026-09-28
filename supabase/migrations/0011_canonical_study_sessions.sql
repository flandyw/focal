-- Canonical server-owned session lifecycle. Existing sync_log rows are retained as the
-- durable wakeup feed; study session values now live only in study_sessions.
begin;

create table public.study_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 160),
  kind text not null check (kind in ('focus', 'exam', 'sac')),
  state text not null check (state in ('planned', 'running', 'paused', 'completed', 'cancelled')),
  phase text check (phase in ('focus', 'reading', 'writing')),
  revision bigint not null default 1 check (revision > 0),
  title text not null default '' check (length(title) <= 512),
  subject_id text,
  originating_app text not null check (originating_app in ('focal', 'examtrack', 'folio')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  accumulated_active_ms bigint not null default 0 check (accumulated_active_ms >= 0),
  segment_started_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  primary key (user_id, id),
  constraint study_sessions_state_timestamps check (
    (state <> 'running' or (started_at is not null and segment_started_at is not null))
    and (state <> 'paused' or (started_at is not null and segment_started_at is null))
    and (state <> 'completed' or completed_at is not null)
    and (state <> 'cancelled' or cancelled_at is not null)
  )
);

create index study_sessions_user_state_idx on public.study_sessions (user_id, state, created_at desc);
create index study_sessions_user_kind_state_idx on public.study_sessions (user_id, kind, state);
create table public.study_session_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  phase text check (phase in ('focus', 'reading', 'writing')),
  source_device_id text,
  constraint study_session_segments_valid_interval check (ended_at is null or ended_at > started_at),
  constraint study_session_segments_session_fk foreign key (user_id, session_id)
    references public.study_sessions(user_id, id) on delete cascade
);

create index study_session_segments_session_idx
  on public.study_session_segments (user_id, session_id, started_at);
create unique index study_session_segments_one_open_idx
  on public.study_session_segments (user_id, session_id) where ended_at is null;

create table public.study_session_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  accepted_at timestamptz not null default clock_timestamp(),
  primary key (user_id, mutation_id)
);

alter table public.study_sessions enable row level security;
alter table public.study_session_segments enable row level security;
alter table public.study_session_mutation_receipts enable row level security;

create policy "study sessions select own" on public.study_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "study session segments select own" on public.study_session_segments
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.study_sessions, public.study_session_segments, public.study_session_mutation_receipts
  from public, anon, authenticated;
grant select on public.study_sessions, public.study_session_segments to authenticated;

-- Old session documents are migrated from the existing materialized state in a stable
-- row order. Their original domain payload remains available as legacy_metadata while
-- lifecycle and elapsed time are copied into typed canonical columns and segments.
create or replace function public._sync_try_timestamptz(p_value text)
returns timestamptz
language plpgsql immutable
set search_path = ''
as $$
begin
  return nullif(p_value, '')::timestamptz;
exception when others then
  return null;
end;
$$;
revoke all on function public._sync_try_timestamptz(text) from public, anon, authenticated;

create or replace function public._sync_session_time(p_value jsonb)
returns timestamptz
language plpgsql immutable
set search_path = ''
as $$
declare
  v_text text := p_value #>> '{}';
begin
  if jsonb_typeof(p_value) = 'number' and v_text ~ '^[0-9]{10,16}(\.[0-9]+)?$' then
    return to_timestamp(v_text::double precision / 1000.0);
  end if;
  return public._sync_try_timestamptz(v_text);
exception when others then
  return null;
end;
$$;
revoke all on function public._sync_session_time(jsonb) from public, anon, authenticated;

insert into public.study_sessions (
  user_id, id, kind, state, phase, revision, title, subject_id, originating_app,
  created_at, updated_at, started_at, paused_at, completed_at, cancelled_at,
  accumulated_active_ms, segment_started_at, metadata
)
select
  s.user_id,
  s.row_id,
  case
    when p #>> '{integrations,examtrack,kind}' = 'sac' then 'sac'
    when p #>> '{integrations,examtrack,kind}' = 'exam' then 'exam'
    when p #>> '{integrations,folio,kind}' = 'exam' then 'exam'
    when p ->> 'kind' in ('exam', 'sac') then p ->> 'kind'
    else 'focus'
  end,
  case
    when s.operation = 'delete' or p ->> 'deleted_at' is not null then 'cancelled'
    when coalesce(p #>> '{execution,state}', p ->> 'status') = 'completed'
      or p ->> 'completed' = 'true' then 'completed'
    when coalesce(p #>> '{execution,state}', p ->> 'status') in ('in-progress', 'running')
      then case
        when exists (
          select 1 from jsonb_array_elements(
            case
              when jsonb_typeof(p #> '{execution,intervals}') = 'array' then p #> '{execution,intervals}'
              when jsonb_typeof(p -> 'activeDurations') = 'array' then p -> 'activeDurations'
              else '[]'::jsonb
            end
          ) i where nullif(i ->> 'start', '') is not null and nullif(i ->> 'end', '') is null
        ) then 'running' else 'paused' end
    else 'planned'
  end,
  case
    when coalesce(p #>> '{integrations,examtrack,phase}', p #>> '{integrations,folio,phase}') in ('reading', 'writing')
      then coalesce(p #>> '{integrations,examtrack,phase}', p #>> '{integrations,folio,phase}')
    when p ->> 'kind' = 'focus' then 'focus'
    else null
  end,
  greatest(coalesce(s.lamport, 1), 1),
  coalesce(nullif(p ->> 'title', ''), 'Study Session'),
  coalesce(nullif(p ->> 'subject_id', ''), nullif(p ->> 'subjectId', ''), p #>> '{subjectIds,0}'),
  case
    when p #>> '{integrations,examtrack,type}' = 'examtrack' or p ->> 'createdVia' = 'examtrack' then 'examtrack'
    when p #>> '{integrations,folio,type}' = 'folio' then 'folio'
    else 'focal'
  end,
  coalesce(public._sync_try_timestamptz(p ->> 'created_at'), s.updated_at, clock_timestamp()),
  coalesce(s.updated_at, clock_timestamp()),
  coalesce(
    public._sync_try_timestamptz(p ->> 'startedAt'),
    public._sync_try_timestamptz(p #>> '{execution,intervals,0,start}'),
    public._sync_try_timestamptz(p ->> 'startTime'),
    s.updated_at
  ),
  public._sync_try_timestamptz(p ->> 'pausedAt'),
  case when coalesce(p #>> '{execution,state}', p ->> 'status') = 'completed' or p ->> 'completed' = 'true'
    then coalesce(public._sync_try_timestamptz(p #>> '{execution,completedAt}'),
                  public._sync_try_timestamptz(p ->> 'completedAt'), s.updated_at, clock_timestamp()) end,
  case when s.operation = 'delete' or p ->> 'deleted_at' is not null
    then coalesce(public._sync_try_timestamptz(p ->> 'deleted_at'), s.updated_at, clock_timestamp()) end,
  case when coalesce(p ->> 'activeMillis', '') ~ '^[0-9]+$'
    then (p ->> 'activeMillis')::bigint
    else 0 end,
  case
    when coalesce(p #>> '{execution,state}', p ->> 'status') in ('in-progress', 'running')
      and exists (
        select 1 from jsonb_array_elements(
          case
            when jsonb_typeof(p #> '{execution,intervals}') = 'array' then p #> '{execution,intervals}'
            when jsonb_typeof(p -> 'activeDurations') = 'array' then p -> 'activeDurations'
            else '[]'::jsonb
          end
        ) i where nullif(i ->> 'start', '') is not null and nullif(i ->> 'end', '') is null
      )
      then public._sync_try_timestamptz((
        select i ->> 'start' from jsonb_array_elements(
          case
            when jsonb_typeof(p #> '{execution,intervals}') = 'array' then p #> '{execution,intervals}'
            when jsonb_typeof(p -> 'activeDurations') = 'array' then p -> 'activeDurations'
            else '[]'::jsonb
          end
        ) i where nullif(i ->> 'start', '') is not null and nullif(i ->> 'end', '') is null
        order by public._sync_try_timestamptz(i ->> 'start') desc limit 1
      ))
  end,
  jsonb_build_object('legacy_metadata', coalesce(p, '{}'::jsonb) - 'execution' - 'activeDurations' - 'status' - 'startedAt' - 'pausedAt' - 'completedAt' - 'deleted_at')
from public.sync_state s
cross join lateral (select case when jsonb_typeof(s.payload) = 'object' then s.payload else '{}'::jsonb end as p) source
where s.entity = 'study_sessions'
on conflict (user_id, id) do nothing;

-- Preserve live ExamTrack timers that only existed in the legacy user_state document.
-- An already-synced study_sessions row wins deterministically; the old embedded timer is
-- removed from user_state after its ExamTrack fields and known intervals are copied.
with legacy_timers as (
  select s.user_id, 'exam'::text as kind, s.payload -> 'activeExamTimer' as timer, s.updated_at
    from public.user_state s where jsonb_typeof(s.payload -> 'activeExamTimer') = 'object'
  union all
  select s.user_id, 'sac'::text, s.payload -> 'activeSacTimer', s.updated_at
    from public.user_state s where jsonb_typeof(s.payload -> 'activeSacTimer') = 'object'
), normalized as (
  select user_id, kind, timer, updated_at,
         coalesce(nullif(timer ->> 'id', ''), nullif(timer #>> '{focal,sessionId}', '')) as id,
         public._sync_session_time(timer -> 'startedAt') as effective_start,
         public._sync_session_time(timer -> 'pausedAt') as paused_at,
         coalesce(nullif(timer ->> 'subject', ''), nullif(timer ->> 'subjectId', '')) as subject_id
    from legacy_timers
)
insert into public.study_sessions (
  user_id, id, kind, state, phase, revision, title, subject_id, originating_app,
  created_at, updated_at, started_at, paused_at, accumulated_active_ms,
  segment_started_at, metadata
)
select n.user_id, n.id, n.kind,
       case when n.paused_at is null then 'running' else 'paused' end,
       case when n.kind = 'sac' then 'focus'
            when coalesce(n.timer ->> 'phase', n.timer #>> '{focal,phase}') = 'reading' then 'reading'
            else 'writing' end,
       1,
       coalesce(nullif(n.timer ->> 'title', ''), case when n.kind = 'exam' then 'Exam session' else 'SAC session' end),
       n.subject_id, 'examtrack',
       coalesce(n.effective_start, n.updated_at, clock_timestamp()), n.updated_at,
       coalesce(n.effective_start, n.updated_at, clock_timestamp()), n.paused_at,
       case when n.paused_at is not null and n.effective_start is not null
         then greatest(0, floor(extract(epoch from (n.paused_at - n.effective_start)) * 1000))::bigint else 0 end,
       case when n.paused_at is null then coalesce(n.effective_start, clock_timestamp()) end,
       jsonb_build_object('examtrack', n.timer - 'focal', 'legacy_timer_backfill', true)
  from normalized n
 where n.id is not null
on conflict (user_id, id) do nothing;

-- Timer intervals in FocalTimerLink are legacy data only. Copy them to canonical segments;
-- if a legacy row had no interval list, its current uninterrupted span is retained.
with legacy_timers as (
  select s.user_id, 'exam'::text as kind, s.payload -> 'activeExamTimer' as timer
    from public.user_state s where jsonb_typeof(s.payload -> 'activeExamTimer') = 'object'
  union all
  select s.user_id, 'sac'::text, s.payload -> 'activeSacTimer'
    from public.user_state s where jsonb_typeof(s.payload -> 'activeSacTimer') = 'object'
), normalized as (
  select user_id, kind, timer,
         coalesce(nullif(timer ->> 'id', ''), nullif(timer #>> '{focal,sessionId}', '')) as id,
         public._sync_session_time(timer -> 'startedAt') as effective_start,
         public._sync_session_time(timer -> 'pausedAt') as paused_at,
         case when kind = 'sac' then 'focus'
              when coalesce(timer ->> 'phase', timer #>> '{focal,phase}') = 'reading' then 'reading'
              else 'writing' end as phase
    from legacy_timers
), legacy_intervals as (
  select n.user_id, n.id, n.kind, n.phase, n.effective_start, n.paused_at,
         public._sync_session_time(i -> 'start') as started_at,
         coalesce(public._sync_session_time(i -> 'end'),
           lead(public._sync_session_time(i -> 'start')) over (partition by n.user_id, n.id order by public._sync_session_time(i -> 'start')),
           n.paused_at) as ended_at,
         row_number() over (partition by n.user_id, n.id order by public._sync_session_time(i -> 'start') desc) as reverse_position
    from normalized n
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(n.timer #> '{focal,intervals}') = 'array' then n.timer #> '{focal,intervals}' else '[]'::jsonb end
    ) i
   where n.id is not null
), intervals_to_store as (
  select user_id, id, phase, started_at,
         case when reverse_position = 1 and paused_at is null and ended_at is null then null else ended_at end as ended_at
    from legacy_intervals
   where started_at is not null and (ended_at is null or ended_at > started_at)
  union all
  select n.user_id, n.id, n.phase, n.effective_start, n.paused_at
    from normalized n
   where n.id is not null and n.effective_start is not null
     and not exists (select 1 from legacy_intervals i where i.user_id = n.user_id and i.id = n.id)
)
insert into public.study_session_segments (user_id, session_id, started_at, ended_at, phase, source_device_id)
select i.user_id, i.id, i.started_at, i.ended_at, i.phase, null
  from intervals_to_store i
  join public.study_sessions s on s.user_id = i.user_id and s.id = i.id
 where s.originating_app = 'examtrack' and s.metadata ->> 'legacy_timer_backfill' = 'true'
on conflict do nothing;

update public.study_sessions s
   set accumulated_active_ms = greatest(s.accumulated_active_ms, coalesce(active.total_ms, 0))
  from (
    select user_id, session_id,
           sum(greatest(0, floor(extract(epoch from (ended_at - started_at)) * 1000))::bigint) as total_ms
      from public.study_session_segments
     where ended_at is not null
     group by user_id, session_id
  ) active
 where s.user_id = active.user_id and s.id = active.session_id and s.metadata ->> 'legacy_timer_backfill' = 'true';

update public.study_sessions
   set metadata = metadata - 'legacy_timer_backfill'
 where metadata ? 'legacy_timer_backfill';

update public.user_state s
   set payload = (s.payload - 'activeExamTimer' - 'activeSacTimer' - 'activeExamTimerUpdatedAt' - 'activeSacTimerUpdatedAt'),
       updated_at = clock_timestamp()
 where s.payload ?| array['activeExamTimer', 'activeSacTimer', 'activeExamTimerUpdatedAt', 'activeSacTimerUpdatedAt'];

-- Backfill actual intervals. Multiple malformed open intervals are resolved by keeping
-- the latest one open; earlier open intervals end at the next interval's start.
with legacy as (
  select s.user_id, s.row_id as id, s.payload as payload, s.operation,
         canonical.state, canonical.phase, s.client_id as source_device_id
    from public.sync_state s
    join public.study_sessions canonical on canonical.user_id = s.user_id and canonical.id = s.row_id
   where s.entity = 'study_sessions'
), intervals as (
  select l.user_id, l.id, l.phase, l.source_device_id,
         public._sync_try_timestamptz(i ->> 'start') as started_at,
         coalesce(
           public._sync_try_timestamptz(i ->> 'end'),
           public._sync_try_timestamptz(l.payload ->> 'pausedAt'),
           public._sync_try_timestamptz(l.payload #>> '{execution,completedAt}'),
           public._sync_try_timestamptz(l.payload ->> 'completedAt')
         ) as ended_at,
         i ->> 'end' as raw_end,
         row_number() over (partition by l.user_id, l.id order by public._sync_try_timestamptz(i ->> 'start') desc) as reverse_position,
         lead(public._sync_try_timestamptz(i ->> 'start')) over (
           partition by l.user_id, l.id order by public._sync_try_timestamptz(i ->> 'start')
         ) as next_started_at
    from legacy l
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(l.payload #> '{execution,intervals}') = 'array' then l.payload #> '{execution,intervals}'
        when jsonb_typeof(l.payload -> 'activeDurations') = 'array' then l.payload -> 'activeDurations'
        else '[]'::jsonb
      end
    ) i
   where nullif(i ->> 'start', '') is not null
), valid as (
  select user_id, id, phase, source_device_id, started_at,
         case
           when ended_at > started_at then ended_at
           when raw_end is null and next_started_at > started_at then next_started_at
           else null
         end as ended_at,
         reverse_position, raw_end
    from intervals
   where started_at is not null
)
insert into public.study_session_segments (user_id, session_id, started_at, ended_at, phase, source_device_id)
select v.user_id, v.id, v.started_at,
       case when s.state = 'running' and v.raw_end is null and v.reverse_position = 1 then null else v.ended_at end,
       v.phase, v.source_device_id
  from valid v
  join public.study_sessions s on s.user_id = v.user_id and s.id = v.id
 where (s.state = 'running' and (v.ended_at is not null or (v.raw_end is null and v.reverse_position = 1)))
    or (s.state <> 'running' and v.ended_at > v.started_at)
on conflict do nothing;

update public.study_sessions s
   set accumulated_active_ms = greatest(s.accumulated_active_ms, coalesce(active.total_ms, 0))
  from (
    select user_id, session_id,
           sum(greatest(0, floor(extract(epoch from (ended_at - started_at)) * 1000))::bigint) as total_ms
      from public.study_session_segments
     where ended_at is not null
     group by user_id, session_id
  ) active
 where s.user_id = active.user_id and s.id = active.session_id;

-- The old LWW materialization is no longer authoritative for sessions.
delete from public.sync_state where entity = 'study_sessions';

create or replace function public.sync_project_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entity = 'study_sessions' then return new; end if;
  insert into public.sync_state as s (user_id, entity, row_id, operation, payload, lamport, client_id, seq, updated_at)
  values (new.user_id, new.entity, new.row_id, new.operation, new.payload, new.lamport, new.client_id, new.seq, new.created_at)
  on conflict (user_id, entity, row_id) do update
     set operation = excluded.operation, payload = excluded.payload, lamport = excluded.lamport,
         client_id = excluded.client_id, seq = excluded.seq, updated_at = excluded.updated_at
   where (excluded.lamport, excluded.client_id) > (s.lamport, s.client_id);
  return new;
end;
$$;

-- The cursor floor alone determines snapshot fallback. A valid cursor at or beyond the
-- current head is an empty incremental read, even though older feed rows exist.
create or replace function public.sync_read_changes(p_after bigint default 0, p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_floor bigint;
  v_head bigint;
  v_server_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select coalesce(f.floor_seq, 0) into v_floor from public.sync_floors f where f.user_id = v_uid;
  v_floor := coalesce(v_floor, 0);
  select coalesce(max(l.seq), 0) into v_head from public.sync_log l where l.user_id = v_uid;

  if p_after < 0 or p_after < v_floor then
    return jsonb_build_object(
      'mode', 'snapshot', 'floor', v_floor, 'head', v_head, 'server_now', v_server_now,
      'rows', (
        select coalesce(jsonb_agg(state.row_value order by state.seq), '[]'::jsonb)
          from (
            select jsonb_build_object(
              'entity', s.entity, 'row_id', s.row_id, 'operation', s.operation, 'payload', s.payload,
              'lamport', s.lamport, 'client_id', s.client_id, 'seq', s.seq, 'updated_at', s.updated_at
            ) as row_value, s.seq
              from public.sync_state s
             where s.user_id = v_uid and s.entity <> 'study_sessions'
            union all
            select jsonb_build_object(
              'entity', 'study_sessions', 'row_id', s.id, 'operation', 'put',
              'payload', public.study_session_payload(v_uid, s.id),
              'lamport', s.revision, 'client_id', 'server',
              'seq', coalesce((select max(l.seq) from public.sync_log l
                                where l.user_id = v_uid and l.entity = 'study_sessions' and l.row_id = s.id), v_head),
              'updated_at', s.created_at
            ), coalesce((select max(l.seq) from public.sync_log l
                          where l.user_id = v_uid and l.entity = 'study_sessions' and l.row_id = s.id), v_head)
              from public.study_sessions s where s.user_id = v_uid
          ) state
      )
    );
  end if;

  return jsonb_build_object(
    'mode', 'changes', 'floor', v_floor, 'head', v_head, 'server_now', v_server_now,
    'rows', (
      select coalesce(jsonb_agg(change.row_value order by change.seq), '[]'::jsonb)
        from (
          select l.seq,
            jsonb_build_object(
              'seq', l.seq, 'change_id', l.change_id, 'client_id', l.client_id,
              'entity', l.entity, 'row_id', l.row_id,
              'operation', case when l.entity = 'study_sessions' then 'put' else l.operation end,
              'payload', case when l.entity = 'study_sessions'
                then public.study_session_payload(v_uid, l.row_id) else l.payload end,
              'lamport', l.lamport, 'created_at', l.created_at
            ) as row_value
            from public.sync_log l
           where l.user_id = v_uid and l.seq > p_after
           order by l.seq
           limit greatest(1, least(coalesce(p_limit, 500), 1000))
        ) change
    )
  );
end;
$$;

create or replace function public.study_session_payload(p_user_id uuid, p_session_id text)
returns jsonb
language sql stable
security invoker
set search_path = ''
as $$
  select (to_jsonb(s) - 'user_id') || jsonb_build_object(
    'segments', coalesce((
      select jsonb_agg(to_jsonb(g) - 'user_id' order by g.started_at, g.id)
        from public.study_session_segments g
       where g.user_id = p_user_id and g.session_id = p_session_id
    ), '[]'::jsonb)
  )
    from public.study_sessions s
   where s.user_id = p_user_id and s.id = p_session_id
$$;
revoke all on function public.study_session_payload(uuid, text) from public, anon, authenticated;

create or replace function public.sync_changes_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if new.user_id is not null and new.user_id <> v_uid then
    raise exception 'Cannot publish changes for another user' using errcode = '42501';
  end if;
  if new.entity = 'study_sessions' then
    raise exception 'Study sessions must use study_session_mutate' using errcode = '22023';
  end if;
  insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
  values (v_uid, new.change_id, coalesce(nullif(new.device_id, ''), 'legacy'), new.entity, new.row_id,
          coalesce(new.operation, 'put'), nullif(new.payload, 'null'::jsonb), public.sync_next_lamport(v_uid))
  on conflict (user_id, change_id) do nothing;
  return null;
end;
$$;

-- Keep the existing generic change feed for ordinary rows, but make study_sessions a
-- command-only entity and serialize per-user appends so a cursor cannot skip a late commit.
alter function public.sync_apply_changes(jsonb) rename to sync_apply_changes_v3_legacy;
revoke all on function public.sync_apply_changes_v3_legacy(jsonb) from public, anon, authenticated;
alter function public.sync_apply_changes_v3_legacy(jsonb) set search_path = '';
create function public.sync_apply_changes(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'p_changes must be a json array' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_changes) loop
    if v_item ->> 'entity' = 'study_sessions' then
      raise exception 'Study sessions must use study_session_mutate' using errcode = '22023';
    end if;
  end loop;
  perform public.sync_next_lamport(v_uid);
  return public.sync_apply_changes_v3_legacy(p_changes);
end;
$$;

revoke all on function public.sync_apply_changes(jsonb) from public, anon;
grant execute on function public.sync_apply_changes(jsonb) to authenticated;
alter function public.sync_apply_changes(jsonb) set search_path = '';
alter function public.sync_read_changes(bigint, integer) set search_path = '';

create function public.study_session_mutate(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_mutation uuid;
  v_session_id text;
  v_action text;
  v_device_id text;
  v_app text;
  v_expected bigint;
  v_now timestamptz := clock_timestamp();
  v_lamport bigint;
  v_existing_request jsonb;
  v_result jsonb;
  v_session public.study_sessions%rowtype;
  v_found boolean;
  v_applied boolean := false;
  v_reason text;
  v_kind text;
  v_phase text;
  v_title text;
  v_subject_id text;
  v_metadata jsonb;
  v_active_ms bigint;
  v_change_seq bigint;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_command is null or jsonb_typeof(p_command) <> 'object' then
    raise exception 'validation_failed: command must be an object' using errcode = '22023';
  end if;
  begin v_mutation := (p_command ->> 'mutation_id')::uuid;
  exception when others then raise exception 'validation_failed: mutation_id must be a UUID' using errcode = '22023'; end;
  v_session_id := nullif(p_command ->> 'session_id', '');
  v_action := p_command ->> 'action';
  v_device_id := coalesce(nullif(p_command ->> 'device_id', ''), 'unknown');
  v_app := coalesce(nullif(p_command ->> 'app', ''), 'focal');
  begin v_expected := coalesce((p_command ->> 'expected_revision')::bigint, 0);
  exception when others then raise exception 'validation_failed: expected_revision must be an integer' using errcode = '22023'; end;
  if v_session_id is null or length(v_session_id) > 160 then
    raise exception 'validation_failed: session_id is required' using errcode = '22023';
  end if;
  if v_action is null or v_action not in ('create', 'start', 'pause', 'resume', 'phase_change', 'save_progress', 'complete', 'cancel') then
    raise exception 'validation_failed: unknown session action' using errcode = '22023';
  end if;
  if v_app not in ('focal', 'examtrack', 'folio') then
    raise exception 'validation_failed: app must be focal, examtrack, or folio' using errcode = '22023';
  end if;
  if p_command ? 'kind' and p_command ->> 'kind' not in ('focus', 'exam', 'sac') then
    raise exception 'validation_failed: kind must be focus, exam, or sac' using errcode = '22023';
  end if;
  if p_command ? 'phase' and p_command ->> 'phase' not in ('focus', 'reading', 'writing') then
    raise exception 'validation_failed: phase must be focus, reading, or writing' using errcode = '22023';
  end if;
  if p_command ? 'title' and (jsonb_typeof(p_command -> 'title') <> 'string' or length(p_command ->> 'title') > 512) then
    raise exception 'validation_failed: title must be a string no longer than 512 characters' using errcode = '22023';
  end if;
  if p_command ? 'subject_id' and (p_command -> 'subject_id' <> 'null'::jsonb and jsonb_typeof(p_command -> 'subject_id') <> 'string') then
    raise exception 'validation_failed: subject_id must be a string or null' using errcode = '22023';
  end if;
  if v_device_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'validation_failed: device_id must be a UUID' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_command -> 'metadata', '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_command -> 'metadata', '{}'::jsonb)::text) > 65536 then
    raise exception 'validation_failed: metadata must be an object smaller than 64 KiB' using errcode = '22023';
  end if;

  -- This per-user row lock makes the feed sequence commit-ordered and serializes same-key
  -- retries before receipt lookup. The value is only a feed ordering aid, never a timer.
  v_lamport := public.sync_next_lamport(v_uid);
  if v_mutation is null then raise exception 'validation_failed: mutation_id is required' using errcode = '22023'; end if;
  if v_expected < 0 then raise exception 'validation_failed: expected_revision must be nonnegative' using errcode = '22023'; end if;
  select r.request into v_existing_request
    from public.study_session_mutation_receipts r
   where r.user_id = v_uid and r.mutation_id = v_mutation;
  if found then
    if v_existing_request <> p_command then
      raise exception 'mutation_id_reused: mutation_id was already used for another command' using errcode = '22023';
    end if;
    select r.result into v_result from public.study_session_mutation_receipts r
     where r.user_id = v_uid and r.mutation_id = v_mutation;
    return v_result;
  end if;
  v_now := clock_timestamp();

  select s.* into v_session from public.study_sessions s
   where s.user_id = v_uid and s.id = v_session_id for update;
  v_found := found;

  if not v_found then
    if v_action not in ('create', 'start') or v_expected <> 0 then
      v_result := jsonb_build_object('ok', false, 'applied', false, 'reason', 'not_found', 'server_now', v_now, 'session', null);
    else
      v_kind := coalesce(p_command ->> 'kind', 'focus');
      if v_kind not in ('focus', 'exam', 'sac') then
        raise exception 'validation_failed: kind must be focus, exam, or sac' using errcode = '22023';
      end if;
      v_phase := nullif(p_command ->> 'phase', '');
      if v_phase is not null and v_phase not in ('focus', 'reading', 'writing') then
        raise exception 'validation_failed: phase must be focus, reading, or writing' using errcode = '22023';
      end if;
      v_title := left(coalesce(p_command ->> 'title', ''), 512);
      v_subject_id := nullif(p_command ->> 'subject_id', '');
      v_metadata := coalesce(p_command -> 'metadata', '{}'::jsonb);
      insert into public.study_sessions (
        user_id, id, kind, state, phase, revision, title, subject_id, originating_app,
        created_at, updated_at, started_at, accumulated_active_ms, segment_started_at, metadata
      ) values (
        v_uid, v_session_id, v_kind,
        case when v_action = 'start' then 'running' else 'planned' end,
        coalesce(v_phase, case when v_kind = 'focus' then 'focus' end),
        1, v_title, v_subject_id, v_app, v_now, v_now,
        case when v_action = 'start' then v_now end, 0,
        case when v_action = 'start' then v_now end, v_metadata
      ) returning * into v_session;
      if v_action = 'start' then
        insert into public.study_session_segments (user_id, session_id, started_at, phase, source_device_id)
        values (v_uid, v_session_id, v_now, v_session.phase, v_device_id);
      end if;
      v_applied := true;
    end if;
  elsif v_action = 'create' then
    v_result := jsonb_build_object('ok', false, 'applied', false, 'reason', 'already_exists', 'server_now', v_now,
      'session', public.study_session_payload(v_uid, v_session_id));
  else
    v_kind := coalesce(nullif(p_command ->> 'kind', ''), v_session.kind);
    v_phase := coalesce(nullif(p_command ->> 'phase', ''), v_session.phase);
    v_title := coalesce(p_command ->> 'title', v_session.title);
    v_subject_id := coalesce(p_command ->> 'subject_id', v_session.subject_id);
    v_metadata := case when p_command ? 'metadata' then p_command -> 'metadata' else v_session.metadata end;

    if (v_action = 'pause' and v_session.state = 'paused')
       or (v_action = 'resume' and v_session.state = 'running') then
      v_reason := case when v_action = 'pause' then 'already_paused' else 'already_running' end;
    elsif v_action = 'start' and v_session.state = 'running' then
      v_reason := 'already_running';
    elsif v_action = 'complete' and v_session.state = 'completed' then
      v_reason := 'already_completed';
    elsif v_action = 'cancel' and v_session.state = 'cancelled' then
      v_reason := 'already_cancelled';
    elsif v_session.state in ('completed', 'cancelled') and v_action <> 'save_progress' then
      v_reason := 'session_terminal';
    elsif v_expected <> v_session.revision then
      v_result := jsonb_build_object('ok', true, 'applied', false, 'reason', 'stale_revision', 'server_now', v_now,
        'session', public.study_session_payload(v_uid, v_session_id));
    elsif v_action = 'save_progress' then
      update public.study_sessions s set title = v_title, updated_at = v_now,
        subject_id = case when p_command ? 'subject_id' then nullif(p_command ->> 'subject_id', '') else s.subject_id end,
        metadata = v_metadata, revision = s.revision + 1
       where s.user_id = v_uid and s.id = v_session_id returning * into v_session;
      v_applied := true;
    elsif v_action = 'pause' and v_session.state = 'running' then
      update public.study_session_segments g set ended_at = v_now
       where g.user_id = v_uid and g.session_id = v_session_id and g.ended_at is null
      returning greatest(0, floor(extract(epoch from (v_now - g.started_at)) * 1000))::bigint into v_active_ms;
      update public.study_sessions s set state = 'paused', paused_at = v_now, segment_started_at = null, updated_at = v_now,
        accumulated_active_ms = s.accumulated_active_ms + coalesce(v_active_ms, 0), revision = s.revision + 1,
        title = v_title, subject_id = v_subject_id, metadata = v_metadata
       where s.user_id = v_uid and s.id = v_session_id returning * into v_session;
      v_applied := true;
    elsif (v_action = 'resume' and v_session.state = 'paused')
       or (v_action = 'start' and v_session.state = 'planned') then
      update public.study_sessions s set state = 'running', started_at = coalesce(s.started_at, v_now), updated_at = v_now,
        paused_at = null, segment_started_at = v_now, revision = s.revision + 1,
        title = v_title, subject_id = v_subject_id, phase = v_phase, metadata = v_metadata
       where s.user_id = v_uid and s.id = v_session_id returning * into v_session;
      insert into public.study_session_segments (user_id, session_id, started_at, phase, source_device_id)
      values (v_uid, v_session_id, v_now, v_session.phase, v_device_id);
      v_applied := true;
    elsif v_action = 'phase_change' and v_session.state in ('running', 'paused') then
      if v_phase is null or v_phase not in ('focus', 'reading', 'writing') then
        raise exception 'validation_failed: phase_change requires a valid phase' using errcode = '22023';
      end if;
      if v_session.state = 'running' then
        update public.study_session_segments g set ended_at = v_now
         where g.user_id = v_uid and g.session_id = v_session_id and g.ended_at is null
        returning greatest(0, floor(extract(epoch from (v_now - g.started_at)) * 1000))::bigint into v_active_ms;
        update public.study_sessions s set accumulated_active_ms = s.accumulated_active_ms + coalesce(v_active_ms, 0), updated_at = v_now,
          phase = v_phase, revision = s.revision + 1, segment_started_at = v_now,
          title = v_title, subject_id = v_subject_id, metadata = v_metadata
         where s.user_id = v_uid and s.id = v_session_id returning * into v_session;
        insert into public.study_session_segments (user_id, session_id, started_at, phase, source_device_id)
        values (v_uid, v_session_id, v_now, v_session.phase, v_device_id);
      else
        update public.study_sessions s set phase = v_phase, updated_at = v_now, revision = s.revision + 1,
          title = v_title, subject_id = v_subject_id, metadata = v_metadata
         where s.user_id = v_uid and s.id = v_session_id returning * into v_session;
      end if;
      v_applied := true;
    elsif v_action in ('complete', 'cancel') and v_session.state in ('running', 'paused', 'planned') then
      if v_session.state = 'running' then
        update public.study_session_segments g set ended_at = v_now
         where g.user_id = v_uid and g.session_id = v_session_id and g.ended_at is null
        returning greatest(0, floor(extract(epoch from (v_now - g.started_at)) * 1000))::bigint into v_active_ms;
      end if;
      update public.study_sessions s set
        state = case when v_action = 'complete' then 'completed' else 'cancelled' end,
        completed_at = case when v_action = 'complete' then v_now end,
        cancelled_at = case when v_action = 'cancel' then v_now end,
        paused_at = null, segment_started_at = null, updated_at = v_now,
        accumulated_active_ms = s.accumulated_active_ms + coalesce(v_active_ms, 0), revision = s.revision + 1,
        title = v_title, subject_id = v_subject_id, metadata = v_metadata
       where s.user_id = v_uid and s.id = v_session_id returning * into v_session;
      v_applied := true;
    elsif v_action in ('save_progress', 'create') and v_session.state in ('planned', 'running', 'paused', 'completed') then
      update public.study_sessions s set title = v_title, updated_at = v_now, subject_id = v_subject_id,
        metadata = v_metadata, revision = s.revision + 1
       where s.user_id = v_uid and s.id = v_session_id returning * into v_session;
      v_applied := true;
    else
      v_reason := 'invalid_transition';
    end if;
  end if;

  if v_applied then
    insert into public.sync_log (user_id, change_id, client_id, entity, row_id, operation, payload, lamport)
    values (v_uid, v_mutation, v_device_id, 'study_sessions', v_session_id, 'put',
      jsonb_build_object('revision', v_session.revision), v_lamport)
    on conflict (user_id, change_id) do nothing
    returning seq into v_change_seq;
    if v_change_seq is null then
      select l.seq into v_change_seq from public.sync_log l where l.user_id = v_uid and l.change_id = v_mutation;
    end if;
    v_result := jsonb_build_object('ok', true, 'applied', true, 'reason', null,
      'server_now', v_now, 'change_seq', v_change_seq, 'session', public.study_session_payload(v_uid, v_session_id));
  elsif v_result is null then
    v_result := jsonb_build_object('ok', v_reason <> 'invalid_transition', 'applied', false, 'reason', v_reason,
      'server_now', v_now, 'session', case when v_found then public.study_session_payload(v_uid, v_session_id) else null end);
  end if;

  insert into public.study_session_mutation_receipts (user_id, mutation_id, request, result)
  values (v_uid, v_mutation, p_command, v_result);
  return v_result;
end;
$$;

revoke all on function public.study_session_mutate(jsonb) from public, anon;
grant execute on function public.study_session_mutate(jsonb) to authenticated;
alter function public.study_session_mutate(jsonb) set search_path = '';

-- Stored history becomes canonical session and segment rows. Do not keep an LWW copy.
do $$
begin
  if exists (select 1 from public.sync_state where entity = 'study_sessions') then
    raise exception 'study session backfill left rows in sync_state';
  end if;
  if not has_function_privilege('authenticated', 'public.study_session_mutate(jsonb)', 'EXECUTE') then
    raise exception 'authenticated clients cannot call study_session_mutate';
  end if;
  if has_table_privilege('authenticated', 'public.study_sessions', 'INSERT')
     or has_table_privilege('authenticated', 'public.study_sessions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.study_sessions', 'DELETE') then
    raise exception 'study_sessions must only be writable through the command RPC';
  end if;
end;
$$;

commit;
