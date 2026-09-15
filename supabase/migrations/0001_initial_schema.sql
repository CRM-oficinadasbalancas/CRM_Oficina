-- ============================================================
-- CRM/ERP Oficina das Balanças — schema inicial
-- Reconstruído a partir do código-fonte do sistema base CRP
-- (QuboTech/Gest-o-CRM), que nunca versionou o schema em SQL.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- profiles  (1:1 com auth.users)
-- ============================================================
create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  nome_exibicao        text not null,
  must_change_password boolean not null default false,
  is_admin             boolean not null default false,
  created_at           timestamptz not null default now()
);

-- ============================================================
-- clientes
-- ============================================================
create table public.clientes (
  id                          uuid primary key default gen_random_uuid(),
  codigo                      text,
  cnpj_cpf                    text,
  razao_social                text not null,
  nome_fantasia               text,
  ie                          text,
  logradouro                  text,
  numero                      text,
  complemento                 text,
  bairro                      text,
  cep                         text,
  municipio                   text,
  uf                          text,
  telefone_empresa            text,
  email_empresa               text,
  contato_nome                text,
  contato_telefone            text,
  contato_email               text,
  forma_pagamento_padrao      text,
  local_entrega_preferencial  text,
  observacoes                 text,
  created_by                  uuid references public.profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ============================================================
-- equipamentos  (balanças do cliente)
-- ============================================================
create table public.equipamentos (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.clientes(id) on delete cascade,
  marca         text,
  modelo        text,
  numero_serie  text not null,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

-- ============================================================
-- estoque_pecas
-- ============================================================
create table public.estoque_pecas (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null unique,
  tipo_modelo  text not null,
  quantidade   numeric not null default 0,
  localidade   text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ============================================================
-- produtos_catalogo
-- ============================================================
create table public.produtos_catalogo (
  id              uuid primary key default gen_random_uuid(),
  nome_produto    text not null,
  codigo_produto  text,
  ncm             text,
  preco_unitario  numeric,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ============================================================
-- pedidos  (pedido OU orçamento, diferenciados por `tipo`)
--
-- cliente_id usa ON DELETE RESTRICT (não CASCADE): o front-end
-- (admin/js/clientes.js) depende do Postgres bloquear a exclusão
-- de um cliente com pedidos vinculados (erro 23503) para então
-- oferecer a tela de "transferir histórico" ou "excluir mesmo
-- assim". Com CASCADE esse fluxo nunca dispararia.
-- ============================================================
create table public.pedidos (
  id                           uuid primary key default gen_random_uuid(),
  numero                       integer generated always as identity,
  cliente_id                   uuid not null references public.clientes(id) on delete restrict,
  tipo                         text not null,
  status_orcamento             text,
  prazo_entrega                text,
  icms                         text,
  ipi                          text,
  regime_tributacao            text,
  transportadora_empresa       text,
  transportadora_cnpj          text,
  transportadora_endereco      text,
  transportadora_telefone      text,
  observacao                   text,
  forma_pagamento              text not null,
  boleto_quantidade            integer,
  boleto_dias                  integer,
  cartao_parcelas              integer,
  valor_total_a_pagar          numeric not null default 0,
  desconto_percentual          numeric,
  valor_total_a_pagar_vista    numeric,
  created_by                   uuid references public.profiles(id),
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

-- ============================================================
-- pedido_itens_vacuo
-- (largura_m/comprimento_m ficam em METROS; a UI mostra/edita em cm)
-- ============================================================
create table public.pedido_itens_vacuo (
  id                 uuid primary key default gen_random_uuid(),
  pedido_id          uuid not null references public.pedidos(id) on delete cascade,
  ordem              integer not null,
  item               text,
  material           text,
  largura_m          numeric,
  comprimento_m      numeric,
  espessura_micras   numeric,
  tipo               text,
  quantidade         numeric,
  peso               numeric,
  peso_total         numeric,
  taxa_preco_peso    numeric,
  vl_unitario        numeric,
  vl_total           numeric
);

-- ============================================================
-- pedido_itens_gerais
-- ============================================================
create table public.pedido_itens_gerais (
  id                   uuid primary key default gen_random_uuid(),
  pedido_id            uuid not null references public.pedidos(id) on delete cascade,
  ordem                integer not null,
  produto_catalogo_id  uuid references public.produtos_catalogo(id),
  nome_produto         text not null,
  codigo_produto       text,
  ncm                  text,
  preco_unitario       numeric not null default 0,
  quantidade           numeric not null default 0,
  preco_total          numeric
);

-- ============================================================
-- assistencias_tecnicas
-- ============================================================
create table public.assistencias_tecnicas (
  id                          uuid primary key default gen_random_uuid(),
  numero                      integer generated always as identity,
  cliente_id                  uuid not null references public.clientes(id) on delete cascade,
  equipamento_id              uuid not null references public.equipamentos(id) on delete cascade,
  descricao_defeito           text not null,
  selo_antigo                 text,
  selo_novo                   text,
  lacre_antigo                text,
  lacre_novo                  text,
  status                      text not null default 'aberta',
  resolucao                   text,
  peca_id                     uuid references public.estoque_pecas(id),
  quantidade_peca_utilizada   numeric,
  pausado_em                  timestamptz,
  created_by                  uuid references public.profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ============================================================
-- financeiro_entradas / financeiro_saidas
-- (lançamentos manuais, sem FK para pedidos/clientes — confirmado
-- em admin/js/financeiro.js, que só tem campos de texto livre)
-- ============================================================
create table public.financeiro_entradas (
  id            uuid primary key default gen_random_uuid(),
  data          date not null,
  cliente_nome  text,
  produto       text,
  valor         numeric not null,
  observacao    text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

create table public.financeiro_saidas (
  id          uuid primary key default gen_random_uuid(),
  data        date not null,
  descricao   text not null,
  categoria   text,
  valor       numeric not null,
  observacao  text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- ============================================================
-- Triggers para manter updated_at em dia
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_clientes_updated_at before update on public.clientes
  for each row execute function public.set_updated_at();
create trigger trg_estoque_pecas_updated_at before update on public.estoque_pecas
  for each row execute function public.set_updated_at();
create trigger trg_produtos_catalogo_updated_at before update on public.produtos_catalogo
  for each row execute function public.set_updated_at();
create trigger trg_pedidos_updated_at before update on public.pedidos
  for each row execute function public.set_updated_at();
create trigger trg_assistencias_tecnicas_updated_at before update on public.assistencias_tecnicas
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS: authenticated tem acesso total, anon não tem acesso a nada
-- ============================================================
alter table public.profiles              enable row level security;
alter table public.clientes              enable row level security;
alter table public.equipamentos          enable row level security;
alter table public.estoque_pecas         enable row level security;
alter table public.produtos_catalogo     enable row level security;
alter table public.pedidos               enable row level security;
alter table public.pedido_itens_vacuo    enable row level security;
alter table public.pedido_itens_gerais   enable row level security;
alter table public.assistencias_tecnicas enable row level security;
alter table public.financeiro_entradas   enable row level security;
alter table public.financeiro_saidas     enable row level security;

create policy "authenticated_full_access" on public.profiles
  for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.clientes
  for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.equipamentos
  for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.estoque_pecas
  for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.produtos_catalogo
  for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.pedidos
  for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.pedido_itens_vacuo
  for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.pedido_itens_gerais
  for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.assistencias_tecnicas
  for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.financeiro_entradas
  for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.financeiro_saidas
  for all to authenticated using (true) with check (true);
