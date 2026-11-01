-- Leads (Vendas/Manutenção/Pós-venda) não se misturam com a Assistência Técnica:
-- só entra na AT quem for marcado como cliente da Oficina.
alter table public.clientes add column eh_cliente boolean not null default false;
