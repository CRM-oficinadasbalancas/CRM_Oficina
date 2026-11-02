-- A lista de técnicos (só id, nome e perfil) passa a servir também ao técnico de campo e à oficina interna,
-- para a tela do chamado mostrar o nome do responsável em vez de "Técnico".
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
    and private.meu_perfil() in ('admin', 'programadora', 'recepcao', 'tecnico', 'oficina_interna')
  order by p.nome_exibicao
$$;
