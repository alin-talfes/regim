-- The Supabase-created event-trigger helper must not be callable through PostgREST.
-- Event triggers do not require anon/authenticated EXECUTE grants.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
