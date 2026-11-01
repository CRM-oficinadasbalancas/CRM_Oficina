// Relatórios da Assistência Técnica (só admin):
//   Consumo de peças · Chamados abertos · Backlog · Manutenção por defeito / peças
// O período (ano e, opcionalmente, mês) filtra pela data de ABERTURA do chamado.
// O Backlog é a situação de hoje e não depende do período.

var STATUS_LABELS = { aberta: 'Aberta', em_andamento: 'Em andamento', pendente: 'Pendente', concluida: 'Concluída', nao_aprovada: 'Não aprovado' };
var STATUS_ABERTOS = ['aberta', 'em_andamento', 'pendente'];
var MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

var abaAtual = 'consumo';
var chamadosPeriodo = [];   // abertos no período (todos os status)
var chamadosEmAberto = [];  // backlog: abertos hoje, qualquer data
var carregou = false;

function esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtNum(n) {
  var x = parseFloat(n);
  if (isNaN(x)) return '0';
  return x.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}
function fmtData(iso) { return new Date(iso).toLocaleDateString('pt-BR'); }
function diasDesde(iso) { return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); }
function equipamentoTexto(c) {
  var eq = c.equipamentos || {};
  var nome = [eq.marca, eq.modelo].filter(Boolean).join(' ') || 'Equipamento';
  return nome + (eq.numero_serie ? ' (série ' + eq.numero_serie + ')' : '');
}
function nomeCliente(c) { return c.clientes ? c.clientes.razao_social : '—'; }
function sufixoArquivo() {
  var mes = $('f-mes').value;
  return $('f-ano').value + (mes ? '-' + String(mes).padStart(2, '0') : '');
}
function $(id) { return document.getElementById(id); }

function periodo() {
  var ano = parseInt($('f-ano').value, 10);
  var mes = $('f-mes').value ? parseInt($('f-mes').value, 10) : null;
  var ini = mes ? new Date(ano, mes - 1, 1) : new Date(ano, 0, 1);
  var fim = mes ? new Date(ano, mes, 1) : new Date(ano + 1, 0, 1);
  return { ini: ini, fim: fim, texto: mes ? MESES[mes - 1] + ' de ' + ano : 'ano de ' + ano };
}

var SELECT_CHAMADO = '*, clientes(razao_social), equipamentos(marca, modelo, numero_serie), estoque_pecas(codigo, tipo_modelo, quantidade)';

async function carregar() {
  var p = periodo();
  $('f-resumo').textContent = 'Período: ' + p.texto + ' (pela data de abertura do chamado).';
  $('painel').innerHTML = '<p class="rel-nota">Carregando...</p>';

  var res = await Promise.all([
    supabaseClient.from('assistencias_tecnicas').select(SELECT_CHAMADO)
      .gte('created_at', p.ini.toISOString()).lt('created_at', p.fim.toISOString())
      .order('created_at', { ascending: false }).limit(5000),
    supabaseClient.from('assistencias_tecnicas').select(SELECT_CHAMADO)
      .in('status', STATUS_ABERTOS).order('created_at', { ascending: true }).limit(5000)
  ]);
  if (res[0].error || res[1].error) {
    $('painel').innerHTML = '<p class="rel-nota">Não foi possível carregar: ' + esc((res[0].error || res[1].error).message) + '</p>';
    return;
  }
  chamadosPeriodo = res[0].data || [];
  chamadosEmAberto = res[1].data || [];
  carregou = true;
  desenhar();
}

function kpis(itens) {
  return '<div class="rel-kpis">' + itens.map(function (i) {
    return '<div class="rel-kpi"' + (i.cor ? ' style="border-top-color:' + i.cor + '"' : '') + '><span>' + i.rotulo + '</span><strong>' + i.valor + '</strong></div>';
  }).join('') + '</div>';
}

function cabecalho(titulo, id) {
  return '<div class="rel-acoes"><h2>' + titulo + '</h2><button type="button" class="btn btn-outline" id="' + id + '">Exportar Excel</button></div>';
}

function tabela(colunas, linhas, vazio) {
  if (!linhas.length) return '<p class="rel-nota">' + vazio + '</p>';
  return '<div class="table-scroll"><table class="admin-table"><thead><tr>' +
    colunas.map(function (c) { return '<th' + (c.num ? ' class="num"' : '') + '>' + c.t + '</th>'; }).join('') +
    '</tr></thead><tbody>' + linhas.join('') + '</tbody></table></div>';
}

/* ---------- 1) Consumo de peças ---------- */
function dadosConsumo() {
  var mapa = {};
  chamadosPeriodo.forEach(function (c) {
    if (!c.peca_id || c.status === 'nao_aprovada') return;
    var q = parseFloat(c.quantidade_peca_utilizada) || 0;
    if (!q) return;
    var p = c.estoque_pecas || {};
    if (!mapa[c.peca_id]) mapa[c.peca_id] = { codigo: p.codigo || '—', desc: p.tipo_modelo || '', usado: 0, chamados: 0, estoque: p.quantidade };
    mapa[c.peca_id].usado += q;
    mapa[c.peca_id].chamados += 1;
  });
  return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return b.usado - a.usado; });
}

function abaConsumo() {
  var dados = dadosConsumo();
  var total = dados.reduce(function (s, d) { return s + d.usado; }, 0);
  var maximo = dados.length ? dados[0].usado : 1;
  var chamados = dados.reduce(function (s, d) { return s + d.chamados; }, 0);
  var linhas = dados.map(function (d) {
    var estoqueBaixo = parseFloat(d.estoque) <= 0 ? ' <span class="badge badge-warning">Sem estoque</span>' : '';
    return '<tr><td>' + esc(d.codigo) + '</td><td>' + esc(d.desc) + '</td>' +
      '<td class="num"><span class="barra" style="width:' + Math.max(2, Math.round(d.usado / maximo * 90)) + 'px"></span>' + fmtNum(d.usado) + '</td>' +
      '<td class="num">' + d.chamados + '</td><td class="num">' + fmtNum(d.estoque) + estoqueBaixo + '</td></tr>';
  });
  return kpis([
    { rotulo: 'Peças diferentes usadas', valor: dados.length, cor: '#d93035' },
    { rotulo: 'Unidades consumidas', valor: fmtNum(total) },
    { rotulo: 'Usos em chamados', valor: chamados }
  ]) + cabecalho('Consumo de peças — ' + periodo().texto, 'exp-consumo') +
    tabela([{ t: 'Código' }, { t: 'Peça' }, { t: 'Consumido', num: true }, { t: 'Chamados', num: true }, { t: 'Estoque atual', num: true }], linhas,
      'Nenhuma peça foi usada em chamados neste período.') +
    '<p class="rel-nota" style="margin-top:10px;">Chamados "não aprovados" não entram (a peça não foi usada).</p>';
}

/* ---------- 2) Chamados abertos ---------- */
function abaAbertos() {
  var cont = {};
  Object.keys(STATUS_LABELS).forEach(function (s) { cont[s] = 0; });
  chamadosPeriodo.forEach(function (c) { cont[c.status] = (cont[c.status] || 0) + 1; });
  var aindaAbertos = chamadosPeriodo.filter(function (c) { return STATUS_ABERTOS.indexOf(c.status) !== -1; });
  var linhas = aindaAbertos.map(function (c) {
    return '<tr><td>' + c.numero + '</td><td>' + fmtData(c.created_at) + '</td><td>' + esc(nomeCliente(c)) + '</td><td>' + esc(equipamentoTexto(c)) +
      '</td><td>' + esc((c.descricao_defeito || '').slice(0, 120)) + '</td><td>' + STATUS_LABELS[c.status] + '</td><td class="num">' + diasDesde(c.created_at) + '</td></tr>';
  });
  return kpis([
    { rotulo: 'Abertos no período', valor: chamadosPeriodo.length, cor: '#1b1b18' },
    { rotulo: 'Abertas', valor: cont.aberta, cor: '#f0a020' },
    { rotulo: 'Em andamento', valor: cont.em_andamento, cor: '#0073e6' },
    { rotulo: 'Pendentes', valor: cont.pendente, cor: '#d93035' },
    { rotulo: 'Concluídos', valor: cont.concluida, cor: '#2e9e5b' },
    { rotulo: 'Não aprovados', valor: cont.nao_aprovada, cor: '#8a8a85' }
  ]) + cabecalho('Chamados do período ainda em aberto — ' + periodo().texto, 'exp-abertos') +
    tabela([{ t: 'Nº' }, { t: 'Abertura' }, { t: 'Cliente' }, { t: 'Equipamento' }, { t: 'Defeito' }, { t: 'Status' }, { t: 'Dias', num: true }], linhas,
      'Nenhum chamado deste período está em aberto.');
}

/* ---------- 3) Backlog ---------- */
var FAIXAS = [
  { t: '0 a 7 dias', min: 0, max: 7 }, { t: '8 a 15 dias', min: 8, max: 15 }, { t: '16 a 30 dias', min: 16, max: 30 },
  { t: '31 a 60 dias', min: 31, max: 60 }, { t: 'Mais de 60 dias', min: 61, max: 99999 }
];

function abaBacklog() {
  var lista = chamadosEmAberto.map(function (c) { return { c: c, dias: diasDesde(c.created_at) }; })
    .sort(function (a, b) { return b.dias - a.dias; });
  var media = lista.length ? Math.round(lista.reduce(function (s, i) { return s + i.dias; }, 0) / lista.length) : 0;
  var pend = lista.filter(function (i) { return i.c.status === 'pendente'; }).length;
  var maisAntigo = lista.length ? lista[0].dias : 0;

  var faixas = FAIXAS.map(function (f) {
    var n = lista.filter(function (i) { return i.dias >= f.min && i.dias <= f.max; }).length;
    return '<tr><td>' + f.t + '</td><td class="num">' + n + '</td></tr>';
  });
  var linhas = lista.map(function (i) {
    var c = i.c;
    return '<tr><td>' + c.numero + '</td><td>' + fmtData(c.created_at) + '</td><td>' + esc(nomeCliente(c)) + '</td><td>' + esc(equipamentoTexto(c)) +
      '</td><td>' + STATUS_LABELS[c.status] + '</td><td class="num ' + (i.dias > 30 ? 'atraso' : '') + '">' + i.dias + '</td></tr>';
  });
  return kpis([
    { rotulo: 'Chamados em aberto hoje', valor: lista.length, cor: '#d93035' },
    { rotulo: 'Idade média (dias)', valor: media },
    { rotulo: 'Mais antigo (dias)', valor: maisAntigo, cor: '#a92323' },
    { rotulo: 'Pendentes (parados)', valor: pend, cor: '#f0a020' }
  ]) + '<p class="rel-nota">O backlog mostra a situação de hoje e não depende do período escolhido.</p>' +
    '<h3 class="rel-sub">Idade dos chamados em aberto</h3>' +
    tabela([{ t: 'Faixa' }, { t: 'Chamados', num: true }], faixas, '') +
    cabecalho('Chamados em aberto (mais antigos primeiro)', 'exp-backlog') +
    tabela([{ t: 'Nº' }, { t: 'Abertura' }, { t: 'Cliente' }, { t: 'Equipamento' }, { t: 'Status' }, { t: 'Dias em aberto', num: true }], linhas,
      'Nenhum chamado em aberto. Backlog zerado!');
}

/* ---------- 4) Manutenção por defeito / peças ---------- */
function normalizar(t) { return String(t || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function abaManutencao() {
  var itens = chamadosPeriodo;
  var porDefeito = {};
  itens.forEach(function (c) {
    var k = normalizar(c.descricao_defeito).slice(0, 80);
    if (!k) return;
    if (!porDefeito[k]) porDefeito[k] = { defeito: c.descricao_defeito.trim().slice(0, 80), n: 0, pecas: {} };
    porDefeito[k].n += 1;
    if (c.estoque_pecas && c.status !== 'nao_aprovada') {
      var cod = c.estoque_pecas.codigo;
      porDefeito[k].pecas[cod] = (porDefeito[k].pecas[cod] || 0) + (parseFloat(c.quantidade_peca_utilizada) || 0);
    }
  });
  var topDefeitos = Object.keys(porDefeito).map(function (k) { return porDefeito[k]; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 15);
  var linhasDefeito = topDefeitos.map(function (d) {
    var pecas = Object.keys(d.pecas).map(function (cod) { return esc(cod) + ' ×' + fmtNum(d.pecas[cod]); }).join(', ') || '—';
    return '<tr><td>' + esc(d.defeito) + '</td><td class="num">' + d.n + '</td><td>' + pecas + '</td></tr>';
  });

  var porEquip = {};
  itens.forEach(function (c) {
    var eq = c.equipamentos || {};
    var k = [eq.marca, eq.modelo].filter(Boolean).join(' ') || 'Não informado';
    porEquip[k] = (porEquip[k] || 0) + 1;
  });
  var linhasEquip = Object.keys(porEquip).sort(function (a, b) { return porEquip[b] - porEquip[a]; }).slice(0, 15)
    .map(function (k) { return '<tr><td>' + esc(k) + '</td><td class="num">' + porEquip[k] + '</td></tr>'; });

  var linhas = itens.map(function (c) {
    var pecaTxt = c.estoque_pecas && c.status !== 'nao_aprovada' ? esc(c.estoque_pecas.codigo + ' — ' + (c.estoque_pecas.tipo_modelo || '')) : '—';
    return '<tr><td>' + c.numero + '</td><td>' + fmtData(c.created_at) + '</td><td>' + esc(nomeCliente(c)) + '</td><td>' + esc(equipamentoTexto(c)) +
      '</td><td>' + esc((c.descricao_defeito || '').slice(0, 140)) + '</td><td>' + pecaTxt + '</td><td class="num">' +
      (c.peca_id && c.status !== 'nao_aprovada' ? fmtNum(c.quantidade_peca_utilizada) : '') + '</td><td>' + STATUS_LABELS[c.status] + '</td></tr>';
  });

  return kpis([
    { rotulo: 'Chamados no período', valor: itens.length, cor: '#1b1b18' },
    { rotulo: 'Com peça utilizada', valor: itens.filter(function (c) { return c.peca_id && c.status !== 'nao_aprovada'; }).length, cor: '#d93035' },
    { rotulo: 'Concluídos', valor: itens.filter(function (c) { return c.status === 'concluida'; }).length, cor: '#2e9e5b' }
  ]) +
    '<h3 class="rel-sub">Defeitos mais repetidos e peças usadas</h3>' +
    '<p class="rel-nota">O defeito é texto livre; aqui agrupamos descrições iguais. Para agrupar de verdade (ex.: "não liga", "peso errado") dá para criar uma lista de tipos de defeito.</p>' +
    tabela([{ t: 'Defeito' }, { t: 'Chamados', num: true }, { t: 'Peças usadas' }], linhasDefeito, 'Sem chamados no período.') +
    '<h3 class="rel-sub">Chamados por equipamento</h3>' +
    tabela([{ t: 'Marca / modelo' }, { t: 'Chamados', num: true }], linhasEquip, 'Sem chamados no período.') +
    cabecalho('Manutenção detalhada — ' + periodo().texto, 'exp-manut') +
    tabela([{ t: 'Nº' }, { t: 'Abertura' }, { t: 'Cliente' }, { t: 'Equipamento' }, { t: 'Defeito' }, { t: 'Peça' }, { t: 'Qtd', num: true }, { t: 'Status' }], linhas,
      'Nenhum chamado neste período.');
}

/* ---------- desenho + exportação ---------- */
function desenhar() {
  if (!carregou) return;
  var html = abaAtual === 'consumo' ? abaConsumo() : abaAtual === 'abertos' ? abaAbertos() : abaAtual === 'backlog' ? abaBacklog() : abaManutencao();
  $('painel').innerHTML = html;
  ligarExportacoes();
}

function ligarExportacoes() {
  var sufixo = sufixoArquivo();
  var b;
  if ((b = $('exp-consumo'))) b.addEventListener('click', function () {
    var d = dadosConsumo();
    if (!d.length) { showToast('Não há dados para exportar.', 'warning'); return; }
    exportarExcel('consumo-pecas-' + sufixo + '.xlsx', d, [
      { titulo: 'Código', chave: 'codigo' }, { titulo: 'Peça', chave: 'desc' },
      { titulo: 'Consumido', valor: function (x) { return x.usado; } }, { titulo: 'Chamados', chave: 'chamados' },
      { titulo: 'Estoque atual', valor: function (x) { return parseFloat(x.estoque); } }
    ], 'Consumo');
  });
  if ((b = $('exp-abertos'))) b.addEventListener('click', function () {
    var d = chamadosPeriodo.filter(function (c) { return STATUS_ABERTOS.indexOf(c.status) !== -1; });
    if (!d.length) { showToast('Não há dados para exportar.', 'warning'); return; }
    exportarExcel('chamados-abertos-' + sufixo + '.xlsx', d, colunasChamado(true), 'Abertos');
  });
  if ((b = $('exp-backlog'))) b.addEventListener('click', function () {
    if (!chamadosEmAberto.length) { showToast('Não há dados para exportar.', 'warning'); return; }
    exportarExcel('backlog-' + new Date().toISOString().slice(0, 10) + '.xlsx', chamadosEmAberto, colunasChamado(true), 'Backlog');
  });
  if ((b = $('exp-manut'))) b.addEventListener('click', function () {
    if (!chamadosPeriodo.length) { showToast('Não há dados para exportar.', 'warning'); return; }
    exportarExcel('manutencao-' + sufixo + '.xlsx', chamadosPeriodo, colunasChamado(false), 'Manutencao');
  });
}

function colunasChamado(comDias) {
  var cols = [
    { titulo: 'Nº', chave: 'numero' },
    { titulo: 'Abertura', valor: function (c) { return fmtData(c.created_at); } },
    { titulo: 'Cliente', valor: nomeCliente },
    { titulo: 'Equipamento', valor: equipamentoTexto },
    { titulo: 'Defeito', chave: 'descricao_defeito' },
    { titulo: 'Status', valor: function (c) { return STATUS_LABELS[c.status] || c.status; } }
  ];
  if (comDias) cols.push({ titulo: 'Dias em aberto', valor: function (c) { return diasDesde(c.created_at); } });
  else {
    cols.push({ titulo: 'Peça', valor: function (c) { return c.estoque_pecas && c.status !== 'nao_aprovada' ? c.estoque_pecas.codigo : ''; } });
    cols.push({ titulo: 'Qtd peça', valor: function (c) { return c.peca_id && c.status !== 'nao_aprovada' ? parseFloat(c.quantidade_peca_utilizada) : ''; } });
    cols.push({ titulo: 'Resolução', chave: 'resolucao' });
  }
  return cols;
}

$('rel-tabs').addEventListener('click', function (e) {
  var b = e.target.closest('.rel-tab');
  if (!b) return;
  document.querySelectorAll('.rel-tab').forEach(function (t) { t.classList.remove('ativo'); });
  b.classList.add('ativo');
  abaAtual = b.dataset.tab;
  desenhar();
});
$('f-ano').addEventListener('change', carregar);
$('f-mes').addEventListener('change', carregar);

(async function () {
  var auth = await window.ADMIN_AUTH_READY;
  if (!auth) return;
  var anoAtual = new Date().getFullYear();
  var opcoes = '';
  for (var a = anoAtual; a >= anoAtual - 5; a--) opcoes += '<option value="' + a + '">' + a + '</option>';
  $('f-ano').innerHTML = opcoes;
  $('f-mes').value = String(new Date().getMonth() + 1);
  carregar();
})();
