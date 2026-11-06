// Relatórios da Assistência Técnica (só admin):
//   Consumo e estoque de peças · Chamados abertos · Backlog · Manutenção por defeito / peças
// O período (ano e, opcionalmente, mês) filtra pela data de ABERTURA do chamado.
// O Backlog é a situação de hoje e não depende do período.

var STATUS_LABELS = { aberta: 'Aberto', em_andamento: 'Em atendimento', pendente: 'Pendente (aguardando orçamento)', orcamento_aprovado: 'Orçamento aprovado', concluida: 'Fechado', nao_aprovada: 'Orçamento recusado' };
var STATUS_ABERTOS = ['aberta', 'em_andamento', 'pendente', 'orcamento_aprovado'];
var MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

var abaAtual = 'consumo';
var chamadosPeriodo = [];   // abertos no período (todos os status)
var chamadosEmAberto = [];  // backlog: abertos hoje, qualquer data
var chamadosOficinaAno = [];  // chamados da oficina com algum evento (abertura, orçamento, faturamento) no ano
var pecasEstoque = [];
var custosPeca = {};         // custo unitário atual de cada peça (só admin/financeiro enxergam)
var nomesTecnicos = {};      // id -> nome      // todas as peças e o saldo de hoje
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
function numChamado(c) { return c.codigo || c.numero; }
// Peças realmente usadas: só chamados fechados com serviço feito (devolvido sem conserto não usa peça).
function pecasUsadas(c) { return c.status === 'concluida' && !c.devolvido ? (c.itens || []) : []; }
function fmtReais(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
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

var SELECT_CHAMADO = '*, clientes(razao_social), equipamentos(marca, modelo, numero_serie)';

async function carregar() {
  var p = periodo();
  $('f-resumo').textContent = 'Período: ' + p.texto + ' (pela data de abertura do chamado).';
  $('painel').innerHTML = '<p class="rel-nota">Carregando...</p>';

  var res = await Promise.all([
    supabaseClient.from('assistencias_tecnicas').select(SELECT_CHAMADO)
      .gte('created_at', p.ini.toISOString()).lt('created_at', p.fim.toISOString())
      .order('created_at', { ascending: false }).limit(5000),
    supabaseClient.from('assistencias_tecnicas').select(SELECT_CHAMADO)
      .in('status', STATUS_ABERTOS).order('created_at', { ascending: true }).limit(5000),
    supabaseClient.from('estoque_pecas').select('id, codigo, tipo_modelo, quantidade, marca').order('codigo').limit(5000),
    (function () {
      var ano = parseInt($('f-ano').value, 10);
      var a = new Date(ano, 0, 1).toISOString(), b = new Date(ano + 1, 0, 1).toISOString();
      return supabaseClient.from('assistencias_tecnicas').select(SELECT_CHAMADO).eq('tipo', 'oficina')
        .or('and(created_at.gte.' + a + ',created_at.lt.' + b + '),and(orcamento_em.gte.' + a + ',orcamento_em.lt.' + b + '),and(faturado_em.gte.' + a + ',faturado_em.lt.' + b + ')')
        .limit(5000);
    })(),
    (function () {
      // peças (itens) dos chamados abertos no período
      return supabaseClient.from('chamado_itens')
        .select('chamado_id, quantidade, preco_unit, peca_id, estoque_pecas(codigo, tipo_modelo, marca), assistencias_tecnicas!inner(created_at)')
        .gte('assistencias_tecnicas.created_at', p.ini.toISOString()).lt('assistencias_tecnicas.created_at', p.fim.toISOString()).limit(20000);
    })(),
    supabaseClient.from('estoque_custos').select('peca_id, custo'),
    supabaseClient.rpc('listar_tecnicos')
  ]);
  if (res[0].error || res[1].error || res[3].error) {
    $('painel').innerHTML = '<p class="rel-nota">Não foi possível carregar: ' + esc((res[0].error || res[1].error || res[3].error).message) + '</p>';
    return;
  }
  chamadosOficinaAno = res[3].data || [];
  custosPeca = {};
  (res[5].data || []).forEach(function (c) { custosPeca[c.peca_id] = parseFloat(c.custo); });
  nomesTecnicos = {};
  (res[6].data || []).forEach(function (t) { nomesTecnicos[t.id] = t.nome; });
  chamadosPeriodo = res[0].data || [];
  var itensPorChamado = {};
  (res[4].data || []).forEach(function (i) { (itensPorChamado[i.chamado_id] = itensPorChamado[i.chamado_id] || []).push(i); });
  chamadosPeriodo.forEach(function (c) { c.itens = itensPorChamado[c.id] || []; });
  chamadosEmAberto = res[1].data || [];
  pecasEstoque = res[2].data || [];
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
// Meses que o período cobre (para estimar a duração do estoque no ritmo de consumo).
function mesesDoPeriodo() {
  var ano = parseInt($('f-ano').value, 10);
  if ($('f-mes').value) return 1;
  var hoje = new Date();
  if (ano < hoje.getFullYear()) return 12;
  if (ano > hoje.getFullYear()) return 12;
  return Math.max(1, hoje.getMonth() + 1);
}

function dadosConsumo() {
  var mapa = {};
  // todas as peças do estoque entram, mesmo as que não foram usadas no período
  pecasEstoque.forEach(function (p) {
    mapa[p.id] = { codigo: p.codigo || '—', desc: p.tipo_modelo || '', marca: p.marca || '', usado: 0, chamados: 0, estoque: p.quantidade, custo: 0, venda: 0, _c: {} };
  });
  chamadosPeriodo.forEach(function (c) {
    pecasUsadas(c).forEach(function (i) {
      var q = parseFloat(i.quantidade) || 0;
      if (!q) return;
      var p = i.estoque_pecas || {};
      var m = mapa[i.peca_id] || (mapa[i.peca_id] = { codigo: p.codigo || '—', desc: p.tipo_modelo || '', marca: p.marca || '', usado: 0, chamados: 0, estoque: null, custo: 0, venda: 0, _c: {} });
      m.usado += q;
      if (!m._c[c.id]) { m._c[c.id] = true; m.chamados++; }
      m.custo += q * (custosPeca[i.peca_id] || 0);
      m.venda += q * (i.preco_unit != null ? parseFloat(i.preco_unit) : 0);
    });
  });
  var meses = mesesDoPeriodo();
  return Object.keys(mapa).map(function (k) {
    var d = mapa[k];
    d.porMes = d.usado / meses;
    d.duraMeses = d.porMes > 0 ? (parseFloat(d.estoque) || 0) / d.porMes : null;
    d.margem = d.venda - d.custo;
    return d;
  }).sort(function (a, b) { return b.usado - a.usado || String(a.codigo).localeCompare(String(b.codigo)); });
}

// Consumo agrupado por marca da peça.
function dadosPorMarca() {
  var por = {};
  dadosConsumo().forEach(function (d) {
    if (!(d.usado > 0)) return;
    var k = d.marca || 'Sem marca';
    var m = por[k] || (por[k] = { marca: k, pecas: 0, usado: 0, custo: 0, venda: 0 });
    m.pecas += 1; m.usado += d.usado; m.custo += d.custo; m.venda += d.venda;
  });
  return Object.keys(por).map(function (k) { por[k].margem = por[k].venda - por[k].custo; return por[k]; })
    .sort(function (a, b) { return b.usado - a.usado; });
}

function textoDura(d) {
  if (d.duraMeses == null) return '—';
  if (d.duraMeses < 0.1) return 'acabou';
  return '~' + fmtNum(Math.round(d.duraMeses * 10) / 10) + (d.duraMeses === 1 ? ' mês' : ' meses');
}

function abaConsumo() {
  var dados = dadosConsumo();
  var usadas = dados.filter(function (d) { return d.usado > 0; });
  var total = dados.reduce(function (s, d) { return s + d.usado; }, 0);
  var venda = dados.reduce(function (s, d) { return s + d.venda; }, 0);
  var custo = dados.reduce(function (s, d) { return s + d.custo; }, 0);
  var maximo = dados.length && dados[0].usado > 0 ? dados[0].usado : 1;
  var semEstoque = dados.filter(function (d) { return (parseFloat(d.estoque) || 0) <= 0; }).length;
  var linhas = dados.map(function (d) {
    var zerado = (parseFloat(d.estoque) || 0) <= 0;
    var alerta = zerado ? ' <span class="badge badge-warning">Sem estoque</span>' : '';
    return '<tr><td>' + esc(d.codigo) + '</td><td>' + esc(d.desc) + '</td><td>' + esc(d.marca || '—') + '</td>' +
      '<td class="num">' + (d.usado > 0 ? '<span class="barra" style="width:' + Math.max(2, Math.round(d.usado / maximo * 90)) + 'px"></span>' : '') + fmtNum(d.usado) + '</td>' +
      '<td class="num">' + d.chamados + '</td><td class="num">' + fmtNum(d.estoque) + alerta + '</td>' +
      '<td class="num">' + textoDura(d) + '</td>' +
      '<td class="num">' + (d.usado > 0 ? fmtReais(d.custo) : '—') + '</td><td class="num">' + (d.usado > 0 ? fmtReais(d.venda) : '—') + '</td>' +
      '<td class="num">' + (d.usado > 0 ? fmtReais(d.margem) : '—') + '</td></tr>';
  });
  var marcas = dadosPorMarca();
  var linhasMarca = marcas.map(function (m) {
    return '<tr><td>' + esc(m.marca) + '</td><td class="num">' + m.pecas + '</td><td class="num">' + fmtNum(m.usado) + '</td>' +
      '<td class="num">' + fmtReais(m.custo) + '</td><td class="num">' + fmtReais(m.venda) + '</td><td class="num">' + fmtReais(m.margem) + '</td></tr>';
  });
  return kpis([
    { rotulo: 'Peças usadas no período', valor: usadas.length, cor: '#d93035' },
    { rotulo: 'Unidades consumidas', valor: fmtNum(total) },
    { rotulo: 'Venda das peças', valor: fmtReais(venda), cor: '#2e9e5b' },
    { rotulo: 'Custo das peças', valor: fmtReais(custo) },
    { rotulo: 'Margem', valor: fmtReais(venda - custo), cor: '#1b1b18' },
    { rotulo: 'Peças sem estoque', valor: semEstoque }
  ]) + cabecalho('Consumo e estoque de peças — ' + periodo().texto, 'exp-consumo') +
    tabela([{ t: 'Código' }, { t: 'Peça' }, { t: 'Marca' }, { t: 'Consumido no período', num: true }, { t: 'Chamados', num: true }, { t: 'Estoque atual', num: true }, { t: 'Estoque dura', num: true },
            { t: 'Custo', num: true }, { t: 'Venda', num: true }, { t: 'Margem', num: true }], linhas,
      'Nenhuma peça cadastrada no estoque.') +
    '<div class="rel-acoes" style="margin-top:22px;"><h2>Consumo por marca — ' + periodo().texto + '</h2><button type="button" class="btn btn-outline" id="exp-marca">Exportar Excel</button></div>' +
    tabela([{ t: 'Marca' }, { t: 'Peças diferentes', num: true }, { t: 'Consumido', num: true }, { t: 'Custo', num: true }, { t: 'Venda', num: true }, { t: 'Margem', num: true }], linhaMarcaOuVazio(linhasMarca),
      'Nenhuma peça usada neste período.') +
    '<p class="rel-nota" style="margin-top:10px;">Conta só chamados fechados com serviço feito; orçamento recusado e devolvido não usa peça. O <b>custo</b> é o custo atual cadastrado no estoque; a <b>venda</b> é o preço de venda da peça no momento em que entrou no chamado. "Estoque dura" estima por quantos meses o saldo atual cobre o consumo médio mensal do período.</p>';
}
function linhaMarcaOuVazio(l) { return l; }

/* ---------- Tempo de atendimento por produto (interno e externo) ---------- */
function fmtDuracao(h) {
  if (h == null || isNaN(h)) return '—';
  var min = Math.round(h * 60);
  if (min < 60) return min + ' min';
  var horas = Math.floor(min / 60), resto = min % 60;
  if (horas < 24) return horas + ' h' + (resto ? ' ' + resto + ' min' : '');
  var dias = Math.floor(horas / 24);
  return dias + ' d' + (horas % 24 ? ' ' + (horas % 24) + ' h' : '');
}

// Chamados fechados com serviço feito e com início registrado: tempo de atendimento = do "Iniciar" até o "Fechar".
function medidosTempo() {
  return chamadosPeriodo.filter(function (c) { return c.status === 'concluida' && !c.devolvido && c.iniciado_em && c.fechado_em; }).map(function (c) {
    var eq = c.equipamentos || {};
    return {
      c: c,
      produto: [eq.marca, eq.modelo].filter(Boolean).join(' ') || 'Não informado',
      lado: c.tipo === 'oficina' ? 'interno' : 'externo',
      tecnico: nomesTecnicos[c.tecnico_id] || 'Não identificado',
      atend: (new Date(c.fechado_em) - new Date(c.iniciado_em)) / 3600000
    };
  }).filter(function (m) { return m.atend >= 0; });
}

function media(l) { return l.length ? l.reduce(function (s, x) { return s + x; }, 0) / l.length : null; }

function dadosTempoProduto() {
  var por = {};
  medidosTempo().forEach(function (m) {
    var p = por[m.produto] || (por[m.produto] = { produto: m.produto, interno: [], externo: [] });
    p[m.lado].push(m.atend);
  });
  return Object.keys(por).map(function (k) {
    var p = por[k];
    return { produto: p.produto, nInt: p.interno.length, mediaInt: media(p.interno), nExt: p.externo.length, mediaExt: media(p.externo), total: p.interno.length + p.externo.length };
  }).sort(function (a, b) { return b.total - a.total; });
}

function dadosTempoTecnico() {
  var por = {};
  medidosTempo().forEach(function (m) {
    var k = m.tecnico + '|' + m.lado;
    var t = por[k] || (por[k] = { tecnico: m.tecnico, lado: m.lado, tempos: [] });
    t.tempos.push(m.atend);
  });
  return Object.keys(por).map(function (k) {
    var t = por[k];
    return { tecnico: t.tecnico, lado: t.lado === 'interno' ? 'Interno (oficina)' : 'Externo (rua)', n: t.tempos.length, media: media(t.tempos), menor: Math.min.apply(null, t.tempos), maior: Math.max.apply(null, t.tempos) };
  }).sort(function (a, b) { return b.n - a.n; });
}

function abaTempo() {
  var med = medidosTempo();
  var ints = med.filter(function (m) { return m.lado === 'interno'; }).map(function (m) { return m.atend; });
  var exts = med.filter(function (m) { return m.lado === 'externo'; }).map(function (m) { return m.atend; });
  var linhasProd = dadosTempoProduto().map(function (p) {
    return '<tr><td>' + esc(p.produto) + '</td><td class="num">' + p.nInt + '</td><td class="num">' + fmtDuracao(p.mediaInt) + '</td><td class="num">' + p.nExt + '</td><td class="num">' + fmtDuracao(p.mediaExt) + '</td></tr>';
  });
  var linhasTec = dadosTempoTecnico().map(function (t) {
    return '<tr><td>' + esc(t.tecnico) + '</td><td>' + t.lado + '</td><td class="num">' + t.n + '</td><td class="num">' + fmtDuracao(t.media) + '</td><td class="num">' + fmtDuracao(t.menor) + '</td><td class="num">' + fmtDuracao(t.maior) + '</td></tr>';
  });
  return kpis([
    { rotulo: 'Atendimentos medidos', valor: med.length, cor: '#1b1b18' },
    { rotulo: 'Tempo médio — interno (oficina)', valor: fmtDuracao(media(ints)), cor: '#d93035' },
    { rotulo: 'Tempo médio — externo (rua)', valor: fmtDuracao(media(exts)), cor: '#2e9e5b' }
  ]) +
  '<div class="rel-acoes"><h2>Por produto — ' + periodo().texto + '</h2><button type="button" class="btn btn-outline" id="exp-tempo-prod">Exportar Excel</button></div>' +
  tabela([{ t: 'Produto (marca / modelo)' }, { t: 'Interno: chamados', num: true }, { t: 'Interno: tempo médio', num: true }, { t: 'Externo: chamados', num: true }, { t: 'Externo: tempo médio', num: true }], linhasProd,
    'Nenhum atendimento fechado e medido neste período.') +
  '<div class="rel-acoes" style="margin-top:22px;"><h2>Por técnico</h2><button type="button" class="btn btn-outline" id="exp-tempo-tec">Exportar Excel</button></div>' +
  tabela([{ t: 'Técnico' }, { t: 'Atuação' }, { t: 'Chamados', num: true }, { t: 'Tempo médio', num: true }, { t: 'Mais rápido', num: true }, { t: 'Mais lento', num: true }], linhasTec, 'Sem dados neste período.') +
  '<p class="rel-nota" style="margin-top:10px;">Tempo de atendimento = do <b>Iniciar</b> até o <b>Fechar</b> o chamado. Conta só chamados fechados com serviço feito (devolvido sem conserto fica de fora). Interno = oficina; externo = rua. Se o chamado ficou aguardando orçamento no meio do caminho, essa espera entra no tempo.</p>';
}

/* ---------- Oficina: abertos, aprovados, recusados e faturados (mensal e anual) ---------- */
var EVENTO_OFICINA = { aberto: 'Aberto', aprovado: 'Orçamento aprovado', recusado: 'Orçamento recusado', faturado: 'Faturado' };

// Eventos de cada chamado da oficina, cada um na sua data: abertura, decisão do orçamento e faturamento.
function eventosOficina() {
  var ev = [];
  chamadosOficinaAno.forEach(function (c) {
    ev.push({ tipo: 'aberto', data: new Date(c.created_at), c: c });
    if (c.orcamento_em) {
      var recusado = c.status === 'nao_aprovada' || c.devolvido;
      ev.push({ tipo: recusado ? 'recusado' : 'aprovado', data: new Date(c.orcamento_em), c: c });
    }
    if (c.faturado_em) ev.push({ tipo: 'faturado', data: new Date(c.faturado_em), c: c });
  });
  return ev;
}

function contarEventos(eventos) {
  var n = { aberto: 0, aprovado: 0, recusado: 0, faturado: 0 };
  eventos.forEach(function (e) { n[e.tipo]++; });
  return n;
}

function dadosOficinaMes() {
  var ano = parseInt($('f-ano').value, 10);
  var todos = eventosOficina().filter(function (e) { return e.data.getFullYear() === ano; });
  var linhas = [];
  for (var m = 0; m < 12; m++) {
    var n = contarEventos(todos.filter(function (e) { return e.data.getMonth() === m; }));
    linhas.push({ mes: MESES[m], num: m + 1, aberto: n.aberto, aprovado: n.aprovado, recusado: n.recusado, faturado: n.faturado });
  }
  return linhas;
}

function eventosDoPeriodo() {
  var p = periodo();
  return eventosOficina().filter(function (e) { return e.data >= p.ini && e.data < p.fim; })
    .sort(function (a, b) { return b.data - a.data; });
}

function abaOficina() {
  var p = periodo();
  var ev = eventosDoPeriodo();
  var n = contarEventos(ev);
  var decididos = n.aprovado + n.recusado;
  var mesSel = $('f-mes').value ? parseInt($('f-mes').value, 10) : 0;
  var meses = dadosOficinaMes();
  var tot = { aberto: 0, aprovado: 0, recusado: 0, faturado: 0 };
  var linhasMes = meses.map(function (l) {
    tot.aberto += l.aberto; tot.aprovado += l.aprovado; tot.recusado += l.recusado; tot.faturado += l.faturado;
    return '<tr' + (l.num === mesSel ? ' style="background:#fff3cd;"' : '') + '><td>' + l.mes + '</td><td class="num">' + l.aberto + '</td><td class="num">' + l.aprovado +
      '</td><td class="num">' + l.recusado + '</td><td class="num">' + l.faturado + '</td></tr>';
  });
  linhasMes.push('<tr style="font-weight:700; background:#f5f5f3;"><td>Total do ano</td><td class="num">' + tot.aberto + '</td><td class="num">' + tot.aprovado +
    '</td><td class="num">' + tot.recusado + '</td><td class="num">' + tot.faturado + '</td></tr>');

  var linhasDet = ev.map(function (e) {
    var c = e.c;
    return '<tr><td>' + fmtData(e.data.toISOString()) + '</td><td>' + EVENTO_OFICINA[e.tipo] + '</td><td>' + numChamado(c) + '</td><td>' + esc(nomeCliente(c)) + '</td><td>' + esc(equipamentoTexto(c)) +
      '</td><td>' + esc((c.descricao_defeito || '').slice(0, 100)) + '</td></tr>';
  });

  return kpis([
    { rotulo: 'Abertos na oficina', valor: n.aberto, cor: '#1b1b18' },
    { rotulo: 'Orçamentos aprovados', valor: n.aprovado, cor: '#2e9e5b' },
    { rotulo: 'Orçamentos recusados', valor: n.recusado, cor: '#8a8a85' },
    { rotulo: 'Faturados', valor: n.faturado, cor: '#d93035' },
    { rotulo: 'Taxa de aprovação', valor: decididos ? Math.round(n.aprovado * 100 / decididos) + '%' : '—' }
  ]) +
  '<div class="rel-acoes"><h2>Mês a mês — ' + $('f-ano').value + '</h2><button type="button" class="btn btn-outline" id="exp-oficina-mes">Exportar Excel</button></div>' +
  tabela([{ t: 'Mês' }, { t: 'Abertos', num: true }, { t: 'Orç. aprovados', num: true }, { t: 'Orç. recusados', num: true }, { t: 'Faturados', num: true }], linhasMes, '') +
  '<div class="rel-acoes" style="margin-top:22px;"><h2>Detalhe — ' + p.texto + '</h2><button type="button" class="btn btn-outline" id="exp-oficina-det">Exportar Excel</button></div>' +
  tabela([{ t: 'Data' }, { t: 'Evento' }, { t: 'Nº' }, { t: 'Cliente' }, { t: 'Equipamento' }, { t: 'Defeito' }], linhasDet, 'Nenhum evento da oficina neste período.') +
  '<p class="rel-nota" style="margin-top:10px;">Cada evento conta na data em que aconteceu: aberto = abertura do chamado; aprovado/recusado = decisão do orçamento pela recepção; faturado = faturamento. Só chamados da oficina interna. Equipamento recusado e devolvido não é faturado.</p>';
}

/* ---------- 2) Chamados abertos ---------- */
function abaAbertos() {
  var cont = {};
  Object.keys(STATUS_LABELS).forEach(function (s) { cont[s] = 0; });
  chamadosPeriodo.forEach(function (c) { cont[c.status] = (cont[c.status] || 0) + 1; });
  var aindaAbertos = chamadosPeriodo.filter(function (c) { return STATUS_ABERTOS.indexOf(c.status) !== -1; });
  var linhas = aindaAbertos.map(function (c) {
    return '<tr><td>' + numChamado(c) + '</td><td>' + fmtData(c.created_at) + '</td><td>' + esc(nomeCliente(c)) + '</td><td>' + esc(equipamentoTexto(c)) +
      '</td><td>' + esc((c.descricao_defeito || '').slice(0, 120)) + '</td><td>' + STATUS_LABELS[c.status] + '</td><td class="num">' + diasDesde(c.created_at) + '</td></tr>';
  });
  return kpis([
    { rotulo: 'Abertos no período', valor: chamadosPeriodo.length, cor: '#1b1b18' },
    { rotulo: 'Abertos', valor: cont.aberta, cor: '#f0a020' },
    { rotulo: 'Em atendimento', valor: cont.em_andamento, cor: '#0073e6' },
    { rotulo: 'Aguardando orçamento', valor: cont.pendente, cor: '#d93035' },
    { rotulo: 'Orçamento aprovado', valor: cont.orcamento_aprovado, cor: '#6b4fd8' },
    { rotulo: 'Fechados', valor: cont.concluida, cor: '#2e9e5b' },
    { rotulo: 'Orçamento recusado', valor: cont.nao_aprovada, cor: '#8a8a85' }
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
    return '<tr><td>' + numChamado(c) + '</td><td>' + fmtData(c.created_at) + '</td><td>' + esc(nomeCliente(c)) + '</td><td>' + esc(equipamentoTexto(c)) +
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
    pecasUsadas(c).forEach(function (i) {
      var cod = (i.estoque_pecas || {}).codigo || '—';
      porDefeito[k].pecas[cod] = (porDefeito[k].pecas[cod] || 0) + (parseFloat(i.quantidade) || 0);
    });
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
    var usadasC = pecasUsadas(c);
    var pecaTxt = usadasC.length ? esc(usadasC.map(function (i) { var p = i.estoque_pecas || {}; return p.codigo + ' ×' + fmtNum(i.quantidade); }).join(', ')) : '—';
    return '<tr><td>' + numChamado(c) + '</td><td>' + fmtData(c.created_at) + '</td><td>' + esc(nomeCliente(c)) + '</td><td>' + esc(equipamentoTexto(c)) +
      '</td><td>' + esc((c.descricao_defeito || '').slice(0, 140)) + '</td><td>' + pecaTxt + '</td><td class="num">' +
      (usadasC.length ? fmtNum(usadasC.reduce(function (s2, i) { return s2 + (parseFloat(i.quantidade) || 0); }, 0)) : '') + '</td><td>' + STATUS_LABELS[c.status] + '</td></tr>';
  });

  return kpis([
    { rotulo: 'Chamados no período', valor: itens.length, cor: '#1b1b18' },
    { rotulo: 'Com peça utilizada', valor: itens.filter(function (c) { return pecasUsadas(c).length > 0; }).length, cor: '#d93035' },
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
  var html = abaAtual === 'tempo' ? abaTempo() : abaAtual === 'oficina' ? abaOficina() : abaAtual === 'consumo' ? abaConsumo() : abaAtual === 'abertos' ? abaAbertos() : abaAtual === 'backlog' ? abaBacklog() : abaManutencao();
  $('painel').innerHTML = html;
  ligarExportacoes();
}

function ligarExportacoes() {
  var sufixo = sufixoArquivo();
  var b;
  if ((b = $('exp-oficina-mes'))) b.addEventListener('click', function () {
    exportarExcel('oficina-mes-a-mes-' + $('f-ano').value + '.xlsx', dadosOficinaMes(), [
      { titulo: 'Mês', chave: 'mes' }, { titulo: 'Abertos', chave: 'aberto' }, { titulo: 'Orçamentos aprovados', chave: 'aprovado' },
      { titulo: 'Orçamentos recusados', chave: 'recusado' }, { titulo: 'Faturados', chave: 'faturado' }
    ], 'Oficina');
  });
  if ((b = $('exp-oficina-det'))) b.addEventListener('click', function () {
    var d = eventosDoPeriodo();
    if (!d.length) { showToast('Não há dados para exportar.', 'warning'); return; }
    exportarExcel('oficina-detalhe-' + sufixo + '.xlsx', d, [
      { titulo: 'Data', valor: function (e) { return fmtData(e.data.toISOString()); } },
      { titulo: 'Evento', valor: function (e) { return EVENTO_OFICINA[e.tipo]; } },
      { titulo: 'Nº', valor: function (e) { return numChamado(e.c); } },
      { titulo: 'Cliente', valor: function (e) { return nomeCliente(e.c); } },
      { titulo: 'Equipamento', valor: function (e) { return equipamentoTexto(e.c); } },
      { titulo: 'Defeito', valor: function (e) { return e.c.descricao_defeito || ''; } }
    ], 'Detalhe');
  });
  if ((b = $('exp-consumo'))) b.addEventListener('click', function () {
    var d = dadosConsumo();
    if (!d.length) { showToast('Não há dados para exportar.', 'warning'); return; }
    exportarExcel('consumo-pecas-' + sufixo + '.xlsx', d, [
      { titulo: 'Código', chave: 'codigo' }, { titulo: 'Peça', chave: 'desc' }, { titulo: 'Marca', chave: 'marca' },
      { titulo: 'Consumido no período', valor: function (x) { return x.usado; } }, { titulo: 'Chamados', chave: 'chamados' },
      { titulo: 'Estoque atual', valor: function (x) { return parseFloat(x.estoque); } },
      { titulo: 'Consumo médio por mês', valor: function (x) { return Math.round(x.porMes * 100) / 100; } },
      { titulo: 'Estoque dura (meses)', valor: function (x) { return x.duraMeses == null ? '' : Math.round(x.duraMeses * 10) / 10; } },
      { titulo: 'Custo (R$)', valor: function (x) { return Math.round(x.custo * 100) / 100; } },
      { titulo: 'Venda (R$)', valor: function (x) { return Math.round(x.venda * 100) / 100; } },
      { titulo: 'Margem (R$)', valor: function (x) { return Math.round(x.margem * 100) / 100; } }
    ], 'Consumo');
  });
  if ((b = $('exp-marca'))) b.addEventListener('click', function () {
    var d = dadosPorMarca();
    if (!d.length) { showToast('Não há dados para exportar.', 'warning'); return; }
    exportarExcel('consumo-por-marca-' + sufixo + '.xlsx', d, [
      { titulo: 'Marca', chave: 'marca' }, { titulo: 'Peças diferentes', chave: 'pecas' }, { titulo: 'Consumido', chave: 'usado' },
      { titulo: 'Custo (R$)', valor: function (x) { return Math.round(x.custo * 100) / 100; } },
      { titulo: 'Venda (R$)', valor: function (x) { return Math.round(x.venda * 100) / 100; } },
      { titulo: 'Margem (R$)', valor: function (x) { return Math.round(x.margem * 100) / 100; } }
    ], 'Marcas');
  });
  if ((b = $('exp-tempo-prod'))) b.addEventListener('click', function () {
    var d = dadosTempoProduto();
    if (!d.length) { showToast('Não há dados para exportar.', 'warning'); return; }
    exportarExcel('tempo-atendimento-produto-' + sufixo + '.xlsx', d, [
      { titulo: 'Produto', chave: 'produto' }, { titulo: 'Interno: chamados', chave: 'nInt' },
      { titulo: 'Interno: tempo médio (h)', valor: function (x) { return x.mediaInt == null ? '' : Math.round(x.mediaInt * 100) / 100; } },
      { titulo: 'Externo: chamados', chave: 'nExt' },
      { titulo: 'Externo: tempo médio (h)', valor: function (x) { return x.mediaExt == null ? '' : Math.round(x.mediaExt * 100) / 100; } }
    ], 'Por produto');
  });
  if ((b = $('exp-tempo-tec'))) b.addEventListener('click', function () {
    var d = dadosTempoTecnico();
    if (!d.length) { showToast('Não há dados para exportar.', 'warning'); return; }
    exportarExcel('tempo-atendimento-tecnico-' + sufixo + '.xlsx', d, [
      { titulo: 'Técnico', chave: 'tecnico' }, { titulo: 'Atuação', chave: 'lado' }, { titulo: 'Chamados', chave: 'n' },
      { titulo: 'Tempo médio (h)', valor: function (x) { return Math.round(x.media * 100) / 100; } },
      { titulo: 'Mais rápido (h)', valor: function (x) { return Math.round(x.menor * 100) / 100; } },
      { titulo: 'Mais lento (h)', valor: function (x) { return Math.round(x.maior * 100) / 100; } }
    ], 'Por técnico');
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
    { titulo: 'Nº', valor: numChamado },
    { titulo: 'Abertura', valor: function (c) { return fmtData(c.created_at); } },
    { titulo: 'Cliente', valor: nomeCliente },
    { titulo: 'Equipamento', valor: equipamentoTexto },
    { titulo: 'Defeito', chave: 'descricao_defeito' },
    { titulo: 'Status', valor: function (c) { return STATUS_LABELS[c.status] || c.status; } }
  ];
  if (comDias) cols.push({ titulo: 'Dias em aberto', valor: function (c) { return diasDesde(c.created_at); } });
  else {
    cols.push({ titulo: 'Peças', valor: function (c) { return pecasUsadas(c).map(function (i) { return ((i.estoque_pecas || {}).codigo || '') + ' x' + i.quantidade; }).join('; '); } });
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
