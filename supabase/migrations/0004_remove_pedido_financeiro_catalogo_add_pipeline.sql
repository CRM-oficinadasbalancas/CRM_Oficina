-- Remove os módulos de Pedido, Financeiro e Catálogo (o negócio da Oficina
-- não é venda por pedido/orçamento com itens — é acompanhamento de clientes
-- em 3 funis: Venda, Manutenção e Pós-venda).
drop table if exists public.pedido_itens_vacuo;
drop table if exists public.pedido_itens_gerais;
drop table if exists public.pedidos;
drop table if exists public.produtos_catalogo;
drop table if exists public.financeiro_entradas;
drop table if exists public.financeiro_saidas;

-- Cliente ganha uma categoria de funil (nula até ser atribuída) e passa a
-- exigir só nome + pelo menos um contato (telefone ou e-mail) — CNPJ não é
-- mais obrigatório (aliás nunca foi no banco, só na expectativa de uso).
alter table public.clientes add column categoria text
  check (categoria in ('venda', 'manutencao', 'pos_venda'));

alter table public.clientes add constraint clientes_contato_obrigatorio
  check (telefone_empresa is not null or email_empresa is not null);

-- Histórico de follow-up (Vendas/Manutenção/Pós-venda) — timeline de
-- anotações por cliente, independente do histórico de Assistência Técnica
-- (que continua vivendo em assistencias_tecnicas).
create table public.cliente_historico (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  anotacao text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.cliente_historico enable row level security;
create policy "authenticated_full_access" on public.cliente_historico
  for all to authenticated using (true) with check (true);
