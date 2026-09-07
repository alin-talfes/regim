create index if not exists audit_logs_actor_user_id_idx on public.audit_logs (actor_user_id);
create index if not exists notification_log_ppl_id_idx on public.notification_log (ppl_id);
create index if not exists ppl_created_by_idx on public.ppl (created_by);
create index if not exists ppl_updated_by_idx on public.ppl (updated_by);
create index if not exists ppl_deleted_by_idx on public.ppl (deleted_by);
