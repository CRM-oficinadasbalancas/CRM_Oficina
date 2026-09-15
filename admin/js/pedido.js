var currentUserId = null;
var clientesCache = [];
var catalogoCache = [];
var selectedCliente = null;
var vacuoItems = [];
var geraisItems = [];
var valorTotalManuallyEdited = false;
var valorVistaManuallyEdited = false;
var pedidoEmEdicaoId = null;

function uid() {
  return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toNumber(v) {
  var n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function formatBRL(n) {
  return 'R$ ' + toNumber(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcVacuo(item) {
  var peso = item.largura_m * item.comprimento_m * item.espessura_micras;
  var pesoTotal = peso * item.quantidade;
  var vlUnitario = peso * item.taxa_preco_peso;
  var vlTotal = item.quantidade * vlUnitario;
  return { peso: peso, peso_total: pesoTotal, vl_unitario: vlUnitario, vl_total: vlTotal };
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

document.getElementById('select-cliente').addEventListener('change', function (e) {
  var id = e.target.value;
  selectedCliente = clientesCache.find(function (c) { return c.id === id; }) || null;
  var resumo = document.getElementById('cliente-resumo');

  if (!selectedCliente) {
    resumo.style.display = 'none';
    document.getElementById('alerta-orcamento-pendente').style.display = 'none';
    return;
  }

  var enderecoPartes = [
    selectedCliente.logradouro, selectedCliente.numero, selectedCliente.complemento,
    selectedCliente.bairro, selectedCliente.municipio, selectedCliente.uf
  ].filter(Boolean).join(', ');

  document.getElementById('cliente-resumo-texto').innerHTML =
    '<strong>' + selectedCliente.razao_social + '</strong><br>' +
    (enderecoPartes ? enderecoPartes + '<br>' : '') +
    (selectedCliente.cnpj_cpf ? 'CNPJ/CPF: ' + selectedCliente.cnpj_cpf + '<br>' : '') +
    (selectedCliente.contato_nome ? 'Contato: ' + selectedCliente.contato_nome +
      (selectedCliente.contato_telefone ? ' — ' + selectedCliente.contato_telefone : '') + '<br>' : '') +
    (selectedCliente.local_entrega_preferencial ? '<strong>Entregar em:</strong> ' + selectedCliente.local_entrega_preferencial + '<br>' : '') +
    (selectedCliente.observacoes ? '<strong>Observações:</strong> ' + selectedCliente.observacoes + '<br>' : '');
  resumo.style.display = 'block';

  // Pré-preenche a forma de pagamento com a particularidade cadastrada do cliente
  if (selectedCliente.forma_pagamento_padrao) {
    var formaSelect = document.getElementById('forma_pagamento');
    formaSelect.value = selectedCliente.forma_pagamento_padrao;
    formaSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  atualizarAlertaOrcamentosPendentes();
});

/* ===================== HISTÓRICO DE COMPRAS + ALERTA DE ORÇAMENTO PENDENTE ===================== */

document.getElementById('btn-ver-historico').addEventListener('click', function () {
  if (!selectedCliente) return;
  document.getElementById('historico-cliente-nome').textContent = selectedCliente.razao_social;
  document.getElementById('modal-historico').classList.add('open');
  loadHistoricoCliente(selectedCliente.id, 'historico-conteudo', atualizarAlertaOrcamentosPendentes);
});

document.getElementById('historico-btn-fechar').addEventListener('click', function () {
  document.getElementById('modal-historico').classList.remove('open');
});

async function atualizarAlertaOrcamentosPendentes() {
  var alertaEl = document.getElementById('alerta-orcamento-pendente');
  if (!selectedCliente) { alertaEl.style.display = 'none'; return; }

  var pendentes = await contarOrcamentosPendentes(selectedCliente.id);
  if (pendentes > 0) {
    alertaEl.textContent = '⚠️ Este cliente tem ' + pendentes + ' orçamento' + (pendentes > 1 ? 's' : '') + ' pendente' + (pendentes > 1 ? 's' : '') + ' aguardando virar pedido. Veja no histórico de compras.';
    alertaEl.style.display = 'block';
  } else {
    alertaEl.style.display = 'none';
  }
}

/* ===================== ITENS VÁCUO ===================== */

function renderVacuoRow(item) {
  var row = document.createElement('div');
  row.className = 'item-row';
  row.dataset.id = item._id;

  row.innerHTML =
    '<div class="form-field"><label class="item-row-label">Material</label><input type="text" data-f="material" placeholder="Ex: NYLON POLI" value="' + (item.material || '') + '"></div>' +
    '<div class="form-field"><label class="item-row-label">Larg. (m)</label><input type="number" step="0.001" data-f="largura_m" value="' + item.largura_m + '"></div>' +
    '<div class="form-field"><label class="item-row-label">Comp. (m)</label><input type="number" step="0.001" data-f="comprimento_m" value="' + item.comprimento_m + '"></div>' +
    '<div class="form-field"><label class="item-row-label">Esp. (µ)</label><input type="number" step="0.1" data-f="espessura_micras" value="' + item.espessura_micras + '"></div>' +
    '<div class="form-field"><label class="item-row-label">Tipo</label><input type="text" data-f="tipo" placeholder="Ex: NATURAL" value="' + (item.tipo || '') + '"></div>' +
    '<div class="form-field"><label class="item-row-label">Qtd.</label><input type="number" step="1" data-f="quantidade" value="' + item.quantidade + '"></div>' +
    '<div class="form-field"><label class="item-row-label">Peso</label><span class="calc-readout" data-out="peso">0</span></div>' +
    '<div class="form-field"><label class="item-row-label">Fator</label><input type="number" step="0.01" data-f="taxa_preco_peso" value="' + item.taxa_preco_peso + '"></div>' +
    '<div class="form-field"><label class="item-row-label">Vl. Total</label><span class="calc-readout" data-out="vl_total">R$ 0,00</span></div>' +
    '<button type="button" class="item-remove" title="Remover item">✕</button>';

  row.querySelectorAll('[data-f]').forEach(function (input) {
    input.addEventListener('input', function () {
      var field = input.dataset.f;
      item[field] = (input.type === 'number') ? toNumber(input.value) : input.value;
      updateVacuoRowReadout(row, item);
      updateTotals();
    });
  });

  row.querySelector('.item-remove').addEventListener('click', function () {
    vacuoItems = vacuoItems.filter(function (i) { return i._id !== item._id; });
    row.remove();
    updateTotals();
  });

  document.getElementById('vacuo-items').appendChild(row);
  updateVacuoRowReadout(row, item);
}

function updateVacuoRowReadout(row, item) {
  var calc = calcVacuo(item);
  row.querySelector('[data-out="peso"]').textContent = calc.peso.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  row.querySelector('[data-out="vl_total"]').textContent = formatBRL(calc.vl_total);
}

document.getElementById('btn-add-vacuo').addEventListener('click', function () {
  var item = {
    _id: uid(), item: 'SACO A VÁCUO', material: '', largura_m: 0, comprimento_m: 0,
    espessura_micras: 0, tipo: '', quantidade: 0, taxa_preco_peso: 0
  };
  vacuoItems.push(item);
  renderVacuoRow(item);
});

/* ===================== ITENS GERAIS ===================== */

function renderGeraisItems() {
  var container = document.getElementById('gerais-items');
  if (!geraisItems.length) {
    container.innerHTML = '<p style="color:var(--gray-400); font-size:0.88rem;">Nenhum item adicionado ainda.</p>';
    return;
  }

  container.innerHTML = geraisItems.map(function (g) {
    var precoTotal = g.preco_unitario * g.quantidade;
    var pendencias = [];
    if (!g.codigo_produto) pendencias.push('Código');
    if (!g.ncm) pendencias.push('NCM');
    var badge = pendencias.length ? '<span class="badge badge-warning">' + pendencias.join(' + ') + ' pendente</span>' : '';

    return '<div class="items-gerais-row" data-id="' + g._id + '">' +
      '<div><strong>' + g.nome_produto + '</strong><br>' + badge + '</div>' +
      '<div>Cód: ' + (g.codigo_produto || '—') + '</div>' +
      '<div>NCM: ' + (g.ncm || '—') + '</div>' +
      '<div>Unit.: ' + formatBRL(g.preco_unitario) + '</div>' +
      '<div>Qtd: ' + g.quantidade + '</div>' +
      '<div>Total: ' + formatBRL(precoTotal) + '</div>' +
      '<button type="button" class="item-remove" title="Remover item">✕</button>' +
    '</div>';
  }).join('');

  container.querySelectorAll('.item-remove').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.closest('[data-id]').dataset.id;
      geraisItems = geraisItems.filter(function (g) { return g._id !== id; });
      renderGeraisItems();
      updateTotals();
    });
  });
}

/* ===================== MODAL CADASTRO (produto novo) ===================== */

function openModal() {
  document.getElementById('modal-nome').value = '';
  document.getElementById('modal-codigo').value = '';
  document.getElementById('modal-ncm').value = '';
  document.getElementById('modal-preco').value = '';
  document.getElementById('modal-quantidade').value = '';
  document.getElementById('modal-salvar-catalogo').checked = true;
  document.getElementById('modal-error').style.display = 'none';
  document.getElementById('modal-cadastro').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-cadastro').classList.remove('open');
}

document.getElementById('btn-open-cadastro').addEventListener('click', openModal);
document.getElementById('modal-btn-cancelar').addEventListener('click', closeModal);

document.getElementById('modal-btn-adicionar').addEventListener('click', async function () {
  var nome = document.getElementById('modal-nome').value.trim();
  var errorEl = document.getElementById('modal-error');
  errorEl.style.display = 'none';

  if (!nome) {
    errorEl.textContent = 'Nome do Produto é obrigatório.';
    errorEl.style.display = 'block';
    return;
  }

  var codigo = document.getElementById('modal-codigo').value.trim();
  var ncm = document.getElementById('modal-ncm').value.trim();
  var preco = toNumber(document.getElementById('modal-preco').value);
  var quantidade = toNumber(document.getElementById('modal-quantidade').value);
  var salvarCatalogo = document.getElementById('modal-salvar-catalogo').checked;
  var produtoCatalogoId = null;

  if (!codigo || !ncm) {
    var faltando = [];
    if (!codigo) faltando.push('Código');
    if (!ncm) faltando.push('NCM');
    showToast('Lembre de preencher depois: ' + faltando.join(' e ') + '.', 'warning');
  }

  if (salvarCatalogo) {
    var { data, error } = await supabaseClient.from('produtos_catalogo').insert({
      nome_produto: nome, codigo_produto: codigo || null, ncm: ncm || null,
      preco_unitario: preco || null, created_by: currentUserId
    }).select().single();
    if (!error && data) produtoCatalogoId = data.id;
  }

  geraisItems.push({
    _id: uid(), produto_catalogo_id: produtoCatalogoId, nome_produto: nome,
    codigo_produto: codigo || null, ncm: ncm || null, preco_unitario: preco, quantidade: quantidade
  });

  renderGeraisItems();
  updateTotals();
  closeModal();
});

/* ===================== MODAL SELECIONAR (produto já cadastrado) ===================== */

async function loadCatalogoParaSelecionar() {
  var { data, error } = await supabaseClient.from('produtos_catalogo').select('*').order('nome_produto');
  if (error) return;
  catalogoCache = data || [];

  var select = document.getElementById('select-produto-existente');
  if (!catalogoCache.length) {
    select.innerHTML = '<option value="">Nenhum produto cadastrado ainda</option>';
    return;
  }
  select.innerHTML = '<option value="">— Selecione —</option>' + catalogoCache.map(function (p) {
    return '<option value="' + p.id + '">' + p.nome_produto + '</option>';
  }).join('');
}

function openSelecionarModal() {
  document.getElementById('select-produto-existente').value = '';
  document.getElementById('select-produto-codigo-readout').textContent = '—';
  document.getElementById('select-produto-ncm-readout').textContent = '—';
  document.getElementById('select-produto-preco-readout').textContent = '—';
  document.getElementById('select-produto-quantidade').value = '';
  document.getElementById('selecionar-error').style.display = 'none';
  document.getElementById('modal-selecionar').classList.add('open');
}

function closeSelecionarModal() {
  document.getElementById('modal-selecionar').classList.remove('open');
}

document.getElementById('btn-open-selecionar').addEventListener('click', function () {
  loadCatalogoParaSelecionar();
  openSelecionarModal();
});
document.getElementById('selecionar-btn-cancelar').addEventListener('click', closeSelecionarModal);

document.getElementById('select-produto-existente').addEventListener('change', function (e) {
  var produto = catalogoCache.find(function (p) { return p.id === e.target.value; });
  document.getElementById('select-produto-codigo-readout').textContent = produto && produto.codigo_produto ? produto.codigo_produto : '—';
  document.getElementById('select-produto-ncm-readout').textContent = produto && produto.ncm ? produto.ncm : '—';
  document.getElementById('select-produto-preco-readout').textContent = produto ? formatBRL(produto.preco_unitario || 0) : '—';
});

document.getElementById('selecionar-btn-adicionar').addEventListener('click', function () {
  var errorEl = document.getElementById('selecionar-error');
  errorEl.style.display = 'none';

  var produtoId = document.getElementById('select-produto-existente').value;
  var produto = catalogoCache.find(function (p) { return p.id === produtoId; });
  if (!produto) {
    errorEl.textContent = 'Selecione um produto cadastrado.';
    errorEl.style.display = 'block';
    return;
  }

  var quantidade = toNumber(document.getElementById('select-produto-quantidade').value);
  if (quantidade <= 0) {
    errorEl.textContent = 'Informe a quantidade.';
    errorEl.style.display = 'block';
    return;
  }

  geraisItems.push({
    _id: uid(), produto_catalogo_id: produto.id, nome_produto: produto.nome_produto,
    codigo_produto: produto.codigo_produto, ncm: produto.ncm,
    preco_unitario: produto.preco_unitario || 0, quantidade: quantidade
  });

  renderGeraisItems();
  updateTotals();
  closeSelecionarModal();
});

/* ===================== PAGAMENTO / TOTAIS ===================== */

function deveMostrarDescontoVista() {
  var forma = document.getElementById('forma_pagamento').value;
  return forma === 'a_vista' || forma === 'pix';
}

document.getElementById('forma_pagamento').addEventListener('change', function (e) {
  var v = e.target.value;
  document.getElementById('boleto-quantidade-field').style.display = v === 'boleto' ? 'flex' : 'none';
  document.getElementById('boleto-dias-field').style.display = v === 'boleto' ? 'flex' : 'none';
  document.getElementById('cartao-parcelas-field').style.display = v === 'cartao_credito' ? 'flex' : 'none';
  var mostrarVista = deveMostrarDescontoVista();
  document.getElementById('desconto-vista-field').style.display = mostrarVista ? 'flex' : 'none';
  document.getElementById('valor-vista-field').style.display = mostrarVista ? 'flex' : 'none';
  atualizarValorVista();
});

document.getElementById('valor_total_a_pagar').addEventListener('input', function () {
  valorTotalManuallyEdited = true;
  atualizarValorVista();
});

document.getElementById('desconto_percentual').addEventListener('input', function () {
  valorVistaManuallyEdited = false;
  atualizarValorVista();
});

document.getElementById('valor_total_a_pagar_vista').addEventListener('input', function () {
  valorVistaManuallyEdited = true;
});

function atualizarValorVista() {
  if (valorVistaManuallyEdited) return;
  var valorCheio = toNumber(document.getElementById('valor_total_a_pagar').value);
  var desconto = toNumber(document.getElementById('desconto_percentual').value);
  document.getElementById('valor_total_a_pagar_vista').value = (valorCheio * (1 - desconto / 100)).toFixed(2);
}

function updateTotals() {
  var qtdTotal = 0, pesoTotal = 0, valorItens = 0;

  vacuoItems.forEach(function (item) {
    var calc = calcVacuo(item);
    qtdTotal += item.quantidade;
    pesoTotal += calc.peso_total;
    valorItens += calc.vl_total;
  });

  geraisItems.forEach(function (g) {
    qtdTotal += g.quantidade;
    valorItens += g.preco_unitario * g.quantidade;
  });

  document.getElementById('total-quantidade').textContent = qtdTotal.toLocaleString('pt-BR');
  document.getElementById('total-peso').textContent = pesoTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  document.getElementById('total-itens').textContent = formatBRL(valorItens);

  if (!valorTotalManuallyEdited) {
    document.getElementById('valor_total_a_pagar').value = valorItens.toFixed(2);
  }
  atualizarValorVista();
}

/* ===================== SALVAR PEDIDO / ORÇAMENTO ===================== */

function validarPedido(errorEl) {
  errorEl.style.display = 'none';

  if (!selectedCliente) {
    errorEl.textContent = 'Selecione um cliente antes de continuar.';
    errorEl.style.display = 'block';
    return false;
  }
  if (!vacuoItems.length && !geraisItems.length) {
    errorEl.textContent = 'Adicione ao menos um item ao pedido.';
    errorEl.style.display = 'block';
    return false;
  }
  if (!document.getElementById('forma_pagamento').value) {
    errorEl.textContent = 'Selecione a forma de pagamento.';
    errorEl.style.display = 'block';
    return false;
  }
  return true;
}

async function salvarPedidoNoBanco(tipo, statusOrcamento) {
  var formaPagamento = document.getElementById('forma_pagamento').value;

  var pedidoPayload = {
    cliente_id: selectedCliente.id,
    prazo_entrega: document.getElementById('prazo_entrega').value || null,
    icms: document.getElementById('icms').value || null,
    ipi: document.getElementById('ipi').value || null,
    regime_tributacao: document.getElementById('regime_tributacao').value || null,
    transportadora_empresa: document.getElementById('transp_empresa').value || null,
    transportadora_cnpj: document.getElementById('transp_cnpj').value || null,
    transportadora_endereco: document.getElementById('transp_endereco').value || null,
    transportadora_telefone: document.getElementById('transp_tel').value || null,
    observacao: document.getElementById('observacao').value || null,
    forma_pagamento: formaPagamento,
    boleto_quantidade: formaPagamento === 'boleto' ? (toNumber(document.getElementById('boleto_quantidade').value) || null) : null,
    boleto_dias: formaPagamento === 'boleto' ? (toNumber(document.getElementById('boleto_dias').value) || null) : null,
    cartao_parcelas: formaPagamento === 'cartao_credito' ? (toNumber(document.getElementById('cartao_parcelas').value) || null) : null,
    valor_total_a_pagar: toNumber(document.getElementById('valor_total_a_pagar').value),
    desconto_percentual: deveMostrarDescontoVista() ? (toNumber(document.getElementById('desconto_percentual').value) || null) : null,
    valor_total_a_pagar_vista: deveMostrarDescontoVista() ? toNumber(document.getElementById('valor_total_a_pagar_vista').value) : null,
    created_by: currentUserId
  };

  var pedido, pedidoError;

  if (pedidoEmEdicaoId) {
    // Edição: atualiza o registro existente sem tocar em tipo/status_orcamento —
    // isso só muda pelos botões dedicados (Converter em pedido / Marcar como não convertido).
    var updateResult = await supabaseClient.from('pedidos').update(pedidoPayload).eq('id', pedidoEmEdicaoId).select().single();
    pedido = updateResult.data;
    pedidoError = updateResult.error;
    if (pedidoError) return { error: pedidoError };

    await supabaseClient.from('pedido_itens_vacuo').delete().eq('pedido_id', pedidoEmEdicaoId);
    await supabaseClient.from('pedido_itens_gerais').delete().eq('pedido_id', pedidoEmEdicaoId);
  } else {
    pedidoPayload.tipo = tipo;
    pedidoPayload.status_orcamento = statusOrcamento;
    var insertResult = await supabaseClient.from('pedidos').insert(pedidoPayload).select().single();
    pedido = insertResult.data;
    pedidoError = insertResult.error;
    if (pedidoError) return { error: pedidoError };
  }

  var vacuoRows = vacuoItems.map(function (item, idx) {
    var calc = calcVacuo(item);
    return {
      pedido_id: pedido.id, ordem: idx, item: item.item, material: item.material,
      largura_m: item.largura_m, comprimento_m: item.comprimento_m, espessura_micras: item.espessura_micras,
      tipo: item.tipo, quantidade: item.quantidade, peso: calc.peso, peso_total: calc.peso_total,
      taxa_preco_peso: item.taxa_preco_peso, vl_unitario: calc.vl_unitario, vl_total: calc.vl_total
    };
  });

  var geraisRows = geraisItems.map(function (g, idx) {
    return {
      pedido_id: pedido.id, ordem: idx, produto_catalogo_id: g.produto_catalogo_id,
      nome_produto: g.nome_produto, codigo_produto: g.codigo_produto, ncm: g.ncm,
      preco_unitario: g.preco_unitario, quantidade: g.quantidade, preco_total: g.preco_unitario * g.quantidade
    };
  });

  if (vacuoRows.length) await supabaseClient.from('pedido_itens_vacuo').insert(vacuoRows);
  if (geraisRows.length) await supabaseClient.from('pedido_itens_gerais').insert(geraisRows);

  pedidoEmEdicaoId = pedido.id;
  return { pedido: pedido };
}

document.getElementById('btn-salvar-pedido').addEventListener('click', async function () {
  var errorEl = document.getElementById('pedido-error');
  if (!validarPedido(errorEl)) return;

  var btn = this;
  var estavaEditando = !!pedidoEmEdicaoId;
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  var result = await salvarPedidoNoBanco('pedido', null);

  btn.disabled = false;
  btn.textContent = pedidoEmEdicaoId ? 'Salvar alterações' : 'Salvar pedido';

  if (result.error) {
    errorEl.textContent = 'Erro ao salvar pedido: ' + result.error.message;
    errorEl.style.display = 'block';
    return;
  }

  showToast((estavaEditando ? 'Pedido nº ' + result.pedido.numero + ' atualizado com sucesso.' : 'Pedido nº ' + result.pedido.numero + ' salvo com sucesso.'), 'ok');
  atualizarAlertaOrcamentosPendentes();
});

/* ===================== FORMA DE PAGAMENTO (texto p/ impressão) ===================== */

var FORMA_PAGAMENTO_LABELS = {
  boleto: 'Boleto', a_vista: 'À Vista', cartao_credito: 'Cartão de Crédito',
  cartao_debito: 'Cartão de Débito', pix: 'Pix', link_pagamento: 'Link de Pagamento'
};

function formatarFormaPagamento() {
  var forma = document.getElementById('forma_pagamento').value;
  var texto = FORMA_PAGAMENTO_LABELS[forma] || '-';

  if (forma === 'boleto') {
    var qtd = document.getElementById('boleto_quantidade').value;
    var dias = document.getElementById('boleto_dias').value;
    var detalhes = [];
    if (qtd) detalhes.push(qtd + 'x');
    if (dias) detalhes.push(dias + ' dias');
    if (detalhes.length) texto += ' (' + detalhes.join(', ') + ')';
  } else if (forma === 'cartao_credito') {
    var parcelas = document.getElementById('cartao_parcelas').value;
    if (parcelas) texto += ' (' + parcelas + 'x)';
  }

  return texto;
}

function deveMostrarChavePix() {
  var forma = document.getElementById('forma_pagamento').value;
  return !!EMPRESA_CONFIG.chavePix && (forma === 'a_vista' || forma === 'pix');
}

/* ===================== IMPRESSÃO (2 vias) ===================== */

function buildViaHtml(label) {
  var dataStr = new Date().toLocaleDateString('pt-BR');
  var cliente = selectedCliente || {};
  var enderecoCompleto = [
    cliente.logradouro, cliente.numero, cliente.complemento, cliente.bairro, cliente.municipio, cliente.uf
  ].filter(Boolean).join(', ');

  var vacuoRowsHtml = vacuoItems.map(function (item) {
    var calc = calcVacuo(item);
    return '<tr>' +
      '<td>' + item.item + '</td><td>' + (item.material || '') + '</td>' +
      '<td>' + formatMedidaCm(item.largura_m) + '</td><td>' + formatMedidaCm(item.comprimento_m) + '</td><td>' + item.espessura_micras + '</td>' +
      '<td>' + (item.tipo || '') + '</td><td>' + calc.peso.toFixed(4) + '</td><td>' + item.quantidade + '</td>' +
      '<td>' + calc.peso_total.toFixed(2) + '</td><td>' + formatBRL(calc.vl_unitario) + '</td><td>' + formatBRL(calc.vl_total) + '</td>' +
    '</tr>';
  }).join('');

  var geraisRowsHtml = geraisItems.map(function (g) {
    return '<tr>' +
      '<td>' + g.nome_produto + '</td><td>' + (g.codigo_produto || '-') + '</td><td>' + (g.ncm || '-') + '</td>' +
      '<td>' + formatBRL(g.preco_unitario) + '</td><td>' + g.quantidade + '</td><td>' + formatBRL(g.preco_unitario * g.quantidade) + '</td>' +
    '</tr>';
  }).join('');

  var formaPagamentoLabels = {
    boleto: 'Boleto', a_vista: 'À Vista', cartao_credito: 'Cartão de Crédito',
    cartao_debito: 'Cartão de Débito', pix: 'Pix', link_pagamento: 'Link de Pagamento'
  };
  var formaPagamentoTexto = formatarFormaPagamento();

  return '<div class="print-via">' +
    '<div class="print-header"><div><h2>Pedido — ' + (cliente.razao_social || cliente.nome_fantasia || '') + ' — ' + EMPRESA_CONFIG.nome + '</h2>Data: ' + dataStr + '</div>' +
    '<div class="print-via-label">Via ' + label + '</div></div>' +
    '<p><strong>CLIENTE:</strong> ' + (cliente.razao_social || '') + (cliente.nome_fantasia ? ' (' + cliente.nome_fantasia + ')' : '') + '</p>' +
    '<p><strong>ENDEREÇO:</strong> ' + enderecoCompleto + '</p>' +
    '<p><strong>CNPJ/CPF:</strong> ' + (cliente.cnpj_cpf || '') + ' &nbsp; <strong>CÓDIGO:</strong> ' + (cliente.codigo || '') + ' &nbsp; <strong>I.E:</strong> ' + (cliente.ie || '') + '</p>' +
    '<p><strong>CONTATO:</strong> ' + (cliente.contato_nome || '') + ' &nbsp; <strong>TEL:</strong> ' + (cliente.contato_telefone || '') + ' &nbsp; <strong>EMAIL:</strong> ' + (cliente.contato_email || '') + '</p>' +
    (vacuoRowsHtml ? '<table><thead><tr><th>Item</th><th>Material</th><th>Larg.</th><th>Comp.</th><th>Esp.</th><th>Tipo</th><th>Peso</th><th>Qtd</th><th>Peso Total</th><th>Vl. Unit.</th><th>Vl. Total</th></tr></thead><tbody>' + vacuoRowsHtml + '</tbody></table>' : '') +
    (geraisRowsHtml ? '<table><thead><tr><th>Produto</th><th>Código</th><th>NCM</th><th>Vl. Unit.</th><th>Qtd</th><th>Vl. Total</th></tr></thead><tbody>' + geraisRowsHtml + '</tbody></table>' : '') +
    '<p><strong>PRAZO DE ENTREGA:</strong> ' + (document.getElementById('prazo_entrega').value || '') + '</p>' +
    '<p><strong>ICMS:</strong> ' + (document.getElementById('icms').value || '') + ' &nbsp; <strong>IPI:</strong> ' + (document.getElementById('ipi').value || '') + ' &nbsp; <strong>REGIME:</strong> ' + (document.getElementById('regime_tributacao').value || '') + '</p>' +
    '<p><strong>TRANSPORTADORA:</strong> ' + (document.getElementById('transp_empresa').value || '') + ' — ' + (document.getElementById('transp_endereco').value || '') + ' — ' + (document.getElementById('transp_tel').value || '') + '</p>' +
    '<p><strong>OBSERVAÇÃO:</strong> ' + (document.getElementById('observacao').value || '') + '</p>' +
    '<p><strong>FORMA DE PAGAMENTO:</strong> ' + formaPagamentoTexto + ' &nbsp; <strong>VALOR TOTAL A PAGAR:</strong> ' + formatBRL(document.getElementById('valor_total_a_pagar').value) + '</p>' +
    (deveMostrarDescontoVista() ? '<p><strong>TOTAL A PAGAR À VISTA:</strong> ' + formatBRL(document.getElementById('valor_total_a_pagar_vista').value) + '</p>' : '') +
    (deveMostrarChavePix() ? '<p><strong>CHAVE PIX:</strong> ' + EMPRESA_CONFIG.chavePix + '</p>' : '') +
  '</div>';
}

/* ===================== ORÇAMENTO (A4, papel timbrado) ===================== */

var BRAND_MARK_HTML =
  '<div class="brand-mark">' +
    '<img class="bm-mark-full" src="../assets/img/logo-full.png" alt="' + EMPRESA_CONFIG.nome + '">' +
  '</div>';

function buildOrcamentoHtml() {
  var dataStr = new Date().toLocaleDateString('pt-BR');
  var cliente = selectedCliente || {};
  var enderecoCompleto = [
    cliente.logradouro, cliente.numero, cliente.complemento, cliente.bairro, cliente.municipio, cliente.uf
  ].filter(Boolean).join(', ');

  var vacuoRowsHtml = vacuoItems.map(function (item) {
    var calc = calcVacuo(item);
    return '<tr>' +
      '<td>' + (item.material || 'SACO A VÁCUO') + '</td>' +
      '<td>' + formatMedidaCm(item.largura_m) + 'x' + formatMedidaCm(item.comprimento_m) + 'x' + item.espessura_micras + (item.tipo ? ' — ' + item.tipo : '') + '</td>' +
      '<td>' + item.quantidade + '</td><td>' + formatBRL(calc.vl_unitario) + '</td><td>' + formatBRL(calc.vl_total) + '</td>' +
    '</tr>';
  }).join('');

  var geraisRowsHtml = geraisItems.map(function (g) {
    return '<tr>' +
      '<td>' + g.nome_produto + '</td><td>—</td>' +
      '<td>' + g.quantidade + '</td><td>' + formatBRL(g.preco_unitario) + '</td><td>' + formatBRL(g.preco_unitario * g.quantidade) + '</td>' +
    '</tr>';
  }).join('');

  var formaPagamentoTexto = formatarFormaPagamento();

  return '<div class="orcamento-via">' +
    '<div class="orcamento-header">' +
      '<div>' + BRAND_MARK_HTML +
        '<div class="orcamento-empresa-dados">' +
          EMPRESA_CONFIG.nome + '<br>' +
          (EMPRESA_CONFIG.cnpj ? 'CNPJ: ' + EMPRESA_CONFIG.cnpj + '<br>' : '') +
          EMPRESA_CONFIG.endereco +
        '</div>' +
      '</div>' +
      '<div class="orcamento-titulo"><h1>ORÇAMENTO</h1>Data: ' + dataStr + '</div>' +
    '</div>' +

    '<div class="secao-titulo">Cliente</div>' +
    '<p><strong>' + (cliente.razao_social || '') + (cliente.nome_fantasia ? ' (' + cliente.nome_fantasia + ')' : '') + '</strong></p>' +
    '<p>' + enderecoCompleto + '</p>' +
    '<p>CNPJ/CPF: ' + (cliente.cnpj_cpf || '') + (cliente.contato_nome ? ' &nbsp; Contato: ' + cliente.contato_nome : '') +
      (cliente.contato_telefone ? ' — ' + cliente.contato_telefone : '') + '</p>' +

    '<div class="secao-titulo">Itens</div>' +
    (vacuoRowsHtml || geraisRowsHtml
      ? '<table><thead><tr><th>Produto</th><th>Especificação</th><th>Qtd</th><th>Vl. Unit.</th><th>Vl. Total</th></tr></thead><tbody>' + vacuoRowsHtml + geraisRowsHtml + '</tbody></table>'
      : '<p>Nenhum item adicionado.</p>') +

    '<div class="secao-titulo">Condições</div>' +
    '<p><strong>Prazo de entrega:</strong> ' + (document.getElementById('prazo_entrega').value || '') +
      ' &nbsp; <strong>Forma de pagamento:</strong> ' + formaPagamentoTexto + '</p>' +
    '<p><strong>Valor total:</strong> ' + formatBRL(document.getElementById('valor_total_a_pagar').value) + '</p>' +
    (deveMostrarDescontoVista() ? '<p><strong>Total à vista:</strong> ' + formatBRL(document.getElementById('valor_total_a_pagar_vista').value) + '</p>' : '') +
    (deveMostrarChavePix() ? '<p><strong>Chave PIX:</strong> ' + EMPRESA_CONFIG.chavePix + '</p>' : '') +
  '</div>';
}

var originalDocumentTitle = document.title;

document.getElementById('btn-imprimir').addEventListener('click', function () {
  if (!selectedCliente) {
    showToast('Selecione um cliente antes de imprimir.', 'warning');
    return;
  }
  document.getElementById('print-sheet').innerHTML = buildViaHtml('Cliente') + buildViaHtml('Empresa');
  document.getElementById('orcamento-sheet').innerHTML = ''; // evita sobrepor com um orçamento gerado antes

  // O nome sugerido ao salvar como PDF vem do document.title — troca temporariamente
  // para o nome do cliente, assim os PDFs saem identificados em vez de todos com o mesmo nome.
  var nomeCliente = selectedCliente.razao_social || selectedCliente.nome_fantasia || 'Pedido';
  document.title = nomeCliente + ' - CRP';

  window.print();
});

document.getElementById('btn-orcamento').addEventListener('click', function () {
  var errorEl = document.getElementById('pedido-error');
  if (!validarPedido(errorEl)) return;

  document.getElementById('orcamento-preview-conteudo').innerHTML = buildOrcamentoHtml();
  document.getElementById('orcamento-preview-error').style.display = 'none';
  document.getElementById('modal-orcamento-preview').classList.add('open');
});

document.getElementById('orcamento-preview-cancelar').addEventListener('click', function () {
  document.getElementById('modal-orcamento-preview').classList.remove('open');
});

document.getElementById('orcamento-preview-confirmar').addEventListener('click', async function () {
  var btn = this;
  var errorEl = document.getElementById('orcamento-preview-error');
  var estavaEditando = !!pedidoEmEdicaoId;
  errorEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  var result = await salvarPedidoNoBanco('orcamento', 'pendente');

  btn.disabled = false;
  btn.textContent = 'Confirmar e Imprimir';

  if (result.error) {
    errorEl.textContent = 'Erro ao salvar orçamento: ' + result.error.message;
    errorEl.style.display = 'block';
    return;
  }

  document.getElementById('modal-orcamento-preview').classList.remove('open');
  document.getElementById('orcamento-sheet').innerHTML = buildOrcamentoHtml();
  document.getElementById('print-sheet').innerHTML = ''; // evita sobrepor com um romaneio gerado antes

  var nomeCliente = selectedCliente.razao_social || selectedCliente.nome_fantasia || 'Orcamento';
  document.title = 'Orçamento - ' + nomeCliente + ' - CRP';

  window.print();

  showToast((estavaEditando ? 'Orçamento nº ' + result.pedido.numero + ' atualizado.' : 'Orçamento nº ' + result.pedido.numero + ' salvo como pendente.'), 'ok');
  atualizarAlertaOrcamentosPendentes();
});

window.addEventListener('afterprint', function () {
  document.title = originalDocumentTitle;
});

/* ===================== EDITAR PEDIDO/ORÇAMENTO EXISTENTE ===================== */

async function iniciarEdicaoPedido(pedidoId) {
  var { data: pedido, error } = await supabaseClient
    .from('pedidos')
    .select('*, pedido_itens_vacuo(*), pedido_itens_gerais(*)')
    .eq('id', pedidoId)
    .single();

  if (error || !pedido) {
    showToast('Não foi possível carregar esse registro para edição.', 'error');
    return;
  }

  // limpa o formulário atual antes de popular
  vacuoItems = [];
  geraisItems = [];
  document.getElementById('vacuo-items').innerHTML = '';
  valorTotalManuallyEdited = false;
  valorVistaManuallyEdited = false;

  document.getElementById('select-cliente').value = pedido.cliente_id || '';
  document.getElementById('select-cliente').dispatchEvent(new Event('change', { bubbles: true }));

  (pedido.pedido_itens_vacuo || []).slice().sort(function (a, b) { return a.ordem - b.ordem; }).forEach(function (i) {
    var item = {
      _id: uid(), item: i.item, material: i.material, largura_m: parseFloat(i.largura_m) || 0,
      comprimento_m: parseFloat(i.comprimento_m) || 0, espessura_micras: parseFloat(i.espessura_micras) || 0,
      tipo: i.tipo, quantidade: parseFloat(i.quantidade) || 0, taxa_preco_peso: parseFloat(i.taxa_preco_peso) || 0
    };
    vacuoItems.push(item);
    renderVacuoRow(item);
  });

  geraisItems = (pedido.pedido_itens_gerais || []).slice().sort(function (a, b) { return a.ordem - b.ordem; }).map(function (g) {
    return {
      _id: uid(), produto_catalogo_id: g.produto_catalogo_id, nome_produto: g.nome_produto,
      codigo_produto: g.codigo_produto, ncm: g.ncm, preco_unitario: parseFloat(g.preco_unitario) || 0,
      quantidade: parseFloat(g.quantidade) || 0
    };
  });
  renderGeraisItems();

  document.getElementById('prazo_entrega').value = pedido.prazo_entrega || '';
  document.getElementById('icms').value = pedido.icms || '';
  document.getElementById('ipi').value = pedido.ipi || '';
  document.getElementById('regime_tributacao').value = pedido.regime_tributacao || '';
  document.getElementById('transp_empresa').value = pedido.transportadora_empresa || '';
  document.getElementById('transp_cnpj').value = pedido.transportadora_cnpj || '';
  document.getElementById('transp_endereco').value = pedido.transportadora_endereco || '';
  document.getElementById('transp_tel').value = pedido.transportadora_telefone || '';
  document.getElementById('observacao').value = pedido.observacao || '';

  var formaSelect = document.getElementById('forma_pagamento');
  formaSelect.value = pedido.forma_pagamento || '';
  formaSelect.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('boleto_quantidade').value = pedido.boleto_quantidade || '';
  document.getElementById('boleto_dias').value = pedido.boleto_dias || '';
  document.getElementById('cartao_parcelas').value = pedido.cartao_parcelas || '';

  document.getElementById('valor_total_a_pagar').value = pedido.valor_total_a_pagar || 0;
  valorTotalManuallyEdited = true;
  document.getElementById('desconto_percentual').value = pedido.desconto_percentual || '';
  document.getElementById('valor_total_a_pagar_vista').value = pedido.valor_total_a_pagar_vista || 0;
  valorVistaManuallyEdited = true;

  updateTotals();

  pedidoEmEdicaoId = pedido.id;
  var tipoLabel = pedido.tipo === 'orcamento' ? 'Orçamento' : 'Pedido';
  document.getElementById('pagina-titulo').textContent = 'Editando ' + tipoLabel + ' nº ' + pedido.numero;
  document.getElementById('edicao-banner-texto').textContent = '✏️ Editando ' + tipoLabel + ' nº ' + pedido.numero;
  document.getElementById('edicao-banner').style.display = 'block';
  document.getElementById('btn-salvar-pedido').textContent = 'Salvar alterações';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.iniciarEdicaoPedido = iniciarEdicaoPedido;

/* ===================== INIT ===================== */

(async function () {
  var auth = await window.ADMIN_AUTH_READY;
  if (!auth) return;
  currentUserId = auth.session.user.id;
  await loadClientesSelect();
  renderGeraisItems();
  updateTotals();

  var params = new URLSearchParams(location.search);
  var editarId = params.get('editar');
  if (editarId) {
    iniciarEdicaoPedido(editarId);
  }
})();
