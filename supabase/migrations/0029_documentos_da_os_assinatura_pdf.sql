-- Documentos do chamado: assinatura do cliente (imagem) e comprovante/OS em PDF.
-- Os arquivos ficam em um bucket privado; o caminho começa pelo id do chamado.
insert into storage.buckets (id, name, public)
values ('os-documentos', 'os-documentos', false)
on conflict (id) do nothing;

create table public.chamado_documentos (
  id uuid primary key default gen_random_uuid(),
  chamado_id uuid not null references public.assistencias_tecnicas(id) on delete cascade,
  tipo text not null check (tipo in ('assinatura', 'comprovante_pdf')),
  caminho text not null,
  nome_assinante text,
  cliente_nao_assinou boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index chamado_documentos_chamado_idx on public.chamado_documentos (chamado_id);
alter table public.chamado_documentos enable row level security;

create policy chamado_docs_select on public.chamado_documentos for select to authenticated
  using (exists (select 1 from public.assistencias_tecnicas a where a.id = chamado_documentos.chamado_id));
create policy chamado_docs_insert on public.chamado_documentos for insert to authenticated
  with check (created_by = auth.uid()
              and private.meu_perfil() in ('admin', 'tecnico', 'oficina_interna', 'recepcao', 'programadora')
              and exists (select 1 from public.assistencias_tecnicas a where a.id = chamado_documentos.chamado_id));
create policy chamado_docs_delete on public.chamado_documentos for delete to authenticated
  using (private.meu_perfil() = 'admin');

create policy os_documentos_select on storage.objects for select to authenticated
  using (bucket_id = 'os-documentos'
         and exists (select 1 from public.assistencias_tecnicas a where a.id::text = (storage.foldername(name))[1]));
create policy os_documentos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'os-documentos'
              and private.meu_perfil() in ('admin', 'tecnico', 'oficina_interna', 'recepcao', 'programadora')
              and exists (select 1 from public.assistencias_tecnicas a where a.id::text = (storage.foldername(name))[1]));
create policy os_documentos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'os-documentos' and private.meu_perfil() = 'admin');
