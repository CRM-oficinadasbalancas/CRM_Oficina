-- Numeração separada: OF = chamados da oficina interna, EX = chamados de rua (externos).
-- O prefixo fica fixo na abertura: chamado de rua transferido para a oficina continua com o número EX.
alter table public.assistencias_tecnicas
  add column prefixo text check (prefixo in ('OF', 'EX')),
  add column seq integer;

create sequence public.chamado_seq_of;
create sequence public.chamado_seq_ex;

with ord as (
  select id,
         case when tipo = 'oficina' then 'OF' else 'EX' end as p,
         row_number() over (partition by (tipo = 'oficina') order by created_at, numero) as rn
  from public.assistencias_tecnicas
)
update public.assistencias_tecnicas a set prefixo = o.p, seq = o.rn from ord o where o.id = a.id;

select setval('public.chamado_seq_of', greatest(coalesce((select max(seq) from public.assistencias_tecnicas where prefixo = 'OF'), 0), 1),
              coalesce((select max(seq) from public.assistencias_tecnicas where prefixo = 'OF'), 0) > 0);
select setval('public.chamado_seq_ex', greatest(coalesce((select max(seq) from public.assistencias_tecnicas where prefixo = 'EX'), 0), 1),
              coalesce((select max(seq) from public.assistencias_tecnicas where prefixo = 'EX'), 0) > 0);

alter table public.assistencias_tecnicas
  alter column prefixo set not null,
  alter column seq set not null,
  add constraint assistencias_prefixo_seq_unico unique (prefixo, seq);

alter table public.assistencias_tecnicas
  add column codigo text generated always as (prefixo || '-' || lpad(seq::text, 4, '0')) stored;

create or replace function private.numerar_chamado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tipo = 'oficina' then
    new.prefixo := 'OF';
    new.seq := nextval('public.chamado_seq_of');
  else
    new.prefixo := 'EX';
    new.seq := nextval('public.chamado_seq_ex');
  end if;
  return new;
end $$;

create trigger trg_assistencias_zz_numero
  before insert on public.assistencias_tecnicas
  for each row execute function private.numerar_chamado();

grant usage, select on sequence public.chamado_seq_of, public.chamado_seq_ex to authenticated;
