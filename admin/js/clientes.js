var currentUserId = null;
var allClientes = [];

var CATEGORIA_LABELS = { venda: 'Venda', manutencao: 'Manutenção', pos_venda: 'Pós-venda' };

var fieldIds = [
  'codigo', 'cnpj_cpf', 'razao_social', 'nome_fantasia', 'ie', 'categoria', 'canal_aquisicao', 'situacao', 'eh_cliente',
  'logradouro', 'numero', 'complemento', 'bairro', 'cep', 'municipio', 'uf',
  'telefone_empresa', 'email_empresa', 'contato_nome', 'contato_telefone', 'contato_email',
  'forma_pagamento_padrao', 'local_entrega_preferencial', 'observacoes'
];

// Tipo "Cliente da Oficina" não usa funil nem canal de aquisição: esconde os
// campos (os valores já gravados ficam intactos, só não aparecem).
function atualizarCamposPorTipo() {
  var ehCliente = document.getElementById('eh_cliente').value === 'true';
  ['categoria', 'canal_aquisicao', 'situacao'].forEach(function (id) {
    document.getElementById(id).closest('.form-field').style.display = ehCliente ? 'none' : '';
  });
}
document.getElementById('eh_cliente').addEventListener('change', atualizarCamposPorTipo);

function getFormValues() {
  var values = {};
  fieldIds.forEach(function (id) {
    values[id] = document.getElementById(id).value.trim() || null;
  });
  if (!values.situacao) values.situacao = 'ativo'; // coluna not null
  values.eh_cliente = document.getElementById('eh_cliente').value === 'true';
  // Cliente da Oficina é sempre "ativo" e não entra em funil. Exceção: lead que
  // já era "ganho" e foi migrado — mantém ganho/funil pra não perder a estatística.
  if (values.eh_cliente && values.situacao !== 'ganho') {
    values.situacao = 'ativo';
    values.categoria = null;
  }
  return values;
}

function setFormValues(cliente) {
  fieldIds.forEach(function (id) {
    document.getElementById(id).value = cliente && cliente[id] != null ? String(cliente[id]) : (id === 'eh_cliente' ? 'false' : '');
  });
  atualizarCamposPorTipo();
}

function resetForm() {
  document.getElementById('cliente-form').reset();
  document.getElementById('cliente-id').value = '';
  document.getElementById('form-title').textContent = 'Novo cliente';
  document.getElementById('cliente-error').style.display = 'none';
  document.getElementById('cnpj-status').textContent = 'Opcional.';
  atualizarCamposPorTipo();
}

function normalizarCnpj(v) {
  return (v || '').replace(/\D/g, '');
}

var cnpjDuplicadoMap = {};
var historicoPorClienteMap = {};

async function loadClientes() {
  var { data, error } = await supabaseClient
    .from('clientes')
    .select('*, cliente_historico(cliente_id, created_at, resultado)')
    .order('razao_social', { ascending: true })
    .order('created_at', { referencedTable: 'cliente_historico', ascending: true });

  if (error) {
    showToast('Erro ao carregar clientes: ' + error.message, 'error');
    return;
  }

  allClientes = data || [];

  cnpjDuplicadoMap = {};
  allClientes.forEach(function (c) {
    var cnpj = normalizarCnpj(c.cnpj_cpf);
    if (!cnpj) return;
    cnpjDuplicadoMap[cnpj] = (cnpjDuplicadoMap[cnpj] || 0) + 1;
  });

  historicoPorClienteMap = {};
  allClientes.forEach(function (c) {
    historicoPorClienteMap[c.id] = c.cliente_historico || [];
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
    tbody.innerHTML = '<tr><td colspan="8">Nenhum cliente cadastrado ainda.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(function (c) {
    var contato = [c.telefone_empresa, c.email_empresa].filter(Boolean).join(' — ') || '—';
    var cnpjNormalizado = normalizarCnpj(c.cnpj_cpf);
    var badgeDuplicado = (cnpjNormalizado && cnpjDuplicadoMap[cnpjNormalizado] > 1) ? ' <span class="badge badge-warning">CNPJ/CPF duplicado</span>' : '';
    var categoria = c.categoria ? CATEGORIA_LABELS[c.categoria] : '—';
    var canal = c.canal_aquisicao || '—';
    var tipo = c.eh_cliente ? '<span class="badge badge-ok">Cliente</span>' : '<span class="badge badge-info">Lead</span>';
    var prazoTexto = '—';
    if (c.categoria || (c.situacao && c.situacao !== 'ativo')) {
      var retorno = calcularProximoRetorno(c, historicoPorClienteMap[c.id] || []);
      var prazo = formatarPrazo(retorno);
      prazoTexto = prazo.classe ? '<span class="badge ' + prazo.classe + '">' + prazo.texto + '</span>' : prazo.texto;
    }
    return '<tr>' +
      '<td><button type="button" class="link-cliente" data-abrir="' + c.id + '">' + escHtml(c.razao_social || '') + '</button>' + badgeDuplicado + '</td>' +
      '<td>' + categoria + '</td>' +
      '<td>' + tipo + '</td>' +
      '<td>' + canal + '</td>' +
      '<td>' + prazoTexto + '</td>' +
      '<td>' + contato + '</td>' +
      '<td>' + (c.cnpj_cpf || '—') + '</td>' +
      '<td class="row-actions">' +
        '<button data-abrir="' + c.id + '">Abrir</button>' +
        (c.eh_cliente ? '<button data-historico-assistencia="' + c.id + '">Assist. Técnica</button>' : '') +
        '<button data-edit="' + c.id + '">Editar</button>' +
        '<button data-delete="' + c.id + '" class="danger">Excluir</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  tbody.querySelectorAll('[data-abrir]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      abrirClienteDetalhe(btn.dataset.abrir, { onChange: loadClientes });
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
      if (!confirm('Excluir este cliente? Essa ação não pode ser desfeita (também remove equipamentos e assistências técnicas vinculadas).')) return;
      var { error } = await supabaseClient.from('clientes').delete().eq('id', btn.dataset.delete);
      if (error) {
        showToast('Erro ao excluir: ' + error.message, 'error');
        return;
      }
      showToast('Cliente excluído.', 'ok');
      loadClientes();
    });
  });
}

/* ===================== HISTÓRICO DE FOLLOW-UP ===================== */


function aplicarFiltrosClientes() {
  var term = document.getElementById('cliente-search').value.toLowerCase();
  var tipo = document.getElementById('cliente-filtro-tipo').value;
  var filtered = allClientes.filter(function (c) {
    if (tipo && String(!!c.eh_cliente) !== tipo) return false;
    return (c.razao_social || '').toLowerCase().includes(term) ||
      (c.nome_fantasia || '').toLowerCase().includes(term) ||
      (c.cnpj_cpf || '').toLowerCase().includes(term);
  });
  renderClientesTable(filtered);
}
document.getElementById('cliente-search').addEventListener('input', aplicarFiltrosClientes);
document.getElementById('cliente-filtro-tipo').addEventListener('change', aplicarFiltrosClientes);

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
    statusEl.textContent = 'Opcional.';
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
    errorEl.textContent = 'Nome é obrigatório.';
    errorEl.style.display = 'block';
    return;
  }

  var telefone = document.getElementById('telefone_empresa').value.trim();
  var email = document.getElementById('email_empresa').value.trim();
  if (!telefone && !email) {
    errorEl.textContent = 'Preencha pelo menos o telefone ou o e-mail.';
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
  } else if (params.get('novo') === 'cliente') {
    document.getElementById('eh_cliente').value = 'true'; // vindo da Assistência Técnica
    atualizarCamposPorTipo();
  }
})();

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

var historicoAssistenciaBtnImprimir = document.getElementById('historico-assistencia-btn-imprimir');
if (historicoAssistenciaBtnImprimir) historicoAssistenciaBtnImprimir.addEventListener('click', function () {
  var nomeCliente = document.getElementById('historico-assistencia-cliente-nome').textContent;
  imprimirHistorico('Histórico de Assistências Técnicas', nomeCliente, 'historico-assistencia-conteudo');
});

/* ===================== IMPORTAR / MODELO DE PLANILHA ===================== */

var COLUNAS_CLIENTE = [
  { titulo: 'Código', chave: 'codigo' },
  { titulo: 'CNPJ/CPF', chave: 'cnpj_cpf' },
  { titulo: 'Nome', chave: 'razao_social' },
  { titulo: 'Nome Fantasia', chave: 'nome_fantasia' },
  { titulo: 'Categoria (venda/manutencao/pos_venda)', chave: 'categoria' },
  { titulo: 'Canal de Aquisição', chave: 'canal_aquisicao' },
  { titulo: 'Inscrição Estadual', chave: 'ie' },
  { titulo: 'Logradouro', chave: 'logradouro' },
  { titulo: 'Número', chave: 'numero' },
  { titulo: 'Complemento', chave: 'complemento' },
  { titulo: 'Bairro', chave: 'bairro' },
  { titulo: 'CEP', chave: 'cep' },
  { titulo: 'Município', chave: 'municipio' },
  { titulo: 'UF', chave: 'uf' },
  { titulo: 'Telefone', chave: 'telefone_empresa' },
  { titulo: 'E-mail', chave: 'email_empresa' },
  { titulo: 'Nome do Contato', chave: 'contato_nome' },
  { titulo: 'Telefone do Contato', chave: 'contato_telefone' },
  { titulo: 'E-mail do Contato', chave: 'contato_email' },
  { titulo: 'Forma de Pagamento Preferencial', chave: 'forma_pagamento_padrao' },
  { titulo: 'Local de Entrega Preferencial', chave: 'local_entrega_preferencial' },
  { titulo: 'Observações', chave: 'observacoes' }
];

var FORMAS_PAGAMENTO_VALIDAS = ['boleto', 'a_vista', 'cartao_credito', 'cartao_debito', 'pix', 'link_pagamento'];
var CATEGORIAS_VALIDAS = ['venda', 'manutencao', 'pos_venda'];
var linhasImportacaoClienteValidas = [];

var btnBaixarModeloCliente = document.getElementById('btn-baixar-modelo-cliente');
if (btnBaixarModeloCliente) btnBaixarModeloCliente.addEventListener('click', function () {
  baixarModeloExcel('modelo-importacao-clientes.xlsx', COLUNAS_CLIENTE, [{
    codigo: 'C001', cnpj_cpf: '', razao_social: 'Nome do Cliente Exemplo',
    nome_fantasia: '', categoria: 'venda', ie: '', logradouro: 'Rua Exemplo', numero: '123', complemento: '',
    bairro: 'Centro', cep: '00000-000', municipio: 'Americana', uf: 'SP',
    telefone_empresa: '(19) 90000-0000', email_empresa: 'contato@exemplo.com',
    contato_nome: '', contato_telefone: '', contato_email: '',
    forma_pagamento_padrao: '', local_entrega_preferencial: '', observacoes: ''
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
    if (!linha.razao_social) erros.push('nome obrigatório');
    if (!linha.telefone_empresa && !linha.email_empresa) erros.push('telefone ou e-mail obrigatório');
    if (linha.forma_pagamento_padrao && FORMAS_PAGAMENTO_VALIDAS.indexOf(linha.forma_pagamento_padrao) === -1) {
      linha.forma_pagamento_padrao = ''; // valor não reconhecido: importa sem essa particularidade em vez de travar a linha
    }
    if (linha.categoria && CATEGORIAS_VALIDAS.indexOf(linha.categoria) === -1) {
      linha.categoria = ''; // idem
    }
    return Object.assign({}, linha, { erros: erros });
  });

  linhasImportacaoClienteValidas = linhasProcessadas.filter(function (l) { return !l.erros.length; });

  previewEl.style.display = 'block';
  previewEl.innerHTML = '<table class="admin-table"><thead><tr><th>Nome</th><th>CNPJ/CPF</th><th>Status</th></tr></thead><tbody>' +
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
    if (!payload.situacao) delete payload.situacao; // mantém o padrão do banco (ativo)
    if (payload.eh_cliente == null) delete payload.eh_cliente;

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
