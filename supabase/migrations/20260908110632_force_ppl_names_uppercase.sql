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

  new.nume_complet := upper(btrim(new.nume_complet));
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

alter table public.ppl disable trigger ppl_touch_before_write;
update public.ppl
set nume_complet = upper(btrim(nume_complet))
where nume_complet <> upper(btrim(nume_complet));
alter table public.ppl enable trigger ppl_touch_before_write;
