-- VAPID material is stored only in Supabase Vault and exposed only to service_role.
create or replace function public.store_vapid_keys(p_public_key text, p_private_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_public_key is null or length(p_public_key) < 80 or p_private_key is null or length(p_private_key) < 40 then
    raise exception 'Invalid VAPID key material';
  end if;
  perform pg_advisory_xact_lock(hashtext('regim_vapid_keys'));
  if not exists (select 1 from vault.decrypted_secrets where name = 'regim_vapid_public_key') then
    perform vault.create_secret(p_public_key, 'regim_vapid_public_key');
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'regim_vapid_private_key') then
    perform vault.create_secret(p_private_key, 'regim_vapid_private_key');
  end if;
end;
$$;
revoke all on function public.store_vapid_keys(text, text) from public, anon, authenticated;
grant execute on function public.store_vapid_keys(text, text) to service_role;

create or replace function public.get_vapid_keys()
returns table(public_key text, private_key text)
language sql
security definer
set search_path = ''
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'regim_vapid_public_key' limit 1),
    (select decrypted_secret from vault.decrypted_secrets where name = 'regim_vapid_private_key' limit 1)
  where exists (select 1 from vault.decrypted_secrets where name = 'regim_vapid_public_key')
    and exists (select 1 from vault.decrypted_secrets where name = 'regim_vapid_private_key');
$$;
revoke all on function public.get_vapid_keys() from public, anon, authenticated;
grant execute on function public.get_vapid_keys() to service_role;
