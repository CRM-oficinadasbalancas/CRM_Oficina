var currentUserId = null;
var currentUserIsAdmin = false;
var clientesCache = [];
var equipamentosCache = [];
var pecasCache = [];
var allAssistencias = [];
var selectedClienteAssistencia = null;
var selectedEquipamento = null;
var assistenciaEmEdicaoId = null;
var assistenciaPausadoEmCarregado = null;
var assistenciaStatusCarregado = null;

var ALFANUMERICO_REGEX = /^[A-Za-z0-9]{1,20}$/;
var QUANTIDADE_PECA_REGEX = /^\d{1,5}(\.\d{1,2})?$/;

var STATUS_LABELS = {
  aberta: 'Aberta',
  em_andamento: 'Em andamento',
  pendente: 'Pendente',
  concluida: 'Concluída',
  nao_aprovada: 'Não aprovado pelo cliente'
};

var STATUS_BADGE_CLASS = {
  aberta: 'badge-warning',
  em_andamento: 'badge-warning',
  pendente: 'badge-warning',
  concluida: 'badge-ok',
  nao_aprovada: 'badge-danger'
};

var STATUS_FECHAMENTO = ['concluida', 'nao_aprovada'];

/* ===================== PRAZO (SLA): bullet verde/amarelo/vermelho =====================
   Verde: até 24h (prazo de atendimento). Amarelo: 24h–36h (prazo de solução).
   Vermelho: acima de 36h, OU 72h+ sem nenhuma atualização (chamado esquecido).
   "Pendente" congela o cálculo no momento em que foi pausado. Fechado (concluída/
   não aprovada) fica com a cor referente ao tempo que levou até fechar. */
function calcularSlaAssistencia(a) {
  var criadoEm = new Date(a.created_at);

  if (a.status === 'concluida' || a.status === 'nao_aprovada') {
    var horasFechamento = (new Date(a.updated_at) - criadoEm) / 3600000;
    return corPorHoras(horasFechamento);
  }

  var horasSemMexer = (Date.now() - new Date(a.updated_at)) / 3600000;
  if (horasSemMexer > 72) {
    return { cor: 'vermelho', label: 'Sem atualização há mais de 72h' };
  }

  if (a.status === 'pendente') {
    var referenciaPausa = a.pausado_em || a.updated_at;
    var horasPendente = (new Date(referenciaPausa) - criadoEm) / 3600000;
    var resultado = corPorHoras(horasPendente);
    resultado.label += ' (pausado)';
    return resultado;
  }

  var horas = (Date.now() - criadoEm) / 3600000;
  return corPorHoras(horas);
}

function corPorHoras(horas) {
  if (horas < 24) return { cor: 'verde', label: 'Dentro do prazo de atendimento (24h)' };
  if (horas < 36) return { cor: 'amarelo', label: 'Prazo de atendimento (24h) estourado' };
  return { cor: 'vermelho', label: 'Prazo de solução (36h) estourado' };
}

function formatarQuantidadeLocal(q) {
  var n = parseFloat(q);
  if (isNaN(n)) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function equipamentoLabel(eq) {
  var nomeBase = [eq.marca, eq.modelo].filter(Boolean).join(' ') || 'Equipamento';
  return nomeBase + (eq.numero_serie ? ' — Série: ' + eq.numero_serie : '');
}

function equipamentoTexto(a) {
  if (!a.equipamentos) return '—';
  return [a.equipamentos.marca, a.equipamentos.modelo].filter(Boolean).join(' ') || '—';
}

function numeroSerieTexto(a) {
  return (a.equipamentos && a.equipamentos.numero_serie) || '—';
}

function resetForm() {
  document.getElementById('assistencia-form').reset();
  document.getElementById('assistencia-id').value = '';
  assistenciaEmEdicaoId = null;
  assistenciaPausadoEmCarregado = null;
  assistenciaStatusCarregado = null;
  selectedClienteAssistencia = null;
  selectedEquipamento = null;
  equipamentosCache = [];
  document.getElementById('form-title').textContent = 'Nova assistência técnica';
  document.getElementById('pagina-titulo').textContent = 'Assistência Técnica';
  document.getElementById('edicao-banner').style.display = 'none';
  document.getElementById('assistencia-error').style.display = 'none';
  document.getElementById('alerta-equipamento-historico').style.display = 'none';
  document.getElementById('peca-estoque-info').style.display = 'none';
  document.getElementById('cliente-resumo').style.display = 'none';
  document.getElementById('status').value = 'aberta';
  document.getElementById('select-equipamento').innerHTML = '<option value="">— Selecione o cliente primeiro —</option>';
  document.getElementById('select-equipamento').disabled = true;
  document.getElementById('assistencia-save-btn').textContent = 'Salvar assistência técnica';
  atualizarContadorDescricao();
  atualizarContadorResolucao();
  atualizarHintResolucao();
}

/* ===================== CLIENTE ===================== */

async function loadClientesSelect() {
  var { data, error } = await supabaseClient.from('clientes').select('*').order('razao_social');
  if (error) { showToast('Erro ao carregar clientes: ' + error.message, 'error'); return; }
  clientesCache = data || [];

  var select = document.getElementById('select-cliente');
  select.innerHTML = '<option value="">— Selecione —</option>' + clientesCache.map(function (c) {
    return '<option value="' + c.id + '">' + c.razao_social + (c.nome_fantasia ? ' (' + c.nome_fantasia + ')' : '') + '</option>';
  }).join('');
}

async function selecionarCliente(clienteId) {
  selectedClienteAssistencia = clientesCache.find(function (c) { return c.id === clienteId; }) || null;
  var resumo = document.getElementById('cliente-resumo');
  var equipSelect = document.getElementById('select-equipamento');

  if (!selectedClienteAssistencia) {
    resumo.style.display = 'none';
    equipSelect.innerHTML = '<option value="">— Selecione o cliente primeiro —</option>';
    equipSelect.disabled = true;
    equipamentosCache = [];
    selectedEquipamento = null;
    document.getElementById('alerta-equipamento-historico').style.display = 'none';
    return;
  }

  var c = selectedClienteAssistencia;
  var enderecoPartes = [
    c.logradouro, c.numero, c.complemento, c.bairro, c.municipio, c.uf
  ].filter(Boolean).join(', ');

  document.getElementById('cliente-resumo-texto').innerHTML =
    '<strong>' + c.razao_social + '</strong><br>' +
    (enderecoPartes ? enderecoPartes + '<br>' : '') +
    (c.cnpj_cpf ? 'CNPJ/CPF: ' + c.cnpj_cpf + '<br>' : '') +
    (c.contato_nome ? 'Contato: ' + c.contato_nome +
      (c.contato_telefone ? ' — ' + c.contato_telefone : '') : '');
  document.getElementById('link-editar-cliente').href = 'clientes.html?editar=' + c.id;
  resumo.style.display = 'block';

  await loadEquipamentosDoCliente(clienteId);
}

document.getElementById('select-cliente').addEventListener('change', function (e) {
  selecionarCliente(e.target.value);
});

/* ===================== EQUIPAMENTO ===================== */

async function loadEquipamentosDoCliente(clienteId) {
  var select = document.getElementById('select-equipamento');
  select.innerHTML = '<option value="">Carregando...</option>';
  select.disabled = true;

  var { data, error } = await supabaseClient
    .from('equipamentos')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false });

  if (error) { showToast('Erro ao carregar equipamentos: ' + error.message, 'error'); return; }

  equipamentosCache = data || [];
  select.disabled = false;

  if (!equipamentosCache.length) {
    select.innerHTML = '<option value="">Nenhum equipamento cadastrado — cadastre um novo</option>';
    return;
  }
  select.innerHTML = '<option value="">— Selecione —</option>' + equipamentosCache.map(function (eq) {
    return '<option value="' + eq.id + '">' + equipamentoLabel(eq) + '</option>';
  }).join('');
}

document.getElementById('select-equipamento').addEventListener('change', async function (e) {
  var eq = equipamentosCache.find(function (x) { return x.id === e.target.value; });
  selectedEquipamento = eq || null;
  var alertaEl = document.getElementById('alerta-equipamento-historico');

  if (!selectedEquipamento) { alertaEl.style.display = 'none'; return; }

  var count = await contarAssistenciasPorEquipamento(selectedEquipamento.id, assistenciaEmEdicaoId);
  if (count > 0) {
    alertaEl.textContent = '⚠️ Este equipamento já tem ' + count + ' assistência' + (count > 1 ? 's' : '') + ' técnica' + (count > 1 ? 's' : '') + ' registrada' + (count > 1 ? 's' : '') + '.';
    alertaEl.style.display = 'block';
  } else {
    alertaEl.style.display = 'none';
  }
});

document.getElementById('btn-cadastrar-equipamento').addEventListener('click', function () {
  if (!selectedClienteAssistencia) {
    showToast('Selecione um cliente antes de cadastrar um equipamento.', 'warning');
    return;
  }
  document.getElementById('modal-eq-cliente-nome').textContent = selectedClienteAssistencia.razao_social;
  document.getElementById('modal-eq-marca').value = '';
  document.getElementById('modal-eq-modelo').value = '';
  document.getElementById('modal-eq-serie').value = '';
  document.getElementById('modal-eq-error').style.display = 'none';
  document.getElementById('modal-cadastrar-equipamento').classList.add('open');
});

document.getElementById('modal-eq-btn-cancelar').addEventListener('click', function () {
  document.getElementById('modal-cadastrar-equipamento').classList.remove('open');
});

document.getElementById('modal-eq-btn-salvar').addEventListener('click', async function () {
  var errorEl = document.getElementById('modal-eq-error');
  errorEl.style.display = 'none';

  var serie = document.getElementById('modal-eq-serie').value.trim();
  if (!ALFANUMERICO_REGEX.test(serie)) {
    errorEl.textContent = 'Número de série deve conter apenas letras e números (sem espaços ou símbolos), até 20 caracteres.';
    errorEl.style.display = 'block';
    return;
  }

  var payload = {
    cliente_id: selectedClienteAssistencia.id,
    marca: document.getElementById('modal-eq-marca').value.trim() || null,
    modelo: document.getElementById('modal-eq-modelo').value.trim() || null,
    numero_serie: serie,
    created_by: currentUserId
  };

  var btn = this;
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  var result = await supabaseClient.from('equipamentos').insert(payload).select().single();
  btn.disabled = false;
  btn.textContent = 'Cadastrar equipamento';

  if (result.error) {
    errorEl.textContent = 'Erro ao cadastrar equipamento: ' + result.error.message;
    errorEl.style.display = 'block';
    return;
  }

  equipamentosCache.unshift(result.data);
  var select = document.getElementById('select-equipamento');
  select.innerHTML = '<option value="">— Selecione —</option>' + equipamentosCache.map(function (eq) {
    return '<option value="' + eq.id + '">' + equipamentoLabel(eq) + '</option>';
  }).join('');
  select.value = result.data.id;
  select.dispatchEvent(new Event('change', { bubbles: true }));

  document.getElementById('modal-cadastrar-equipamento').classList.remove('open');
  showToast('Equipamento cadastrado.', 'ok');
});

/* ===================== IMPORTAR EQUIPAMENTOS (BALANÇAS) VIA PLANILHA ===================== */

var COLUNAS_EQUIPAMENTO = [
  { titulo: 'Cliente (Razão Social ou CNPJ)', chave: 'cliente_ref' },
  { titulo: 'Marca', chave: 'marca' },
  { titulo: 'Modelo', chave: 'modelo' },
  { titulo: 'Número de Série', chave: 'numero_serie' }
];
var linhasImportacaoEquipamentoValidas = [];

function encontrarClientePorNomeOuCnpj(valor) {
  var texto = (valor || '').trim().toLowerCase();
  if (!texto) return null;
  var porNome = clientesCache.find(function (c) { return (c.razao_social || '').trim().toLowerCase() === texto; });
  if (porNome) return porNome;
  var digitos = texto.replace(/\D/g, '');
  if (!digitos) return null;
  return clientesCache.find(function (c) { return (c.cnpj_cpf || '').replace(/\D/g, '') === digitos; }) || null;
}

document.getElementById('btn-baixar-modelo-equipamento').addEventListener('click', function () {
  baixarModeloExcel('modelo-importacao-equipamentos.xlsx', COLUNAS_EQUIPAMENTO, [
    { cliente_ref: 'Empresa Exemplo LTDA', marca: 'Toledo', modelo: '9091-B/15', numero_serie: 'SN12345' }
  ]);
});

function abrirModalImportarEquipamento() {
  document.getElementById('importar-equipamento-arquivo').value = '';
  document.getElementById('importar-equipamento-preview').style.display = 'none';
  document.getElementById('importar-equipamento-preview').innerHTML = '';
  document.getElementById('importar-equipamento-error').style.display = 'none';
  document.getElementById('importar-equipamento-btn-confirmar').disabled = true;
  linhasImportacaoEquipamentoValidas = [];
  document.getElementById('modal-importar-equipamento').classList.add('open');
}

document.getElementById('btn-abrir-importar-equipamento').addEventListener('click', function () {
  if (!clientesCache.length) { showToast('Cadastre ao menos um cliente antes de importar equipamentos.', 'warning'); return; }
  abrirModalImportarEquipamento();
});

document.getElementById('importar-equipamento-btn-cancelar').addEventListener('click', function () {
  document.getElementById('modal-importar-equipamento').classList.remove('open');
});

document.getElementById('importar-equipamento-arquivo').addEventListener('change', async function (e) {
  var file = e.target.files[0];
  var previewEl = document.getElementById('importar-equipamento-preview');
  var errorEl = document.getElementById('importar-equipamento-error');
  var confirmarBtn = document.getElementById('importar-equipamento-btn-confirmar');
  errorEl.style.display = 'none';
  confirmarBtn.disabled = true;
  linhasImportacaoEquipamentoValidas = [];
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
    .map(function (linha) { return normalizarLinhaExcel(linha, COLUNAS_EQUIPAMENTO); })
    .filter(function (linha) { return linha.cliente_ref || linha.marca || linha.modelo || linha.numero_serie; });

  if (!linhas.length) {
    errorEl.textContent = 'Nenhuma linha com dados encontrada no arquivo.';
    errorEl.style.display = 'block';
    return;
  }

  var linhasProcessadas = linhas.map(function (linha) {
    var erros = [];
    var cliente = encontrarClientePorNomeOuCnpj(linha.cliente_ref);
    if (!cliente) erros.push('cliente não encontrado');
    if (!ALFANUMERICO_REGEX.test(linha.numero_serie)) erros.push('número de série inválido');
    return {
      cliente_ref: linha.cliente_ref, cliente_id: cliente ? cliente.id : null,
      marca: linha.marca || null, modelo: linha.modelo || null,
      numero_serie: linha.numero_serie, erros: erros
    };
  });

  linhasImportacaoEquipamentoValidas = linhasProcessadas.filter(function (l) { return !l.erros.length; });

  previewEl.style.display = 'block';
  previewEl.innerHTML = '<table class="admin-table"><thead><tr><th>Cliente</th><th>Marca</th><th>Modelo</th><th>Nº de Série</th><th>Status</th></tr></thead><tbody>' +
    linhasProcessadas.map(function (l) {
      var status = l.erros.length ? '<span class="badge badge-warning">' + l.erros.join(', ') + '</span>' : '<span class="badge badge-ok">OK</span>';
      return '<tr><td>' + (l.cliente_ref || '—') + '</td><td>' + (l.marca || '—') + '</td><td>' + (l.modelo || '—') + '</td><td>' + (l.numero_serie || '—') + '</td><td>' + status + '</td></tr>';
    }).join('') +
  '</tbody></table>';

  confirmarBtn.disabled = !linhasImportacaoEquipamentoValidas.length;
  if (!linhasImportacaoEquipamentoValidas.length) {
    errorEl.textContent = 'Nenhuma linha válida para importar. Corrija o arquivo e tente novamente.';
    errorEl.style.display = 'block';
  }
});

document.getElementById('importar-equipamento-btn-confirmar').addEventListener('click', async function () {
  var btn = this;
  btn.disabled = true;
  btn.textContent = 'Importando...';

  var importados = 0, atualizados = 0, comErro = 0;

  for (var i = 0; i < linhasImportacaoEquipamentoValidas.length; i++) {
    var linha = linhasImportacaoEquipamentoValidas[i];

    var existenteResult = await supabaseClient
      .from('equipamentos')
      .select('id')
      .eq('cliente_id', linha.cliente_id)
      .ilike('numero_serie', linha.numero_serie)
      .maybeSingle();
    var existente = existenteResult.data;

    var payload = { cliente_id: linha.cliente_id, marca: linha.marca, modelo: linha.modelo, numero_serie: linha.numero_serie };
    var result;
    if (existente) {
      result = await supabaseClient.from('equipamentos').update(payload).eq('id', existente.id);
      if (!result.error) atualizados++; else comErro++;
    } else {
      payload.created_by = currentUserId;
      result = await supabaseClient.from('equipamentos').insert(payload);
      if (!result.error) importados++; else comErro++;
    }
  }

  btn.disabled = false;
  btn.textContent = 'Importar linhas';

  document.getElementById('modal-importar-equipamento').classList.remove('open');
  showToast('Importação concluída: ' + importados + ' novo(s), ' + atualizados + ' atualizado(s)' + (comErro ? ', ' + comErro + ' com erro' : '') + '.', comErro ? 'warning' : 'ok');
  if (selectedClienteAssistencia) loadEquipamentosDoCliente(selectedClienteAssistencia.id);
});

/* ===================== HISTÓRICO DE ASSISTÊNCIAS DO CLIENTE ===================== */

document.getElementById('btn-ver-historico').addEventListener('click', function () {
  if (!selectedClienteAssistencia) return;
  document.getElementById('historico-cliente-nome').textContent = selectedClienteAssistencia.razao_social;
  document.getElementById('modal-historico').classList.add('open');
  loadHistoricoAssistencias(selectedClienteAssistencia.id, 'historico-conteudo');
});

document.getElementById('historico-btn-fechar').addEventListener('click', function () {
  document.getElementById('modal-historico').classList.remove('open');
});

/* ===================== PEÇA UTILIZADA (ESTOQUE) ===================== */

async function loadPecasSelect() {
  var { data, error } = await supabaseClient.from('estoque_pecas').select('*').order('codigo');
  if (error) { showToast('Erro ao carregar peças do estoque: ' + error.message, 'error'); return; }
  pecasCache = data || [];

  var select = document.getElementById('select-peca');
  select.innerHTML = '<option value="">— Nenhuma —</option>' + pecasCache.map(function (p) {
    return '<option value="' + p.id + '">' + p.codigo + ' — ' + (p.tipo_modelo || '').slice(0, 60) + ' (estoque: ' + formatarQuantidadeLocal(p.quantidade) + ')</option>';
  }).join('');
}

document.getElementById('select-peca').addEventListener('change', function (e) {
  var peca = pecasCache.find(function (p) { return p.id === e.target.value; });
  var infoEl = document.getElementById('peca-estoque-info');
  if (!peca) { infoEl.style.display = 'none'; return; }
  infoEl.textContent = 'Estoque atual: ' + formatarQuantidadeLocal(peca.quantidade) + (peca.localidade ? ' — Localidade: ' + peca.localidade : '');
  infoEl.style.display = 'block';
});

/* ===================== DESCRIÇÃO DO DEFEITO (contador) ===================== */

function atualizarContadorDescricao() {
  var valor = document.getElementById('descricao_defeito').value;
  document.getElementById('descricao-contador').textContent = valor.length;
}
document.getElementById('descricao_defeito').addEventListener('input', atualizarContadorDescricao);

/* ===================== RESOLUÇÃO / FECHAMENTO DO CHAMADO ===================== */

function atualizarContadorResolucao() {
  var valor = document.getElementById('resolucao').value;
  document.getElementById('resolucao-contador').textContent = valor.length;
}
document.getElementById('resolucao').addEventListener('input', atualizarContadorResolucao);

function atualizarHintResolucao() {
  var status = document.getElementById('status').value;
  var precisaFechar = STATUS_FECHAMENTO.indexOf(status) !== -1;
  document.getElementById('resolucao-obrigatoria-hint').style.display = precisaFechar ? 'inline' : 'none';
}
document.getElementById('status').addEventListener('change', atualizarHintResolucao);

/* ===================== LISTAGEM ===================== */

async function loadAssistencias() {
  var { data, error } = await supabaseClient
    .from('assistencias_tecnicas')
    .select('*, clientes(razao_social, nome_fantasia, cnpj_cpf, contato_nome, contato_telefone, logradouro, numero, complemento, bairro, municipio, uf), equipamentos(marca, modelo, numero_serie), estoque_pecas(codigo, tipo_modelo)')
    .order('created_at', { ascending: false });

  if (error) {
    showToast('Erro ao carregar assistências técnicas: ' + error.message, 'error');
    return;
  }

  allAssistencias = data || [];
  aplicarFiltrosAssistencias();
}

function nomeClienteAssistencia(a) {
  if (!a.clientes) return '—';
  return a.clientes.razao_social + (a.clientes.nome_fantasia ? ' (' + a.clientes.nome_fantasia + ')' : '');
}

function renderAssistenciasDashboard(list) {
  var container = document.getElementById('assistencia-dashboard');
  if (!list.length) {
    container.innerHTML = '<p style="color:var(--gray-400);">Nenhuma assistência técnica registrada ainda.</p>';
    return;
  }

  container.innerHTML = list.map(function (a) {
    var dataStr = new Date(a.created_at).toLocaleDateString('pt-BR');
    var badgeClass = STATUS_BADGE_CLASS[a.status] || 'badge-warning';
    var badgeText = STATUS_LABELS[a.status] || a.status;
    var sla = calcularSlaAssistencia(a);
    var resumo = (a.descricao_defeito || '').slice(0, 140) + ((a.descricao_defeito || '').length > 140 ? '…' : '');

    return '<div class="assistencia-card" data-id="' + a.id + '">' +
      '<div class="assistencia-card-topo">' +
        '<span class="sla-dot sla-' + sla.cor + '" title="' + sla.label + '"></span>' +
        '<strong>Nº ' + a.numero + '</strong>' +
        '<span class="badge ' + badgeClass + '">' + badgeText + '</span>' +
      '</div>' +
      '<div class="assistencia-card-cliente">' + nomeClienteAssistencia(a) + '</div>' +
      '<div class="assistencia-card-equip">' + equipamentoTexto(a) + ' — Série: ' + numeroSerieTexto(a) + '</div>' +
      '<p class="assistencia-card-resumo">' + (resumo || '—') + '</p>' +
      '<div class="assistencia-card-data">' + dataStr + '</div>' +
      '<div class="assistencia-card-acoes">' +
        '<button data-consultar="' + a.id + '">Consultar</button>' +
        '<button data-edit="' + a.id + '">Editar</button>' +
        (currentUserIsAdmin ? '<button data-delete="' + a.id + '" class="danger">Excluir</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');

  container.querySelectorAll('[data-consultar]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var assistencia = allAssistencias.find(function (a) { return a.id === btn.dataset.consultar; });
      if (!assistencia) return;
      document.getElementById('consultar-assistencia-conteudo').innerHTML = buildConsultaHtml(assistencia);
      document.getElementById('modal-consultar-assistencia').classList.add('open');
    });
  });

  container.querySelectorAll('[data-edit]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var assistencia = allAssistencias.find(function (a) { return a.id === btn.dataset.edit; });
      if (!assistencia) return;
      await preencherFormularioParaEdicao(assistencia);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  container.querySelectorAll('[data-delete]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      if (!currentUserIsAdmin) {
        showToast('Somente um usuário administrador pode excluir assistências técnicas.', 'warning');
        return;
      }
      if (!confirm('Excluir esta assistência técnica? A peça utilizada (se houver) volta para o estoque automaticamente. Essa ação não pode ser desfeita.')) return;
      var { error } = await supabaseClient.from('assistencias_tecnicas').delete().eq('id', btn.dataset.delete);
      if (error) {
        showToast('Erro ao excluir: ' + error.message, 'error');
        return;
      }
      showToast('Assistência técnica excluída.', 'ok');
      loadAssistencias();
      loadPecasSelect();
    });
  });
}

async function preencherFormularioParaEdicao(a) {
  assistenciaEmEdicaoId = a.id;
  document.getElementById('assistencia-id').value = a.id;

  document.getElementById('select-cliente').value = a.cliente_id || '';
  await selecionarCliente(a.cliente_id || '');

  var equipSelect = document.getElementById('select-equipamento');
  equipSelect.value = a.equipamento_id || '';
  selectedEquipamento = equipamentosCache.find(function (eq) { return eq.id === a.equipamento_id; }) || null;

  document.getElementById('descricao_defeito').value = a.descricao_defeito || '';
  document.getElementById('selo_antigo').value = a.selo_antigo || '';
  document.getElementById('selo_novo').value = a.selo_novo || '';
  document.getElementById('lacre_antigo').value = a.lacre_antigo || '';
  document.getElementById('lacre_novo').value = a.lacre_novo || '';
  document.getElementById('status').value = a.status || 'aberta';
  document.getElementById('resolucao').value = a.resolucao || '';
  assistenciaStatusCarregado = a.status || 'aberta';
  assistenciaPausadoEmCarregado = a.pausado_em || null;

  if (!pecasCache.length) await loadPecasSelect();
  document.getElementById('select-peca').value = a.peca_id || '';
  document.getElementById('quantidade_peca_utilizada').value = a.quantidade_peca_utilizada != null ? formatarQuantidadeLocal(a.quantidade_peca_utilizada) : '';
  document.getElementById('select-peca').dispatchEvent(new Event('change', { bubbles: true }));

  var alertaEl = document.getElementById('alerta-equipamento-historico');
  if (selectedEquipamento) {
    var count = await contarAssistenciasPorEquipamento(selectedEquipamento.id, a.id);
    if (count > 0) {
      alertaEl.textContent = '⚠️ Este equipamento já tem ' + count + ' assistência' + (count > 1 ? 's' : '') + ' técnica' + (count > 1 ? 's' : '') + ' registrada' + (count > 1 ? 's' : '') + '.';
      alertaEl.style.display = 'block';
    } else {
      alertaEl.style.display = 'none';
    }
  }

  atualizarContadorDescricao();
  atualizarContadorResolucao();
  atualizarHintResolucao();
  document.getElementById('form-title').textContent = 'Editar assistência técnica nº ' + a.numero;
  document.getElementById('pagina-titulo').textContent = 'Editando Assistência Técnica nº ' + a.numero;
  document.getElementById('edicao-banner-texto').textContent = '✏️ Editando Assistência Técnica nº ' + a.numero;
  document.getElementById('edicao-banner').style.display = 'block';
  document.getElementById('assistencia-save-btn').textContent = 'Salvar alterações';
}

/* Suporte a assistencia-tecnica.html?editar=ID, e chamado pelo histórico do cliente em clientes.html */
async function iniciarEdicaoAssistencia(assistenciaId) {
  var { data, error } = await supabaseClient
    .from('assistencias_tecnicas')
    .select('*')
    .eq('id', assistenciaId)
    .single();

  if (error || !data) {
    showToast('Não foi possível carregar esse registro para edição.', 'error');
    return;
  }

  if (!clientesCache.length) await loadClientesSelect();
  await preencherFormularioParaEdicao(data);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.iniciarEdicaoAssistencia = iniciarEdicaoAssistencia;

var filtroStatusAtual = '';

function aplicarFiltrosAssistencias() {
  var term = document.getElementById('assistencia-search').value.toLowerCase();
  var filtered = allAssistencias.filter(function (a) {
    var passaStatus = !filtroStatusAtual || a.status === filtroStatusAtual;
    var passaBusca = !term ||
      nomeClienteAssistencia(a).toLowerCase().includes(term) ||
      numeroSerieTexto(a).toLowerCase().includes(term) ||
      equipamentoTexto(a).toLowerCase().includes(term) ||
      String(a.numero).includes(term);
    return passaStatus && passaBusca;
  });
  renderAssistenciasDashboard(filtered);
}

document.getElementById('assistencia-search').addEventListener('input', aplicarFiltrosAssistencias);

document.querySelectorAll('.filtro-status-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.filtro-status-btn').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    filtroStatusAtual = btn.dataset.status;
    aplicarFiltrosAssistencias();
  });
});

/* ===================== SALVAR ===================== */

function validarCampoAlfanumerico(id, label, errorEl, obrigatorio) {
  var valor = document.getElementById(id).value.trim();
  if (!valor) {
    if (obrigatorio) {
      errorEl.textContent = label + ' é obrigatório.';
      errorEl.style.display = 'block';
      return null;
    }
    return '';
  }
  if (!ALFANUMERICO_REGEX.test(valor)) {
    errorEl.textContent = label + ' deve conter apenas letras e números (sem espaços ou símbolos), até 20 caracteres.';
    errorEl.style.display = 'block';
    return null;
  }
  return valor;
}

function validarAssistencia(errorEl) {
  errorEl.style.display = 'none';

  if (!document.getElementById('select-cliente').value) {
    errorEl.textContent = 'Selecione um cliente.';
    errorEl.style.display = 'block';
    return false;
  }
  if (!document.getElementById('select-equipamento').value) {
    errorEl.textContent = 'Selecione (ou cadastre) o equipamento.';
    errorEl.style.display = 'block';
    return false;
  }
  var descricaoDefeito = document.getElementById('descricao_defeito').value.trim();
  if (!descricaoDefeito) {
    errorEl.textContent = 'Descrição do defeito é obrigatória.';
    errorEl.style.display = 'block';
    return false;
  }
  if (descricaoDefeito.length > 5000) {
    errorEl.textContent = 'Descrição do defeito excede o limite de 5000 caracteres.';
    errorEl.style.display = 'block';
    return false;
  }

  var pecaId = document.getElementById('select-peca').value;
  var quantidadePecaStr = document.getElementById('quantidade_peca_utilizada').value.trim();
  if (pecaId && !quantidadePecaStr) {
    errorEl.textContent = 'Informe a quantidade utilizada da peça selecionada.';
    errorEl.style.display = 'block';
    return false;
  }
  if (quantidadePecaStr && !pecaId) {
    errorEl.textContent = 'Selecione a peça correspondente à quantidade informada.';
    errorEl.style.display = 'block';
    return false;
  }
  if (quantidadePecaStr && !QUANTIDADE_PECA_REGEX.test(quantidadePecaStr)) {
    errorEl.textContent = 'Quantidade da peça inválida. Use até 5 caracteres, números e ponto como separador decimal.';
    errorEl.style.display = 'block';
    return false;
  }

  var status = document.getElementById('status').value;
  var resolucao = document.getElementById('resolucao').value.trim();
  if (STATUS_FECHAMENTO.indexOf(status) !== -1 && !resolucao) {
    errorEl.textContent = 'Informe a Resolução para fechar o chamado como "' + STATUS_LABELS[status] + '".';
    errorEl.style.display = 'block';
    return false;
  }
  if (resolucao.length > 5000) {
    errorEl.textContent = 'Resolução excede o limite de 5000 caracteres.';
    errorEl.style.display = 'block';
    return false;
  }

  return true;
}

async function salvarAssistencia() {
  var errorEl = document.getElementById('assistencia-error');
  if (!validarAssistencia(errorEl)) return null;

  var clienteId = document.getElementById('select-cliente').value;
  var equipamentoId = document.getElementById('select-equipamento').value;
  var descricaoDefeito = document.getElementById('descricao_defeito').value.trim();

  var seloAntigo = validarCampoAlfanumerico('selo_antigo', 'Selo antigo', errorEl, false);
  if (seloAntigo === null) return null;
  var seloNovo = validarCampoAlfanumerico('selo_novo', 'Selo novo', errorEl, false);
  if (seloNovo === null) return null;
  var lacreAntigo = validarCampoAlfanumerico('lacre_antigo', 'Lacre antigo', errorEl, false);
  if (lacreAntigo === null) return null;
  var lacreNovo = validarCampoAlfanumerico('lacre_novo', 'Lacre novo', errorEl, false);
  if (lacreNovo === null) return null;

  var statusValor = document.getElementById('status').value || 'aberta';
  var resolucao = document.getElementById('resolucao').value.trim();

  var pecaId = document.getElementById('select-peca').value || null;
  var quantidadePecaStr = document.getElementById('quantidade_peca_utilizada').value.trim();
  var quantidadePeca = quantidadePecaStr ? parseFloat(quantidadePecaStr) : null;

  if (statusValor === 'nao_aprovada' && pecaId) {
    // Reparo não aprovado pelo cliente: nenhuma peça foi de fato utilizada,
    // então não faz sentido manter a baixa no estoque.
    showToast('Cliente não aprovou o reparo — a peça selecionada foi removida do chamado e o estoque não será afetado.', 'warning');
    pecaId = null;
    quantidadePeca = null;
    document.getElementById('select-peca').value = '';
    document.getElementById('quantidade_peca_utilizada').value = '';
  } else if (pecaId) {
    var peca = pecasCache.find(function (p) { return p.id === pecaId; });
    if (peca && quantidadePeca > parseFloat(peca.quantidade)) {
      showToast('Atenção: a quantidade utilizada é maior que o estoque atual dessa peça (' + formatarQuantidadeLocal(peca.quantidade) + '). O estoque vai ficar negativo.', 'warning');
    }
  }

  // "Pendente" congela o prazo: guarda o momento em que entrou nesse status pela
  // primeira vez, e preserva esse momento em salvamentos seguintes enquanto continuar
  // pendente. Ao sair do pendente, o congelamento é limpo.
  var pausadoEm = null;
  if (statusValor === 'pendente') {
    pausadoEm = (assistenciaStatusCarregado === 'pendente' && assistenciaPausadoEmCarregado)
      ? assistenciaPausadoEmCarregado
      : new Date().toISOString();
  }

  var payload = {
    cliente_id: clienteId,
    equipamento_id: equipamentoId,
    descricao_defeito: descricaoDefeito,
    selo_antigo: seloAntigo || null,
    selo_novo: seloNovo || null,
    lacre_antigo: lacreAntigo || null,
    lacre_novo: lacreNovo || null,
    status: statusValor,
    resolucao: resolucao || null,
    peca_id: pecaId,
    quantidade_peca_utilizada: quantidadePeca,
    pausado_em: pausadoEm
  };

  var assistenciaId = document.getElementById('assistencia-id').value;
  var result;

  if (assistenciaId) {
    result = await supabaseClient.from('assistencias_tecnicas').update(payload).eq('id', assistenciaId).select().single();
  } else {
    payload.created_by = currentUserId;
    result = await supabaseClient.from('assistencias_tecnicas').insert(payload).select().single();
  }

  if (result.error) {
    errorEl.textContent = 'Erro ao salvar: ' + result.error.message;
    errorEl.style.display = 'block';
    return null;
  }

  assistenciaEmEdicaoId = result.data.id;
  assistenciaStatusCarregado = result.data.status;
  assistenciaPausadoEmCarregado = result.data.pausado_em;
  document.getElementById('assistencia-id').value = result.data.id;
  return result.data;
}

document.getElementById('assistencia-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var saveBtn = document.getElementById('assistencia-save-btn');
  var estavaEditando = !!assistenciaEmEdicaoId;

  saveBtn.disabled = true;
  saveBtn.textContent = 'Salvando...';

  var assistencia = await salvarAssistencia();

  saveBtn.disabled = false;
  saveBtn.textContent = assistenciaEmEdicaoId ? 'Salvar alterações' : 'Salvar assistência técnica';

  if (!assistencia) return;

  showToast((estavaEditando ? 'Assistência técnica nº ' + assistencia.numero + ' atualizada com sucesso.' : 'Assistência técnica nº ' + assistencia.numero + ' salva com sucesso.'), 'ok');
  resetForm();
  loadAssistencias();
  loadPecasSelect();
});

document.getElementById('assistencia-cancel-btn').addEventListener('click', resetForm);

/* ===================== CONSULTAR (OS somente leitura) ===================== */

document.getElementById('consultar-assistencia-btn-fechar').addEventListener('click', function () {
  document.getElementById('modal-consultar-assistencia').classList.remove('open');
});

function buildConsultaHtml(a) {
  var cliente = a.clientes || {};
  var equipamento = a.equipamentos || {};
  var peca = a.estoque_pecas || null;
  var dataStr = new Date(a.created_at).toLocaleDateString('pt-BR');
  var enderecoCompleto = [
    cliente.logradouro, cliente.numero, cliente.complemento, cliente.bairro, cliente.municipio, cliente.uf
  ].filter(Boolean).join(', ');
  var sla = calcularSlaAssistencia(a);

  return '<p><strong>Nº:</strong> ' + a.numero + ' &nbsp; <strong>Status:</strong> <span class="badge ' + (STATUS_BADGE_CLASS[a.status] || 'badge-warning') + '">' + (STATUS_LABELS[a.status] || a.status) + '</span> ' +
      '&nbsp; <span class="sla-dot sla-' + sla.cor + '" title="' + sla.label + '" style="display:inline-block; vertical-align:middle;"></span> <span style="font-size:0.85rem; color:var(--gray-400);">' + sla.label + '</span></p>' +
    '<p><strong>Data de abertura:</strong> ' + dataStr + '</p>' +
    '<p><strong>Cliente:</strong> ' + (cliente.razao_social || '') + (cliente.nome_fantasia ? ' (' + cliente.nome_fantasia + ')' : '') + '</p>' +
    (enderecoCompleto ? '<p><strong>Endereço:</strong> ' + enderecoCompleto + '</p>' : '') +
    '<p><strong>CNPJ/CPF:</strong> ' + (cliente.cnpj_cpf || '—') + ' &nbsp; <strong>Contato:</strong> ' + (cliente.contato_nome || '—') + (cliente.contato_telefone ? ' — ' + cliente.contato_telefone : '') + '</p>' +
    '<p><strong>Equipamento:</strong> ' + ([equipamento.marca, equipamento.modelo].filter(Boolean).join(' ') || '—') + ' &nbsp; <strong>Nº de Série:</strong> ' + (equipamento.numero_serie || '—') + '</p>' +
    '<p><strong>Descrição do Defeito:</strong><br>' + (a.descricao_defeito || '—').replace(/\n/g, '<br>') + '</p>' +
    (peca ? '<p><strong>Peça utilizada:</strong> ' + peca.codigo + ' — ' + peca.tipo_modelo + ' &nbsp; <strong>Qtd:</strong> ' + formatarQuantidadeLocal(a.quantidade_peca_utilizada) + '</p>' : '') +
    '<p><strong>Selo:</strong> antigo ' + (a.selo_antigo || '—') + ' / novo ' + (a.selo_novo || '—') + ' &nbsp; <strong>Lacre:</strong> antigo ' + (a.lacre_antigo || '—') + ' / novo ' + (a.lacre_novo || '—') + '</p>' +
    (a.resolucao ? '<p><strong>Resolução:</strong><br>' + a.resolucao.replace(/\n/g, '<br>') + '</p>' : '');
}

/* ===================== IMPRESSÃO (2 vias) ===================== */

function buildAssistenciaViaHtml(assistencia, label) {
  var dataStr = new Date(assistencia.created_at || Date.now()).toLocaleDateString('pt-BR');
  var cliente = selectedClienteAssistencia || {};
  var equipamento = selectedEquipamento || {};
  var enderecoCompleto = [
    cliente.logradouro, cliente.numero, cliente.complemento, cliente.bairro, cliente.municipio, cliente.uf
  ].filter(Boolean).join(', ');

  return '<div class="print-via">' +
    '<div class="print-header"><div><h2>Assistência Técnica nº ' + (assistencia.numero || '') + ' — ' + EMPRESA_CONFIG.nome + '</h2>Data: ' + dataStr + '</div>' +
    '<div class="print-via-label">Via ' + label + '</div></div>' +
    '<p><strong>CLIENTE:</strong> ' + (cliente.razao_social || '') + (cliente.nome_fantasia ? ' (' + cliente.nome_fantasia + ')' : '') + '</p>' +
    '<p><strong>ENDEREÇO:</strong> ' + enderecoCompleto + '</p>' +
    '<p><strong>CNPJ/CPF:</strong> ' + (cliente.cnpj_cpf || '') + ' &nbsp; <strong>CONTATO:</strong> ' + (cliente.contato_nome || '') + ' &nbsp; <strong>TEL:</strong> ' + (cliente.contato_telefone || '') + '</p>' +
    '<p><strong>MARCA / MODELO:</strong> ' + ([equipamento.marca, equipamento.modelo].filter(Boolean).join(' ') || '—') + ' &nbsp; <strong>Nº DE SÉRIE:</strong> ' + (equipamento.numero_serie || '—') + '</p>' +
    '<p><strong>DESCRIÇÃO DO DEFEITO:</strong><br>' + (assistencia.descricao_defeito || '').replace(/\n/g, '<br>') + '</p>' +
    '<p><strong>SELO ANTIGO:</strong> ' + (assistencia.selo_antigo || '—') + ' &nbsp; <strong>SELO NOVO:</strong> ' + (assistencia.selo_novo || '—') + '</p>' +
    '<p><strong>LACRE ANTIGO:</strong> ' + (assistencia.lacre_antigo || '—') + ' &nbsp; <strong>LACRE NOVO:</strong> ' + (assistencia.lacre_novo || '—') + '</p>' +
    '<p><strong>STATUS:</strong> ' + (STATUS_LABELS[assistencia.status] || assistencia.status || '') + '</p>' +
    (assistencia.resolucao ? '<p><strong>RESOLUÇÃO:</strong><br>' + assistencia.resolucao.replace(/\n/g, '<br>') + '</p>' : '') +
    '<div style="margin-top:40px; padding-top:10px; border-top:1px solid #000;">Assinatura do Cliente: _______________________________________________ &nbsp;&nbsp; Data: ___/___/_____</div>' +
  '</div>';
}

var originalDocumentTitleAssistencia = document.title;

document.getElementById('btn-imprimir').addEventListener('click', async function () {
  var errorEl = document.getElementById('assistencia-error');
  if (!validarAssistencia(errorEl)) return;
  if (!selectedClienteAssistencia || !selectedEquipamento) {
    showToast('Selecione o cliente e o equipamento antes de imprimir.', 'warning');
    return;
  }

  var btn = this;
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  var assistencia = await salvarAssistencia();
  btn.disabled = false;
  btn.textContent = 'Imprimir (2 vias)';

  if (!assistencia) return;

  document.getElementById('print-sheet').innerHTML = buildAssistenciaViaHtml(assistencia, 'Cliente') + buildAssistenciaViaHtml(assistencia, 'Empresa');

  document.title = (selectedClienteAssistencia.razao_social || 'Assistencia') + ' - CRP';
  window.print();

  showToast('Assistência técnica nº ' + assistencia.numero + ' salva e enviada para impressão.', 'ok');
  loadAssistencias();
  loadPecasSelect();
});

window.addEventListener('afterprint', function () {
  document.title = originalDocumentTitleAssistencia;
});

/* ===================== INIT ===================== */

(async function () {
  var auth = await window.ADMIN_AUTH_READY;
  if (!auth) return;
  currentUserId = auth.session.user.id;
  currentUserIsAdmin = !!auth.profile.is_admin;
  await loadClientesSelect();
  await loadPecasSelect();
  await loadAssistencias();
  atualizarContadorDescricao();

  // Recalcula os bullets de prazo periodicamente, sem precisar recarregar do banco.
  setInterval(aplicarFiltrosAssistencias, 60000);

  var params = new URLSearchParams(location.search);
  var editarId = params.get('editar');
  if (editarId) {
    iniciarEdicaoAssistencia(editarId);
  }
})();
