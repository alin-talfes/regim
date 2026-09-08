create or replace function private.prevent_day31_ppl_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  local_today date := (now() at time zone 'Europe/Bucharest')::date;
begin
  if new.data_depunerii <= local_today - 30 then
    raise exception 'Nu poți adăuga o persoană aflată deja în Ziua 31 sau ulterior.';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_day31_ppl_insert() from public, anon, authenticated;

drop trigger if exists ppl_prevent_day31_insert on public.ppl;
create trigger ppl_prevent_day31_insert
before insert on public.ppl
for each row execute function private.prevent_day31_ppl_insert();

comment on function private.prevent_day31_ppl_insert() is
  'Refuză introducerea unei persoane care, raportat la data curentă Europe/Bucharest, este deja în Ziua 31 sau ulterior. Ziua depunerii este Ziua 1.';
