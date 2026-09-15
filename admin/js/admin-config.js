// Configuração do portal administrativo. A anon/publishable key é pública por
// design — a segurança real vem das políticas RLS no banco (só authenticated).
var ADMIN_CONFIG = {
  supabaseUrl: 'https://gbahaegarnzgebgzeumk.supabase.co',
  supabaseAnonKey: 'sb_publishable_KymWyWGjso1Y2EmZ9WbyfQ_ou9_M8QJ',
  syntheticEmailDomain: '@oficinadasbalancas.internal'
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
