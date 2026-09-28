create table public.user_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  constraint user_state_payload_object check (jsonb_typeof(payload) = 'object')
);

alter table public.user_state enable row level security;

create policy "Users manage their state"
on public.user_state for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_state to authenticated;
