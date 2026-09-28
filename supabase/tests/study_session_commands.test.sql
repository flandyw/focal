begin;

select plan(15);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'sync-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'sync-b@example.test', '', now(), '{}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (public.study_session_mutate($session$
    {"mutation_id":"20000000-0000-4000-8000-000000000001","session_id":"session-clock","expected_revision":0,"action":"start","device_id":"30000000-0000-4000-8000-000000000001","app":"examtrack","kind":"exam","phase":"reading","title":"Clock skew test","subject_id":"Chemistry","client_now":"2000-01-01T00:00:00Z"}
  $session$::jsonb)->>'ok'),
  'true', 'start creates a canonical session'
);

select is(
  (public.study_session_mutate($session$
    {"mutation_id":"20000000-0000-4000-8000-000000000001","session_id":"session-clock","expected_revision":0,"action":"start","device_id":"30000000-0000-4000-8000-000000000001","app":"examtrack","kind":"exam","phase":"reading","title":"Clock skew test","subject_id":"Chemistry","client_now":"2000-01-01T00:00:00Z"}
  $session$::jsonb)->'session'->>'started_at'),
  (public.study_session_mutate($session$
    {"mutation_id":"20000000-0000-4000-8000-000000000001","session_id":"session-clock","expected_revision":0,"action":"start","device_id":"30000000-0000-4000-8000-000000000001","app":"examtrack","kind":"exam","phase":"reading","title":"Clock skew test","subject_id":"Chemistry","client_now":"2000-01-01T00:00:00Z"}
  $session$::jsonb)->>'server_now'),
  'the server timestamp, not the supplied client clock, defines start'
);

select is(
  (public.study_session_mutate($session$
    {"mutation_id":"20000000-0000-4000-8000-000000000001","session_id":"session-clock","expected_revision":0,"action":"start","device_id":"30000000-0000-4000-8000-000000000001","app":"examtrack","kind":"exam","phase":"reading","title":"Clock skew test","subject_id":"Chemistry","client_now":"2000-01-01T00:00:00Z"}
  $session$::jsonb)->>'change_seq'),
  (select seq::text from public.sync_log where user_id = auth.uid() and change_id = '20000000-0000-4000-8000-000000000001'),
  'replaying a lost response returns the original receipt and feed event'
);

select is(
  (public.study_session_mutate($session$
    {"mutation_id":"20000000-0000-4000-8000-000000000002","session_id":"session-clock","expected_revision":1,"action":"pause","device_id":"30000000-0000-4000-8000-000000000001","app":"examtrack"}
  $session$::jsonb)->'session'->>'state'),
  'paused', 'pause closes the active segment'
);

select is(
  (public.study_session_mutate($session$
    {"mutation_id":"20000000-0000-4000-8000-000000000003","session_id":"session-clock","expected_revision":1,"action":"pause","device_id":"30000000-0000-4000-8000-000000000002","app":"folio"}
  $session$::jsonb)->>'reason'),
  'already_paused', 'a concurrent repeated pause is a no-op success'
);

select is(
  (select count(*)::integer from public.study_session_segments
    where user_id = auth.uid() and session_id = 'session-clock' and ended_at is not null),
  1, 'repeated pause does not close a segment twice'
);

select is(
  (public.study_session_mutate($session$
    {"mutation_id":"20000000-0000-4000-8000-000000000004","session_id":"session-clock","expected_revision":1,"action":"resume","device_id":"30000000-0000-4000-8000-000000000002","app":"folio"}
  $session$::jsonb)->>'reason'),
  'stale_revision', 'pause and resume racing at one revision returns canonical state'
);

select is(
  (public.study_session_mutate($session$
    {"mutation_id":"20000000-0000-4000-8000-000000000005","session_id":"session-clock","expected_revision":2,"action":"cancel","device_id":"30000000-0000-4000-8000-000000000001","app":"examtrack"}
  $session$::jsonb)->'session'->>'state'),
  'cancelled', 'cancel keeps a terminal canonical row'
);

select is(
  (public.study_session_mutate($session$
    {"mutation_id":"20000000-0000-4000-8000-000000000006","session_id":"session-clock","expected_revision":2,"action":"resume","device_id":"30000000-0000-4000-8000-000000000002","app":"folio"}
  $session$::jsonb)->>'reason'),
  'session_terminal', 'a stale resume cannot reopen a cancelled session'
);

create temporary table test_sync_cursor as
select coalesce(max(seq), 0) as seq from public.sync_log where user_id = auth.uid();

select is(
  (public.sync_read_changes((select seq from test_sync_cursor), 500)->>'mode'),
  'changes', 'a current cursor does not trigger a snapshot'
);
select is(
  jsonb_array_length(public.sync_read_changes((select seq from test_sync_cursor), 500)->'rows'),
  0, 'a current cursor reads no already-seen changes'
);

select public.study_session_mutate($session$
  {"mutation_id":"20000000-0000-4000-8000-000000000007","session_id":"session-next","expected_revision":0,"action":"start","device_id":"30000000-0000-4000-8000-000000000001","app":"examtrack","kind":"sac","phase":"focus","title":"SAC"}
$session$::jsonb);
select is(
  (public.sync_read_changes((select seq from test_sync_cursor), 500)->>'mode'),
  'changes', 'new changes after a valid cursor remain incremental'
);
select is(
  (public.sync_read_changes((select seq from test_sync_cursor), 500)->'rows'->0->>'row_id'),
  'session-next', 'the incremental page contains only the unseen session'
);

reset role;
insert into public.sync_floors (user_id, floor_seq)
values ('10000000-0000-4000-8000-000000000001', 1)
on conflict (user_id) do update set floor_seq = 1;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (public.sync_read_changes(0, 500)->>'mode'),
  'snapshot', 'a cursor below the retained feed floor receives a snapshot'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.study_sessions where id = 'session-clock'),
  0, 'RLS prevents another account from reading the session'
);

select * from finish();
rollback;
