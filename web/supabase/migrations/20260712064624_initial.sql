create table public.attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  id uuid not null,
  payload jsonb,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  primary key (user_id, id),
  constraint attempts_payload_object check (payload is null or jsonb_typeof(payload) = 'object'),
  constraint attempts_deleted_payload check (deleted_at is null or payload is null)
);

create table public.mistakes (
  user_id uuid not null references auth.users (id) on delete cascade,
  id uuid not null,
  payload jsonb,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  primary key (user_id, id),
  constraint mistakes_payload_object check (payload is null or jsonb_typeof(payload) = 'object'),
  constraint mistakes_deleted_payload check (deleted_at is null or payload is null)
);

alter table public.attempts enable row level security;
alter table public.mistakes enable row level security;

create policy "Users manage their attempts"
on public.attempts for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users manage their mistakes"
on public.mistakes for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.attempts to authenticated;
grant select, insert, update, delete on public.mistakes to authenticated;
