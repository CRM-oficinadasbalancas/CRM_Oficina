-- A oficina interna passa a controlar o status dos chamados da oficina:
--   iniciar (de Pendente ou Orçamento aprovado), voltar a Pendente (de Em atendimento ou Orçamento aprovado)
--   e fechar (de Pendente, Orçamento aprovado ou Em atendimento), sempre com os selos/lacres novos.
-- A decisão de orçamento (aprovar/recusar) continua só da recepção e da programação.
-- Faturamento: todo chamado fechado da oficina volta para a recepção faturar.

create or replace function private.validar_chamado()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  papel text := private.meu_perfil();
  perfil_tec text;
begin
  if papel is null or papel = 'admin' then
    if tg_op = 'UPDATE' then
      if new.status = 'em_andamento' and old.status <> 'em_andamento' and new.iniciado_em is null then new.iniciado_em := now(); end if;
      if new.status = 'concluida' and old.status <> 'concluida' then new.fechado_em := now(); end if;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if papel not in ('programadora', 'recepcao') then
      raise exception 'Seu perfil não abre chamados.';
    end if;
    if new.tecnico_id is null then
      raise exception 'Escolha o técnico responsável pelo chamado.';
    end if;
    perfil_tec := private.perfil_de(new.tecnico_id);
    if perfil_tec is null or perfil_tec not in ('tecnico', 'oficina_interna') then
      raise exception 'O responsável precisa ser um técnico de campo ou da oficina interna.';
    end if;
    if btrim(coalesce(new.descricao_defeito, '')) = '' then
      raise exception 'Informe o defeito.';
    end if;

    if perfil_tec = 'tecnico' then
      new.tipo := 'campo';
      if new.status <> 'aberta' then
        raise exception 'Chamado de campo é aberto com status Aberto.';
      end if;
      if new.data_agendada is null then
        raise exception 'Informe a data da visita.';
      end if;
      if new.selo_antigo is not null or new.lacre_antigo is not null
         or new.selo_antigo_ausente or new.lacre_antigo_ausente then
        raise exception 'Selo e lacre antigos são informados pelo técnico no atendimento, não na abertura.';
      end if;
    else
      new.tipo := 'oficina';
      if new.status <> 'pendente' then
        raise exception 'Chamado da oficina interna é aberto aguardando orçamento (Pendente).';
      end if;
      if btrim(coalesce(new.selo_antigo, '')) = '' and not new.selo_antigo_ausente then
        raise exception 'Informe o selo antigo ou marque "Não possui selo".';
      end if;
      if btrim(coalesce(new.lacre_antigo, '')) = '' and not new.lacre_antigo_ausente then
        raise exception 'Informe o lacre antigo ou marque "Não possui lacre".';
      end if;
      new.pausado_em := now();
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
      if not ((old.status in ('pendente', 'orcamento_aprovado') and new.status = 'em_andamento')
           or (old.status in ('orcamento_aprovado', 'em_andamento') and new.status = 'pendente')
           or (old.status in ('pendente', 'orcamento_aprovado', 'em_andamento') and new.status = 'concluida')) then
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
        and not (papel = 'oficina_interna' and old.status in ('pendente', 'orcamento_aprovado')) then
    raise exception 'Este chamado não pode mais ser editado por você.';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'em_andamento' and new.iniciado_em is null then new.iniciado_em := now(); end if;
    if new.status = 'pendente' then
      new.pausado_em := coalesce(old.pausado_em, now());
      if papel = 'tecnico' then new.tipo := 'oficina'; end if;
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

-- faturamento: qualquer chamado fechado da oficina (com ou sem orçamento registrado)
create or replace function private.validar_faturamento()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  papel text := private.meu_perfil();
begin
  if tg_op = 'INSERT' then
    if papel is not null and papel <> 'admin' then
      new.faturado_em := null;
      new.faturado_por := null;
    end if;
    return new;
  end if;

  if new.faturado_em is distinct from old.faturado_em or new.faturado_por is distinct from old.faturado_por then
    if papel is null then return new; end if;
    if papel = 'admin' then
      if new.faturado_em is not null and old.faturado_em is null then new.faturado_por := auth.uid(); end if;
      return new;
    end if;
    if papel <> 'recepcao' then
      raise exception 'Só a recepção fatura o serviço.';
    end if;
    if old.faturado_em is not null then
      raise exception 'Este serviço já foi faturado.';
    end if;
    if new.faturado_em is null then
      return new;
    end if;
    if old.status <> 'concluida' or old.tipo <> 'oficina' then
      raise exception 'Só é possível faturar chamados da oficina que já foram fechados.';
    end if;
    new.faturado_em := now();
    new.faturado_por := auth.uid();
  end if;
  return new;
end $$;
