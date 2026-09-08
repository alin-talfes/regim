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
        when d.day_no in (21,22)
          and public.non_working_reason(p.data_depunerii + (d.day_no - 1)) is not null
          then public.previous_operational_working_day(p.data_depunerii + (d.day_no - 1))
        else p.data_depunerii + (d.day_no - 1)
      end as operational_date,
      case
        when d.day_no in (21,22)
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
