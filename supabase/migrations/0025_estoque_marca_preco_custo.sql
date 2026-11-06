-- Peças: marca, preço de venda (visível a quem monta/vê orçamento) e custo (só admin e financeiro).
alter table public.estoque_pecas
  add column marca text,
  add column preco_venda numeric(12,2) check (preco_venda is null or preco_venda >= 0);

create table public.estoque_custos (
  peca_id uuid primary key references public.estoque_pecas(id) on delete cascade,
  custo numeric(12,2) not null check (custo >= 0),
  updated_at timestamptz not null default now()
);
alter table public.estoque_custos enable row level security;

create policy estoque_custos_select on public.estoque_custos for select to authenticated
  using (private.meu_perfil() in ('admin', 'financeiro'));
create policy estoque_custos_insert on public.estoque_custos for insert to authenticated
  with check (private.meu_perfil() = 'admin');
create policy estoque_custos_update on public.estoque_custos for update to authenticated
  using (private.meu_perfil() = 'admin') with check (private.meu_perfil() = 'admin');
create policy estoque_custos_delete on public.estoque_custos for delete to authenticated
  using (private.meu_perfil() = 'admin');

-- quem enxerga o estoque (saldo, marca e preço de venda): quem monta ou consulta orçamento
drop policy estoque_select on public.estoque_pecas;
create policy estoque_select on public.estoque_pecas for select to authenticated
  using (private.meu_perfil() in ('admin', 'tecnico', 'oficina_interna', 'programadora', 'recepcao', 'financeiro'));
