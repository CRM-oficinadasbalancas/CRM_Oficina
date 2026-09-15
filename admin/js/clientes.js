var currentUserId = null;
var allClientes = [];

var fieldIds = [
  'codigo', 'cnpj_cpf', 'razao_social', 'nome_fantasia', 'ie',
  'logradouro', 'numero', 'complemento', 'bairro', 'cep', 'municipio', 'uf',
  'telefone_empresa', 'email_empresa', 'contato_nome', 'contato_telefone', 'contato_email',
  'forma_pagamento_padrao', 'local_entrega_preferencial', 'observacoes'
];

function getFormValues() {
  var values = {};
  fieldIds.forEach(function (id) {
    values[id] = document.getElementById(id).value.trim() || null;
  });
  return values;
}

function setFormValues(cliente) {
  fieldIds.forEach(function (id) {
    document.getElementById(id).value = cliente && cliente[id] != null ? cliente[id] : '';
  });
}

function resetForm() {
  document.getElementById('cliente-form').reset();
  document.getElementById('cliente-id').value = '';
  document.getElementById('form-title').textContent = 'Novo cliente';
  document.getElementById('cliente-error').style.display = 'none';
  document.getElementById('cnpj-status').textContent = '';
}

function normalizarCnpj(v) {
  return (v || '').replace(/\D/g, '');
}

var clientesComOrcamentoPendente = {};
var cnpjDuplicadoMap = {};

async function loadClientes() {
  var { data, error } = await supabaseClient
    .from('clientes')
    .select('*')
    .order('razao_social', { ascending: true });

  if (error) {
    showToast('Erro ao carregar clientes: ' + error.message, 'error');
    return;
  }

  allClientes = data || [];

  var { data: pendentes } = await supabaseClient
    .from('pedidos')
    .select('cliente_id')
    .eq('tipo', 'orcamento')
    .eq('status_orcamento', 'pendente');

  clientesComOrcamentoPendente = {};
  (pendentes || []).forEach(function (p) {
    clientesComOrcamentoPendente[p.cliente_id] = (clientesComOrcamentoPendente[p.cliente_id] || 0) + 1;
  });

  cnpjDuplicadoMap = {};
  allClientes.forEach(function (c) {
    var cnpj = normalizarCnpj(c.cnpj_cpf);
    if (!cnpj) return;
    cnpjDuplicadoMap[cnpj] = (cnpjDuplicadoMap[cnpj] || 0) + 1;
  });

  renderClientesTable(allClientes);
}

/* Suporte a clientes.html?editar=ID — usado pelo atalho "Editar cliente" na Assistência Técnica */
function iniciarEdicaoClientePorId(clienteId) {
  var cliente = allClientes.find(function (c) { return c.id === clienteId; });
  if (!cliente) {
    showToast('Cliente não encontrado para edição.', 'error');
    return;
  }
  document.getElementById('cliente-id').value = cliente.id;
  setFormValues(cliente);
  document.getElementById('form-title').textContent = 'Editar cliente';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderClientesTable(list) {
  var tbody = document.getElementById('clientes-tbody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="5">Nenhum cliente cadastrado ainda.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(function (c) {
    var contato = [c.contato_nome, c.contato_telefone].filter(Boolean).join(' — ') || '—';
    var pendentes = clientesComOrcamentoPendente[c.id];
    var badgePendente = pendentes ? ' <span class="badge badge-warning">' + pendentes + ' orçamento' + (pendentes > 1 ? 's' : '') + ' pendente' + (pendentes > 1 ? 's' : '') + '</span>' : '';
    var cnpjNormalizado = normalizarCnpj(c.cnpj_cpf);
    var badgeDuplicado = (cnpjNormalizado && cnpjDuplicadoMap[cnpjNormalizado] > 1) ? ' <span class="badge badge-warning">CNPJ/CPF duplicado</span>' : '';
    return '<tr>' +
      '<td>' + (c.razao_social || '') + badgePendente + badgeDuplicado + '</td>' +
      '<td>' + (c.nome_fantasia || '—') + '</td>' +
      '<td>' + (c.cnpj_cpf || '—') + '</td>' +
      '<td>' + contato + '</td>' +
      '<td class="row-actions">' +
        '<button data-historico="' + c.id + '">Histórico</button>' +
        '<button data-historico-assistencia="' + c.id + '">Assist. Técnica</button>' +
        '<button data-edit="' + c.id + '">Editar</button>' +
        '<button data-delete="' + c.id + '" class="danger">Excluir</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  tbody.querySelectorAll('[data-historico]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var cliente = allClientes.find(function (c) { return c.id === btn.dataset.historico; });
      if (!cliente) return;
      document.getElementById('historico-cliente-nome').textContent = cliente.razao_social;
      document.getElementById('modal-historico').classList.add('open');
      loadHistoricoCliente(cliente.id, 'historico-conteudo');
    });
  });

  tbody.querySelectorAll('[data-historico-assistencia]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var cliente = allClientes.find(function (c) { return c.id === btn.dataset.historicoAssistencia; });
      if (!cliente) return;
      document.getElementById('historico-assistencia-cliente-nome').textContent = cliente.razao_social;
      document.getElementById('modal-historico-assistencia').classList.add('open');
      loadHistoricoAssistencias(cliente.id, 'historico-assistencia-conteudo');
    });
  });

  tbody.querySelectorAll('[data-edit]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var cliente = allClientes.find(function (c) { return c.id === btn.dataset.edit; });
      if (!cliente) return;
      document.getElementById('cliente-id').value = cliente.id;
      setFormValues(cliente);
      document.getElementById('form-title').textContent = 'Editar cliente';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  tbody.querySelectorAll('[data-delete]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      if (!confirm('Excluir este cliente? Essa ação não pode ser desfeita.')) return;
      var cliente = allClientes.find(function (c) { return c.id === btn.dataset.delete; });
      var { error } = await supabaseClient.from('clientes').delete().eq('id', btn.dataset.delete);
      if (error) {
        if (error.code === '23503') {
          abrirModalMerge(cliente);
        } else {
          showToast('Erro ao excluir: ' + error.message, 'error');
        }
        return;
      }
      showToast('Cliente excluído.', 'ok');
      loadClientes();
    });
  });
}

/* ===================== TRANSFERIR HISTÓRICO E EXCLUIR (duplicados) ===================== */

var clienteParaExcluir = null;

function abrirModalMerge(cliente) {
  var modalEl = document.getElementById('modal-merge-cliente');
  if (!modalEl) {
    // HTML desatualizado no cache do navegador (sem o modal novo) — evita travar o resto da tela.
    showToast('Não é possível excluir: este cliente possui pedidos/orçamentos vinculados. Atualize a página (F5) e tente novamente.', 'warning');
    return;
  }

  clienteParaExcluir = cliente;
  document.getElementById('merge-cliente-nome').textContent = cliente.razao_social || cliente.nome_fantasia || '';
  document.getElementById('merge-cliente-error').style.display = 'none';

  var destinoSelect = document.getElementById('merge-cliente-destino');
  destinoSelect.innerHTML = allClientes
    .filter(function (c) { return c.id !== cliente.id; })
    .map(function (c) {
      return '<option value="' + c.id + '">' + (c.razao_social || c.nome_fantasia || '') + (c.cnpj_cpf ? ' — ' + c.cnpj_cpf : '') + '</option>';
    }).join('');

  modalEl.classList.add('open');
}

var mergeCancelarBtn = document.getElementById('merge-cliente-cancelar');
if (mergeCancelarBtn) mergeCancelarBtn.addEventListener('click', function () {
  document.getElementById('modal-merge-cliente').classList.remove('open');
  clienteParaExcluir = null;
});

var mergeConfirmarBtn = document.getElementById('merge-cliente-confirmar');
if (mergeConfirmarBtn) mergeConfirmarBtn.addEventListener('click', async function () {
  var errorEl = document.getElementById('merge-cliente-error');
  errorEl.style.display = 'none';
  var destinoId = document.getElementById('merge-cliente-destino').value;

  if (!clienteParaExcluir || !destinoId) return;

  var btn = this;
  btn.disabled = true;
  btn.textContent = 'Transferindo...';

  var updatePedidos = await supabaseClient.from('pedidos').update({ cliente_id: destinoId }).eq('cliente_id', clienteParaExcluir.id);
  if (updatePedidos.error) {
    errorEl.textContent = 'Erro ao transferir histórico: ' + updatePedidos.error.message;
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Transferir e excluir';
    return;
  }

  var deleteResult = await supabaseClient.from('clientes').delete().eq('id', clienteParaExcluir.id);
  btn.disabled = false;
  btn.textContent = 'Transferir e excluir';

  if (deleteResult.error) {
    errorEl.textContent = 'Histórico transferido, mas houve erro ao excluir o cadastro: ' + deleteResult.error.message;
    errorEl.style.display = 'block';
    return;
  }

  showToast('Histórico transferido e cadastro duplicado excluído.', 'ok');
  document.getElementById('modal-merge-cliente').classList.remove('open');
  clienteParaExcluir = null;
  loadClientes();
});

var mergeSoExcluirBtn = document.getElementById('merge-cliente-so-excluir');
if (mergeSoExcluirBtn) mergeSoExcluirBtn.addEventListener('click', async function () {
  var errorEl = document.getElementById('merge-cliente-error');
  errorEl.style.display = 'none';

  if (!clienteParaExcluir) return;
  if (!confirm('Isso vai excluir também todos os pedidos/orçamentos vinculados a "' + (clienteParaExcluir.razao_social || '') + '". Essa ação não pode ser desfeita. Continuar?')) return;

  var btn = this;
  btn.disabled = true;
  btn.textContent = 'Excluindo...';

  var deletePedidos = await supabaseClient.from('pedidos').delete().eq('cliente_id', clienteParaExcluir.id);
  if (deletePedidos.error) {
    errorEl.textContent = 'Erro ao excluir pedidos vinculados: ' + deletePedidos.error.message;
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Excluir mesmo assim (perde o histórico)';
    return;
  }

  var deleteResult = await supabaseClient.from('clientes').delete().eq('id', clienteParaExcluir.id);
  btn.disabled = false;
  btn.textContent = 'Excluir mesmo assim (perde o histórico)';

  if (deleteResult.error) {
    errorEl.textContent = 'Pedidos excluídos, mas houve erro ao excluir o cadastro: ' + deleteResult.error.message;
    errorEl.style.display = 'block';
    return;
  }

  showToast('Cliente e histórico vinculado excluídos.', 'ok');
  document.getElementById('modal-merge-cliente').classList.remove('open');
  clienteParaExcluir = null;
  loadClientes();
});

document.getElementById('cliente-search').addEventListener('input', function (e) {
  var term = e.target.value.toLowerCase();
  var filtered = allClientes.filter(function (c) {
    return (c.razao_social || '').toLowerCase().includes(term) ||
      (c.nome_fantasia || '').toLowerCase().includes(term) ||
      (c.cnpj_cpf || '').toLowerCase().includes(term);
  });
  renderClientesTable(filtered);
});

document.getElementById('btn-buscar-cnpj').addEventListener('click', async function () {
  var cnpjInput = document.getElementById('cnpj_cpf');
  var statusEl = document.getElementById('cnpj-status');
  var btn = this;

  statusEl.textContent = 'Buscando...';
  btn.disabled = true;

  try {
    var dados = await fetchCnpj(cnpjInput.value);
    document.getElementById('cnpj_cpf').value = dados.cnpj;
    document.getElementById('razao_social').value = dados.razaoSocial;
    document.getElementById('nome_fantasia').value = dados.nomeFantasia;
    document.getElementById('logradouro').value = dados.logradouro;
    document.getElementById('numero').value = dados.numero;
    document.getElementById('complemento').value = dados.complemento;
    document.getElementById('bairro').value = dados.bairro;
    document.getElementById('cep').value = dados.cep;
    document.getElementById('municipio').value = dados.municipio;
    document.getElementById('uf').value = dados.uf;
    document.getElementById('telefone_empresa').value = dados.telefone;
    document.getElementById('email_empresa').value = dados.email;
    statusEl.textContent = 'Dados encontrados na Receita Federal.';
  } catch (err) {
    statusEl.textContent = '';
    showToast(err.message, 'warning');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('cliente-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var errorEl = document.getElementById('cliente-error');
  var saveBtn = document.getElementById('cliente-save-btn');
  errorEl.style.display = 'none';

  var razaoSocial = document.getElementById('razao_social').value.trim();
  if (!razaoSocial) {
    errorEl.textContent = 'Razão Social é obrigatória.';
    errorEl.style.display = 'block';
    return;
  }

  var values = getFormValues();
  var clienteId = document.getElementById('cliente-id').value;

  var cnpjDigitado = normalizarCnpj(values.cnpj_cpf);
  if (cnpjDigitado) {
    var jaExiste = allClientes.find(function (c) {
      return c.id !== clienteId && normalizarCnpj(c.cnpj_cpf) === cnpjDigitado;
    });
    if (jaExiste) {
      errorEl.textContent = 'Já existe um cliente cadastrado com esse CNPJ/CPF: ' + (jaExiste.razao_social || jaExiste.nome_fantasia || '') + '. Verifique antes de salvar para evitar cadastro duplicado.';
      errorEl.style.display = 'block';
      return;
    }
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Salvando...';
  var result;

  if (clienteId) {
    result = await supabaseClient.from('clientes').update(values).eq('id', clienteId);
  } else {
    values.created_by = currentUserId;
    result = await supabaseClient.from('clientes').insert(values);
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Salvar cliente';

  if (result.error) {
    errorEl.textContent = 'Erro ao salvar: ' + result.error.message;
    errorEl.style.display = 'block';
    return;
  }

  showToast('Cliente salvo com sucesso.', 'ok');
  resetForm();
  loadClientes();
});

document.getElementById('cliente-cancel-btn').addEventListener('click', resetForm);

(async function () {
  var auth = await window.ADMIN_AUTH_READY;
  if (!auth) return;
  currentUserId = auth.session.user.id;
  await loadClientes();

  var params = new URLSearchParams(location.search);
  var editarId = params.get('editar');
  if (editarId) {
    iniciarEdicaoClientePorId(editarId);
  }
})();

/* ===================== HISTÓRICO DE COMPRAS ===================== */
/* loadHistoricoCliente() vem de js/historico.js (compartilhado com pedido.html) */

var historicoBtnFechar = document.getElementById('historico-btn-fechar');
if (historicoBtnFechar) historicoBtnFechar.addEventListener('click', function () {
  document.getElementById('modal-historico').classList.remove('open');
});

var historicoAssistenciaBtnFechar = document.getElementById('historico-assistencia-btn-fechar');
if (historicoAssistenciaBtnFechar) historicoAssistenciaBtnFechar.addEventListener('click', function () {
  document.getElementById('modal-historico-assistencia').classList.remove('open');
});

/* ===================== IMPRIMIR HISTÓRICO DO CLIENTE ===================== */

function imprimirHistorico(titulo, nomeCliente, conteudoId) {
  var conteudoHtml = document.getElementById(conteudoId).innerHTML;
  var dataStr = new Date().toLocaleDateString('pt-BR');

  document.getElementById('print-sheet').innerHTML =
    '<div class="historico-print">' +
      '<h2>' + titulo + ' — ' + nomeCliente + '</h2>' +
      '<div class="historico-data">Emitido em ' + dataStr + '</div>' +
      conteudoHtml +
    '</div>';

  var originalTitle = document.title;
  document.title = titulo + ' - ' + nomeCliente;
  window.print();
  document.title = originalTitle;
}

var historicoBtnImprimir = document.getElementById('historico-btn-imprimir');
if (historicoBtnImprimir) historicoBtnImprimir.addEventListener('click', function () {
  var nomeCliente = document.getElementById('historico-cliente-nome').textContent;
  imprimirHistorico('Histórico de Compras', nomeCliente, 'historico-conteudo');
});

var historicoAssistenciaBtnImprimir = document.getElementById('historico-assistencia-btn-imprimir');
if (historicoAssistenciaBtnImprimir) historicoAssistenciaBtnImprimir.addEventListener('click', function () {
  var nomeCliente = document.getElementById('historico-assistencia-cliente-nome').textContent;
  imprimirHistorico('Histórico de Assistências Técnicas', nomeCliente, 'historico-assistencia-conteudo');
});

/* ===================== IMPORTAR / MODELO DE PLANILHA ===================== */

var COLUNAS_CLIENTE = [
  { titulo: 'Código', chave: 'codigo' },
  { titulo: 'CNPJ/CPF', chave: 'cnpj_cpf' },
  { titulo: 'Razão Social', chave: 'razao_social' },
  { titulo: 'Nome Fantasia', chave: 'nome_fantasia' },
  { titulo: 'Inscrição Estadual', chave: 'ie' },
  { titulo: 'Logradouro', chave: 'logradouro' },
  { titulo: 'Número', chave: 'numero' },
  { titulo: 'Complemento', chave: 'complemento' },
  { titulo: 'Bairro', chave: 'bairro' },
  { titulo: 'CEP', chave: 'cep' },
  { titulo: 'Município', chave: 'municipio' },
  { titulo: 'UF', chave: 'uf' },
  { titulo: 'Telefone Empresa', chave: 'telefone_empresa' },
  { titulo: 'E-mail Empresa', chave: 'email_empresa' },
  { titulo: 'Nome do Contato', chave: 'contato_nome' },
  { titulo: 'Telefone do Contato', chave: 'contato_telefone' },
  { titulo: 'E-mail do Contato', chave: 'contato_email' },
  { titulo: 'Forma de Pagamento Preferencial', chave: 'forma_pagamento_padrao' },
  { titulo: 'Local de Entrega Preferencial', chave: 'local_entrega_preferencial' },
  { titulo: 'Observações', chave: 'observacoes' }
];

var FORMAS_PAGAMENTO_VALIDAS = ['boleto', 'a_vista', 'cartao_credito', 'cartao_debito', 'pix', 'link_pagamento'];
var linhasImportacaoClienteValidas = [];

var btnBaixarModeloCliente = document.getElementById('btn-baixar-modelo-cliente');
if (btnBaixarModeloCliente) btnBaixarModeloCliente.addEventListener('click', function () {
  baixarModeloExcel('modelo-importacao-clientes.xlsx', COLUNAS_CLIENTE, [{
    codigo: 'C001', cnpj_cpf: '00.000.000/0001-00', razao_social: 'Empresa Exemplo LTDA',
    nome_fantasia: 'Exemplo', ie: '', logradouro: 'Rua Exemplo', numero: '123', complemento: '',
    bairro: 'Centro', cep: '00000-000', municipio: 'Americana', uf: 'SP',
    telefone_empresa: '(19) 0000-0000', email_empresa: 'contato@exemplo.com',
    contato_nome: 'Fulano', contato_telefone: '(19) 90000-0000', contato_email: 'fulano@exemplo.com',
    forma_pagamento_padrao: 'boleto', local_entrega_preferencial: '', observacoes: ''
  }]);
});

function abrirModalImportarCliente() {
  document.getElementById('importar-cliente-arquivo').value = '';
  document.getElementById('importar-cliente-preview').style.display = 'none';
  document.getElementById('importar-cliente-preview').innerHTML = '';
  document.getElementById('importar-cliente-error').style.display = 'none';
  document.getElementById('importar-cliente-btn-confirmar').disabled = true;
  linhasImportacaoClienteValidas = [];
  document.getElementById('modal-importar-cliente').classList.add('open');
}

var btnAbrirImportarCliente = document.getElementById('btn-abrir-importar-cliente');
if (btnAbrirImportarCliente) btnAbrirImportarCliente.addEventListener('click', abrirModalImportarCliente);

var importarClienteBtnCancelar = document.getElementById('importar-cliente-btn-cancelar');
if (importarClienteBtnCancelar) importarClienteBtnCancelar.addEventListener('click', function () {
  document.getElementById('modal-importar-cliente').classList.remove('open');
});

var importarClienteArquivo = document.getElementById('importar-cliente-arquivo');
if (importarClienteArquivo) importarClienteArquivo.addEventListener('change', async function (e) {
  var file = e.target.files[0];
  var previewEl = document.getElementById('importar-cliente-preview');
  var errorEl = document.getElementById('importar-cliente-error');
  var confirmarBtn = document.getElementById('importar-cliente-btn-confirmar');
  errorEl.style.display = 'none';
  confirmarBtn.disabled = true;
  linhasImportacaoClienteValidas = [];
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
    .map(function (linha) { return normalizarLinhaExcel(linha, COLUNAS_CLIENTE); })
    .filter(function (linha) {
      return Object.keys(linha).some(function (k) { return linha[k]; });
    });

  if (!linhas.length) {
    errorEl.textContent = 'Nenhuma linha com dados encontrada no arquivo.';
    errorEl.style.display = 'block';
    return;
  }

  var linhasProcessadas = linhas.map(function (linha) {
    var erros = [];
    if (!linha.razao_social) erros.push('razão social obrigatória');
    if (linha.forma_pagamento_padrao && FORMAS_PAGAMENTO_VALIDAS.indexOf(linha.forma_pagamento_padrao) === -1) {
      linha.forma_pagamento_padrao = ''; // valor não reconhecido: importa sem essa particularidade em vez de travar a linha
    }
    return Object.assign({}, linha, { erros: erros });
  });

  linhasImportacaoClienteValidas = linhasProcessadas.filter(function (l) { return !l.erros.length; });

  previewEl.style.display = 'block';
  previewEl.innerHTML = '<table class="admin-table"><thead><tr><th>Razão Social</th><th>CNPJ/CPF</th><th>Status</th></tr></thead><tbody>' +
    linhasProcessadas.map(function (l) {
      var cnpjNormalizado = normalizarCnpj(l.cnpj_cpf);
      var existente = cnpjNormalizado && allClientes.find(function (c) { return normalizarCnpj(c.cnpj_cpf) === cnpjNormalizado; });
      var status = l.erros.length ? '<span class="badge badge-warning">' + l.erros.join(', ') + '</span>' :
        (existente ? '<span class="badge badge-warning">Atualiza existente</span>' : '<span class="badge badge-ok">Novo</span>');
      return '<tr><td>' + (l.razao_social || '—') + '</td><td>' + (l.cnpj_cpf || '—') + '</td><td>' + status + '</td></tr>';
    }).join('') +
  '</tbody></table>';

  confirmarBtn.disabled = !linhasImportacaoClienteValidas.length;
  if (!linhasImportacaoClienteValidas.length) {
    errorEl.textContent = 'Nenhuma linha válida para importar. Corrija o arquivo e tente novamente.';
    errorEl.style.display = 'block';
  }
});

var importarClienteBtnConfirmar = document.getElementById('importar-cliente-btn-confirmar');
if (importarClienteBtnConfirmar) importarClienteBtnConfirmar.addEventListener('click', async function () {
  var btn = this;
  btn.disabled = true;
  btn.textContent = 'Importando...';

  var importados = 0, atualizados = 0, comErro = 0;

  for (var i = 0; i < linhasImportacaoClienteValidas.length; i++) {
    var linha = linhasImportacaoClienteValidas[i];
    var payload = {};
    fieldIds.forEach(function (chave) { payload[chave] = linha[chave] || null; });

    var cnpjNormalizado = normalizarCnpj(linha.cnpj_cpf);
    var existente = cnpjNormalizado && allClientes.find(function (c) { return normalizarCnpj(c.cnpj_cpf) === cnpjNormalizado; });

    var result;
    if (existente) {
      result = await supabaseClient.from('clientes').update(payload).eq('id', existente.id);
      if (!result.error) atualizados++; else comErro++;
    } else {
      payload.created_by = currentUserId;
      result = await supabaseClient.from('clientes').insert(payload);
      if (!result.error) importados++; else comErro++;
    }
  }

  btn.disabled = false;
  btn.textContent = 'Importar linhas';

  document.getElementById('modal-importar-cliente').classList.remove('open');
  showToast('Importação concluída: ' + importados + ' novo(s), ' + atualizados + ' atualizado(s)' + (comErro ? ', ' + comErro + ' com erro' : '') + '.', comErro ? 'warning' : 'ok');
  loadClientes();
});
