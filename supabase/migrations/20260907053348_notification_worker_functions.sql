-- Service-role-only notification candidate and idempotency functions.
create or replace function public.notification_candidates()
returns table (
  user_id uuid,
  ppl_id uuid,
  nume_complet text,
  camera text,
  quarantine_day integer,
  notification_date date
)
language sql
security definer
set search_path = ''
as $$
  with clock as (
    select
      (now() at time zone 'Europe/Bucharest')::date as local_date,
      (now() at time zone 'Europe/Bucharest')::time as local_time
  )
  select
    pref.user_id,
    p.id,
    p.nume_complet,
    p.camera,
    (clock.local_date - p.data_depunerii + 1)::integer as quarantine_day,
    clock.local_date
  from public.notification_preferences pref
  join public.profiles prof on prof.id = pref.user_id and prof.active = true
  cross join public.ppl p
  cross join clock
  where pref.enabled = true
    and p.deleted_at is null
    and clock.local_time >= pref.notification_time
    and (clock.local_date - p.data_depunerii + 1)::integer = any(pref.notification_days)
    and (clock.local_date - p.data_depunerii + 1)::integer between 20 and 22;
$$;
revoke all on function public.notification_candidates() from public, anon, authenticated;
grant execute on function public.notification_candidates() to service_role;

create or replace function public.claim_notification(p_user_id uuid, p_ppl_id uuid, p_day integer, p_date date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare claimed boolean := false;
begin
  insert into public.notification_log(user_id, ppl_id, quarantine_day, notification_date, status, attempt_count, updated_at)
  values (p_user_id, p_ppl_id, p_day::smallint, p_date, 'pending', 1, now())
  on conflict (user_id, ppl_id, quarantine_day, notification_date)
  do update set
    status = 'pending',
    attempt_count = public.notification_log.attempt_count + 1,
    last_error = null,
    updated_at = now()
  where (
      public.notification_log.status = 'failed'
      or (public.notification_log.status = 'pending' and public.notification_log.updated_at < now() - interval '15 minutes')
    )
    and public.notification_log.attempt_count < 3;
  claimed := found;
  return claimed;
end;
$$;
revoke all on function public.claim_notification(uuid, uuid, integer, date) from public, anon, authenticated;
grant execute on function public.claim_notification(uuid, uuid, integer, date) to service_role;

create or replace function public.release_notification_claim(p_user_id uuid, p_ppl_id uuid, p_day integer, p_date date, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notification_log
  where user_id = p_user_id
    and ppl_id = p_ppl_id
    and quarantine_day = p_day
    and notification_date = p_date
    and status = 'pending'
    and sent_at is null;
end;
$$;
revoke all on function public.release_notification_claim(uuid, uuid, integer, date, text) from public, anon, authenticated;
grant execute on function public.release_notification_claim(uuid, uuid, integer, date, text) to service_role;

create or replace function public.mark_notification_sent(p_user_id uuid, p_ppl_id uuid, p_day integer, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_log
  set status = 'sent', sent_at = now(), last_error = null, updated_at = now()
  where user_id = p_user_id and ppl_id = p_ppl_id and quarantine_day = p_day and notification_date = p_date;
end;
$$;
revoke all on function public.mark_notification_sent(uuid, uuid, integer, date) from public, anon, authenticated;
grant execute on function public.mark_notification_sent(uuid, uuid, integer, date) to service_role;

create or replace function public.mark_notification_failed(p_user_id uuid, p_ppl_id uuid, p_day integer, p_date date, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_log
  set status = 'failed', last_error = left(coalesce(p_error, 'push failed'), 500), updated_at = now()
  where user_id = p_user_id and ppl_id = p_ppl_id and quarantine_day = p_day and notification_date = p_date;
end;
$$;
revoke all on function public.mark_notification_failed(uuid, uuid, integer, date, text) from public, anon, authenticated;
grant execute on function public.mark_notification_failed(uuid, uuid, integer, date, text) to service_role;
