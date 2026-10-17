-- Personal access tokens for the MCP server (server/mcp). Only the SHA-256 hash is stored; the
-- plaintext is returned once by mcp_token_create. The server resolves tokens with the service role.
begin;

create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index mcp_tokens_user_idx on public.mcp_tokens (user_id);

alter table public.mcp_tokens enable row level security;
revoke all on public.mcp_tokens from anon, authenticated;

create function public.mcp_token_create(p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text := 'focal_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if (select count(*) from public.mcp_tokens where user_id = v_uid and revoked_at is null) >= 20 then
    raise exception 'Too many active tokens' using errcode = '54000';
  end if;
  insert into public.mcp_tokens (user_id, name, token_hash)
  values (v_uid, left(btrim(p_name), 60), encode(sha256(convert_to(v_token, 'utf8')), 'hex'));
  return v_token;
end $$;

create function public.mcp_token_list()
returns table (id uuid, name text, created_at timestamptz, last_used_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select t.id, t.name, t.created_at, t.last_used_at from public.mcp_tokens t
  where t.user_id = (select auth.uid()) and t.revoked_at is null order by t.created_at desc;
$$;

create function public.mcp_token_revoke(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.mcp_tokens set revoked_at = now()
  where id = p_id and user_id = (select auth.uid()) and revoked_at is null;
$$;

revoke all on function public.mcp_token_create(text), public.mcp_token_list(), public.mcp_token_revoke(uuid) from public, anon;
grant execute on function public.mcp_token_create(text), public.mcp_token_list(), public.mcp_token_revoke(uuid) to authenticated;

commit;
