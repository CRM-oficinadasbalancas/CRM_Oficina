-- Correção da 0007: as funções do pg_net ficam no schema "net" (a extensão em si fica em "extensions").
-- Com extensions.http_post o cron falhava em toda execução.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'alertas-followup'),
  command := $cmd$
  $$
  select net.http_post(
    url := 'https://gbahaegarnzgebgzeumk.supabase.co/functions/v1/alertas-followup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiYWhhZWdhcm56Z2ViZ3pldW1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNDU1NzAsImV4cCI6MjEwNDYyMTU3MH0.MOW7_d49r1mZehB6t4pDbMsNCEV82rwcuFyT88T29Ec'
    ),
    body := '{}'::jsonb
  );
  $cmd$
);
