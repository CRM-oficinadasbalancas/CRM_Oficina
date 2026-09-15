var currentUserId = null;
var allPecas = [];
var linhasImportacaoValidas = [];

var CODIGO_PECA_REGEX = /^[A-Za-z0-9]{1,15}$/;
var QUANTIDADE_REGEX = /^\d{1,5}(\.\d{1,2})?$/;

var COLUNAS_PECA = [
  { titulo: 'Código', chave: 'codigo' },
  { titulo: 'Tipo/Modelo', chave: 'tipo_modelo' },
  { titulo: 'Quantidade', chave: 'quantidade' },
  { titulo: 'Localidade', chave: 'localidade' }
];

function resetForm() {
  document.getElementById('peca-form').reset();
  document.getElementById('peca-id').value = '';
  document.getElementById('form-title').textContent = 'Nova peça';
  document.getElementById('peca-error').style.display = 'none';
  document.getElementById('peca-save-btn').textContent = 'Cadastrar peça';
  atualizarContadorTipoModelo();
}

function atualizarContadorTipoModelo() {
  document.getElementById('tipo-modelo-contador').textContent = document.getElementById('tipo_modelo').value.length;
}
document.getElementById('tipo_modelo').addEventListener('input', atualizarContadorTipoModelo);

/* ===================== LISTAGEM ===================== */

async function loadPecas() {
  var { data, error } = await supabaseClient.from('estoque_pecas').select('*').order('codigo');
  if (error) { showToast('Erro ao carregar peças: ' + error.message, 'error'); return; }
  allPecas = data || [];
  renderPecasTable(allPecas);
}

function formatarQuantidade(q) {
  var n = parseFloat(q);
  if (isNaN(n)) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function renderPecasTable(list) {
  var tbody = document.getElementById('pecas-tbody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="5">Nenhuma peça cadastrada ainda.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(function (p) {
    var badgeZerado = parseFloat(p.quantidade) <= 0 ? ' <span class="badge badge-warning">Sem estoque</span>' : '';
    return '<tr>' +
      '<td>' + p.codigo + '</td>' +
      '<td>' + (p.tipo_modelo || '').slice(0, 120) + ((p.tipo_modelo || '').length > 120 ? '…' : '') + '</td>' +
      '<td>' + formatarQuantidade(p.quantidade) + badgeZerado + '</td>' +
      '<td>' + (p.localidade || '—') + '</td>' +
      '<td class="row-actions">' +
        '<button data-edit="' + p.id + '">Editar</button>' +
        '<button data-delete="' + p.id + '" class="danger">Excluir</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  tbody.querySelectorAll('[data-edit]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var peca = allPecas.find(function (p) { return p.id === btn.dataset.edit; });
      if (!peca) return;
      document.getElementById('peca-id').value = peca.id;
      document.getElementById('codigo').value = peca.codigo || '';
      document.getElementById('tipo_modelo').value = peca.tipo_modelo || '';
      document.getElementById('quantidade').value = formatarQuantidade(peca.quantidade);
      document.getElementById('localidade').value = peca.localidade || '';
      atualizarContadorTipoModelo();
      document.getElementById('form-title').textContent = 'Editar peça — ' + peca.codigo;
      document.getElementById('peca-save-btn').textContent = 'Salvar alterações';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  tbody.querySelectorAll('[data-delete]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      if (!confirm('Excluir esta peça do estoque? Essa ação não pode ser desfeita.')) return;
      var { error } = await supabaseClient.from('estoque_pecas').delete().eq('id', btn.dataset.delete);
      if (error) {
        showToast('Erro ao excluir: ' + error.message, 'error');
        return;
      }
      showToast('Peça excluída.', 'ok');
      loadPecas();
    });
  });
}

document.getElementById('peca-search').addEventListener('input', function (e) {
  var term = e.target.value.toLowerCase();
  var filtered = allPecas.filter(function (p) {
    return (p.codigo || '').toLowerCase().includes(term) ||
      (p.tipo_modelo || '').toLowerCase().includes(term) ||
      (p.localidade || '').toLowerCase().includes(term);
  });
  renderPecasTable(filtered);
});

/* ===================== VALIDAÇÃO / SALVAR ===================== */

function validarQuantidadeStr(valor, errorEl) {
  valor = (valor || '').trim();
  if (!QUANTIDADE_REGEX.test(valor)) {
    errorEl.textContent = 'Quantidade inválida. Use até 5 caracteres, números e ponto como separador decimal (ex: 25 ou 12.5).';
    errorEl.style.display = 'block';
    return null;
  }
  return parseFloat(valor);
}

document.getElementById('peca-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var errorEl = document.getElementById('peca-error');
  var saveBtn = document.getElementById('peca-save-btn');
  errorEl.style.display = 'none';

  var codigo = document.getElementById('codigo').value.trim();
  if (!CODIGO_PECA_REGEX.test(codigo)) {
    errorEl.textContent = 'Código deve conter apenas letras e números (sem espaços ou símbolos), até 15 caracteres.';
    errorEl.style.display = 'block';
    return;
  }

  var tipoModelo = document.getElementById('tipo_modelo').value.trim();
  if (!tipoModelo) {
    errorEl.textContent = 'Tipo/Modelo é obrigatório.';
    errorEl.style.display = 'block';
    return;
  }
  if (tipoModelo.length > 1000) {
    errorEl.textContent = 'Tipo/Modelo excede o limite de 1000 caracteres.';
    errorEl.style.display = 'block';
    return;
  }

  var quantidade = validarQuantidadeStr(document.getElementById('quantidade').value, errorEl);
  if (quantidade === null) return;

  var pecaId = document.getElementById('peca-id').value;
  var duplicado = allPecas.find(function (p) {
    return p.id !== pecaId && p.codigo.toLowerCase() === codigo.toLowerCase();
  });
  if (duplicado) {
    errorEl.textContent = 'Já existe uma peça cadastrada com esse código.';
    errorEl.style.display = 'block';
    return;
  }

  var payload = {
    codigo: codigo,
    tipo_modelo: tipoModelo,
    quantidade: quantidade,
    localidade: document.getElementById('localidade').value.trim() || null
  };

  saveBtn.disabled = true;
  saveBtn.textContent = 'Salvando...';
  var result;

  if (pecaId) {
    result = await supabaseClient.from('estoque_pecas').update(payload).eq('id', pecaId);
  } else {
    payload.created_by = currentUserId;
    result = await supabaseClient.from('estoque_pecas').insert(payload);
  }

  saveBtn.disabled = false;
  saveBtn.textContent = pecaId ? 'Salvar alterações' : 'Cadastrar peça';

  if (result.error) {
    errorEl.textContent = 'Erro ao salvar: ' + result.error.message;
    errorEl.style.display = 'block';
    return;
  }

  showToast('Peça salva com sucesso.', 'ok');
  resetForm();
  loadPecas();
});

document.getElementById('peca-cancel-btn').addEventListener('click', resetForm);

/* ===================== EXPORTAR LISTA / RELATÓRIO ===================== */

document.getElementById('btn-exportar-lista').addEventListener('click', function () {
  if (!allPecas.length) { showToast('Não há peças cadastradas para exportar.', 'warning'); return; }
  var lista = allPecas.slice().sort(function (a, b) { return a.codigo.localeCompare(b.codigo); });
  exportarExcel('estoque-lista-' + dataParaNomeArquivo() + '.xlsx', lista, [
    { titulo: 'Código', chave: 'codigo' },
    { titulo: 'Tipo/Modelo', chave: 'tipo_modelo' },
    { titulo: 'Quantidade', valor: function (p) { return formatarQuantidade(p.quantidade); } },
    { titulo: 'Localidade', chave: 'localidade' }
  ], 'Estoque');
  showToast('Lista exportada.', 'ok');
});

document.getElementById('btn-relatorio').addEventListener('click', function () {
  if (!allPecas.length) { showToast('Não há peças cadastradas para gerar relatório.', 'warning'); return; }
  // Ordenado do menor pro maior estoque, pra destacar o que precisa de reposição primeiro.
  var lista = allPecas.slice().sort(function (a, b) { return parseFloat(a.quantidade) - parseFloat(b.quantidade); });
  exportarExcel('relatorio-estoque-' + dataParaNomeArquivo() + '.xlsx', lista, [
    { titulo: 'Código', chave: 'codigo' },
    { titulo: 'Tipo/Modelo', chave: 'tipo_modelo' },
    { titulo: 'Quantidade Atual', valor: function (p) { return formatarQuantidade(p.quantidade); } },
    { titulo: 'Localidade', chave: 'localidade' },
    { titulo: 'Gerado em', valor: function () { return new Date().toLocaleString('pt-BR'); } }
  ], 'Relatorio');
  showToast('Relatório de estoque gerado — itens com menor quantidade aparecem primeiro para facilitar a compra.', 'ok');
});

/* ===================== IMPORTAR PLANILHA ===================== */

document.getElementById('btn-baixar-modelo').addEventListener('click', function () {
  baixarModeloExcel('modelo-importacao-pecas.xlsx', COLUNAS_PECA, [
    { codigo: 'PC001', tipo_modelo: 'Célula de carga 50kg', quantidade: '10', localidade: 'Prateleira A1' }
  ]);
});

function abrirModalImportar() {
  document.getElementById('importar-arquivo').value = '';
  document.getElementById('importar-preview').style.display = 'none';
  document.getElementById('importar-preview').innerHTML = '';
  document.getElementById('importar-error').style.display = 'none';
  document.getElementById('importar-btn-confirmar').disabled = true;
  linhasImportacaoValidas = [];
  document.getElementById('modal-importar').classList.add('open');
}

document.getElementById('btn-abrir-importar').addEventListener('click', abrirModalImportar);
document.getElementById('importar-btn-cancelar').addEventListener('click', function () {
  document.getElementById('modal-importar').classList.remove('open');
});

document.getElementById('importar-arquivo').addEventListener('change', async function (e) {
  var file = e.target.files[0];
  var previewEl = document.getElementById('importar-preview');
  var errorEl = document.getElementById('importar-error');
  var confirmarBtn = document.getElementById('importar-btn-confirmar');
  errorEl.style.display = 'none';
  confirmarBtn.disabled = true;
  linhasImportacaoValidas = [];
  if (!file) return;

  var linhasBrutas;
  try {
    linhasBrutas = await lerArquivoExcel(file);
  } catch (err) {
    errorEl.textContent = 'Erro ao ler o arquivo: ' + err.message;
    errorEl.style.display = 'block';
    return;
  }

  var linhas = linhasBrutas
    .map(function (linha) { return normalizarLinhaExcel(linha, COLUNAS_PECA); })
    .filter(function (linha) { return linha.codigo || linha.tipo_modelo || linha.quantidade || linha.localidade; });

  if (!linhas.length) {
    errorEl.textContent = 'Nenhuma linha com dados encontrada no arquivo.';
    errorEl.style.display = 'block';
    return;
  }

  var linhasProcessadas = linhas.map(function (linha) {
    var erros = [];
    if (!CODIGO_PECA_REGEX.test(linha.codigo)) erros.push('código inválido');
    if (!linha.tipo_modelo || linha.tipo_modelo.length > 1000) erros.push('tipo/modelo inválido');
    var quantidadeNum = null;
    if (!QUANTIDADE_REGEX.test(linha.quantidade)) {
      erros.push('quantidade inválida');
    } else {
      quantidadeNum = parseFloat(linha.quantidade);
    }
    return {
      codigo: linha.codigo, tipo_modelo: linha.tipo_modelo, quantidade: quantidadeNum,
      localidade: linha.localidade || null, erros: erros
    };
  });

  linhasImportacaoValidas = linhasProcessadas.filter(function (l) { return !l.erros.length; });

  previewEl.style.display = 'block';
  previewEl.innerHTML = '<table class="admin-table"><thead><tr><th>Código</th><th>Tipo/Modelo</th><th>Quantidade</th><th>Localidade</th><th>Status</th></tr></thead><tbody>' +
    linhasProcessadas.map(function (l) {
      var status = l.erros.length ? '<span class="badge badge-warning">' + l.erros.join(', ') + '</span>' : '<span class="badge badge-ok">OK</span>';
      return '<tr><td>' + (l.codigo || '—') + '</td><td>' + (l.tipo_modelo || '—').slice(0, 60) + '</td><td>' + (l.quantidade != null ? l.quantidade : '—') + '</td><td>' + (l.localidade || '—') + '</td><td>' + status + '</td></tr>';
    }).join('') +
  '</tbody></table>';

  confirmarBtn.disabled = !linhasImportacaoValidas.length;
  if (!linhasImportacaoValidas.length) {
    errorEl.textContent = 'Nenhuma linha válida para importar. Corrija o arquivo e tente novamente.';
    errorEl.style.display = 'block';
  }
});

document.getElementById('importar-btn-confirmar').addEventListener('click', async function () {
  var btn = this;
  var errorEl = document.getElementById('importar-error');
  errorEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Importando...';

  var importadas = 0, atualizadas = 0, comErro = 0;

  for (var i = 0; i < linhasImportacaoValidas.length; i++) {
    var linha = linhasImportacaoValidas[i];
    var existente = allPecas.find(function (p) { return p.codigo.toLowerCase() === linha.codigo.toLowerCase(); });

    var payload = {
      codigo: linha.codigo, tipo_modelo: linha.tipo_modelo,
      quantidade: linha.quantidade, localidade: linha.localidade
    };

    var result;
    if (existente) {
      result = await supabaseClient.from('estoque_pecas').update(payload).eq('id', existente.id);
      if (!result.error) atualizadas++; else comErro++;
    } else {
      payload.created_by = currentUserId;
      result = await supabaseClient.from('estoque_pecas').insert(payload);
      if (!result.error) importadas++; else comErro++;
    }
  }

  btn.disabled = false;
  btn.textContent = 'Importar linhas';

  document.getElementById('modal-importar').classList.remove('open');
  showToast('Importação concluída: ' + importadas + ' nova(s), ' + atualizadas + ' atualizada(s)' + (comErro ? ', ' + comErro + ' com erro' : '') + '.', comErro ? 'warning' : 'ok');
  loadPecas();
});

/* ===================== INIT ===================== */

(async function () {
  var auth = await window.ADMIN_AUTH_READY;
  if (!auth) return;
  currentUserId = auth.session.user.id;
  await loadPecas();
  atualizarContadorTipoModelo();
})();
