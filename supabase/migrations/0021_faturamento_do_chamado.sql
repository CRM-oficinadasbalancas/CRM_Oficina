-- Faturamento: chamado fechado que passou por orçamento aprovado volta para a recepção faturar.
-- Só a recepção (e o admin) registra o faturamento; vale uma única vez por chamado.

alter table public.assistencias_tecnicas
  add column faturado_em timestamptz,
  add column faturado_por uuid references public.profiles(id) on delete set null;

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
    if old.status <> 'concluida' or old.orcamento_em is null then
      raise exception 'Só é possível faturar chamados fechados que passaram por orçamento aprovado.';
    end if;
    new.faturado_em := now();
    new.faturado_por := auth.uid();
  end if;
  return new;
end $$;

create trigger trg_assistencias_faturamento
  before insert or update on public.assistencias_tecnicas
  for each row execute function private.validar_faturamento();
