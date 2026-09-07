create or replace function public.notification_push_subscriptions(p_user_id uuid)
returns table(id uuid, endpoint text, p256dh text, auth text)
language sql
security definer
set search_path = ''
as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  where s.user_id = p_user_id
    and s.enabled = true;
$$;

revoke all on function public.notification_push_subscriptions(uuid) from public, anon, authenticated;
grant execute on function public.notification_push_subscriptions(uuid) to service_role;
