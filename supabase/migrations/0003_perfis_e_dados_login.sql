-- Sistema de perfis (Admin / Técnico / Atendente) para a tela de Usuários.
-- is_admin vira coluna gerada a partir de role, mantendo compatibilidade
-- com o código existente (admin/js/assistencia-tecnica.js lê is_admin).
alter table public.profiles drop column is_admin;

alter table public.profiles add column role text not null default 'atendente'
  check (role in ('admin', 'tecnico', 'atendente'));

alter table public.profiles add column nome_usuario text;
alter table public.profiles add column email text;

alter table public.profiles add column is_admin boolean generated always as (role = 'admin') stored;

update public.profiles p
set role = 'admin',
    nome_usuario = split_part(u.email, '@', 1)
from auth.users u
where p.id = u.id;
