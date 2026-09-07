-- Defense in depth if public Auth signup has not yet been disabled in Dashboard.
alter table public.profiles alter column active set default false;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  provisioned_by_admin boolean := new.email_confirmed_at is not null and new.confirmation_sent_at is null;
begin
  insert into public.profiles (id, display_name, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email,''), '@', 1)),
    provisioned_by_admin
  )
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

comment on column public.profiles.active is
'Access gate. Default false. Admin-created, already-confirmed users are provisioned active; public signups remain inactive as defense in depth. Public signup must also be disabled in Supabase Auth settings.';
