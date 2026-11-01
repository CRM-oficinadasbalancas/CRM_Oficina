-- Segurança por perfil no banco (antes só o menu escondia as telas; a policy
-- "authenticated_full_access" liberava tudo para qualquer usuário logado).
--
--   admin     : tudo
--   atendente : clientes e histórico (ler/escrever), apagar clientes; só LÊ assistências/equipamentos
--   tecnico   : clientes e histórico (ler/escrever), assistências, equipamentos e estoque (ler/escrever)
--
-- profiles: cada um lê/atualiza só o próprio perfil (sem poder mudar o próprio role); admin gerencia todos.
-- alertas_enviados: sem policy — só a edge function (service_role) acessa.
-- Quem está logado mas sem linha em profiles não enxerga nada.

-- A função de apoio fica num schema privado (não exposta como RPC da API).
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.meu_perfil()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

revoke all on function private.meu_perfil() from public, anon;
grant execute on function private.meu_perfil() to authenticated;

-- remove as policies abertas
drop policy if exists authenticated_full_access on public.profiles;
drop policy if exists authenticated_full_access on public.clientes;
drop policy if exists authenticated_full_access on public.cliente_historico;
drop policy if exists authenticated_full_access on public.assistencias_tecnicas;
drop policy if exists authenticated_full_access on public.equipamentos;
drop policy if exists authenticated_full_access on public.estoque_pecas;
drop policy if exists authenticated_full_access on public.alertas_enviados;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.meu_perfil() = 'admin');
create policy profiles_update_proprio on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = private.meu_perfil());
create policy profiles_admin_all on public.profiles for all to authenticated
  using (private.meu_perfil() = 'admin')
  with check (private.meu_perfil() = 'admin');

-- clientes
create policy clientes_select on public.clientes for select to authenticated
  using (private.meu_perfil() in ('admin', 'atendente', 'tecnico'));
create policy clientes_insert on public.clientes for insert to authenticated
  with check (private.meu_perfil() in ('admin', 'atendente', 'tecnico'));
create policy clientes_update on public.clientes for update to authenticated
  using (private.meu_perfil() in ('admin', 'atendente', 'tecnico'))
  with check (private.meu_perfil() in ('admin', 'atendente', 'tecnico'));
create policy clientes_delete on public.clientes for delete to authenticated
  using (private.meu_perfil() in ('admin', 'atendente'));

-- cliente_historico (anotações não são editadas nem apagadas pela tela: só admin)
create policy historico_select on public.cliente_historico for select to authenticated
  using (private.meu_perfil() in ('admin', 'atendente', 'tecnico'));
create policy historico_insert on public.cliente_historico for insert to authenticated
  with check (private.meu_perfil() in ('admin', 'atendente', 'tecnico'));
create policy historico_admin_update on public.cliente_historico for update to authenticated
  using (private.meu_perfil() = 'admin') with check (private.meu_perfil() = 'admin');
create policy historico_admin_delete on public.cliente_historico for delete to authenticated
  using (private.meu_perfil() = 'admin');

-- assistências técnicas e equipamentos: atendente só lê (botão "Assist. Técnica" na tela de Clientes)
create policy assistencias_select on public.assistencias_tecnicas for select to authenticated
  using (private.meu_perfil() in ('admin', 'atendente', 'tecnico'));
create policy assistencias_write on public.assistencias_tecnicas for all to authenticated
  using (private.meu_perfil() in ('admin', 'tecnico'))
  with check (private.meu_perfil() in ('admin', 'tecnico'));

create policy equipamentos_select on public.equipamentos for select to authenticated
  using (private.meu_perfil() in ('admin', 'atendente', 'tecnico'));
create policy equipamentos_write on public.equipamentos for all to authenticated
  using (private.meu_perfil() in ('admin', 'tecnico'))
  with check (private.meu_perfil() in ('admin', 'tecnico'));

-- estoque: só técnico e admin
create policy estoque_all on public.estoque_pecas for all to authenticated
  using (private.meu_perfil() in ('admin', 'tecnico'))
  with check (private.meu_perfil() in ('admin', 'tecnico'));
