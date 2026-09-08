create or replace function public.archive_ppl(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_affected integer := 0;
begin
  if v_actor is null or not (select private.is_active_user()) then
    raise exception 'Authentication required or inactive user' using errcode = '42501';
  end if;

  update public.ppl
     set deleted_at = now()
   where id = p_id
     and deleted_at is null;

  get diagnostics v_affected = row_count;
  return v_affected = 1;
end;
$$;

revoke all on function public.archive_ppl(uuid) from public, anon;
grant execute on function public.archive_ppl(uuid) to authenticated;

comment on function public.archive_ppl(uuid) is
  'Soft-deletes one active PPL row for an authenticated active user. The ppl trigger records deleted_by and audit metadata.';
