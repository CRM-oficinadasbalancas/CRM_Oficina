-- Nº de série do equipamento: só letras e números (até 20) ou, quando a balança não possui, a expressão NÃO CONSTA.
alter table public.equipamentos
  add constraint equipamentos_numero_serie_check
  check (numero_serie ~ '^[A-Za-z0-9]{1,20}$' or numero_serie = 'NÃO CONSTA');
