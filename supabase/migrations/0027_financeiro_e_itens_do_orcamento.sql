-- Perfil Financeiro
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'atendente', 'vendedor', 'tecnico', 'programadora', 'recepcao', 'oficina_interna', 'financeiro'));

drop policy assistencias_select on public.assistencias_tecnicas;
create policy assistencias_select on public.assistencias_tecnicas for select to authenticated
  using (
    private.meu_perfil() in ('admin', 'atendente', 'programadora', 'recepcao', 'financeiro')
    or (private.meu_perfil() = 'tecnico' and tecnico_id = auth.uid())
    or (private.meu_perfil() = 'oficina_interna' and tipo = 'oficina')
  );
drop policy assistencias_update on public.assistencias_tecnicas;
create policy assistencias_update on public.assistencias_tecnicas for update to authenticated
  using (
    private.meu_perfil() in ('admin', 'programadora', 'recepcao', 'financeiro')
    or (private.meu_perfil() = 'tecnico' and tecnico_id = auth.uid())
    or (private.meu_perfil() = 'oficina_interna' and tipo = 'oficina')
  )
  with check (
    private.meu_perfil() in ('admin', 'programadora', 'recepcao', 'financeiro')
    or (private.meu_perfil() = 'tecnico' and tecnico_id = auth.uid())
    or (private.meu_perfil() = 'oficina_interna' and tipo = 'oficina')
  );

drop policy equipamentos_select on public.equipamentos;
create policy equipamentos_select on public.equipamentos for select to authenticated
  using (private.meu_perfil() in ('admin', 'atendente', 'programadora', 'recepcao', 'tecnico', 'oficina_interna', 'financeiro'));

drop policy clientes_select on public.clientes;
create policy clientes_select on public.clientes for select to authenticated
  using (
    private.meu_perfil() in ('admin', 'atendente', 'vendedor')
    or (private.meu_perfil() in ('programadora', 'recepcao', 'tecnico', 'oficina_interna', 'financeiro') and eh_cliente)
  );

-- Peças do orçamento / do serviço (várias por chamado), com o preço de venda do momento
create table public.chamado_itens (
  id uuid primary key default gen_random_uuid(),
  chamado_id uuid not null references public.assistencias_tecnicas(id) on delete cascade,
  peca_id uuid not null references public.estoque_pecas(id),
  quantidade numeric(10,2) not null check (quantidade > 0),
  preco_unit numeric(12,2),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index chamado_itens_chamado_idx on public.chamado_itens (chamado_id);
alter table public.chamado_itens enable row level security;

create policy chamado_itens_select on public.chamado_itens for select to authenticated
  using (exists (select 1 from public.assistencias_tecnicas a where a.id = chamado_itens.chamado_id));
create policy chamado_itens_insert on public.chamado_itens for insert to authenticated
  with check (private.meu_perfil() in ('admin', 'tecnico', 'oficina_interna')
              and exists (select 1 from public.assistencias_tecnicas a where a.id = chamado_itens.chamado_id));
create policy chamado_itens_update on public.chamado_itens for update to authenticated
  using (private.meu_perfil() in ('admin', 'tecnico', 'oficina_interna')
         and exists (select 1 from public.assistencias_tecnicas a where a.id = chamado_itens.chamado_id))
  with check (private.meu_perfil() in ('admin', 'tecnico', 'oficina_interna')
              and exists (select 1 from public.assistencias_tecnicas a where a.id = chamado_itens.chamado_id));
create policy chamado_itens_delete on public.chamado_itens for delete to authenticated
  using (private.meu_perfil() in ('admin', 'tecnico', 'oficina_interna')
         and exists (select 1 from public.assistencias_tecnicas a where a.id = chamado_itens.chamado_id));

create or replace function private.validar_item_chamado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  papel text := private.meu_perfil();
  cid uuid := case when tg_op = 'DELETE' then old.chamado_id else new.chamado_id end;
  ch public.assistencias_tecnicas%rowtype;
  preco numeric(12,2);
begin
  if papel is not null and papel <> 'admin' then
    select * into ch from public.assistencias_tecnicas where id = cid;
    if not found then raise exception 'Chamado não encontrado.'; end if;
    if ch.status not in ('aberta', 'em_andamento', 'orcamento_aprovado') then
      raise exception 'As peças deste chamado não podem mais ser alteradas.';
    end if;
    if papel = 'tecnico' and (ch.tipo <> 'campo' or ch.tecnico_id is distinct from auth.uid()) then
      raise exception 'Você só altera as peças dos seus chamados de rua.';
    end if;
    if tg_op = 'UPDATE' and new.chamado_id <> old.chamado_id then
      raise exception 'Não é possível mover a peça para outro chamado.';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;

  select preco_venda into preco from public.estoque_pecas where id = new.peca_id;
  if tg_op = 'INSERT' then
    if papel is null or papel = 'admin' then
      new.preco_unit := coalesce(new.preco_unit, preco);
    else
      new.preco_unit := preco;
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
  elsif new.peca_id is distinct from old.peca_id then
    new.preco_unit := preco;
  else
    new.preco_unit := old.preco_unit;
  end if;
  return new;
end $$;

create trigger trg_chamado_itens_validar
  before insert or update or delete on public.chamado_itens
  for each row execute function private.validar_item_chamado();

-- O que já estava registrado no chamado antigo (1 peça) vira item (o estoque já tinha baixado).
insert into public.chamado_itens (chamado_id, peca_id, quantidade, created_by)
select id, peca_id, quantidade_peca_utilizada, created_by
from public.assistencias_tecnicas
where peca_id is not null and coalesce(quantidade_peca_utilizada, 0) > 0 and status <> 'nao_aprovada';

-- Estoque: baixa quando o chamado FECHA (soma de todas as peças do chamado); reabrir ou apagar devolve.
-- Chamado devolvido sem conserto (orçamento recusado) não baixa estoque.
drop trigger trg_assistencias_estoque on public.assistencias_tecnicas;
drop function private.ajustar_estoque_assistencia();

create or replace function private.baixar_estoque_itens()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.status = 'concluida' and old.status <> 'concluida' and not new.devolvido then
      update public.estoque_pecas e set quantidade = e.quantidade - i.q
      from (select peca_id, sum(quantidade) q from public.chamado_itens where chamado_id = new.id group by peca_id) i
      where e.id = i.peca_id;
    elsif old.status = 'concluida' and new.status <> 'concluida' and not old.devolvido then
      update public.estoque_pecas e set quantidade = e.quantidade + i.q
      from (select peca_id, sum(quantidade) q from public.chamado_itens where chamado_id = new.id group by peca_id) i
      where e.id = i.peca_id;
    end if;
    return new;
  end if;
  if old.status = 'concluida' and not old.devolvido then
    update public.estoque_pecas e set quantidade = e.quantidade + i.q
    from (select peca_id, sum(quantidade) q from public.chamado_itens where chamado_id = old.id group by peca_id) i
    where e.id = i.peca_id;
  end if;
  return old;
end $$;

create trigger trg_assistencias_estoque_itens
  after update of status on public.assistencias_tecnicas
  for each row execute function private.baixar_estoque_itens();
create trigger trg_assistencias_estoque_itens_del
  before delete on public.assistencias_tecnicas
  for each row execute function private.baixar_estoque_itens();
