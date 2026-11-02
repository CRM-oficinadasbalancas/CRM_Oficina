-- Registro do fechamento do lead (ganho/perdido): quando e quem encerrou.
-- Alimenta a efetividade de fechamento no dashboard. Leads importados que já vieram
-- como ganho/perdido ficam sem data/responsável (não se sabe quem fechou).

alter table public.clientes
  add column encerrado_em timestamptz,
  add column encerrado_por uuid references public.profiles(id) on delete set null,
  add column encerrado_por_nome text;

create or replace function private.registrar_encerramento_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.situacao is distinct from old.situacao then
    if new.situacao in ('ganho', 'perdido') then
      new.encerrado_em := now();
      new.encerrado_por := auth.uid();
      new.encerrado_por_nome := (select coalesce(nullif(p.nome_exibicao, ''), p.nome_usuario) from public.profiles p where p.id = auth.uid());
    else
      new.encerrado_em := null;
      new.encerrado_por := null;
      new.encerrado_por_nome := null;
    end if;
  end if;
  return new;
end $$;

create trigger trg_clientes_registrar_encerramento
  before update on public.clientes
  for each row execute function private.registrar_encerramento_lead();
