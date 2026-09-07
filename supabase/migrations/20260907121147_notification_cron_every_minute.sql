select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'regim-send-quarantine-notifications'),
  schedule := '* * * * *'
);
