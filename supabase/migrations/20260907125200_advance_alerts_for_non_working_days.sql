create or replace function public.orthodox_easter_date(p_year integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  a integer; b integer; c integer; d integer; e integer;
  julian_month integer; julian_day integer; gregorian_offset integer;
begin
  a := mod(p_year, 4);
  b := mod(p_year, 7);
  c := mod(p_year, 19);
  d := mod(19 * c + 15, 30);
  e := mod(2 * a + 4 * b - d + 34, 7);
  julian_month := (d + e + 114) / 31;
  julian_day := mod(d + e + 114, 31) + 1;
  gregorian_offset := (p_year / 100) - (p_year / 400) - 2;
  return make_date(p_year, julian_month, julian_day) + gregorian_offset;
end;
$$;

create or replace function public.legal_holiday_name(p_date date)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  easter date;
  md text := to_char(p_date, 'MM-DD');
begin
  case md
    when '01-01' then return 'Anul Nou';
    when '01-02' then return 'A doua zi de Anul Nou';
    when '01-06' then return 'Boboteaza';
    when '01-07' then return 'Sf. Ioan';
    when '01-24' then return 'Ziua Unirii Principatelor Române';
    when '05-01' then return 'Ziua Muncii';
    when '06-01' then return 'Ziua Copilului';
    when '08-15' then return 'Adormirea Maicii Domnului';
    when '11-30' then return 'Sf. Andrei';
    when '12-01' then return 'Ziua Națională a României';
    when '12-25' then return 'Crăciunul';
    when '12-26' then return 'A doua zi de Crăciun';
    else null;
  end case;

  easter := public.orthodox_easter_date(extract(year from p_date)::integer);
  if p_date = easter - 2 then return 'Vinerea Mare'; end if;
  if p_date = easter then return 'Prima zi de Paști'; end if;
  if p_date = easter + 1 then return 'A doua zi de Paști'; end if;
  if p_date = easter + 49 then return 'Prima zi de Rusalii'; end if;
  if p_date = easter + 50 then return 'A doua zi de Rusalii'; end if;
  return null;
end;
$$;

create or replace function public.non_working_reason(p_date date)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  holiday text;
  dow integer := extract(isodow from p_date)::integer;
begin
  holiday := public.legal_holiday_name(p_date);
  if holiday is not null then return holiday; end if;
  if dow = 6 then return 'sâmbătă'; end if;
  if dow = 7 then return 'duminică'; end if;
  return null;
end;
$$;

create or replace function public.previous_operational_working_day(p_date date)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  candidate date := p_date - 1;
begin
  while public.non_working_reason(candidate) is not null loop
    candidate := candidate - 1;
  end loop;
  return candidate;
end;
$$;

revoke all on function public.orthodox_easter_date(integer) from public, anon, authenticated;
revoke all on function public.legal_holiday_name(date) from public, anon, authenticated;
revoke all on function public.non_working_reason(date) from public, anon, authenticated;
revoke all on function public.previous_operational_working_day(date) from public, anon, authenticated;
grant execute on function public.orthodox_easter_date(integer) to service_role;
grant execute on function public.legal_holiday_name(date) to service_role;
grant execute on function public.non_working_reason(date) to service_role;
grant execute on function public.previous_operational_working_day(date) to service_role;

drop function if exists public.notification_candidates();
create function public.notification_candidates()
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
        when public.non_working_reason(p.data_depunerii + (d.day_no - 1)) is not null
          then public.previous_operational_working_day(p.data_depunerii + (d.day_no - 1))
        else p.data_depunerii + (d.day_no - 1)
      end as operational_date,
      public.non_working_reason(p.data_depunerii + (d.day_no - 1)) as reason
    from (values (20), (21), (22)) as d(day_no)
  ) milestone
  where pref.enabled = true
    and p.deleted_at is null
    and milestone.day_no = any(pref.notification_days)
    and milestone.operational_date = clock.local_date
    and clock.local_time >= pref.notification_time;
$$;

revoke all on function public.notification_candidates() from public, anon, authenticated;
grant execute on function public.notification_candidates() to service_role;
