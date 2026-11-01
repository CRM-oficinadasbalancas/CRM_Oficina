-- Estoque: só o admin altera (cria/edita/apaga peças). O técnico só LÊ o estoque
-- (para escolher a peça no chamado) e alimenta chamados (assistências/equipamentos);
-- apagar chamado/equipamento é só do admin.
--
-- A baixa no estoque é automática: cada chamado que usa uma peça desconta a quantidade;
-- trocar a peça/quantidade reajusta; "não aprovado" ou apagar o chamado devolve a peça.
-- O gatilho roda com os direitos do dono (security definer), então o técnico dispara a
-- baixa sem poder editar o estoque diretamente.

create or replace function private.ajustar_estoque_assistencia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if OLD.peca_id is not null and coalesce(OLD.quantidade_peca_utilizada, 0) <> 0 and OLD.status <> 'nao_aprovada' then
      update public.estoque_pecas set quantidade = quantidade + OLD.quantidade_peca_utilizada where id = OLD.peca_id;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if NEW.peca_id is not null and coalesce(NEW.quantidade_peca_utilizada, 0) <> 0 and NEW.status <> 'nao_aprovada' then
      update public.estoque_pecas set quantidade = quantidade - NEW.quantidade_peca_utilizada where id = NEW.peca_id;
    end if;
  end if;
  return null;
end $$;

revoke all on function private.ajustar_estoque_assistencia() from public, anon, authenticated;

create trigger trg_assistencias_estoque
  after insert or update or delete on public.assistencias_tecnicas
  for each row execute function private.ajustar_estoque_assistencia();

-- estoque_pecas
drop policy estoque_all on public.estoque_pecas;
create policy estoque_select on public.estoque_pecas for select to authenticated
  using (private.meu_perfil() in ('admin', 'tecnico'));
create policy estoque_insert on public.estoque_pecas for insert to authenticated
  with check (private.meu_perfil() = 'admin');
create policy estoque_update on public.estoque_pecas for update to authenticated
  using (private.meu_perfil() = 'admin') with check (private.meu_perfil() = 'admin');
create policy estoque_delete on public.estoque_pecas for delete to authenticated
  using (private.meu_perfil() = 'admin');

-- assistencias_tecnicas
drop policy assistencias_write on public.assistencias_tecnicas;
create policy assistencias_insert on public.assistencias_tecnicas for insert to authenticated
  with check (private.meu_perfil() in ('admin', 'tecnico'));
create policy assistencias_update on public.assistencias_tecnicas for update to authenticated
  using (private.meu_perfil() in ('admin', 'tecnico')) with check (private.meu_perfil() in ('admin', 'tecnico'));
create policy assistencias_delete on public.assistencias_tecnicas for delete to authenticated
  using (private.meu_perfil() = 'admin');

-- equipamentos
drop policy equipamentos_write on public.equipamentos;
create policy equipamentos_insert on public.equipamentos for insert to authenticated
  with check (private.meu_perfil() in ('admin', 'tecnico'));
create policy equipamentos_update on public.equipamentos for update to authenticated
  using (private.meu_perfil() in ('admin', 'tecnico')) with check (private.meu_perfil() in ('admin', 'tecnico'));
create policy equipamentos_delete on public.equipamentos for delete to authenticated
  using (private.meu_perfil() = 'admin');
