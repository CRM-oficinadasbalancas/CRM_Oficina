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
- Login é por usuário (e-mail sintético `usuario@oficinadasbalancas.internal`); perfis Admin / Técnico / Atendente; troca de senha obrigatória no 1º login.

## Modelo
- `clientes`: nome + (telefone ou e-mail); `categoria` (venda | manutencao | pos_venda | null) define o funil;
  `situacao` (ativo | ganho | perdido); `canal_aquisicao`; `origem` (manual | importacao — importados não geram alertas).
- `cliente_historico`: anotação + `resultado` (positivo/negativo, alimenta a cadência e o alerta de 3 negativas) + `status`
  (aberto | pendente | continuacao | fechado, só etiqueta, não muda prazo).
- Cadência (`admin/js/prazos.js`, com port fiel em TS na edge function): Vendas 24/72/120h; Manutenção 60 dias após fechar,
  ou cadência de Vendas se não fechou; Pós-venda 30 dias (+30 se negativo). Lead ganho/perdido = concluído.
- Alertas por e-mail ao gerente: 12 horas úteis de atraso (seg–sex 8–18, almoço 13–14) e 3 negativas seguidas.
- Leads (funis) não se misturam com a Assistência Técnica: `clientes.eh_cliente` (false = lead; true = cliente da Oficina, aparece na AT).
  Migrar lead para a AT = marcar Tipo "Cliente da Oficina" na ficha (a ficha oferece ao marcar Ganho). AT/estoque começam zerados.
- Menu (lateral): Dashboard, Vendas, Manutenção, Pós-venda, Assistência Técnica, Estoque, Clientes, Usuários. Estoque e Assistência Técnica não mudam.
- Dashboard estilo BI (Chart.js) + "Tratado hoje"/"Pendente" por funil; clicar no nome abre a ficha (`admin/js/cliente-detalhe.js`).

## Pendências
1. (feito) Push funcionando: no repo há `credential.https://github.com.username=CRM-oficinadasbalancas`.
2. (feito) Tema da Oficina: `admin/css/tema-oficina.css` (vermelho #D93035, preto #1B1B18, Instrument Sans), menu lateral preto,
   logo e favicon em `assets/img/`. Se a Oficina tiver a logo branca oficial, trocar `logo-oficina-branca.png` (hoje gerada da logo do site).
3. Domínio próprio da Oficina: hospedagem e verificar domínio no Resend; depois trocar `GERENTE_EMAIL` na edge function
   para `lucasbalancas@hotmail.com` e o remetente (hoje vai para `crm.oficinadasbalancas@gmail.com` via `onboarding@resend.dev`).
4. Segurança por perfil no banco: hoje o perfil só esconde menu/páginas; as policies RLS são "authenticated full access".
   Reescrever por role e testar cada tela com cada perfil, antes do uso real.
5. Ligar a proteção contra senhas vazadas no Supabase Auth; avaliar Pro/keep-alive por causa da pausa do free tier.
6. Decidir se status "Fechado" deve encerrar o lead (ganho/perdido) automaticamente.
7. Testar as telas logado com dados reais (só foi testado com dados simulados).
