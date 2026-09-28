begin;

select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '11000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'cursor-sync@example.test', '', now(), '{}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

create temporary table test_attempt_receipt as
select public.sync_apply_changes(jsonb_build_array(jsonb_build_object(
  'change_id', '21000000-0000-4000-8000-000000000001',
  'client_id', '22000000-0000-4000-8000-000000000001',
  'entity', 'attempts', 'row_id', '23000000-0000-4000-8000-000000000001',
  'operation', 'put', 'expected_seq', 0,
  'payload', jsonb_build_object('id', '23000000-0000-4000-8000-000000000001', 'comment', 'first')
))) as result;

select is(jsonb_array_length(result -> 'receipts'), 1, 'versioned app row is accepted and receipted')
  from test_attempt_receipt;
select is(jsonb_array_length(result -> 'stale'), 0, 'current expected sequence does not conflict')
  from test_attempt_receipt;

select is(
  (public.sync_apply_changes(jsonb_build_array(jsonb_build_object(
    'change_id', '21000000-0000-4000-8000-000000000001',
    'client_id', '22000000-0000-4000-8000-000000000001',
    'entity', 'attempts', 'row_id', '23000000-0000-4000-8000-000000000001',
    'operation', 'put', 'expected_seq', 0,
    'payload', jsonb_build_object('id', '23000000-0000-4000-8000-000000000001', 'comment', 'first')
  )))->'receipts'->0->>'seq'),
  (select result -> 'receipts' -> 0 ->> 'seq' from test_attempt_receipt),
  'replaying an accepted row returns its original sequence'
);

select is(
  jsonb_array_length(public.sync_apply_changes(jsonb_build_array(jsonb_build_object(
    'change_id', '21000000-0000-4000-8000-000000000002',
    'client_id', '22000000-0000-4000-8000-000000000002',
    'entity', 'attempts', 'row_id', '23000000-0000-4000-8000-000000000001',
    'operation', 'put', 'expected_seq', 0,
    'payload', jsonb_build_object('id', '23000000-0000-4000-8000-000000000001', 'comment', 'stale')
  )))->'stale'),
  1,
  'a concurrent edit at an old sequence receives the canonical row'
);

select is(
  (select payload ->> 'comment' from public.attempts where id = '23000000-0000-4000-8000-000000000001'),
  'first',
  'versioned feed writes project to the Folio-compatible attempts table'
);

insert into public.mistakes (user_id, id, payload, updated_at)
values (auth.uid(), '24000000-0000-4000-8000-000000000001',
  '{"id":"24000000-0000-4000-8000-000000000001","questionText":"Question","reviewHistory":[]}'::jsonb, now());
update public.mistakes
   set payload = payload || '{"dueAt":"2026-10-01T00:00:00Z","intervalDays":14}'::jsonb,
       updated_at = now()
 where user_id = auth.uid() and id = '24000000-0000-4000-8000-000000000001';

select is(
  (select payload ->> 'questionText' from public.mistakes where id = '24000000-0000-4000-8000-000000000001'),
  'Question',
  'Folio scheduling updates preserve the full mistake payload'
);

select is(
  (select count(*)::integer from public.sync_log
    where user_id = auth.uid() and entity = 'mistakes' and row_id = '24000000-0000-4000-8000-000000000001'),
  2,
  'Folio-compatible direct writes publish ordered feed events'
);

select public.sync_apply_changes(jsonb_build_array(jsonb_build_object(
  'change_id', '21000000-0000-4000-8000-000000000003',
  'client_id', '22000000-0000-4000-8000-000000000001',
  'entity', 'user_state', 'row_id', 'trackedExamIds',
  'operation', 'put', 'expected_seq', 0,
  'payload', jsonb_build_object('value', jsonb_build_array('exam-a'), 'updated_at', '2026-09-28T00:00:00Z')
)));

select is(
  (select payload -> 'trackedExamIds' ->> 0 from public.user_state where user_id = auth.uid()),
  'exam-a',
  'keyed setting writes update the legacy user_state read projection'
);

update public.user_state set payload = payload || '{"activeExamTimer":{"startedAt":"2000-01-01"}}'::jsonb
 where user_id = auth.uid();
select ok(
  not ((select payload from public.user_state where user_id = auth.uid()) ? 'activeExamTimer'),
  'timer state cannot be written back into user_state'
);

select * from finish();
rollback;
