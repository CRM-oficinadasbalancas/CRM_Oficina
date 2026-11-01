-- Campos vindos da planilha "Acompanhamento dos leads":
--   canal_aquisicao: de onde veio o lead (Google Ads, Instagram, Indicação...)
--   situacao: ativo (em andamento), ganho (fechou) ou perdido. Quando não é
--             "ativo" o cliente sai da fila de pendências e dos alertas.
--   origem: 'manual' (cadastrado no sistema) ou 'importacao' (veio da
--           planilha). Clientes importados não disparam alertas por e-mail,
--           pra não inundar o gerente com leads antigos.
alter table public.clientes add column canal_aquisicao text;

alter table public.clientes add column situacao text not null default 'ativo'
  check (situacao in ('ativo', 'ganho', 'perdido'));

alter table public.clientes add column origem text not null default 'manual'
  check (origem in ('manual', 'importacao'));

alter table public.cliente_historico alter column created_at set default now();
