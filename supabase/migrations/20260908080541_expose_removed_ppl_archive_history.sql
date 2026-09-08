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
  'Returns the controlled audit timeline for one existing PPL row, including soft-deleted rows, to authenticated active users.';

create or replace function public.removed_ppl()
returns table(
  id uuid,
  nume_complet text,
  camera text,
  situatie_juridica public.legal_status,
  data_depunerii date,
  data_aplicarii_regimului_provizoriu date,
  created_at timestamptz,
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.is_active_user()) then
    raise exception 'Authentication required or inactive user' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.nume_complet,
    p.camera,
    p.situatie_juridica,
    p.data_depunerii,
    p.data_aplicarii_regimului_provizoriu,
    p.created_at,
    p.created_by,
    p.updated_at,
    p.updated_by,
    p.deleted_at,
    p.deleted_by
  from public.ppl p
  where p.deleted_at is not null
  order by p.deleted_at desc, p.nume_complet asc;
end;
$$;

revoke all on function public.removed_ppl() from public, anon;
grant execute on function public.removed_ppl() to authenticated;

comment on function public.removed_ppl() is
  'Returns soft-deleted PPL rows for the archive to authenticated active users without weakening the normal ppl SELECT policy.';

create or replace function public.removed_ppl_by_id(p_id uuid)
returns table(
  id uuid,
  nume_complet text,
  camera text,
  situatie_juridica public.legal_status,
  data_depunerii date,
  data_aplicarii_regimului_provizoriu date,
  created_at timestamptz,
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.is_active_user()) then
    raise exception 'Authentication required or inactive user' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.nume_complet,
    p.camera,
    p.situatie_juridica,
    p.data_depunerii,
    p.data_aplicarii_regimului_provizoriu,
    p.created_at,
    p.created_by,
    p.updated_at,
    p.updated_by,
    p.deleted_at,
    p.deleted_by
  from public.ppl p
  where p.id = p_id
    and p.deleted_at is not null
  limit 1;
end;
$$;

revoke all on function public.removed_ppl_by_id(uuid) from public, anon;
grant execute on function public.removed_ppl_by_id(uuid) to authenticated;

comment on function public.removed_ppl_by_id(uuid) is
  'Returns one soft-deleted PPL row for read-only archive details to authenticated active users.';
