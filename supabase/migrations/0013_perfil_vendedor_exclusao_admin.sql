-- Novo perfil "vendedor": só Vendas, Manutenção e Pós-venda (edita clientes, histórico e status).
-- Excluir cliente: somente admin.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'tecnico', 'atendente', 'vendedor'));

drop policy clientes_select on public.clientes;
drop policy clientes_insert on public.clientes;
drop policy clientes_update on public.clientes;
drop policy clientes_delete on public.clientes;
create policy clientes_select on public.clientes for select to authenticated
  using (private.meu_perfil() in ('admin', 'atendente', 'tecnico', 'vendedor'));
create policy clientes_insert on public.clientes for insert to authenticated
  with check (private.meu_perfil() in ('admin', 'atendente', 'tecnico', 'vendedor'));
create policy clientes_update on public.clientes for update to authenticated
  using (private.meu_perfil() in ('admin', 'atendente', 'tecnico', 'vendedor'))
  with check (private.meu_perfil() in ('admin', 'atendente', 'tecnico', 'vendedor'));
create policy clientes_delete on public.clientes for delete to authenticated
  using (private.meu_perfil() = 'admin');

drop policy historico_select on public.cliente_historico;
drop policy historico_insert on public.cliente_historico;
create policy historico_select on public.cliente_historico for select to authenticated
  using (private.meu_perfil() in ('admin', 'atendente', 'tecnico', 'vendedor'));
create policy historico_insert on public.cliente_historico for insert to authenticated
  with check (private.meu_perfil() in ('admin', 'atendente', 'tecnico', 'vendedor'));
