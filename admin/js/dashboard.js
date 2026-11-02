var currentUserId = null;

var QUADRANTES = [
  { categoria: 'venda', label: 'Vendas', pagina: 'vendas.html' },
  { categoria: 'manutencao', label: 'Manutenção', pagina: 'manutencao.html' },
  { categoria: 'pos_venda', label: 'Pós-venda / Follow-up', pagina: 'pos-venda.html' }
];

var CATEGORIA_LABELS_DASH = { venda: 'Vendas', manutencao: 'Manutenção', pos_venda: 'Pós-venda', '': 'Sem funil' };

// Cores dos gráficos (mesmos tokens do :root do dashboard.html).
function corBi(nome, padrao) {
  var v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return v || padrao;
}
var COR = {};
function carregarCores() {
  COR = {
    ativo: corBi('--bi-ativo', '#0073e6'),
    ganho: corBi('--bi-ganho', '#00b39a'),
    perdido: corBi('--bi-perdido', '#b4bfd0'),
    ink: corBi('--bi-ink', '#0a2540'),
    muted: corBi('--bi-muted', '#8b95a7')
  };
}

// Totais por quadrante, somados nos KPIs do topo.
var totaisQuadrante = {};

function inicioDeHoje() {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function labelResultado(categoria, resultado) {
  if (!resultado) return 'Contato registrado';
  var labels = RESULTADO_LABELS_POR_CATEGORIA[categoria];
  if (labels && labels[resultado]) return labels[resultado];
  return resultado === 'positivo' ? 'Positivo' : 'Negativo';
}

function linkCliente(c) {
  return '<button type="button" class="link-cliente" data-abrir="' + c.id + '">' + escHtml(c.razao_social || '—') + '</button>';
}

function ligarLinksCliente(container) {
  container.querySelectorAll('[data-abrir]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      abrirClienteDetalhe(btn.dataset.abrir, { onChange: recarregarTudo });
    });
  });
}

/* ===================== KPIs + GRÁFICOS ===================== */

async function buscarTodosClientes() {
  var todos = [];
  var passo = 1000;
  for (var inicio = 0; ; inicio += passo) {
    var { data, error } = await supabaseClient
      .from('clientes')
      .select('id, razao_social, categoria, situacao, canal_aquisicao, created_at, eh_cliente, encerrado_em, encerrado_por_nome')
      .range(inicio, inicio + passo - 1);
    if (error) throw error;
    todos = todos.concat(data || []);
    if (!data || data.length < passo) break;
  }
  return todos;
}

var graficos = {};
function desenharGrafico(id, config) {
  if (graficos[id]) graficos[id].destroy();
  graficos[id] = new Chart(document.getElementById(id), config);
}

function contar(lista, chaveFn) {
  var m = {};
  lista.forEach(function (x) { var k = chaveFn(x); m[k] = (m[k] || 0) + 1; });
  return m;
}

var clientesEfetividade = [];

// Lista visível dos fechamentos mais recentes, com a próxima revisita (manutenção ganha).
async function desenharUltimosFechamentos() {
  var tbody = document.getElementById('fech-tbody');
  if (!tbody) return;
  var recentes = clientesEfetividade.filter(function (c) {
    return (c.situacao === 'ganho' || c.situacao === 'perdido') && c.encerrado_em;
  }).sort(function (a, b) { return new Date(b.encerrado_em) - new Date(a.encerrado_em); }).slice(0, 15);
  if (!recentes.length) {
    tbody.innerHTML = '<tr><td colspan="6">Nenhum fechamento registrado ainda. Feche um lead pela ficha do cliente (histórico com status Fechado).</td></tr>';
    return;
  }
  var h = await supabaseClient.from('cliente_historico').select('cliente_id, created_at, resultado')
    .in('cliente_id', recentes.map(function (c) { return c.id; })).order('created_at', { ascending: true });
  var historico = {};
  (h.data || []).forEach(function (x) { (historico[x.cliente_id] = historico[x.cliente_id] || []).push(x); });
  var funis = { venda: 'Vendas', manutencao: 'Manutenção', pos_venda: 'Pós-venda' };
  tbody.innerHTML = recentes.map(function (c) {
    var revisita = '—';
    if (c.situacao === 'ganho') {
      var r = calcularProximoRetorno(c, historico[c.id] || []);
      if (r.revisao && !r.concluido) {
        revisita = r.data ? r.data.toLocaleDateString('pt-BR') : 'Precisa de contato';
      }
    }
    return '<tr><td>' + linkCliente(c) + '</td><td>' + (funis[c.categoria] || '—') + '</td>' +
      '<td><span class="badge ' + (c.situacao === 'ganho' ? 'badge-ok' : 'badge-danger') + '">' + (c.situacao === 'ganho' ? 'Ganho' : 'Perdido') + '</span></td>' +
      '<td>' + new Date(c.encerrado_em).toLocaleDateString('pt-BR') + '</td><td>' + escHtml(c.encerrado_por_nome || '—') + '</td><td>' + revisita + '</td></tr>';
  }).join('');
  ligarLinksCliente(tbody);
}

// Efetividade de fechamento: ganhos ÷ (ganhos + perdidos), por quem fechou e por mês do fechamento.
function desenharEfetividade() {
  var sel = document.getElementById('efet-periodo');
  if (!sel) return;
  if (!sel.options.length) {
    var ops = '<option value="">Todo o período</option>';
    var hoje = new Date();
    for (var i = 0; i < 12; i++) {
      var d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      ops += '<option value="' + d.getFullYear() + '-' + (d.getMonth() + 1) + '">' +
        d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) + '</option>';
    }
    sel.innerHTML = ops;
    sel.addEventListener('change', desenharEfetividade);
  }
  var periodo = sel.value;
  var porPessoa = {};
  clientesEfetividade.forEach(function (c) {
    if (c.situacao !== 'ganho' && c.situacao !== 'perdido') return;
    if (periodo) {
      if (!c.encerrado_em) return;
      var dt = new Date(c.encerrado_em);
      if (dt.getFullYear() + '-' + (dt.getMonth() + 1) !== periodo) return;
    }
    var quem = c.encerrado_por_nome || (c.encerrado_em ? 'Não identificado' : 'Sem registro');
    if (!porPessoa[quem]) porPessoa[quem] = { ganho: 0, perdido: 0 };
    porPessoa[quem][c.situacao]++;
  });
  var nomes = Object.keys(porPessoa).sort(function (a, b) {
    return (porPessoa[b].ganho + porPessoa[b].perdido) - (porPessoa[a].ganho + porPessoa[a].perdido);
  });
  var tot = { ganho: 0, perdido: 0 };
  var linhas = nomes.map(function (n) {
    var x = porPessoa[n], enc = x.ganho + x.perdido;
    tot.ganho += x.ganho; tot.perdido += x.perdido;
    return '<tr><td>' + n.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</td><td class="num">' + x.ganho + '</td><td class="num">' + x.perdido +
      '</td><td class="num">' + enc + '</td><td class="num"><b>' + Math.round(x.ganho * 100 / enc) + '%</b></td></tr>';
  });
  if (!linhas.length) {
    document.getElementById('efet-tbody').innerHTML = '<tr><td colspan="5">Nenhum lead fechado neste período.</td></tr>';
    return;
  }
  var encTotal = tot.ganho + tot.perdido;
  linhas.push('<tr style="font-weight:700; background:#f5f5f3;"><td>Total</td><td class="num">' + tot.ganho + '</td><td class="num">' + tot.perdido +
    '</td><td class="num">' + encTotal + '</td><td class="num">' + Math.round(tot.ganho * 100 / encTotal) + '%</td></tr>');
  document.getElementById('efet-tbody').innerHTML = linhas.join('');
}

async function carregarEstatisticas() {
  var clientes;
  try {
    clientes = await buscarTodosClientes();
  } catch (e) {
    showToast('Erro ao carregar indicadores: ' + e.message, 'error');
    return;
  }

  // Clientes da Oficina (ativos) não são leads: ficam fora dos indicadores.
  clientes = clientes.filter(function (c) { return !(c.eh_cliente && c.situacao === 'ativo'); });

  var ativos = clientes.filter(function (c) { return c.situacao === 'ativo'; }).length;
  var ganhos = clientes.filter(function (c) { return c.situacao === 'ganho'; }).length;
  var perdidos = clientes.filter(function (c) { return c.situacao === 'perdido'; }).length;
  var encerrados = ganhos + perdidos;
  clientesEfetividade = clientes;
  desenharEfetividade();
  desenharUltimosFechamentos();

  document.getElementById('kpi-ativos').textContent = ativos;
  document.getElementById('kpi-ganhos').textContent = ganhos;
  document.getElementById('kpi-ganhos-sub').textContent = 'de ' + clientes.length + ' leads';
  document.getElementById('kpi-perdidos').textContent = perdidos;
  document.getElementById('kpi-perdidos-sub').textContent = encerrados ? Math.round(perdidos * 100 / encerrados) + '% dos encerrados' : '';
  document.getElementById('kpi-conversao').textContent = encerrados ? Math.round(ganhos * 100 / encerrados) + '%' : '—';

  if (typeof Chart === 'undefined') return;
  carregarCores();
  Chart.defaults.font.family = "'Inter', Arial, sans-serif";
  Chart.defaults.color = COR.muted;

  // 1) Situação — rosca
  desenharGrafico('chart-situacao', {
    type: 'doughnut',
    data: {
      labels: ['Ativos', 'Ganhos', 'Perdidos'],
      datasets: [{ data: [ativos, ganhos, perdidos], backgroundColor: [COR.ativo, COR.ganho, COR.perdido], borderWidth: 2, borderColor: '#fff' }]
    },
    options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom' } } }
  });

  // 2) Canal de aquisição — barras empilhadas por situação
  var porCanal = {};
  clientes.forEach(function (c) {
    var canal = c.canal_aquisicao || 'Sem canal';
    if (!porCanal[canal]) porCanal[canal] = { ativo: 0, ganho: 0, perdido: 0, total: 0 };
    porCanal[canal][c.situacao] += 1;
    porCanal[canal].total += 1;
  });
  var canais = Object.keys(porCanal).sort(function (a, b) { return porCanal[b].total - porCanal[a].total; });
  desenharGrafico('chart-canal', {
    type: 'bar',
    data: {
      labels: canais,
      datasets: [
        { label: 'Ganhos', data: canais.map(function (c) { return porCanal[c].ganho; }), backgroundColor: COR.ganho },
        { label: 'Ativos', data: canais.map(function (c) { return porCanal[c].ativo; }), backgroundColor: COR.ativo },
        { label: 'Perdidos', data: canais.map(function (c) { return porCanal[c].perdido; }), backgroundColor: COR.perdido }
      ]
    },
    options: {
      indexAxis: 'y', maintainAspectRatio: false,
      scales: { x: { stacked: true, grid: { color: '#eef1f6' } }, y: { stacked: true, grid: { display: false } } },
      plugins: { legend: { position: 'bottom' } }
    }
  });

  // 3) Leads por mês (últimos 12 meses)
  var meses = [];
  var agora = new Date();
  for (var i = 11; i >= 0; i--) {
    var d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    meses.push({ chave: d.getFullYear() + '-' + (d.getMonth() + 1), label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '') });
  }
  var chaveMes = function (c) { var dt = new Date(c.created_at); return dt.getFullYear() + '-' + (dt.getMonth() + 1); };
  var novosPorMes = contar(clientes, chaveMes);
  var ganhosPorMes = contar(clientes.filter(function (c) { return c.situacao === 'ganho'; }), chaveMes);
  desenharGrafico('chart-mes', {
    data: {
      labels: meses.map(function (m) { return m.label; }),
      datasets: [
        { type: 'bar', label: 'Novos leads', data: meses.map(function (m) { return novosPorMes[m.chave] || 0; }), backgroundColor: COR.ativo, borderRadius: 4 },
        { type: 'line', label: 'Ganhos', data: meses.map(function (m) { return ganhosPorMes[m.chave] || 0; }), borderColor: COR.ganho, backgroundColor: COR.ganho, tension: 0.3, pointRadius: 3 }
      ]
    },
    options: {
      maintainAspectRatio: false,
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#eef1f6' }, ticks: { precision: 0 } } },
      plugins: { legend: { position: 'bottom' } }
    }
  });

  // 4) Funil — barras empilhadas por situação
  var funis = ['venda', 'manutencao', 'pos_venda', ''];
  var porFunil = {};
  funis.forEach(function (f) { porFunil[f] = { ativo: 0, ganho: 0, perdido: 0 }; });
  clientes.forEach(function (c) { porFunil[c.categoria || ''][c.situacao] += 1; });
  desenharGrafico('chart-funil', {
    type: 'bar',
    data: {
      labels: funis.map(function (f) { return CATEGORIA_LABELS_DASH[f]; }),
      datasets: [
        { label: 'Ganhos', data: funis.map(function (f) { return porFunil[f].ganho; }), backgroundColor: COR.ganho },
        { label: 'Ativos', data: funis.map(function (f) { return porFunil[f].ativo; }), backgroundColor: COR.ativo },
        { label: 'Perdidos', data: funis.map(function (f) { return porFunil[f].perdido; }), backgroundColor: COR.perdido }
      ]
    },
    options: {
      maintainAspectRatio: false,
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: '#eef1f6' }, ticks: { precision: 0 } } },
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

function atualizarKpisOperacao() {
  var tratados = 0, pendentes = 0;
  Object.keys(totaisQuadrante).forEach(function (k) {
    tratados += totaisQuadrante[k].tratados;
    pendentes += totaisQuadrante[k].pendentes;
  });
  document.getElementById('kpi-tratados').textContent = tratados;
  document.getElementById('kpi-pendentes').textContent = pendentes;
}

/* ===================== OPERAÇÃO DO DIA (3 quadrantes) ===================== */

async function carregarQuadrante(quadrante) {
  var { data: clientes, error } = await supabaseClient
    .from('clientes')
    .select('id, razao_social, telefone_empresa, email_empresa, created_at, categoria, situacao, canal_aquisicao, cliente_historico(created_at, resultado, status)')
    .eq('categoria', quadrante.categoria)
    .in('situacao', quadrante.categoria === 'manutencao' ? ['ativo', 'ganho'] : ['ativo'])
    .order('created_at', { referencedTable: 'cliente_historico', ascending: true });

  if (error) {
    showToast('Erro ao carregar ' + quadrante.label + ': ' + error.message, 'error');
    return;
  }
  clientes = (clientes || []).filter(function (c) {
    // Ganho de Manutenção só aparece quando há revisão preventiva a fazer.
    if (c.situacao !== 'ganho') return true;
    return revisitaEmAviso(calcularProximoRetorno(c, c.cliente_historico || []));
  });

  document.getElementById('quad-count-' + quadrante.categoria).textContent = clientes.length;

  var historicoPorCliente = {};
  var historico = [];
  clientes.forEach(function (c) {
    historicoPorCliente[c.id] = c.cliente_historico || [];
    historicoPorCliente[c.id].forEach(function (h) {
      historico.push({ cliente_id: c.id, created_at: h.created_at, resultado: h.resultado, status: h.status });
    });
  });

  // --- Tratado hoje: contatos registrados no dia, mais recentes primeiro ---
  var hoje = inicioDeHoje();
  var clientesPorId = {};
  clientes.forEach(function (c) { clientesPorId[c.id] = c; });

  var tratadoHoje = historico
    .filter(function (h) { return new Date(h.created_at) >= hoje; })
    .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });

  var tratadoEl = document.getElementById('quad-tratado-' + quadrante.categoria);
  if (!tratadoHoje.length) {
    tratadoEl.innerHTML = '<p class="dash-empty">Nenhum contato registrado hoje ainda.</p>';
  } else {
    tratadoEl.innerHTML = tratadoHoje.map(function (h) {
      var cliente = clientesPorId[h.cliente_id];
      var horaStr = new Date(h.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      var badge = h.status
        ? '<span class="badge ' + STATUS_HISTORICO_BADGE[h.status] + '">' + STATUS_HISTORICO_LABELS[h.status] + '</span>'
        : '<span class="badge ' + (h.resultado === 'positivo' ? 'badge-ok' : (h.resultado === 'negativo' ? 'badge-danger' : 'badge-warning')) + '">' + labelResultado(quadrante.categoria, h.resultado) + '</span>';
      return '<div class="dash-row dash-row-trat dash-row-verde">' +
        '<span class="dash-row-nome">' + (cliente ? linkCliente(cliente) : '—') + '</span>' +
        badge + '<span class="dash-row-meta">' + horaStr + '</span></div>';
    }).join('');
  }
  document.getElementById('quad-count-tratado-' + quadrante.categoria).textContent = tratadoHoje.length;
  ligarLinksCliente(tratadoEl);

  // --- Pendente: o que ainda precisa de retorno, mais urgente primeiro ---
  var comPrazo = clientes.map(function (c) {
    return { cliente: c, retorno: calcularProximoRetorno(c, historicoPorCliente[c.id] || []) };
  }).filter(function (item) { return !item.retorno.concluido; });

  comPrazo.sort(function (a, b) {
    if (a.retorno.prioridadeMaxima !== b.retorno.prioridadeMaxima) return a.retorno.prioridadeMaxima ? -1 : 1;
    if (!a.retorno.data && !b.retorno.data) return 0;
    if (!a.retorno.data) return 1;
    if (!b.retorno.data) return -1;
    return a.retorno.data - b.retorno.data;
  });

  var agora = Date.now();
  var vencidos = comPrazo.filter(function (i) {
    return i.retorno.prioridadeMaxima || (i.retorno.data && i.retorno.data.getTime() <= agora);
  }).length;
  document.getElementById('quad-count-pendente-' + quadrante.categoria).textContent = vencidos;
  totaisQuadrante[quadrante.categoria] = { tratados: tratadoHoje.length, pendentes: vencidos };
  atualizarKpisOperacao();

  var listaEl = document.getElementById('quad-lista-' + quadrante.categoria);
  if (!comPrazo.length) {
    listaEl.innerHTML = '<p class="dash-empty">Tudo em dia por aqui.</p>';
    return;
  }
  listaEl.innerHTML = comPrazo.map(function (item) {
    var prazo = formatarPrazo(item.retorno);
    var c = item.cliente;
    var meta = [c.telefone_empresa, c.canal_aquisicao].filter(Boolean).join(' · ');
    return '<div class="dash-row dash-row-pend dash-row-' + classificarUrgencia(item.retorno) + '">' +
      '<span class="dash-row-nome">' + linkCliente(c) + '</span>' +
      '<span class="dash-row-meta" title="' + escHtml(meta) + '">' + escHtml(meta) + '</span>' +
      '<span class="badge ' + (prazo.classe || '') + '">' + prazo.texto + '</span></div>';
  }).join('');
  ligarLinksCliente(listaEl);
}

function configurarFormNovoCliente(role) {
  var permitidos = {
    admin: ['venda', 'manutencao', 'pos_venda'],
    atendente: ['venda', 'pos_venda'],
    tecnico: ['manutencao']
  }[role] || [];
  var funilSel = document.getElementById('novo-funil');
  funilSel.innerHTML = '<option value="">Funil *</option>' + QUADRANTES.filter(function (q) {
    return permitidos.indexOf(q.categoria) !== -1;
  }).map(function (q) { return '<option value="' + q.categoria + '">' + q.label + '</option>'; }).join('');
  document.getElementById('novo-canal').innerHTML =
    '<option value="">Canal de aquisição</option>' + opcoesCanalHtml('').replace('<option value="">—</option>', '');

  var form = document.getElementById('novo-form');
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var errorEl = document.getElementById('novo-error');
    errorEl.style.display = 'none';

    var funil = funilSel.value;
    var nome = document.getElementById('novo-nome').value.trim();
    var telefone = document.getElementById('novo-telefone').value.trim();
    var email = document.getElementById('novo-email').value.trim();

    var msg = null;
    if (!funil) msg = 'Escolha o funil.';
    else if (!nome) msg = 'Nome é obrigatório.';
    else if (!telefone && !email) msg = 'Telefone ou e-mail obrigatório.';
    if (msg) { errorEl.textContent = msg; errorEl.style.display = 'block'; return; }

    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    var { error } = await supabaseClient.from('clientes').insert({
      razao_social: nome, telefone_empresa: telefone || null, email_empresa: email || null,
      canal_aquisicao: document.getElementById('novo-canal').value || null,
      categoria: funil, created_by: currentUserId
    });
    btn.disabled = false;

    if (error) {
      errorEl.textContent = 'Erro ao salvar: ' + error.message;
      errorEl.style.display = 'block';
      return;
    }
    form.reset();
    showToast('Cliente adicionado em ' + CATEGORIA_LABELS_DASH[funil] + '.', 'ok');
    recarregarTudo();
  });
}

var quadrantesVisiveis = [];

function recarregarTudo() {
  carregarEstatisticas();
  quadrantesVisiveis.forEach(carregarQuadrante);
}

(async function () {
  var auth = await window.ADMIN_AUTH_READY;
  if (!auth) return;
  currentUserId = auth.session.user.id;

  quadrantesVisiveis = QUADRANTES.filter(function (q) {
    return !!document.getElementById('quad-' + q.categoria);
  });
  configurarFormNovoCliente(auth.profile.role);
  recarregarTudo();
})();
