begin;
select plan(7);
select is(to_regclass('public.study_session_segments')::text, null::text, 'there is no separate study interval table');
select is(to_regprocedure('public.study_session_mutate_timed(jsonb)')::text, null::text, 'the old write wrappers are removed');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000028',
  'authenticated', 'authenticated', 'single-table@example.test', '', now(), '{}', '{}', now(), now());
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000028', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000028","role":"authenticated"}', true);
select public.study_session_mutate($command${
  "mutation_id":"20000000-0000-4000-8000-000000000028", "session_id":"web-study", "expected_revision":0,
  "action":"log", "device_id":"30000000-0000-4000-8000-000000000028", "app":"examtrack", "kind":"focus",
  "title":"Web revision", "subject_id":"eng", "metadata":{"subjectIds":["eng"]},
  "blocks":[{"start":"2020-01-01T12:00:00Z","end":"2020-01-01T13:00:00Z"}]
}$command$::jsonb);
select public.study_session_mutate($command${
  "mutation_id":"20000000-0000-4000-8000-000000000029", "session_id":"desktop-study", "expected_revision":0,
  "action":"create", "device_id":"30000000-0000-4000-8000-000000000029", "app":"focal", "kind":"focus",
  "title":"Desktop revision", "subject_id":"mm", "metadata":{"subjectIds":["mm"],"schedule":{"blocks":[
    {"start":"2020-01-01T14:00:00Z","end":"2020-01-01T15:00:00Z"}]}}
}$command$::jsonb);
select is((select count(*)::integer from public.study_sessions), 2, 'web and desktop each write a row to the same table');
select is((select jsonb_array_length(segments) from public.study_sessions where id = 'web-study'),
  1, 'actual study intervals live in the session row');
-- Exercise the public read API as authenticated callers, not the private payload helper.
select is(jsonb_array_length(public.sync_read_changes(-1, 500)->'rows'), 2, 'both calendars receive both sessions in the shared snapshot');
select is((select item->'payload'->'segments' from jsonb_array_elements(public.sync_read_changes(-1, 500)->'rows') item
  where item->>'row_id' = 'web-study'), (select segments from public.study_sessions where id = 'web-study'),
  'calendar payload is the session row, not a second projection table');
select is((select item->'payload'->>'title' from jsonb_array_elements(public.sync_read_changes(-1, 500)->'rows') item
  where item->>'row_id' = 'desktop-study'), 'Desktop revision', 'the desktop record is also available to web');
select * from finish();
rollback;
