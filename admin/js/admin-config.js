// Configuração do portal administrativo. A anon/publishable key é pública por
// design — a segurança real vem das políticas RLS no banco (só authenticated).
var ADMIN_CONFIG = {
  supabaseUrl: 'https://agtlqmbhkajsxdpeqviq.supabase.co',
  supabaseAnonKey: 'sb_publishable_oewjlw01Gkkn8WSeLFczwA_pLbiDXnA',
  syntheticEmailDomain: '@gestaocrm.internal'
};

// Dados da empresa que usa este sistema — aparecem nos impressos (pedido,
// orçamento, assistência técnica). Ao clonar este sistema base para um
// cliente novo, é só preencher aqui: nenhum outro arquivo tem esses dados
// fixos no código.
var EMPRESA_CONFIG = {
  nome: 'CRP',
  cnpj: '',
  endereco: '',
  chavePix: ''
};
