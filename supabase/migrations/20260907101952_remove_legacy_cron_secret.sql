-- Remove the credential used by the superseded shared-token cron implementation.
-- Current notification invocation uses short-lived one-time capability tokens.
delete from vault.secrets where name = 'regim_cron_token';
