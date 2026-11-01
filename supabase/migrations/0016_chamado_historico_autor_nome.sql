-- nome de quem escreveu (a tabela de perfis só é legível pelo próprio usuário e pelo admin)
alter table public.chamado_historico add column autor_nome text;
