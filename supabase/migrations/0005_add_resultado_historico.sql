-- Etiqueta de resultado em cada anotação de follow-up, usada pra calcular
-- automaticamente o prazo do próximo retorno (ver admin/js/prazos.js):
--   - Manutenção: positivo = fechou o serviço, negativo = não fechou.
--   - Pós-venda: positivo = retorno positivo, negativo = retorno negativo.
--   - Venda: não é usado (a cadência de vendas independe de resultado).
alter table public.cliente_historico add column resultado text
  check (resultado in ('positivo', 'negativo'));
