create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Controle de idempotência: cada linha representa um alerta já disparado,
-- pra function de alertas (supabase/functions/alertas-followup) nunca
-- mandar o mesmo e-mail duas vezes pro mesmo evento.
create table public.alertas_enviados (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  tipo text not null check (tipo in ('atraso', 'tres_negativas')),
  chave text not null,
  enviado_em timestamptz not null default now(),
  unique (cliente_id, tipo, chave)
);

alter table public.alertas_enviados enable row level security;
create policy "authenticated_full_access" on public.alertas_enviados
  for all to authenticated using (true) with check (true);
