begin;
select plan(23);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '12000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'offline-timing@example.test', '', now(), '{}', '{}', now(), now()
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"12000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$select public.study_session_mutate('{"mutation_id":"22000000-0000-4000-8000-000000000020","session_id":"wrong-owner","expected_revision":0,"action":"start","expected_user_id":"12000000-0000-4000-8000-000000000002"}'::jsonb)$$,
  '42501', 'account_mismatch: expected_user_id must match the authenticated account',
  'session outbox ownership is checked against the authenticated account'
);
select throws_ok(
  $$select public.sync_read_changes(0, 500, '12000000-0000-4000-8000-000000000002'::uuid)$$,
  '42501', 'account_mismatch: expected_user_id must match the authenticated account',
  'cursor reads cannot populate another account local cache'
);
select throws_ok(
  $$select public.sync_apply_changes('[]'::jsonb, '12000000-0000-4000-8000-000000000002'::uuid)$$,
  '42501', 'account_mismatch: expected_user_id must match the authenticated account',
  'generic outbox writes cannot cross authenticated accounts'
);

-- A command with no timing fields is a client without a monotonic model, not a claim of zero
-- elapsed time. It is still accepted, and its boundary lands on server receipt time.
create temporary table legacy_command_result as
select public.study_session_mutate(jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000014','session_id','legacy-no-timing',
  'expected_revision',0,'action','start','device_id','32000000-0000-4000-8000-000000000001',
  'app','focal','kind','focus','phase','focus'
)) as result;
select is((select result->'session'->>'state' from legacy_command_result),'running',
  'a legacy command with no timing fields is still accepted');
select is(public.study_session_mutate(jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000014','session_id','legacy-no-timing',
  'expected_revision',0,'action','start','device_id','32000000-0000-4000-8000-000000000001',
  'app','focal','kind','focus','phase','focus','expected_user_id','12000000-0000-4000-8000-000000000001'
)) = (select result from legacy_command_result),true,
  'account-pinned retry preserves the receipt for a legacy unpinned command');

-- No server-clock anchor: the command stores monotonic deltas. Fast replay moves the
-- timeline back as a whole rather than collapsing the active segment to RPC receipt time.
select public.study_session_mutate(jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000001','session_id','offline-start-pause',
  'expected_revision',0,'action','start','elapsed_since_previous_ms',0,'occurred_at',null,
  'device_id','32000000-0000-4000-8000-000000000001','app','focal','kind','focus','phase','focus',
  'expected_user_id','12000000-0000-4000-8000-000000000001'
));
create temporary table first_pause as
select public.study_session_mutate(jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000002','session_id','offline-start-pause',
  'expected_revision',1,'action','pause','elapsed_since_previous_ms',1800000,'occurred_at',null,
  'device_id','32000000-0000-4000-8000-000000000001','app','focal'
)) as result;
select is((result->'session'->>'accumulated_active_ms')::bigint,1800000::bigint,'offline start then 30 minutes then pause records 30 active minutes') from first_pause;
select is((select floor(extract(epoch from (ended_at-started_at))*1000)::bigint from public.study_session_segments where session_id='offline-start-pause'),1800000::bigint,'replayed pause preserves the original segment length');
create temporary table replay_receipt as select result from first_pause;
select is((public.study_session_mutate(jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000002','session_id','offline-start-pause',
  'expected_revision',1,'action','pause','elapsed_since_previous_ms',1800000,'occurred_at',null,
  'device_id','32000000-0000-4000-8000-000000000001','app','focal'
)) = (select result from replay_receipt)),true,'duplicate replay returns the exact original timing receipt');
select is((select revision from public.study_sessions where id='offline-start-pause'),2::bigint,'duplicate replay adds no revision');
select is((select count(*)::integer from public.study_session_segments where session_id='offline-start-pause'),1,'duplicate replay adds no segment');

-- A valid server anchor lets an offline action land at its actual occurrence despite a
-- 30-minute-late reconnect. The remote receipt time is deliberately not the boundary.
create temporary table anchored_start as select clock_timestamp() - interval '35 minutes' as started;
select public.study_session_mutate((select jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000003','session_id','online-offline-pause',
  'expected_revision',0,'action','start','elapsed_since_previous_ms',0,'occurred_at',started,
  'device_id','32000000-0000-4000-8000-000000000001','app','folio','kind','exam','phase','reading'
) from anchored_start));
select public.study_session_mutate((select jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000004','session_id','online-offline-pause',
  'expected_revision',1,'action','pause','elapsed_since_previous_ms',300000,'occurred_at',started + interval '5 minutes',
  'device_id','32000000-0000-4000-8000-000000000001','app','folio'
) from anchored_start));
select is((select accumulated_active_ms from public.study_sessions where id='online-offline-pause'),300000::bigint,'late reconnect does not overcount 25 disconnected minutes');
select is((select floor(extract(epoch from (ended_at-started_at))*1000)::bigint from public.study_session_segments where session_id='online-offline-pause'),300000::bigint,'online-start/offline-pause segment is exactly five minutes');

-- Offline pause/resume/pause retains both active intervals and the intervening pause gap.
create temporary table sequence_anchor as select clock_timestamp() - interval '40 minutes' as started;
select public.study_session_mutate((select jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000005','session_id','offline-resume-sequence',
  'expected_revision',0,'action','start','elapsed_since_previous_ms',0,'occurred_at',started,
  'device_id','32000000-0000-4000-8000-000000000001','app','folio','kind','focus','phase','focus'
) from sequence_anchor));
select public.study_session_mutate((select jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000006','session_id','offline-resume-sequence',
  'expected_revision',1,'action','pause','elapsed_since_previous_ms',300000,'occurred_at',started + interval '5 minutes',
  'device_id','32000000-0000-4000-8000-000000000001','app','folio'
) from sequence_anchor));
select public.study_session_mutate((select jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000007','session_id','offline-resume-sequence',
  'expected_revision',2,'action','resume','elapsed_since_previous_ms',1500000,'occurred_at',started + interval '30 minutes',
  'device_id','32000000-0000-4000-8000-000000000001','app','folio'
) from sequence_anchor));
select public.study_session_mutate((select jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000008','session_id','offline-resume-sequence',
  'expected_revision',3,'action','pause','elapsed_since_previous_ms',600000,'occurred_at',started + interval '40 minutes',
  'device_id','32000000-0000-4000-8000-000000000001','app','folio'
) from sequence_anchor));
select is((select accumulated_active_ms from public.study_sessions where id='offline-resume-sequence'),900000::bigint,'offline pause/resume/pause stores 15 active minutes');
select is((select count(*)::integer from public.study_session_segments where session_id='offline-resume-sequence'),2,'offline resume creates exactly one additional segment');
select is((select sum(floor(extract(epoch from (ended_at-started_at))*1000)::bigint) from public.study_session_segments where session_id='offline-resume-sequence' and ended_at is not null),900000::bigint,'both offline active intervals remain exact');

-- An offline reading-to-writing phase boundary and completion close distinct segments.
create temporary table phase_anchor as select clock_timestamp() - interval '20 minutes' as started;
select public.study_session_mutate((select jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000009','session_id','offline-phase-complete',
  'expected_revision',0,'action','start','elapsed_since_previous_ms',0,'occurred_at',started,
  'device_id','32000000-0000-4000-8000-000000000001','app','examtrack','kind','exam','phase','reading'
) from phase_anchor));
select public.study_session_mutate((select jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000010','session_id','offline-phase-complete',
  'expected_revision',1,'action','phase_change','elapsed_since_previous_ms',300000,'occurred_at',started + interval '5 minutes','phase','writing',
  'device_id','32000000-0000-4000-8000-000000000001','app','examtrack'
) from phase_anchor));
select public.study_session_mutate((select jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000011','session_id','offline-phase-complete',
  'expected_revision',2,'action','complete','elapsed_since_previous_ms',600000,'occurred_at',started + interval '15 minutes',
  'device_id','32000000-0000-4000-8000-000000000001','app','examtrack'
) from phase_anchor));
select is((select state from public.study_sessions where id='offline-phase-complete'),'completed','offline completion reaches a terminal state');
select is((select accumulated_active_ms from public.study_sessions where id='offline-phase-complete'),900000::bigint,'reading phase transition and completion retain all active time');
select is((select count(*)::integer from public.study_session_segments where session_id='offline-phase-complete' and ended_at is not null),2,'phase transition and complete preserve two closed segments');

-- Cancellation closes an active segment but cannot later be reopened. A restarted client
-- with no monotonic continuity uses a zero delta and therefore does not invent elapsed time.
select public.study_session_mutate(jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000012','session_id','offline-cancel',
  'expected_revision',0,'action','start','elapsed_since_previous_ms',0,'occurred_at',null,
  'device_id','32000000-0000-4000-8000-000000000001','app','focal','kind','focus','phase','focus'
));
select public.study_session_mutate(jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000013','session_id','offline-cancel',
  'expected_revision',1,'action','cancel','elapsed_since_previous_ms',0,'occurred_at',null,
  'device_id','32000000-0000-4000-8000-000000000001','app','focal'
));
-- A client that reports no timing at all gets receipt time, not "0 ms since the previous
-- boundary". Ageing the canonical start by 30 minutes makes the difference unambiguous: the
-- old rule recorded zero active time here, which is a real sitting reported as no study at all.
select public.study_session_mutate(jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000021','session_id','untimed-direct-pause',
  'expected_revision',0,'action','start','device_id','32000000-0000-4000-8000-000000000001',
  'app','focal','kind','focus','phase','focus'
));
update public.study_sessions
   set started_at = clock_timestamp() - interval '30 minutes',
       segment_started_at = clock_timestamp() - interval '30 minutes',
       timing_at = clock_timestamp() - interval '30 minutes'
 where id = 'untimed-direct-pause';
create temporary table untimed_pause as
select public.study_session_mutate(jsonb_build_object(
  'mutation_id','22000000-0000-4000-8000-000000000022','session_id','untimed-direct-pause',
  'expected_revision',1,'action','pause','device_id','32000000-0000-4000-8000-000000000001',
  'app','focal','kind','focus','phase','focus'
)) as result;
select is((result->'session'->>'state') from untimed_pause,'paused','an untimed pause is applied');
select is((result->'session'->>'accumulated_active_ms')::bigint > 1700000,true,
  'an untimed pause records the elapsed run at server receipt time, not zero')
  from untimed_pause;

select is((select state from public.study_sessions where id='offline-cancel'),'cancelled','offline cancel remains terminal');
select is((select accumulated_active_ms from public.study_sessions where id='offline-cancel'),1::bigint,'restart recovery adds at most the one-millisecond positive-segment floor');
select is((select count(*)::integer from public.study_session_segments where session_id='offline-cancel' and ended_at is null),0,'cancel closes the only open segment');

select * from finish();
rollback;
