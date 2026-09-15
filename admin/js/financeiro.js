var currentUserId = null;

function formatBRLFin(n) {
  return 'R$ ' + (parseFloat(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDataFin(d) {
  var partes = String(d).split('-'); // yyyy-mm-dd -> dd/mm/yyyy, sem problema de fuso horário
  return partes.length === 3 ? partes[2] + '/' + partes[1] + '/' + partes[0] : d;
}

/* ===================== ENTRADAS ===================== */

async function loadEntradasRecentes() {
  var { data, error } = await supabaseClient.from('financeiro_entradas').select('*').order('data', { ascending: false }).limit(50);
  var tbody = document.getElementById('entradas-tbody');
  if (error) { tbody.innerHTML = '<tr><td colspan="5">Erro: ' + error.message + '</td></tr>'; return; }
  if (!data || !data.length) { tbody.innerHTML = '<tr><td colspan="5">Nenhuma entrada cadastrada ainda.</td></tr>'; return; }

  tbody.innerHTML = data.map(function (e) {
    return '<tr>' +
      '<td>' + formatDataFin(e.data) + '</td>' +
      '<td>' + (e.cliente_nome || '—') + '</td>' +
      '<td>' + (e.produto || '—') + '</td>' +
      '<td>' + formatBRLFin(e.valor) + '</td>' +
      '<td class="row-actions"><button data-del-entrada="' + e.id + '" class="danger">Excluir</button></td>' +
    '</tr>';
  }).join('');

  tbody.querySelectorAll('[data-del-entrada]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      if (!confirm('Excluir esta entrada?')) return;
      await supabaseClient.from('financeiro_entradas').delete().eq('id', btn.dataset.delEntrada);
      loadEntradasRecentes();
      gerarRelatorio();
    });
  });
}

document.getElementById('entrada-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var errorEl = document.getElementById('entrada-error');
  errorEl.style.display = 'none';

  var payload = {
    data: document.getElementById('entrada-data').value,
    cliente_nome: document.getElementById('entrada-cliente').value || null,
    produto: document.getElementById('entrada-produto').value || null,
    valor: parseFloat(document.getElementById('entrada-valor').value) || 0,
    observacao: document.getElementById('entrada-observacao').value || null,
    created_by: currentUserId
  };

  if (!payload.data || payload.valor <= 0) {
    errorEl.textContent = 'Preencha a data e um valor maior que zero.';
    errorEl.style.display = 'block';
    return;
  }

  var { error } = await supabaseClient.from('financeiro_entradas').insert(payload);
  if (error) {
    errorEl.textContent = 'Erro ao salvar: ' + error.message;
    errorEl.style.display = 'block';
    return;
  }

  showToast('Entrada registrada.', 'ok');
  this.reset();
  document.getElementById('entrada-data').value = new Date().toISOString().slice(0, 10);
  loadEntradasRecentes();
  gerarRelatorio();
});

/* ===================== SAÍDAS ===================== */

async function loadSaidasRecentes() {
  var { data, error } = await supabaseClient.from('financeiro_saidas').select('*').order('data', { ascending: false }).limit(50);
  var tbody = document.getElementById('saidas-tbody');
  if (error) { tbody.innerHTML = '<tr><td colspan="5">Erro: ' + error.message + '</td></tr>'; return; }
  if (!data || !data.length) { tbody.innerHTML = '<tr><td colspan="5">Nenhuma saída cadastrada ainda.</td></tr>'; return; }

  tbody.innerHTML = data.map(function (s) {
    return '<tr>' +
      '<td>' + formatDataFin(s.data) + '</td>' +
      '<td>' + s.descricao + '</td>' +
      '<td>' + (s.categoria || '—') + '</td>' +
      '<td>' + formatBRLFin(s.valor) + '</td>' +
      '<td class="row-actions"><button data-del-saida="' + s.id + '" class="danger">Excluir</button></td>' +
    '</tr>';
  }).join('');

  tbody.querySelectorAll('[data-del-saida]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      if (!confirm('Excluir esta saída?')) return;
      await supabaseClient.from('financeiro_saidas').delete().eq('id', btn.dataset.delSaida);
      loadSaidasRecentes();
      gerarRelatorio();
    });
  });
}

document.getElementById('saida-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var errorEl = document.getElementById('saida-error');
  errorEl.style.display = 'none';

  var payload = {
    data: document.getElementById('saida-data').value,
    descricao: document.getElementById('saida-descricao').value.trim(),
    categoria: document.getElementById('saida-categoria').value || null,
    valor: parseFloat(document.getElementById('saida-valor').value) || 0,
    observacao: document.getElementById('saida-observacao').value || null,
    created_by: currentUserId
  };

  if (!payload.data || !payload.descricao || payload.valor <= 0) {
    errorEl.textContent = 'Preencha data, descrição e um valor maior que zero.';
    errorEl.style.display = 'block';
    return;
  }

  var { error } = await supabaseClient.from('financeiro_saidas').insert(payload);
  if (error) {
    errorEl.textContent = 'Erro ao salvar: ' + error.message;
    errorEl.style.display = 'block';
    return;
  }

  showToast('Saída registrada.', 'ok');
  this.reset();
  document.getElementById('saida-data').value = new Date().toISOString().slice(0, 10);
  loadSaidasRecentes();
  gerarRelatorio();
});

/* ===================== RELATÓRIO (mensal/anual) ===================== */

function calcularPeriodo() {
  var tipo = document.getElementById('relatorio-tipo').value;
  var inicio, fim;

  if (tipo === 'mensal') {
    var mesValor = document.getElementById('relatorio-mes').value; // yyyy-mm
    var partes = mesValor.split('-');
    var ano = parseInt(partes[0], 10), mes = parseInt(partes[1], 10);
    inicio = ano + '-' + String(mes).padStart(2, '0') + '-01';
    var proximoMes = mes === 12 ? 1 : mes + 1;
    var anoProximo = mes === 12 ? ano + 1 : ano;
    fim = anoProximo + '-' + String(proximoMes).padStart(2, '0') + '-01';
  } else {
    var ano2 = parseInt(document.getElementById('relatorio-ano').value, 10);
    inicio = ano2 + '-01-01';
    fim = (ano2 + 1) + '-01-01';
  }

  return { inicio: inicio, fim: fim };
}

var MESES_NOMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

var ultimasEntradas = [];
var ultimasSaidas = [];

function popularSelectAnos() {
  var select = document.getElementById('relatorio-ano');
  var html = '';
  for (var ano = 2026; ano <= 2036; ano++) {
    html += '<option value="' + ano + '">' + ano + '</option>';
  }
  select.innerHTML = html;
}

function descreverPeriodo() {
  var tipo = document.getElementById('relatorio-tipo').value;
  if (tipo === 'mensal') {
    var mesValor = document.getElementById('relatorio-mes').value;
    var partes = mesValor.split('-');
    var mesNome = MESES_NOMES[parseInt(partes[1], 10) - 1] || '';
    return 'Relatório Financeiro — ' + mesNome + '/' + partes[0];
  }
  return 'Relatório Financeiro — Ano ' + document.getElementById('relatorio-ano').value;
}

async function gerarRelatorio() {
  var periodo = calcularPeriodo();

  var [entradasRes, saidasRes] = await Promise.all([
    supabaseClient.from('financeiro_entradas').select('*').gte('data', periodo.inicio).lt('data', periodo.fim).order('data'),
    supabaseClient.from('financeiro_saidas').select('*').gte('data', periodo.inicio).lt('data', periodo.fim).order('data')
  ]);

  var entradas = entradasRes.data || [];
  var saidas = saidasRes.data || [];
  ultimasEntradas = entradas;
  ultimasSaidas = saidas;

  document.getElementById('relatorio-periodo-label').textContent = descreverPeriodo();

  var totalEntradas = entradas.reduce(function (acc, e) { return acc + parseFloat(e.valor); }, 0);
  var totalSaidas = saidas.reduce(function (acc, s) { return acc + parseFloat(s.valor); }, 0);
  var saldo = totalEntradas - totalSaidas;

  document.getElementById('relatorio-entradas').textContent = formatBRLFin(totalEntradas);
  document.getElementById('relatorio-saidas').textContent = formatBRLFin(totalSaidas);
  var saldoEl = document.getElementById('relatorio-saldo');
  saldoEl.textContent = formatBRLFin(saldo);
  saldoEl.style.color = saldo >= 0 ? '#0f7a3d' : '#a92323';

  var entradasTbody = document.getElementById('relatorio-entradas-tbody');
  entradasTbody.innerHTML = entradas.length
    ? entradas.map(function (e) {
        return '<tr><td>' + formatDataFin(e.data) + '</td><td>' + (e.cliente_nome || '—') + '</td><td>' + (e.produto || '—') + '</td><td>' + formatBRLFin(e.valor) + '</td></tr>';
      }).join('')
    : '<tr><td colspan="4">Nenhuma entrada nesse período.</td></tr>';

  var saidasTbody = document.getElementById('relatorio-saidas-tbody');
  saidasTbody.innerHTML = saidas.length
    ? saidas.map(function (s) {
        return '<tr><td>' + formatDataFin(s.data) + '</td><td>' + s.descricao + '</td><td>' + (s.categoria || '—') + '</td><td>' + formatBRLFin(s.valor) + '</td></tr>';
      }).join('')
    : '<tr><td colspan="4">Nenhuma saída nesse período.</td></tr>';
}

document.getElementById('relatorio-tipo').addEventListener('change', function (e) {
  var mensal = e.target.value === 'mensal';
  document.getElementById('relatorio-mes-field').style.display = mensal ? 'flex' : 'none';
  document.getElementById('relatorio-ano-field').style.display = mensal ? 'none' : 'flex';
  gerarRelatorio();
});
document.getElementById('relatorio-mes').addEventListener('change', gerarRelatorio);
document.getElementById('relatorio-ano').addEventListener('change', gerarRelatorio);

/* ===================== EXPORTAR / IMPRIMIR ===================== */

function csvEscapar(valor) {
  var texto = String(valor == null ? '' : valor);
  return '"' + texto.replace(/"/g, '""') + '"';
}

document.getElementById('btn-exportar-csv').addEventListener('click', function () {
  var linhas = [['Tipo', 'Data', 'Cliente/Descrição', 'Produto/Categoria', 'Valor'].map(csvEscapar).join(';')];

  ultimasEntradas.forEach(function (e) {
    linhas.push(['Entrada', formatDataFin(e.data), e.cliente_nome || '', e.produto || '', e.valor].map(csvEscapar).join(';'));
  });
  ultimasSaidas.forEach(function (s) {
    linhas.push(['Saída', formatDataFin(s.data), s.descricao || '', s.categoria || '', s.valor].map(csvEscapar).join(';'));
  });

  var csvContent = '﻿' + linhas.join('\r\n');
  var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'financeiro_' + document.getElementById('relatorio-periodo-label').textContent.replace(/[^a-zA-Z0-9]+/g, '_') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById('btn-imprimir-relatorio').addEventListener('click', function () {
  window.print();
});

/* ===================== INIT ===================== */

(async function () {
  var auth = await window.ADMIN_AUTH_READY;
  if (!auth) return;
  currentUserId = auth.session.user.id;

  var hoje = new Date();
  var hojeIso = hoje.toISOString().slice(0, 10);
  document.getElementById('entrada-data').value = hojeIso;
  document.getElementById('saida-data').value = hojeIso;
  document.getElementById('relatorio-mes').value = hojeIso.slice(0, 7);
  popularSelectAnos();
  document.getElementById('relatorio-ano').value = hoje.getFullYear();

  loadEntradasRecentes();
  loadSaidasRecentes();
  gerarRelatorio();
})();
