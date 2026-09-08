alter table public.notification_preferences
  drop constraint if exists notification_days_allowed;

alter table public.notification_preferences
  alter column notification_days
  set default array[20,21,22,23]::smallint[];

update public.notification_preferences
set notification_days = notification_days || 23::smallint
where not (23 = any(notification_days));

alter table public.notification_preferences
  add constraint notification_days_allowed
  check (
    notification_days <@ array[20,21,22,23]::smallint[]
    and array_length(notification_days, 1) is not null
  );

create or replace function public.notification_candidates()
returns table(
  user_id uuid,
  ppl_id uuid,
  nume_complet text,
  camera text,
  quarantine_day integer,
  notification_date date,
  milestone_date date,
  is_early boolean,
  non_working_reason text
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
    milestone.day_no,
    clock.local_date,
    milestone.milestone_date,
    milestone.operational_date < milestone.milestone_date,
    milestone.reason
  from public.notification_preferences pref
  join public.profiles prof on prof.id = pref.user_id and prof.active = true
  cross join public.ppl p
  cross join clock
  cross join lateral (
    select
      d.day_no,
      p.data_depunerii + (d.day_no - 1) as milestone_date,
      case
        when d.day_no in (20,21,22)
          and public.non_working_reason(p.data_depunerii + (d.day_no - 1)) is not null
          then public.previous_operational_working_day(p.data_depunerii + (d.day_no - 1))
        else p.data_depunerii + (d.day_no - 1)
      end as operational_date,
      case
        when d.day_no in (20,21,22)
          then public.non_working_reason(p.data_depunerii + (d.day_no - 1))
        else null
      end as reason
    from (values (20), (21), (22), (23)) as d(day_no)
  ) milestone
  where pref.enabled = true
    and p.deleted_at is null
    and clock.local_date < p.data_depunerii + 30
    and milestone.day_no = any(pref.notification_days)
    and milestone.operational_date = clock.local_date
    and clock.local_time >= pref.notification_time;
$$;

create or replace function public.ppl_history(p_id uuid)
returns table(
  audit_id bigint,
  action text,
  event_at timestamptz,
  actor_user_id uuid,
  actor_display_name text,
  old_camera text,
  new_camera text,
  old_situatie_juridica text,
  new_situatie_juridica text,
  old_data_depunerii date,
  new_data_depunerii date
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.is_active_user()) then
    raise exception 'Authentication required or inactive user' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.ppl p
    where p.id = p_id
      and p.deleted_at is null
  ) then
    return;
  end if;

  return query
  select
    a.id,
    a.action,
    a.created_at,
    a.actor_user_id,
    coalesce(pr.display_name, 'Utilizator')::text,
    nullif(a.old_data ->> 'camera', ''),
    nullif(a.new_data ->> 'camera', ''),
    nullif(a.old_data ->> 'situatie_juridica', ''),
    nullif(a.new_data ->> 'situatie_juridica', ''),
    nullif(a.old_data ->> 'data_depunerii', '')::date,
    nullif(a.new_data ->> 'data_depunerii', '')::date
  from public.audit_logs a
  left join public.profiles pr on pr.id = a.actor_user_id
  where a.entity_type = 'ppl'
    and a.entity_id = p_id
  order by a.created_at asc, a.id asc;
end;
$$;

revoke all on function public.ppl_history(uuid) from public, anon;
grant execute on function public.ppl_history(uuid) to authenticated;

comment on function public.ppl_history(uuid) is
  'Returns the controlled audit timeline for one non-deleted PPL row to authenticated active users.';
