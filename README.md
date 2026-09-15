# CRP (CRM com ERP)

Sistema de gestão genérico, sem marca ou dados de nenhuma empresa
específica. É o **sistema base**: sempre que for parametrizado para um
cliente, o caminho é criar uma cópia limpa deste repositório e customizar
essa cópia (branding, dados da empresa, banco Supabase próprio) — este
repositório em si permanece genérico.

## Módulos

- **CRM** — Clientes, Pedidos e Catálogo de produtos.
- **Assistência Técnica** — atendimentos vinculados a cliente + equipamento
  cadastrado, com baixa automática de peça no estoque.
- **Estoque** — cadastro de peças, exportação/relatório e importação via
  planilha Excel.
- **Financeiro** — entradas e saídas.

## Parametrização para um cliente novo

Tudo que muda de cliente para cliente está centralizado em poucos lugares:

- `admin/js/admin-config.js` → `ADMIN_CONFIG` (projeto Supabase do cliente)
  e `EMPRESA_CONFIG` (nome, CNPJ, endereço, chave PIX — usados nos
  impressos de pedido/orçamento/assistência técnica).
- `assets/img/logo-full.png` e o bloco `.brand-mark` (reaproveitado em
  `admin/login.html`, `admin/trocar-senha.html`, `index.html`, `404.html` e
  no orçamento impresso) — trocar pela identidade visual do cliente.
- Banco de dados: criar um projeto Supabase novo e aplicar as migrações
  (schema abaixo) nesse projeto próprio do cliente.
- `index.html` — hoje é só uma landing enxuta apontando pro login; cada
  cliente pode receber sua própria página institucional aqui, se quiser.

## Infraestrutura (deste ambiente de referência)

- **Supabase**: projeto `hln-gestao-crm` (ref `agtlqmbhkajsxdpeqviq`, região
  `sa-east-1`) — tabelas: `profiles`, `clientes`, `equipamentos`,
  `assistencias_tecnicas`, `estoque_pecas`, `produtos_catalogo`, `pedidos`,
  `pedido_itens_vacuo`, `pedido_itens_gerais`, `financeiro_entradas`,
  `financeiro_saidas`. RLS: `authenticated` tem acesso total, `anon` não tem
  acesso a nada.
- **Deploy**: Vercel, projeto `gestao-crm`, produção em
  `https://gestao-crm-three.vercel.app`.
- **Repositório**: `github.com/QuboTech/Gest-o-CRM`, branch `main`.
- **Login inicial**: usuário `gustavo`, com troca de senha obrigatória
  configurada (`must_change_password = true` na tabela `profiles`).

## Como continuar

Basta abrir uma sessão do Claude Code apontando para esta pasta (ou
clonando o repositório acima) — todo o código, schema e deploy já estão
funcionando; é só seguir incrementando.
