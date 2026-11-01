-- Chamados de CAMPO (técnico na rua, com agenda/rota) e de OFICINA INTERNA.
--
-- Perfis novos:
--   programadora    : abre e programa chamados de campo (escolhe técnico e data); aprova/recusa orçamento
--   recepcao        : abre chamados da oficina interna (defeito + selo/lacre antigos); aprova/recusa orçamento
--   tecnico         : técnico de campo — só vê/atende os chamados programados para ele
--   oficina_interna : técnicos internos — fazem a manutenção dos chamados com orçamento aprovado
--
-- Fluxo de status:
--   aberta ─(técnico inicia)→ em_andamento ─(técnico fecha)→ concluida
--   aberta/em_andamento ─(técnico transfere)→ pendente  (vira chamado de oficina, aguarda orçamento)
--   recepção abre direto como pendente (tipo oficina)
--   pendente ─(programadora/recepção)→ orcamento_aprovado | nao_aprovada (orçamento recusado → devolver ao cliente)
--   orcamento_aprovado ─(oficina interna inicia)→ em_andamento ─→ concluida

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'atendente', 'vendedor', 'tecnico', 'programadora', 'recepcao', 'oficina_interna'));

-- coordenadas do cliente (para a rota do técnico)
alter table public.clientes
  add column latitude double precision,
  add column longitude double precision,
  add column geocodificado_em timestamptz;

alter table public.assistencias_tecnicas
  add column tipo text not null default 'campo' check (tipo in ('campo', 'oficina')),
  add column tecnico_id uuid references public.profiles(id),
  add column data_agendada date,
  add column selo_antigo_ausente boolean not null default false,
  add column lacre_antigo_ausente boolean not null default false,
  add column iniciado_em timestamptz,
  add column fechado_em timestamptz,
  add column orcamento_por uuid references public.profiles(id),
  add column orcamento_em timestamptz;

alter table public.assistencias_tecnicas add constraint assistencias_status_check
  check (status in ('aberta', 'em_andamento', 'pendente', 'orcamento_aprovado', 'nao_aprovada', 'concluida'));

create index assistencias_tecnico_status_idx on public.assistencias_tecnicas (tecnico_id, status);

-- histórico do chamado (o que foi feito, por que foi transferido, decisões de orçamento...)
create table public.chamado_historico (
  id uuid primary key default gen_random_uuid(),
  chamado_id uuid not null references public.assistencias_tecnicas(id) on delete cascade,
  autor_id uuid references public.profiles(id),
  tipo text not null default 'nota' check (tipo in ('nota', 'inicio', 'pendencia', 'fechamento', 'orcamento')),
  status_para text,
  texto text not null,
  created_at timestamptz not null default now()
);
create index chamado_historico_chamado_idx on public.chamado_historico (chamado_id, created_at);
alter table public.chamado_historico enable row level security;

-- ---------------------------------------------------------------------------
-- Regras do chamado (valem para qualquer caminho de acesso, não só para a tela)
-- ---------------------------------------------------------------------------
create or replace function private.validar_chamado()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  papel text := private.meu_perfil();
begin
  -- sem perfil (service_role, migrações): sem restrição
  if papel is null or papel = 'admin' then
    if tg_op = 'UPDATE' then
      if new.status = 'em_andamento' and old.status <> 'em_andamento' and new.iniciado_em is null then new.iniciado_em := now(); end if;
      if new.status = 'concluida' and old.status <> 'concluida' then new.fechado_em := now(); end if;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if papel = 'programadora' then
      if new.tipo <> 'campo' or new.status <> 'aberta' then
        raise exception 'A programação abre chamados de campo com status Aberto.';
      end if;
    elsif papel = 'recepcao' then
      if new.tipo <> 'oficina' or new.status <> 'pendente' then
        raise exception 'A recepção abre chamados da oficina interna (aguardando orçamento).';
      end if;
      if btrim(coalesce(new.descricao_defeito, '')) = '' then
        raise exception 'Informe o defeito.';
      end if;
      if btrim(coalesce(new.selo_antigo, '')) = '' and not new.selo_antigo_ausente then
        raise exception 'Informe o selo antigo ou marque "Não possui selo".';
      end if;
      if btrim(coalesce(new.lacre_antigo, '')) = '' and not new.lacre_antigo_ausente then
        raise exception 'Informe o lacre antigo ou marque "Não possui lacre".';
      end if;
      new.pausado_em := now();
    else
      raise exception 'Seu perfil não abre chamados.';
    end if;
    new.created_by := auth.uid();
    return new;
  end if;

  -- UPDATE
  if papel in ('tecnico', 'oficina_interna') then
    if new.cliente_id <> old.cliente_id or new.equipamento_id <> old.equipamento_id
       or new.tecnico_id is distinct from old.tecnico_id
       or new.data_agendada is distinct from old.data_agendada
       or new.descricao_defeito is distinct from old.descricao_defeito then
      raise exception 'Você não pode alterar cliente, equipamento, defeito, técnico ou agenda do chamado.';
    end if;
  end if;

  if new.status is distinct from old.status then
    if papel = 'tecnico' then
      if not ((old.status = 'aberta' and new.status in ('em_andamento', 'pendente'))
           or (old.status = 'em_andamento' and new.status in ('pendente', 'concluida'))) then
        raise exception 'Mudança de status não permitida para o técnico (% → %).', old.status, new.status;
      end if;
    elsif papel = 'oficina_interna' then
      if not ((old.status = 'orcamento_aprovado' and new.status = 'em_andamento')
           or (old.status = 'em_andamento' and new.status = 'concluida')) then
        raise exception 'Mudança de status não permitida para a oficina interna (% → %).', old.status, new.status;
      end if;
    elsif papel in ('programadora', 'recepcao') then
      if not (old.status = 'pendente' and new.status in ('orcamento_aprovado', 'nao_aprovada')) then
        raise exception 'Você só decide o orçamento de chamados pendentes (aprovar ou recusar).';
      end if;
    else
      raise exception 'Seu perfil não altera chamados.';
    end if;
  elsif papel in ('tecnico', 'oficina_interna') and old.status in ('pendente', 'orcamento_aprovado', 'nao_aprovada', 'concluida')
        and not (papel = 'oficina_interna' and old.status = 'orcamento_aprovado') then
    raise exception 'Este chamado não pode mais ser editado por você.';
  end if;

  -- efeitos automáticos
  if new.status is distinct from old.status then
    if new.status = 'em_andamento' and new.iniciado_em is null then new.iniciado_em := now(); end if;
    if new.status = 'pendente' then
      new.pausado_em := coalesce(old.pausado_em, now());
      if papel = 'tecnico' then new.tipo := 'oficina'; end if;  -- transferência para a oficina interna
    else
      new.pausado_em := null;
    end if;
    if new.status in ('orcamento_aprovado', 'nao_aprovada') then
      new.orcamento_por := auth.uid();
      new.orcamento_em := now();
    end if;
    if new.status = 'concluida' then
      new.fechado_em := now();
      if btrim(coalesce(new.selo_novo, '')) = '' then raise exception 'Informe o selo novo para fechar o chamado.'; end if;
      if btrim(coalesce(new.lacre_novo, '')) = '' then raise exception 'Informe o lacre novo para fechar o chamado.'; end if;
      if btrim(coalesce(new.selo_antigo, '')) = '' and not new.selo_antigo_ausente then
        raise exception 'Informe o selo antigo ou marque "Não possui selo".';
      end if;
      if btrim(coalesce(new.lacre_antigo, '')) = '' and not new.lacre_antigo_ausente then
        raise exception 'Informe o lacre antigo ou marque "Não possui lacre".';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger trg_assistencias_validar
  before insert or update on public.assistencias_tecnicas
  for each row execute function private.validar_chamado();

-- ---------------------------------------------------------------------------
-- RLS: assistencias_tecnicas
-- ---------------------------------------------------------------------------
drop policy assistencias_select on public.assistencias_tecnicas;
drop policy assistencias_insert on public.assistencias_tecnicas;
drop policy assistencias_update on public.assistencias_tecnicas;
drop policy assistencias_delete on public.assistencias_tecnicas;

create policy assistencias_select on public.assistencias_tecnicas for select to authenticated
  using (
    private.meu_perfil() in ('admin', 'atendente', 'programadora', 'recepcao')
    or (private.meu_perfil() = 'tecnico' and tecnico_id = auth.uid())
    or (private.meu_perfil() = 'oficina_interna' and tipo = 'oficina')
  );
create policy assistencias_insert on public.assistencias_tecnicas for insert to authenticated
  with check (private.meu_perfil() in ('admin', 'programadora', 'recepcao'));
create policy assistencias_update on public.assistencias_tecnicas for update to authenticated
  using (
    private.meu_perfil() in ('admin', 'programadora', 'recepcao')
    or (private.meu_perfil() = 'tecnico' and tecnico_id = auth.uid())
    or (private.meu_perfil() = 'oficina_interna' and tipo = 'oficina')
  )
  with check (
    private.meu_perfil() in ('admin', 'programadora', 'recepcao')
    or (private.meu_perfil() = 'tecnico' and tecnico_id = auth.uid())
    or (private.meu_perfil() = 'oficina_interna' and tipo = 'oficina')
  );
create policy assistencias_delete on public.assistencias_tecnicas for delete to authenticated
  using (private.meu_perfil() = 'admin');

-- histórico do chamado
create policy chamado_hist_select on public.chamado_historico for select to authenticated
  using (exists (select 1 from public.assistencias_tecnicas a where a.id = chamado_id));
create policy chamado_hist_insert on public.chamado_historico for insert to authenticated
  with check (autor_id = auth.uid() and exists (select 1 from public.assistencias_tecnicas a where a.id = chamado_id));
create policy chamado_hist_admin_delete on public.chamado_historico for delete to authenticated
  using (private.meu_perfil() = 'admin');

-- ---------------------------------------------------------------------------
-- RLS: clientes (perfis de chamado só enxergam clientes da Oficina, nunca os leads)
-- ---------------------------------------------------------------------------
drop policy clientes_select on public.clientes;
drop policy clientes_insert on public.clientes;
drop policy clientes_update on public.clientes;

create policy clientes_select on public.clientes for select to authenticated
  using (
    private.meu_perfil() in ('admin', 'atendente', 'vendedor')
    or (private.meu_perfil() in ('programadora', 'recepcao', 'tecnico', 'oficina_interna') and eh_cliente)
  );
create policy clientes_insert on public.clientes for insert to authenticated
  with check (
    private.meu_perfil() in ('admin', 'atendente', 'vendedor')
    or (private.meu_perfil() in ('programadora', 'recepcao') and eh_cliente)
  );
create policy clientes_update on public.clientes for update to authenticated
  using (
    private.meu_perfil() in ('admin', 'atendente', 'vendedor')
    or (private.meu_perfil() in ('programadora', 'recepcao') and eh_cliente)
  )
  with check (
    private.meu_perfil() in ('admin', 'atendente', 'vendedor')
    or (private.meu_perfil() in ('programadora', 'recepcao') and eh_cliente)
  );

-- ---------------------------------------------------------------------------
-- RLS: equipamentos e estoque
-- ---------------------------------------------------------------------------
drop policy equipamentos_select on public.equipamentos;
drop policy equipamentos_insert on public.equipamentos;
drop policy equipamentos_update on public.equipamentos;
create policy equipamentos_select on public.equipamentos for select to authenticated
  using (private.meu_perfil() in ('admin', 'atendente', 'programadora', 'recepcao', 'tecnico', 'oficina_interna'));
create policy equipamentos_insert on public.equipamentos for insert to authenticated
  with check (private.meu_perfil() in ('admin', 'programadora', 'recepcao', 'tecnico'));
create policy equipamentos_update on public.equipamentos for update to authenticated
  using (private.meu_perfil() in ('admin', 'programadora', 'recepcao', 'tecnico'))
  with check (private.meu_perfil() in ('admin', 'programadora', 'recepcao', 'tecnico'));

drop policy estoque_select on public.estoque_pecas;
create policy estoque_select on public.estoque_pecas for select to authenticated
  using (private.meu_perfil() in ('admin', 'tecnico', 'oficina_interna'));

-- ---------------------------------------------------------------------------
-- Funções de apoio (executam com direitos do dono, mas checam o perfil)
-- ---------------------------------------------------------------------------
create or replace function public.listar_tecnicos()
returns table (id uuid, nome text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.nome_exibicao, p.role
  from public.profiles p
  where p.role in ('tecnico', 'oficina_interna')
    and private.meu_perfil() in ('admin', 'programadora', 'recepcao')
  order by p.nome_exibicao
$$;
revoke all on function public.listar_tecnicos() from public, anon;
grant execute on function public.listar_tecnicos() to authenticated;

create or replace function public.salvar_geocodigo(p_cliente uuid, p_lat double precision, p_lng double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if private.meu_perfil() not in ('admin', 'programadora', 'recepcao', 'tecnico', 'oficina_interna') then
    raise exception 'Sem permissão.';
  end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Coordenadas inválidas.';
  end if;
  update public.clientes set latitude = p_lat, longitude = p_lng, geocodificado_em = now()
  where id = p_cliente and eh_cliente;
end $$;
revoke all on function public.salvar_geocodigo(uuid, double precision, double precision) from public, anon;
grant execute on function public.salvar_geocodigo(uuid, double precision, double precision) to authenticated;
