-- REGIM initial schema
-- Business rule: deposit date is day 1; day 21 / expiry = deposit date + 20 calendar days.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

do $$ begin
  create type public.app_role as enum ('admin', 'operator');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.legal_status as enum ('arestat_preventiv', 'condamnat_definitiv');
exception when duplicate_object then null; end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role public.app_role not null default 'operator',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ppl (
  id uuid primary key default gen_random_uuid(),
  nume_complet text not null check (length(btrim(nume_complet)) > 0),
  camera text not null check (camera in ('E1.14','E1.15','E1.16','E1.17','E1.18','E1.19','E1.20','E1.21','E1.22','E1.23','E1.24','E1.25')),
  situatie_juridica public.legal_status not null,
  data_depunerii date not null,
  data_expirarii date generated always as (data_depunerii + 20) stored,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  constraint ppl_deleted_pair check (
    (deleted_at is null and deleted_by is null) or
    (deleted_at is not null and deleted_by is not null)
  )
);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  notification_days smallint[] not null default array[20,21,22]::smallint[],
  notification_time time without time zone not null default '08:00',
  timezone text not null default 'Europe/Bucharest' check (timezone = 'Europe/Bucharest'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_days_allowed check (
    notification_days <@ array[20,21,22]::smallint[]
    and array_length(notification_days, 1) is not null
  )
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  enabled boolean not null default true,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  ppl_id uuid not null references public.ppl(id) on delete cascade,
  quarantine_day smallint not null check (quarantine_day in (20,21,22)),
  notification_date date not null,
  sent_at timestamptz,
  status text not null check (status in ('pending','sent','failed')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 3),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ppl_id, quarantine_day, notification_date)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index ppl_deleted_at_idx on public.ppl (deleted_at);
create index ppl_data_depunerii_idx on public.ppl (data_depunerii);
create index ppl_data_expirarii_idx on public.ppl (data_expirarii);
create index ppl_camera_idx on public.ppl (camera);
create index ppl_situatie_juridica_idx on public.ppl (situatie_juridica);
create index push_subscriptions_user_enabled_idx on public.push_subscriptions (user_id, enabled);
create index notification_log_lookup_idx on public.notification_log (user_id, notification_date, status);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

-- Profiles are created server-side whenever an administrator creates an Auth user.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email,''), '@', 1)))
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_regim on auth.users;
create trigger on_auth_user_created_regim
after insert on auth.users
for each row execute function private.handle_new_auth_user();

-- Backfill if users existed before this migration.
insert into public.profiles (id, display_name)
select id, coalesce(raw_user_meta_data ->> 'display_name', split_part(coalesce(email,''), '@', 1))
from auth.users
on conflict (id) do nothing;

insert into public.notification_preferences (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and active = true
  );
$$;
revoke all on function private.is_active_user() from public, anon;
grant execute on function private.is_active_user() to authenticated;

create or replace function private.touch_ppl()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  local_today date := (now() at time zone 'Europe/Bucharest')::date;
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  new.nume_complet := btrim(new.nume_complet);
  if new.data_depunerii > local_today then
    raise exception 'Data depunerii nu poate fi in viitor';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := actor;
    new.updated_by := actor;
    new.created_at := now();
    new.updated_at := now();
    new.deleted_at := null;
    new.deleted_by := null;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := actor;
    new.updated_at := now();

    if old.deleted_at is null and new.deleted_at is not null then
      new.deleted_at := now();
      new.deleted_by := actor;
    elsif old.deleted_at is not null and new.deleted_at is null then
      new.deleted_by := null;
    elsif old.deleted_at is not null then
      new.deleted_at := old.deleted_at;
      new.deleted_by := old.deleted_by;
    else
      new.deleted_by := null;
    end if;
  end if;

  return new;
end;
$$;
revoke all on function private.touch_ppl() from public, anon, authenticated;

create trigger ppl_touch_before_write
before insert or update on public.ppl
for each row execute function private.touch_ppl();

create or replace function private.audit_ppl_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_name text;
begin
  if tg_op = 'INSERT' then
    action_name := 'CREATE_PPL';
    insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, old_data, new_data)
    values ((select auth.uid()), action_name, 'ppl', new.id, null, to_jsonb(new));
    return new;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    action_name := 'ARCHIVE_PPL';
  elsif old.deleted_at is not null and new.deleted_at is null then
    action_name := 'RESTORE_PPL';
  else
    action_name := 'UPDATE_PPL';
  end if;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, old_data, new_data)
  values ((select auth.uid()), action_name, 'ppl', new.id, to_jsonb(old), to_jsonb(new));
  return new;
end;
$$;
revoke all on function private.audit_ppl_change() from public, anon, authenticated;

create trigger ppl_audit_after_write
after insert or update on public.ppl
for each row execute function private.audit_ppl_change();

create or replace function private.touch_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.user_id := coalesce(old.user_id, (select auth.uid()));
  new.timezone := 'Europe/Bucharest';
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_preferences() from public, anon, authenticated;

create trigger preferences_touch_before_update
before update on public.notification_preferences
for each row execute function private.touch_preferences();

create or replace function private.audit_preferences_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, old_data, new_data)
  values ((select auth.uid()), 'UPDATE_NOTIFICATION_PREFERENCES', 'notification_preferences', new.user_id, to_jsonb(old), to_jsonb(new));
  return new;
end;
$$;
revoke all on function private.audit_preferences_change() from public, anon, authenticated;

create trigger preferences_audit_after_update
after update on public.notification_preferences
for each row execute function private.audit_preferences_change();

create or replace function private.touch_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  new.user_id := (select auth.uid());
  if tg_op = 'INSERT' then new.created_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_subscription() from public, anon, authenticated;

create trigger subscription_touch_before_write
before insert or update on public.push_subscriptions
for each row execute function private.touch_subscription();

-- RLS: deny by default, then grant only the exact authenticated access required.
alter table public.profiles enable row level security;
alter table public.ppl enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_log enable row level security;
alter table public.audit_logs enable row level security;

revoke all on public.profiles, public.ppl, public.notification_preferences, public.push_subscriptions, public.notification_log, public.audit_logs from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Profile: a signed-in active user can read only their own profile.
grant select on public.profiles to authenticated;
create policy profiles_select_own on public.profiles
for select to authenticated
using ((select auth.uid()) = id and active = true);

-- PPL: active users share the active operational register. No DELETE grant/policy exists.
grant select, insert, update on public.ppl to authenticated;
create policy ppl_select_active on public.ppl
for select to authenticated
using ((select private.is_active_user()) and deleted_at is null);
create policy ppl_insert_active on public.ppl
for insert to authenticated
with check ((select private.is_active_user()));
create policy ppl_update_active on public.ppl
for update to authenticated
using ((select private.is_active_user()) and deleted_at is null)
with check ((select private.is_active_user()));

-- Preferences: own row only.
grant select, update on public.notification_preferences to authenticated;
create policy notification_preferences_select_own on public.notification_preferences
for select to authenticated
using ((select auth.uid()) = user_id and (select private.is_active_user()));
create policy notification_preferences_update_own on public.notification_preferences
for update to authenticated
using ((select auth.uid()) = user_id and (select private.is_active_user()))
with check ((select auth.uid()) = user_id and (select private.is_active_user()));

-- Push subscriptions: own rows only; delete is allowed for device unsubscribe.
grant select, insert, update, delete on public.push_subscriptions to authenticated;
create policy push_subscriptions_select_own on public.push_subscriptions
for select to authenticated
using ((select auth.uid()) = user_id and (select private.is_active_user()));
create policy push_subscriptions_insert_own on public.push_subscriptions
for insert to authenticated
with check ((select auth.uid()) = user_id and (select private.is_active_user()));
create policy push_subscriptions_update_own on public.push_subscriptions
for update to authenticated
using ((select auth.uid()) = user_id and (select private.is_active_user()))
with check ((select auth.uid()) = user_id and (select private.is_active_user()));
create policy push_subscriptions_delete_own on public.push_subscriptions
for delete to authenticated
using ((select auth.uid()) = user_id and (select private.is_active_user()));

-- Server-only tables: no authenticated grants or policies.
revoke all on public.notification_log, public.audit_logs from authenticated, anon;

-- Cron invokes the Edge Function every 5 minutes. Secrets are resolved from Vault at execution time.
select cron.schedule(
  'regim-send-quarantine-notifications',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'regim_project_url') || '/functions/v1/send-quarantine-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'regim_cron_token')
      ),
      body := jsonb_build_object('scheduled_at', now()),
      timeout_milliseconds := 20000
    );
  $cron$
);
