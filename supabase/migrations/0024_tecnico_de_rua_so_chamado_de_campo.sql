-- O técnico de rua só altera chamados de campo: depois da transferência para a oficina interna
-- o chamado deixa de ser dele (continua visível para consulta).
create or replace function private.validar_chamado_tecnico_campo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if private.meu_perfil() = 'tecnico' and old.tipo <> 'campo' then
    raise exception 'Este chamado já está na oficina interna.';
  end if;
  return new;
end $$;

create trigger trg_assistencias_tecnico_tipo
  before update on public.assistencias_tecnicas
  for each row execute function private.validar_chamado_tecnico_campo();
