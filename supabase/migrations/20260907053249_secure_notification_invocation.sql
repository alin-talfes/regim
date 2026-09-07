-- Secure cron -> Edge Function invocation with a one-time database capability token.
create table private.notification_invocation_tokens (
  token uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz
);
revoke all on private.notification_invocation_tokens from public, anon, authenticated;

create or replace function public.consume_notification_invocation(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  consumed boolean := false;
begin
  update private.notification_invocation_tokens
  set consumed_at = now()
  where token = p_token
    and consumed_at is null
    and expires_at >= now();
  consumed := found;
  delete from private.notification_invocation_tokens where expires_at < now() - interval '1 hour';
  return consumed;
end;
$$;
revoke all on function public.consume_notification_invocation(uuid) from public, anon, authenticated;
grant execute on function public.consume_notification_invocation(uuid) to service_role;

select cron.schedule(
  'regim-send-quarantine-notifications',
  '*/5 * * * *',
  $cron$
    with invocation as (
      insert into private.notification_invocation_tokens default values
      returning token
    )
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'regim_project_url') || '/functions/v1/send-quarantine-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-invocation-token', (select token::text from invocation)
      ),
      body := jsonb_build_object('scheduled_at', now()),
      timeout_milliseconds := 20000
    );
  $cron$
);
