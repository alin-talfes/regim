create or replace function public.get_vapid_public_key()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'regim_vapid_public_key'
  limit 1;
$$;
revoke all on function public.get_vapid_public_key() from public, anon, authenticated;
grant execute on function public.get_vapid_public_key() to service_role;
