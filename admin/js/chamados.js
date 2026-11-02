// Chamados no PC: abertura (campo / oficina interna), agenda do técnico, decisão de orçamento
// e atendimento. As regras estão em chamados-lib.js (e no banco).

var papel = null, meuId = null;
var chamados = [], tecnicos = [], pecas = [], clientes = [], equipamentos = [];
var filtro = 'abertos', busca = '', tipoNovo = null, atual = null;

function $(id) { return document.getElementById(id); }
function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtData(iso) { return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'; }
function fmtDia(d) { return d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—'; }
function nomeTecnico(id) { var t = tecnicos.find(function (x) { return x.id === id; }); return t ? t.nome : (id ? 'Técnico' : '—'); }
function equipTxt(c) { var e = c.equipamentos || {}; return ([e.marca, e.modelo].filter(Boolean).join(' ') || 'Equipamento') + (e.numero_serie ? ' · série ' + e.numero_serie : ''); }

var SEL = '*, clientes(razao_social, telefone_empresa, logradouro, numero, bairro, municipio, uf, latitude, longitude), equipamentos(marca, modelo, numero_serie)';

var FILTROS = [
  { id: 'abertos', rotulo: 'Em aberto', fn: function (c) { return ['aberta', 'em_andamento', 'pendente', 'orcamento_aprovado'].indexOf(c.status) !== -1; } },
  { id: 'campo', rotulo: 'Campo', fn: function (c) { return c.tipo === 'campo' && ['aberta', 'em_andamento'].indexOf(c.status) !== -1; } },
  { id: 'orcamento', rotulo: 'Aguardando orçamento', fn: function (c) { return c.status === 'pendente'; } },
  { id: 'aprovados', rotulo: 'Orçamento aprovado', fn: function (c) { return c.status === 'orcamento_aprovado'; } },
  { id: 'faturar', rotulo: 'A faturar', fn: chAFaturar },
  { id: 'faturados', rotulo: 'Faturados', fn: function (c) { return !!c.faturado_em; } },
  { id: 'oficina', rotulo: 'Oficina interna', fn: function (c) { return c.tipo === 'oficina' && ['orcamento_aprovado', 'em_andamento'].indexOf(c.status) !== -1; } },
  { id: 'fechados', rotulo: 'Fechados', fn: function (c) { return c.status === 'concluida'; } },
  { id: 'recusados', rotulo: 'Recusados', fn: function (c) { return c.status === 'nao_aprovada'; } },
  { id: 'todos', rotulo: 'Todos', fn: function () { return true; } }
];

// Abas de cada perfil. Técnico de rua: só campo em aberto e fechados. Oficina interna: o que está na oficina
// (em aberto), aguardando orçamento, orçamento aprovado e fechados. Os demais perfis veem todas.
var FILTROS_POR_PAPEL = {
  tecnico: [
    { id: 'abertos', rotulo: 'Em aberto', fn: function (c) { return c.tipo === 'campo' && ['aberta', 'em_andamento'].indexOf(c.status) !== -1; } },
    { id: 'fechados', rotulo: 'Fechados', fn: function (c) { return c.status === 'concluida'; } }
  ],
  oficina_interna: [
    { id: 'abertos', rotulo: 'Em aberto', fn: function (c) { return c.tipo === 'oficina' && ['pendente', 'orcamento_aprovado', 'em_andamento'].indexOf(c.status) !== -1; } },
    { id: 'orcamento', rotulo: 'Aguardando orçamento', fn: function (c) { return c.status === 'pendente'; } },
    { id: 'aprovados', rotulo: 'Orçamento aprovado', fn: function (c) { return c.status === 'orcamento_aprovado'; } },
    { id: 'fechados', rotulo: 'Fechados', fn: function (c) { return c.status === 'concluida'; } }
  ]
};
function filtrosAtivos() { return FILTROS_POR_PAPEL[papel] || FILTROS; }

/* ===================== LISTA ===================== */

async function carregar() {
  var r = await supabaseClient.from('assistencias_tecnicas').select(SEL).order('created_at', { ascending: true }).limit(1000);
  if (r.error) { $('ch-tbody').innerHTML = '<tr><td colspan="7">Erro ao carregar: ' + esc(r.error.message) + '</td></tr>'; return; }
  chamados = r.data || [];
  desenharChips();
  desenharLista();
}

function desenharChips() {
  $('ch-chips').innerHTML = filtrosAtivos().map(function (f) {
    var n = chamados.filter(f.fn).length;
    return '<button type="button" class="ch-chip' + (f.id === filtro ? ' ativo' : '') + '" data-f="' + f.id + '">' + f.rotulo + '<small>' + n + '</small></button>';
  }).join('');
  $('ch-chips').querySelectorAll('.ch-chip').forEach(function (b) {
    b.addEventListener('click', function () { filtro = b.dataset.f; desenharChips(); desenharLista(); });
  });
}

function desenharLista() {
  var f = filtrosAtivos().find(function (x) { return x.id === filtro; }) || filtrosAtivos()[0];
  var termo = busca.trim().toLowerCase();
  var itens = chPorAbertura(chamados.filter(f.fn)).filter(function (c) {
    if (!termo) return true;
    var cl = c.clientes ? c.clientes.razao_social : '';
    return [c.numero, cl, equipTxt(c), c.descricao_defeito].join(' ').toLowerCase().indexOf(termo) !== -1;
  });
  if (filtro === 'fechados' || filtro === 'recusados' || filtro === 'todos') itens.reverse();
  if (!itens.length) { $('ch-tbody').innerHTML = '<tr><td colspan="7">Nenhum chamado neste filtro.</td></tr>'; return; }
  $('ch-tbody').innerHTML = itens.map(function (c) {
    var agenda = c.tipo === 'campo' ? esc(nomeTecnico(c.tecnico_id)) + (c.data_agendada ? '<br><small>' + fmtDia(c.data_agendada) + '</small>' : '') : '<span class="tipo-tag">Oficina interna</span>' + (c.tecnico_id ? '<br><small>' + esc(nomeTecnico(c.tecnico_id)) + '</small>' : '');
    return '<tr class="ch-linha" data-id="' + c.id + '"><td><b>' + c.numero + '</b></td><td>' + fmtData(c.created_at) + '</td><td>' + esc(c.clientes ? c.clientes.razao_social : '—') +
      '</td><td>' + esc(equipTxt(c)) + '</td><td>' + esc((c.descricao_defeito || '').slice(0, 90)) + '</td><td>' + agenda +
      '</td><td><span class="ch-st st-' + c.status + '">' + CH_STATUS_CURTO[c.status] + '</span>' +
      (chAFaturar(c) ? '<br><small style="color:#b4251f; font-weight:700;">A faturar</small>' : (c.faturado_em ? '<br><small>Faturado ' + fmtData(c.faturado_em) + '</small>' : '')) + '</td></tr>';
  }).join('');
  $('ch-tbody').querySelectorAll('.ch-linha').forEach(function (tr) {
    tr.addEventListener('click', function () { abrirDetalhe(tr.dataset.id); });
  });
}

/* ===================== NOVO CHAMADO ===================== */

function opcoesClientes(filtroTxt) {
  var f = (filtroTxt || '').trim().toLowerCase();
  var lista = clientes.filter(function (c) { return !f || (c.razao_social || '').toLowerCase().indexOf(f) !== -1 || (c.nome_fantasia || '').toLowerCase().indexOf(f) !== -1; });
  $('n-cliente').innerHTML = '<option value="">— Selecione (' + lista.length + ') —</option>' + lista.map(function (c) {
    return '<option value="' + c.id + '">' + esc(c.razao_social) + (c.nome_fantasia ? ' (' + esc(c.nome_fantasia) + ')' : '') + '</option>';
  }).join('');
}

function normTxt(v) { return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// Lista geral de modelos de balança (marca + modelo): vem de todos os equipamentos já cadastrados,
// vale para qualquer cliente. O nº de série é informado em cada chamado.
var catalogo = [];
async function carregarCatalogo() {
  var r = await supabaseClient.from('equipamentos').select('marca, modelo').order('created_at', { ascending: false }).limit(5000);
  var vistos = {};
  catalogo = [];
  (r.data || []).forEach(function (e) {
    if (!e.marca && !e.modelo) return;
    var k = normTxt(e.marca) + '|' + normTxt(e.modelo);
    if (vistos[k]) return;
    vistos[k] = true;
    catalogo.push({ marca: e.marca || '', modelo: e.modelo || '' });
  });
  catalogo.sort(function (a, b) { return ((a.marca + ' ' + a.modelo).toLowerCase()).localeCompare((b.marca + ' ' + b.modelo).toLowerCase()); });
  $('n-equip').innerHTML = '<option value="">— Selecione —</option>' + catalogo.map(function (m, i) {
    return '<option value="' + i + '">' + esc([m.marca, m.modelo].filter(Boolean).join(' ')) + '</option>';
  }).join('') + '<option value="__novo">+ Cadastrar novo modelo</option>';
  $('n-equip-novo').hidden = true;
}

function tipoDoTecnico(id) {
  var t = tecnicos.find(function (x) { return x.id === id; });
  return t ? (t.role === 'oficina_interna' ? 'oficina' : 'campo') : null;
}

// O técnico escolhido define o tipo: campo (visita) ou oficina interna (selo/lacre antigo obrigatórios).
function atualizarTipoNovo() {
  tipoNovo = tipoDoTecnico($('n-tecnico').value);
  $('n-bloco-campo').hidden = tipoNovo !== 'campo';
  $('n-bloco-oficina').hidden = tipoNovo !== 'oficina';
  $('novo-titulo').textContent = tipoNovo === 'campo' ? 'Novo chamado — campo' : (tipoNovo === 'oficina' ? 'Novo chamado — oficina interna' : 'Novo chamado');
}

async function abrirNovo() {
  tipoNovo = null;
  $('novo-erro').hidden = true;
  ['n-cli-busca', 'n-defeito', 'n-selo', 'n-lacre', 'n-eq-marca', 'n-eq-modelo', 'n-eq-serie'].forEach(function (id) { $(id).value = ''; });
  $('n-selo-aus').checked = false; $('n-lacre-aus').checked = false;
  $('n-eq-serie-aus').checked = false; $('n-eq-serie').disabled = false;
  $('n-selo').disabled = false; $('n-lacre').disabled = false;
  $('n-data').value = new Date().toISOString().slice(0, 10);

  var r = await supabaseClient.from('clientes').select('id, razao_social, nome_fantasia').eq('eh_cliente', true).order('razao_social');
  clientes = r.data || [];
  opcoesClientes('');
  await carregarCatalogo();
  var t = await supabaseClient.rpc('listar_tecnicos');
  tecnicos = t.data || tecnicos;
  function grupo(rotulo, role) {
    var l = tecnicos.filter(function (x) { return x.role === role; });
    return l.length ? '<optgroup label="' + rotulo + '">' + l.map(function (x) { return '<option value="' + x.id + '">' + esc(x.nome) + '</option>'; }).join('') + '</optgroup>' : '';
  }
  $('n-tecnico').innerHTML = '<option value="">— Selecione —</option>' + grupo('Técnicos de campo', 'tecnico') + grupo('Oficina interna', 'oficina_interna');
  atualizarTipoNovo();
  $('modal-novo').classList.add('open');
}

function erroNovo(m) { $('novo-erro').textContent = m; $('novo-erro').hidden = false; }

$('n-eq-serie-aus').addEventListener('change', function () {
  $('n-eq-serie').disabled = this.checked;
  $('n-eq-serie').value = this.checked ? CH_SEM_SERIE : '';
});
$('n-selo-aus').addEventListener('change', function () { $('n-selo').disabled = this.checked; if (this.checked) $('n-selo').value = ''; });
$('n-lacre-aus').addEventListener('change', function () { $('n-lacre').disabled = this.checked; if (this.checked) $('n-lacre').value = ''; });
$('n-tecnico').addEventListener('change', atualizarTipoNovo);
$('n-cli-busca').addEventListener('input', function () { opcoesClientes(this.value); });
$('n-equip').addEventListener('change', function () { $('n-equip-novo').hidden = this.value !== '__novo'; });
$('n-cancelar').addEventListener('click', function () { $('modal-novo').classList.remove('open'); });

$('n-salvar').addEventListener('click', async function () {
  $('novo-erro').hidden = true;
  var clienteId = $('n-cliente').value, eqSel = $('n-equip').value, defeito = $('n-defeito').value.trim();
  if (!clienteId) return erroNovo('Selecione o cliente.');
  if (!eqSel) return erroNovo('Selecione o modelo da balança (ou cadastre um novo modelo).');
  var marca, modelo;
  if (eqSel === '__novo') {
    marca = $('n-eq-marca').value.trim(); modelo = $('n-eq-modelo').value.trim();
    if (!marca || !modelo) return erroNovo('Informe a marca e o modelo da balança.');
  } else {
    var m = catalogo[parseInt(eqSel, 10)]; marca = m.marca; modelo = m.modelo;
  }
  var ns = chNormalizarSerie($('n-eq-serie-aus').checked ? CH_SEM_SERIE : $('n-eq-serie').value);
  if (ns.erro) return erroNovo(ns.erro);
  if (!defeito) return erroNovo('Informe o defeito do equipamento.');
  if (!$('n-tecnico').value) return erroNovo('Escolha o técnico — ele define se o chamado é de campo ou da oficina interna.');
  atualizarTipoNovo();
  var campos = { cliente_id: clienteId, descricao_defeito: defeito, tipo: tipoNovo, tecnico_id: $('n-tecnico').value };

  if (tipoNovo === 'campo') {
    if (!$('n-data').value) return erroNovo('Informe a data da visita.');
    campos.data_agendada = $('n-data').value; campos.status = 'aberta';
  } else {
    var selo = $('n-selo').value.trim(), lacre = $('n-lacre').value.trim();
    if (!selo && !$('n-selo-aus').checked) return erroNovo('Informe o selo antigo ou marque "Não possui selo".');
    if (!lacre && !$('n-lacre-aus').checked) return erroNovo('Informe o lacre antigo ou marque "Não possui lacre".');
    var erros = chCamposVedacao({ seloAntigo: selo, lacreAntigo: lacre }, false);
    if (erros.length) return erroNovo(erros[0]);
    campos.selo_antigo = selo || null; campos.selo_antigo_ausente = $('n-selo-aus').checked;
    campos.lacre_antigo = lacre || null; campos.lacre_antigo_ausente = $('n-lacre-aus').checked;
    campos.status = 'pendente';
  }

  var btn = this; btn.disabled = true;
  // reaproveita a mesma balança (modelo + série) do cliente; sem série ("NÃO CONSTA") sempre cria um registro novo
  var equipId = null;
  if (ns.valor !== CH_SEM_SERIE) {
    var ja = await supabaseClient.from('equipamentos').select('id, marca, modelo').eq('cliente_id', clienteId).eq('numero_serie', ns.valor);
    var igual = (ja.data || []).find(function (e) { return normTxt(e.marca) === normTxt(marca) && normTxt(e.modelo) === normTxt(modelo); });
    if (igual) equipId = igual.id;
  }
  if (!equipId) {
    var eq = await supabaseClient.from('equipamentos').insert({ cliente_id: clienteId, marca: marca, modelo: modelo, numero_serie: ns.valor, created_by: meuId }).select().single();
    if (eq.error) { btn.disabled = false; return erroNovo('Erro ao cadastrar equipamento: ' + eq.error.message); }
    equipId = eq.data.id;
  }
  campos.equipamento_id = equipId;
  var r = await supabaseClient.from('assistencias_tecnicas').insert(campos).select().single();
  btn.disabled = false;
  if (r.error) return erroNovo('Erro ao abrir o chamado: ' + r.error.message);
  await chHistorico(r.data.id, meuId, 'nota', campos.status, tipoNovo === 'campo' ? 'Chamado de campo aberto e programado.' : 'Equipamento recebido na oficina interna — aguardando orçamento.');
  $('modal-novo').classList.remove('open');
  showToast('Chamado Nº ' + r.data.numero + ' aberto.', 'ok');
  carregar();
});

/* ===================== DETALHE ===================== */

async function abrirDetalhe(id) {
  atual = chamados.find(function (c) { return c.id === id; });
  if (!atual) return;
  desenharDetalhe();
  $('modal-det').classList.add('open');
  carregarHistorico();
}

function desenharDetalhe() {
  var c = atual, cl = c.clientes || {};
  $('d-titulo').textContent = 'Chamado Nº ' + c.numero + ' — ' + (c.tipo === 'campo' ? 'Campo' : 'Oficina interna');
  var end = [cl.logradouro, cl.numero, cl.bairro, cl.municipio, cl.uf].filter(Boolean).join(', ');
  var mapa = chUrlLocal(c);
  $('d-info').innerHTML =
    '<div><b>Status</b><span class="ch-st st-' + c.status + '">' + CH_STATUS[c.status] + '</span></div>' +
    '<div><b>Cliente</b>' + esc(cl.razao_social || '—') + (cl.telefone_empresa ? '<br><small>' + esc(cl.telefone_empresa) + '</small>' : '') + '</div>' +
    '<div><b>Endereço</b>' + (end ? esc(end) + (mapa ? ' <a href="' + mapa + '" target="_blank" rel="noopener" style="color:#d93035;">mapa</a>' : '') : '—') + '</div>' +
    '<div><b>Equipamento</b>' + esc(equipTxt(c)) + '</div>' +
    '<div><b>Abertura</b>' + fmtData(c.created_at) + '</div>' +
    (c.status === 'concluida' && c.orcamento_em ? '<div><b>Faturamento</b>' + (c.faturado_em ? 'Faturado em ' + fmtData(c.faturado_em) : '<span style="color:#b4251f; font-weight:700;">A faturar (recepção)</span>') + '</div>' : '') +
    '<div><b>Técnico / visita</b>' + (c.tecnico_id ? esc(nomeTecnico(c.tecnico_id)) + (c.tipo === 'campo' ? ' · ' + fmtDia(c.data_agendada) : '') : '—') + '</div>' +
    '<div style="grid-column:1/-1;"><b>Defeito</b>' + esc(c.descricao_defeito) + '</div>' +
    '<div><b>Selo antigo</b>' + (c.selo_antigo_ausente ? 'Não possui' : esc(c.selo_antigo || '—')) + '</div>' +
    '<div><b>Selo novo</b>' + esc(c.selo_novo || '—') + '</div>' +
    '<div><b>Lacre antigo</b>' + (c.lacre_antigo_ausente ? 'Não possui' : esc(c.lacre_antigo || '—')) + '</div>' +
    '<div><b>Lacre novo</b>' + esc(c.lacre_novo || '—') + '</div>';
  var rot = { iniciar: 'Iniciar', pendencia: 'Pendência / enviar para oficina', fechar: 'Fechar chamado', aprovar: 'Orçamento aprovado', recusar: 'Orçamento recusado', agendar: 'Reprogramar', anotar: 'Adicionar anotação', faturar: 'Marcar como faturado' };
  var acoes = chAcoes(papel, c);
  $('d-acoes').innerHTML = acoes.map(function (a) {
    return '<button type="button" class="btn ' + (a === 'recusar' || a === 'anotar' ? 'btn-outline' : 'btn-primary') + '" data-a="' + a + '">' + rot[a] + '</button>';
  }).join('') || '<span style="color:#8b95a7; font-size:0.88rem;">Nenhuma ação disponível para o seu perfil neste status.</span>';
  $('d-acoes').querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { painelAcao(b.dataset.a); }); });
  $('d-painel').innerHTML = '';
}

async function carregarHistorico() {
  var r = await supabaseClient.from('chamado_historico').select('*').eq('chamado_id', atual.id).order('created_at', { ascending: false });
  var h = r.data || [];
  $('d-hist').innerHTML = h.length ? h.map(function (x) {
    return '<div class="ch-hist"><small>' + new Date(x.created_at).toLocaleString('pt-BR') + (x.autor_nome ? ' · ' + esc(x.autor_nome) : '') + (x.status_para ? ' · ' + (CH_STATUS_CURTO[x.status_para] || '') : '') + '</small>' + esc(x.texto) + '</div>';
  }).join('') : '<p style="color:#8b95a7;">Sem registros ainda.</p>';
}

function camposVedacaoHtml(obrigatorio) {
  var ob = obrigatorio ? ' *' : '';
  return '<div class="form-grid">' +
    '<div class="form-field"><label for="a-selo-ant">Selo antigo' + ob + '</label><input type="text" id="a-selo-ant" maxlength="20" value="' + esc(atual.selo_antigo || '') + '"' + (atual.selo_antigo_ausente ? ' disabled' : '') + '><label class="check-linha"><input type="checkbox" id="a-selo-aus"' + (atual.selo_antigo_ausente ? ' checked' : '') + '> Não possui selo</label></div>' +
    '<div class="form-field"><label for="a-selo-novo">Selo novo' + ob + '</label><input type="text" id="a-selo-novo" maxlength="20" value="' + esc(atual.selo_novo || '') + '"></div>' +
    '<div class="form-field"><label for="a-lacre-ant">Lacre antigo' + ob + '</label><input type="text" id="a-lacre-ant" maxlength="20" value="' + esc(atual.lacre_antigo || '') + '"' + (atual.lacre_antigo_ausente ? ' disabled' : '') + '><label class="check-linha"><input type="checkbox" id="a-lacre-aus"' + (atual.lacre_antigo_ausente ? ' checked' : '') + '> Não possui lacre</label></div>' +
    '<div class="form-field"><label for="a-lacre-novo">Lacre novo' + ob + '</label><input type="text" id="a-lacre-novo" maxlength="20" value="' + esc(atual.lacre_novo || '') + '"></div></div>';
}

function ligarFlags() {
  [['a-selo-aus', 'a-selo-ant'], ['a-lacre-aus', 'a-lacre-ant']].forEach(function (p) {
    var chk = $(p[0]), inp = $(p[1]);
    if (!chk) return;
    chk.addEventListener('change', function () { inp.disabled = chk.checked; if (chk.checked) inp.value = ''; });
  });
}

function lerVedacao() {
  return {
    seloAntigo: ($('a-selo-ant').value || '').trim(), seloAntigoAusente: $('a-selo-aus').checked, seloNovo: ($('a-selo-novo').value || '').trim(),
    lacreAntigo: ($('a-lacre-ant').value || '').trim(), lacreAntigoAusente: $('a-lacre-aus').checked, lacreNovo: ($('a-lacre-novo').value || '').trim()
  };
}

async function garantirPecas() {
  if (pecas.length) return;
  var r = await supabaseClient.from('estoque_pecas').select('id, codigo, tipo_modelo, quantidade').order('codigo');
  pecas = r.data || [];
}

async function painelAcao(acao) {
  var c = atual, p = $('d-painel');
  var btnOk = '<div class="form-actions"><button type="button" class="btn btn-primary" id="a-ok">Confirmar</button></div>';
  var erroEl = '<p class="erro-msg" id="a-erro" hidden></p>';
  if (acao === 'iniciar') {
    p.innerHTML = '<div class="ch-painel"><p>Iniciar o atendimento deste chamado?</p>' + erroEl + btnOk + '</div>';
    $('a-ok').onclick = function () { executar(function () { return chIniciar(c, meuId); }); };
  } else if (acao === 'pendencia') {
    p.innerHTML = '<div class="ch-painel"><div class="form-field"><label for="a-hist">Histórico * — o que foi feito e por que vai para a oficina interna</label><textarea id="a-hist" rows="3"></textarea></div>' +
      '<details><summary style="cursor:pointer; font-weight:600;">Selos e lacres (opcional)</summary>' + camposVedacaoHtml(false) + '</details>' + erroEl + btnOk + '</div>';
    ligarFlags();
    $('a-ok').onclick = function () { var v = lerVedacao(); v.historico = $('a-hist').value; executar(function () { return chPendencia(c, meuId, v); }); };
  } else if (acao === 'fechar') {
    await garantirPecas();
    p.innerHTML = '<div class="ch-painel"><div class="form-field"><label for="a-hist">Histórico do chamado * — o que foi feito</label><textarea id="a-hist" rows="3"></textarea></div>' + camposVedacaoHtml(true) +
      '<div class="form-grid"><div class="form-field"><label for="a-peca">Peça utilizada (se houve)</label><select id="a-peca"><option value="">— Nenhuma (não baixa estoque) —</option>' +
      pecas.map(function (x) { return '<option value="' + x.id + '">' + esc(x.codigo) + ' — ' + esc((x.tipo_modelo || '').slice(0, 50)) + ' (estoque: ' + x.quantidade + ')</option>'; }).join('') +
      '</select></div><div class="form-field"><label for="a-qtd">Quantidade usada</label><input type="text" id="a-qtd" maxlength="8" placeholder="Ex: 1"></div></div>' + erroEl + btnOk + '</div>';
    ligarFlags();
    $('a-ok').onclick = function () { var v = lerVedacao(); v.historico = $('a-hist').value; v.pecaId = $('a-peca').value; v.qtd = $('a-qtd').value; executar(function () { return chFechar(c, meuId, v); }); };
  } else if (acao === 'faturar') {
    p.innerHTML = '<div class="ch-painel"><p>Confirma que o serviço deste chamado foi <b>faturado</b>?</p>' +
      '<div class="form-field"><label for="a-nota">Observação (opcional) — nº da nota, pedido ou forma de cobrança</label><textarea id="a-nota" rows="2" maxlength="500"></textarea></div>' + erroEl + btnOk + '</div>';
    $('a-ok').onclick = function () { executar(function () { return chFaturar(c, meuId, $('a-nota').value); }); };
  } else if (acao === 'anotar') {
    p.innerHTML = '<div class="ch-painel"><div class="form-field"><label for="a-nota">Anotação * — diagnóstico, observação ou andamento</label><textarea id="a-nota" rows="3" maxlength="5000"></textarea></div>' + erroEl + btnOk + '</div>';
    $('a-ok').onclick = function () { executar(function () { return chAnotar(c, meuId, $('a-nota').value); }); };
  } else if (acao === 'aprovar' || acao === 'recusar') {
    var aprova = acao === 'aprovar';
    p.innerHTML = '<div class="ch-painel"><p>' + (aprova ? 'Orçamento <b>aprovado</b>: o equipamento segue para a oficina interna.' : 'Orçamento <b>recusado</b>: o equipamento não será consertado e deve ser devolvido ao cliente.') + '</p>' +
      '<div class="form-field"><label for="a-nota">Observação (opcional)</label><textarea id="a-nota" rows="2"></textarea></div>' + erroEl + btnOk + '</div>';
    $('a-ok').onclick = function () { executar(function () { return chDecidirOrcamento(c, meuId, aprova, $('a-nota').value); }); };
  } else if (acao === 'agendar') {
    var t = await supabaseClient.rpc('listar_tecnicos'); tecnicos = t.data || tecnicos;
    p.innerHTML = '<div class="ch-painel"><div class="form-grid"><div class="form-field"><label for="a-tec">Técnico</label><select id="a-tec">' +
      tecnicos.filter(function (x) { return x.role === 'tecnico'; }).map(function (x) { return '<option value="' + x.id + '"' + (x.id === c.tecnico_id ? ' selected' : '') + '>' + esc(x.nome) + '</option>'; }).join('') +
      '</select></div><div class="form-field"><label for="a-data">Data da visita</label><input type="date" id="a-data" value="' + (c.data_agendada || '') + '"></div></div>' + erroEl + btnOk + '</div>';
    $('a-ok').onclick = function () {
      executar(async function () {
        var campos = { tecnico_id: $('a-tec').value, data_agendada: $('a-data').value || null };
        var r = await chAtualizar(c, campos, meuId, 'nota', 'Reprogramado para ' + nomeTecnico(campos.tecnico_id) + (campos.data_agendada ? ' em ' + fmtDia(campos.data_agendada) : '') + '.');
        return r;
      });
    };
  }
}

async function executar(fn) {
  var erroEl = $('a-erro'), btn = $('a-ok');
  erroEl.hidden = true; btn.disabled = true;
  var r = await fn();
  btn.disabled = false;
  if (r.erro) { erroEl.textContent = r.erro; erroEl.hidden = false; return; }
  showToast('Chamado atualizado.', 'ok');
  var idAtual = atual.id;
  await carregar();
  atual = chamados.find(function (x) { return x.id === idAtual; }) || r.chamado;
  desenharDetalhe();
  carregarHistorico();
}

$('d-fechar').addEventListener('click', function () { $('modal-det').classList.remove('open'); });
$('ch-busca').addEventListener('input', function () { busca = this.value; desenharLista(); });
$('btn-novo').addEventListener('click', abrirNovo);

(async function () {
  var auth = await window.ADMIN_AUTH_READY;
  if (!auth) return;
  papel = auth.profile.role; meuId = auth.session.user.id;
  window.CH_AUTOR_NOME = auth.profile.nome_exibicao;
  $('btn-novo').hidden = ['admin', 'programadora', 'recepcao'].indexOf(papel) === -1;
  $('link-clientes').hidden = !(papel === 'admin' || papel === 'programadora' || papel === 'recepcao');
  var t = await supabaseClient.rpc('listar_tecnicos');
  tecnicos = t.data || [];
  // cada perfil começa no filtro que mais usa
  filtro = papel === 'recepcao' ? 'orcamento' : (papel === 'programadora' ? 'campo' : 'abertos');
  await carregar();
  var alvo = new URLSearchParams(location.search).get('abrir');
  if (alvo) abrirDetalhe(alvo);
})();
