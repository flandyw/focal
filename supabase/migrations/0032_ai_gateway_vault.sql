-- Gateway keys never enter the sync feed or a client-readable table.
begin;

create extension if not exists supabase_vault cascade;
revoke all on schema vault from public, anon, authenticated;
revoke all on table vault.secrets, vault.decrypted_secrets from public, anon, authenticated;

create function public.ai_gateway_key_status(p_expected_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' stable as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or v_uid is distinct from p_expected_user_id then
    raise exception 'Account changed. Sign in again.' using errcode = '28000';
  end if;
  return exists (select 1 from vault.secrets where name = 'focal:ai-gateway:' || v_uid::text);
end $$;

create function public.ai_gateway_key_save(p_expected_user_id uuid, p_api_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_key text := btrim(p_api_key);
begin
  if v_uid is null or v_uid is distinct from p_expected_user_id then
    raise exception 'Account changed. Sign in again.' using errcode = '28000';
  end if;
  if v_key is null or char_length(v_key) not between 1 and 4096 or v_key !~ '^[!-~]+$' then
    raise exception 'Enter a valid Gateway API key.' using errcode = '22023';
  end if;
  -- Keep account deletion and concurrent key changes from leaving an orphaned secret.
  perform 1 from auth.users where id = v_uid for key share;
  if not found then raise exception 'Account not found.' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('focal:ai-gateway:' || v_uid::text, 0));
  select id into v_id from vault.secrets where name = 'focal:ai-gateway:' || v_uid::text;
  if v_id is null then
    perform vault.create_secret(v_key, 'focal:ai-gateway:' || v_uid::text, 'Focal AI Gateway key');
  else
    perform vault.update_secret(v_id, v_key);
  end if;
end $$;

create function public.ai_gateway_key_delete(p_expected_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or v_uid is distinct from p_expected_user_id then
    raise exception 'Account changed. Sign in again.' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('focal:ai-gateway:' || v_uid::text, 0));
  delete from vault.secrets where name = 'focal:ai-gateway:' || v_uid::text;
end $$;

-- Only the server's service role can decrypt, after it verifies the caller's session.
create function public.ai_gateway_key_read(p_user_id uuid)
returns text language sql security definer set search_path = '' stable as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'focal:ai-gateway:' || p_user_id::text;
$$;

create function public.ai_gateway_key_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where name = 'focal:ai-gateway:' || old.id::text;
  return old;
end $$;
create trigger ai_gateway_key_cleanup after delete on auth.users
for each row execute function public.ai_gateway_key_cleanup();

revoke all on function public.ai_gateway_key_status(uuid), public.ai_gateway_key_save(uuid, text), public.ai_gateway_key_delete(uuid), public.ai_gateway_key_read(uuid), public.ai_gateway_key_cleanup() from public, anon, authenticated;
grant execute on function public.ai_gateway_key_status(uuid), public.ai_gateway_key_save(uuid, text), public.ai_gateway_key_delete(uuid) to authenticated;
grant execute on function public.ai_gateway_key_read(uuid) to service_role;

commit;
