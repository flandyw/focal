begin;

-- 10 assertions: the two projection checks at the end replaced one read of the dropped table
-- with a feed read plus the two objects 0016 removes, so the count goes up by one.
select plan(10);

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

-- The user_state projection table is gone (0016). The keyed write above is still valid and is
-- now only observable through the ordered feed, so assert the post-migration contract: the log
-- row exists, and neither the table nor its timer-state helper is left to read.

select is(
  (select payload -> 'value' ->> 0 from public.sync_log
    where user_id = auth.uid() and entity = 'user_state' and row_id = 'trackedExamIds'),
  'exam-a',
  'keyed setting writes are readable from the ordered feed'
);

select is(to_regclass('public.user_state')::text, null,
  'the legacy user_state read projection is gone');

select is(to_regprocedure('public.strip_examtrack_timer_state()')::text, null,
  'the timer-state projection helper is gone with its table');

select * from finish();
rollback;
