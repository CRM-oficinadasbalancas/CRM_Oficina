-- Status de cada anotação do histórico de follow-up (estilo CRM).
-- Nulo nas anotações importadas da planilha.
alter table public.cliente_historico
  add column status text check (status in ('aberto','pendente','continuacao','fechado'));
