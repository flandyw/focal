begin;
select plan(7);
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000017',
  'authenticated', 'authenticated', 'past-study@example.test', '', now(), '{}', '{}', now(), now());
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000017', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000017","role":"authenticated"}', true);
select set_config('test.past_study_command', $command${
  "mutation_id":"20000000-0000-4000-8000-000000000017", "session_id":"past-study", "expected_revision":0,
  "action":"log", "device_id":"30000000-0000-4000-8000-000000000017", "app":"focal", "kind":"focus",
  "title":"Past revision", "subject_id":"English",
  "blocks":[{"start":"2020-01-01T23:45:00Z","end":"2020-01-02T00:15:00Z"},
            {"start":"2020-01-02T00:30:00Z","end":"2020-01-02T00:45:00Z"}]
}$command$, true);
select is(public.study_session_mutate(current_setting('test.past_study_command')::jsonb)->'session'->>'state',
  'completed', 'past study is completed directly');
select is((select accumulated_active_ms from public.study_sessions where id = 'past-study'),
  2700000::bigint, 'breaks are excluded and old sessions are not clock-clamped');
select is((select completed_at from public.study_sessions where id = 'past-study'),
  '2020-01-02T00:45:00Z'::timestamptz, 'overnight study retains the actual finish');
select is(public.study_session_mutate(current_setting('test.past_study_command')::jsonb)->'session'->>'state',
  'completed', 'lost responses can be retried');
select is((select jsonb_array_length(segments) from public.study_sessions where id = 'past-study'),
  2, 'retry does not duplicate intervals');
select throws_ok($sql$
  select public.study_session_mutate(jsonb_set(
    jsonb_set(current_setting('test.past_study_command')::jsonb || '{"session_id":"invalid-overlap"}'::jsonb, '{mutation_id}', '"20000000-0000-4000-8000-000000000018"'),
    '{blocks,1,start}', '"2020-01-02T00:00:00Z"'))
$sql$, 'P0001', 'Invalid, future, or overlapping study blocks', 'overlaps are rejected');
select throws_ok($sql$
  select public.study_session_mutate(jsonb_set(
    jsonb_set(current_setting('test.past_study_command')::jsonb || '{"session_id":"invalid-future"}'::jsonb, '{mutation_id}', '"20000000-0000-4000-8000-000000000019"'),
    '{blocks,1,end}', '"2999-01-02T00:45:00Z"'))
$sql$, 'P0001', 'Invalid, future, or overlapping study blocks', 'future study is rejected');
select * from finish();
rollback;
