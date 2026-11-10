# CRM Oficina das Balanças ("Preenchedor de Lead" / Oficina Office)

CRM web da Oficina das Balanças (conserto e venda de balanças). HTML/CSS/JS puro (sem build),
Supabase (Postgres, Auth, RLS, Edge Functions, pg_cron, pg_net), Vercel (site estático + `api/`), Resend (e-mail).
Derivado do CRP genérico. **Nunca mexer no CRP nem no HLN** — este repositório é independente.

## Infra da Oficina
- GitHub: `CRM-oficinadasbalancas/CRM_Oficina` (branch `main`). Fazer push só logado com a conta `CRM-oficinadasbalancas`
  (se der 403 "denied to <outra conta>", é credencial salva no Gerenciador de Credenciais do Windows).
- Supabase: projeto `gbahaegarnzgebgzeumk` ("CRM-oficinadasbalancas's Project"). Plano free: pausa por inatividade (usar `restore_project`).
- Vercel: `crm-oficinabalanca.vercel.app` (homologação).
- Migrations em `supabase/migrations/0001..0011`; edge function `supabase/functions/alertas-followup` (cron a cada 30 min via pg_cron).

## Regras de trabalho
- Claude NUNCA digita senhas, chaves de API nem tokens (RESEND_API_KEY, service_role etc.): o usuário roda/define.
- Não commitar dados reais de leads. A importação da planilha já foi feita direto no banco (826 clientes, 866 históricos).
- Homologação: o usuário só testa; dados novos ficam fora até liberar uso real.
- Login é por usuário (e-mail sintético `usuario@oficinadasbalancas.internal`); perfis Admin / Técnico / Atendente / Vendedor (vendedor: só Vendas, Manutenção e Pós-venda; edita clientes, histórico e status); troca de senha obrigatória no 1º login.

## Modelo
- `clientes`: nome + (telefone ou e-mail); `categoria` (venda | manutencao | pos_venda | null) define o funil;
  `situacao` (ativo | ganho | perdido); `canal_aquisicao`; `origem` (manual | importacao — importados não geram alertas).
- `cliente_historico`: anotação + `resultado` (positivo/negativo, alimenta a cadência e o alerta de 3 negativas) + `status`
  (aberto | pendente | continuacao | fechado). Salvar uma anotação com status Fechado exige o resultado e encerra o lead: positivo = ganho, negativo = perdido (cliente-detalhe.js, com confirmação). O banco registra `clientes.encerrado_em/encerrado_por/encerrado_por_nome` (migration 0018) e o dashboard mostra a efetividade por quem fechou.
- Cadência (`admin/js/prazos.js`, com port fiel em TS na edge function): Vendas 24/72/120h; Manutenção 60 dias após fechar,
  ou cadência de Vendas se não fechou; Pós-venda 30 dias (+30 se negativo). Lead ganho/perdido = concluído.
- Alertas por e-mail ao gerente: 12 horas úteis de atraso (seg–sex 8–18, almoço 13–14) e 3 negativas seguidas.
- Leads (funis) não se misturam com a Assistência Técnica: `clientes.eh_cliente` (false = lead; true = cliente da Oficina, aparece na AT).
  Migrar lead para a AT = marcar Tipo "Cliente da Oficina" na ficha (a ficha oferece ao marcar Ganho). AT/estoque começam zerados.
- Estoque: só o admin altera (e vê a tela). Técnico só alimenta chamados (assistências/equipamentos) e LÊ as peças; apagar chamado/equipamento = admin.
  A baixa no estoque é automática por gatilho (`private.ajustar_estoque_assistencia`, migration 0014): usar peça desconta, trocar reajusta, "não aprovado"/apagar devolve.
- **Chamados de campo e oficina interna** (migrations 0015/0016, `admin/chamados.html`, `admin/js/chamados-lib.js`, `app/`):
  perfis `programadora` (abre/programa chamados de campo, escolhe técnico e data, aprova/recusa orçamento), `recepcao` (abre chamados da
  oficina interna com defeito + selo/lacre antigos, aprova/recusa orçamento), `tecnico` (campo: só vê os chamados programados para ele),
  `oficina_interna` (faz a manutenção dos orçados). Status: aberta → em_andamento → concluida; técnico pode mandar para `pendente`
  (= transferido para a oficina, aguardando orçamento); `orcamento_aprovado` segue p/ oficina; `nao_aprovada` = orçamento recusado (devolver).
  Fechar exige histórico + selo/lacre novos e antigos (antigo dispensável com "Não possui"); pendência exige só o histórico. Peça opcional (sem peça não baixa).
  Regras no banco (`private.validar_chamado`); histórico em `chamado_historico`. Rota: `chOtimizarRota` (vizinho mais próximo + 2-opt), endereços
  localizados com Nominatim e guardados em `clientes.latitude/longitude`. Agenda do técnico prioriza a data de abertura (mais antigo primeiro).
  Perfil `tecnico` só acessa `chamados` no PC; admin/técnico/oficina interna no celular caem em `/app/`.
- App de chamados no celular (`/app/`, sem instalar): o MESMO endereço do sistema. Técnico no celular é levado do sistema para `/app/` (auth-guard `ehCelular()`);
  no PC, `/app/` manda para o sistema completo. `?desktop=1` força o sistema no celular; `?mobile=1` abre o app no PC. Mesmo login (mesma sessão do navegador).
  Para técnico e admin; mesmo Supabase/RLS. Sem service worker/manifest (a versão instalável foi removida).
- Relatórios (só admin, `admin/relatorios.html`): consumo de peças, chamados abertos, backlog e manutenção por defeito/peças; filtro por ano e mês (data de abertura do chamado); exporta Excel.
  Defeito é texto livre (agrupa descrições iguais); ideia futura: lista de tipos de defeito.
- Menu (lateral): Dashboard, Vendas, Manutenção, Pós-venda, Chamados (é a antiga Assistência Técnica; `assistencia-tecnica.html` só redireciona), Relatórios, Estoque, Clientes, Usuários.
- Chamados: um único botão "Novo chamado" (admin/programadora/recepção). O técnico escolhido define o tipo: `tecnico` = campo (data da visita, sem selo/lacre antigo); `oficina_interna` = oficina (pendente/aguardando orçamento, defeito + selo antigo + lacre antigo obrigatórios ou "Não possui"). Regra no gatilho `private.validar_chamado` (migration 0017).
- Chamados (migrations 0022-0028): número separado por origem, **OF-0001** (oficina interna) e **EX-0001** (rua), coluna `codigo` (prefixo fixo na abertura; chamado de rua transferido para a oficina mantém EX). Fluxo da oficina: recepção abre → fila da oficina (Aberto) → oficina anota e usa "Enviar para orçamento" (Pendente = com a recepção) → recepção/programação aprova ou recusa → volta para a fila → aprovado: inicia e fecha com selo/lacre novos; recusado: "Fechar e devolver ao cliente" mantendo selos/lacres antigos (`devolvido = true`). Fluxo de rua: igual, com orçamento; o técnico de rua também pode transferir para a oficina. **Peças do orçamento/serviço**: tabela `chamado_itens` (várias peças por chamado, `preco_unit` = preço de venda do estoque no momento; editável só em Aberto/Em atendimento/Orçamento aprovado); o estoque baixa quando o chamado FECHA (gatilho `baixar_estoque_itens`; devolvido não baixa; reabrir/apagar devolve). As colunas antigas `peca_id/quantidade_peca_utilizada` são legado. **Estoque**: `marca`, `preco_venda` em `estoque_pecas`; `custo` em `estoque_custos` (só admin/financeiro enxergam). **Faturamento**: perfil `financeiro` (só vê Chamados) fatura (`faturado_em/faturado_por`): oficina = todo fechado não devolvido; rua = só se passou por orçamento. A recepção NÃO fatura. Relatórios: Peças (consumo, marca, custo/venda/margem), Oficina (mensal/anual), Tempo de atendimento (por produto e técnico, interno x externo). Mão de obra por hora técnica (valor da hora só do admin) é FUTURO, ainda não implementado. Transferência do técnico de rua cai na fila da oficina (Aberto/tipo oficina). Abas por perfil em `FILTROS_POR_PAPEL` (PC) e `ABAS` (app). Modelos de balança = lista geral; série obrigatória (letras/números ou NÃO CONSTA, migration 0020).
- Dashboard estilo BI (Chart.js) + "Tratado hoje"/"Pendente" por funil; clicar no nome abre a ficha (`admin/js/cliente-detalhe.js`).

## Pendências
1. (feito) Push funcionando: no repo há `credential.https://github.com.username=CRM-oficinadasbalancas`.
2. (feito) Tema da Oficina: `admin/css/tema-oficina.css` (vermelho #D93035, preto #1B1B18, Instrument Sans), menu lateral preto,
   logo e favicon em `assets/img/`. Se a Oficina tiver a logo branca oficial, trocar `logo-oficina-branca.png` (hoje gerada da logo do site).
3. Domínio próprio da Oficina: hospedagem e verificar domínio no Resend; depois trocar `GERENTE_EMAIL` na edge function
   para `lucasbalancas@hotmail.com` e o remetente (hoje vai para `crm.oficinadasbalancas@gmail.com` via `onboarding@resend.dev`).
4. (feito no banco — migration 0012) RLS por perfil via `private.meu_perfil()` (migrations 0012/0013): admin tudo; **excluir cliente = só admin**; vendedor/atendente = clientes/histórico (atendente também lê AT);
   técnico = clientes/histórico + AT/equipamentos/estoque; profiles só admin (cada um edita o próprio sem mudar role); alertas_enviados só service_role.
   Falta: testar cada tela logado com um usuário Técnico e um Atendente de verdade.
5. Ligar a proteção contra senhas vazadas no Supabase Auth; avaliar Pro/keep-alive por causa da pausa do free tier.
6. (feito) Status "Fechado" encerra o lead como ganho/perdido. Revisita semestral: lead de Manutenção ganho (com contato positivo no histórico) volta 180 dias (`REVISITA_DIAS`, prazos.js) após o último contato positivo como "Revisão", repetindo a cada semestre; aparece nas listas de trabalho 30 dias antes de vencer. Situação Ganho e taxa de fechamento não mudam. Fechados ficam visíveis nas abas do funil e em "Últimos fechamentos" no dashboard.
7. Testar as telas logado com dados reais (só foi testado com dados simulados).
- OS e comprovante (migration 0029): `admin/os.html?id=` imprime a OS em 2 vias (A4; abre após criar o chamado e pelo botão "Imprimir OS" no detalhe). Chamado de RUA (EX) fechado no celular: cliente assina na tela (canvas), PDF gerado no aparelho com jsPDF (`admin/js/os-lib.js`), guardado no bucket privado `os-documentos` + tabela `chamado_documentos`, e o técnico envia pelo WhatsApp dele (Web Share com arquivo; fallback: baixa o PDF + link wa.me). Dados da empresa no topo vêm de `OS_EMPRESA` em os-lib.js (conferir com a oficina). O layout da OS é a 1ª versão: refazer a partir do talão que o dono vai mandar.
- API de integração (migration 0030): somente leitura, em `api/v1/precos.js` (código, marca, modelo, preço de venda; custo só com o escopo `custos`) e `api/v1/clientes.js` (cadastro completo; `incluir=equipamentos`). Núcleo em `api/_integracao.js`. Autenticação por chave (`Authorization: Bearer` ou `X-API-Key`) com escopos `precos`/`custos`/`clientes`; só o hash SHA-256 fica na tabela `api_chaves` (RLS admin; a API usa a service_role). Chaves são criadas/revogadas na tela `admin/integracoes.html` (só admin; a chave aparece uma vez). Filtros: q, marca, uf, municipio, id, atualizado_desde, incluir_leads=1, limite/pagina, formato=csv.
