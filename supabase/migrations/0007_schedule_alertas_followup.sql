-- Roda a function alertas-followup a cada 30 minutos. O token usado no
-- header Authorization é a anon key pública do projeto (a mesma já
-- embutida em admin/js/admin-config.js) — não é segredo, só satisfaz o
-- verify_jwt da function. A function em si usa a service_role key
-- (injetada automaticamente pelo runtime do Supabase) pra fazer as
-- operações privilegiadas no banco.
select cron.schedule(
  'alertas-followup',
  '*/30 * * * *',
  $$
  select extensions.http_post(
    url := 'https://gbahaegarnzgebgzeumk.supabase.co/functions/v1/alertas-followup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiYWhhZWdhcm56Z2ViZ3pldW1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNDU1NzAsImV4cCI6MjEwNDYyMTU3MH0.MOW7_d49r1mZehB6t4pDbMsNCEV82rwcuFyT88T29Ec'
    ),
    body := '{}'::jsonb
  );
  $$
);
