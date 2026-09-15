// Compartilhado entre pedido.html, clientes.html e assistencia-tecnica.html.

var HISTORICO_STATUS_ASSISTENCIA_LABELS = {
  aberta: 'Aberta', em_andamento: 'Em andamento', pendente: 'Pendente', concluida: 'Concluída', nao_aprovada: 'Não aprovado pelo cliente'
};

var HISTORICO_STATUS_ASSISTENCIA_BADGE = {
  aberta: 'badge-warning', em_andamento: 'badge-warning', pendente: 'badge-warning', concluida: 'badge-ok', nao_aprovada: 'badge-danger'
};

var HISTORICO_FORMA_PAGAMENTO_LABELS = {
  boleto: 'Boleto', a_vista: 'À Vista', cartao_credito: 'Cartão de Crédito',
  cartao_debito: 'Cartão de Débito', pix: 'Pix', link_pagamento: 'Link de Pagamento'
};

function formatBRLHistorico(n) {
  return 'R$ ' + (parseFloat(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Medidas são guardadas em metros/micras (fórmula da planilha), mas exibidas
// como número puro em cm, sem unidade, que é como o pessoal do dia a dia lê.
function formatMedidaCm(metros) {
  var cm = Number(((parseFloat(metros) || 0) * 100).toFixed(2));
  return cm.toLocaleString('pt-BR');
}

function formatarFormaPagamentoHistorico(pedido) {
  var texto = HISTORICO_FORMA_PAGAMENTO_LABELS[pedido.forma_pagamento] || '';
  if (pedido.forma_pagamento === 'boleto') {
    var detalhes = [];
    if (pedido.boleto_quantidade) detalhes.push(pedido.boleto_quantidade + 'x');
    if (pedido.boleto_dias) detalhes.push(pedido.boleto_dias + ' dias');
    if (detalhes.length) texto += ' (' + detalhes.join(', ') + ')';
  } else if (pedido.forma_pagamento === 'cartao_credito' && pedido.cartao_parcelas) {
    texto += ' (' + pedido.cartao_parcelas + 'x)';
  }
  return texto;
}

async function contarOrcamentosPendentes(clienteId) {
  var { count, error } = await supabaseClient
    .from('pedidos')
    .select('id', { count: 'exact', head: true })
    .eq('cliente_id', clienteId)
    .eq('tipo', 'orcamento')
    .eq('status_orcamento', 'pendente');
  if (error) return 0;
  return count || 0;
}

async function loadHistoricoCliente(clienteId, containerId, onAtualizado) {
  var conteudo = document.getElementById(containerId || 'historico-conteudo');
  conteudo.textContent = 'Carregando...';

  var { data, error } = await supabaseClient
    .from('pedidos')
    .select('*, pedido_itens_vacuo(*), pedido_itens_gerais(*)')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false });

  if (error) {
    conteudo.textContent = 'Erro ao carregar histórico: ' + error.message;
    return;
  }

  if (!data || !data.length) {
    conteudo.innerHTML = '<p style="color:var(--gray-400);">Nenhum pedido ou orçamento anterior encontrado para esse cliente.</p>';
    return;
  }

  conteudo.innerHTML = data.map(function (pedido) {
    var dataStr = new Date(pedido.created_at).toLocaleDateString('pt-BR');
    var itensVacuo = (pedido.pedido_itens_vacuo || []).map(function (i) {
      return '<li>' + (i.material || 'SACO A VÁCUO') + ' — ' + formatMedidaCm(i.largura_m) + 'x' + formatMedidaCm(i.comprimento_m) + 'x' + i.espessura_micras + ' — Qtd: ' + i.quantidade + '</li>';
    }).join('');
    var itensGerais = (pedido.pedido_itens_gerais || []).map(function (i) {
      return '<li>' + i.nome_produto + ' — Qtd: ' + i.quantidade + '</li>';
    }).join('');

    var tipoLabel, badgeClass, badgeText, acoesEspecificas = '';
    if (pedido.tipo === 'orcamento') {
      tipoLabel = 'Orçamento nº ' + pedido.numero;
      if (pedido.status_orcamento === 'convertido') {
        badgeClass = 'badge-ok'; badgeText = 'Convertido em pedido';
      } else if (pedido.status_orcamento === 'nao_convertido') {
        badgeClass = 'badge-warning'; badgeText = 'Não convertido';
      } else {
        badgeClass = 'badge-warning'; badgeText = 'Pendente';
        acoesEspecificas =
          '<button type="button" class="btn btn-outline" style="padding:6px 12px; font-size:0.78rem;" data-converter="' + pedido.id + '">Converter em pedido</button>' +
          '<button type="button" class="btn btn-outline" style="padding:6px 12px; font-size:0.78rem; color:#a92323; border-color:#a92323;" data-nao-converter="' + pedido.id + '">Marcar como não convertido</button>';
      }
    } else {
      tipoLabel = 'Pedido nº ' + pedido.numero;
      badgeClass = 'badge-ok'; badgeText = 'Pedido';
    }

    var acoes = '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">' +
      '<button type="button" class="btn btn-outline" style="padding:6px 12px; font-size:0.78rem;" data-editar="' + pedido.id + '">Editar</button>' +
      acoesEspecificas +
    '</div>';

    return '<div style="border-bottom:1px solid var(--off-white); padding:14px 0;">' +
      '<strong>' + tipoLabel + '</strong> <span class="badge ' + badgeClass + '">' + badgeText + '</span> — ' + dataStr +
      ' &nbsp; <span style="color:var(--gray-400);">' + formatarFormaPagamentoHistorico(pedido) + '</span>' +
      '<ul style="margin:8px 0 8px 20px; font-size:0.88rem;">' + itensVacuo + itensGerais + '</ul>' +
      '<strong>Valor total a pagar: ' + formatBRLHistorico(pedido.valor_total_a_pagar) + '</strong>' +
      acoes +
    '</div>';
  }).join('');

  conteudo.querySelectorAll('[data-editar]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.dataset.editar;
      if (typeof window.iniciarEdicaoPedido === 'function') {
        window.iniciarEdicaoPedido(id);
        var modal = document.getElementById('modal-historico');
        if (modal) modal.classList.remove('open');
      } else {
        location.href = 'pedido.html?editar=' + id;
      }
    });
  });

  conteudo.querySelectorAll('[data-converter]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      if (!confirm('Converter este orçamento em pedido? Ele passa a contar como pedido real.')) return;
      var { error } = await supabaseClient.from('pedidos')
        .update({ tipo: 'pedido', status_orcamento: 'convertido' })
        .eq('id', btn.dataset.converter);
      if (error) { alert('Erro ao converter: ' + error.message); return; }
      loadHistoricoCliente(clienteId, containerId, onAtualizado);
      if (typeof onAtualizado === 'function') onAtualizado();
    });
  });

  conteudo.querySelectorAll('[data-nao-converter]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      if (!confirm('Marcar este orçamento como não convertido? Continua no histórico, mas não vira pedido.')) return;
      var { error } = await supabaseClient.from('pedidos')
        .update({ status_orcamento: 'nao_convertido' })
        .eq('id', btn.dataset.naoConverter);
      if (error) { alert('Erro ao marcar: ' + error.message); return; }
      loadHistoricoCliente(clienteId, containerId, onAtualizado);
      if (typeof onAtualizado === 'function') onAtualizado();
    });
  });
}

/* ===================== HISTÓRICO DE ASSISTÊNCIAS TÉCNICAS (por cliente) ===================== */

function abrirEdicaoAssistencia(assistenciaId) {
  if (typeof window.iniciarEdicaoAssistencia === 'function') {
    window.iniciarEdicaoAssistencia(assistenciaId);
    document.querySelectorAll('.modal-overlay.open').forEach(function (modal) {
      modal.classList.remove('open');
    });
  } else {
    location.href = 'assistencia-tecnica.html?editar=' + assistenciaId;
  }
}

async function loadHistoricoAssistencias(clienteId, containerId) {
  var conteudo = document.getElementById(containerId || 'historico-conteudo');
  conteudo.textContent = 'Carregando...';

  var { data, error } = await supabaseClient
    .from('assistencias_tecnicas')
    .select('*, equipamentos(marca, modelo, numero_serie)')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false });

  if (error) {
    conteudo.textContent = 'Erro ao carregar histórico: ' + error.message;
    return;
  }

  if (!data || !data.length) {
    conteudo.innerHTML = '<p style="color:var(--gray-400);">Nenhuma assistência técnica anterior encontrada para esse cliente.</p>';
    return;
  }

  conteudo.innerHTML = data.map(function (a) {
    var dataStr = new Date(a.created_at).toLocaleDateString('pt-BR');
    var badgeClass = HISTORICO_STATUS_ASSISTENCIA_BADGE[a.status] || 'badge-warning';
    var badgeText = HISTORICO_STATUS_ASSISTENCIA_LABELS[a.status] || a.status;
    var eq = a.equipamentos || {};
    var equipamento = [eq.marca, eq.modelo].filter(Boolean).join(' ') || '—';

    return '<div style="border-bottom:1px solid var(--off-white); padding:14px 0;">' +
      '<strong>Assistência nº ' + a.numero + '</strong> <span class="badge ' + badgeClass + '">' + badgeText + '</span> — ' + dataStr +
      '<p style="margin:8px 0; font-size:0.88rem;">' +
        '<strong>Equipamento:</strong> ' + equipamento + ' &nbsp; <strong>Nº de Série:</strong> ' + (eq.numero_serie || '—') +
      '</p>' +
      '<p style="margin:0 0 8px; font-size:0.88rem;"><strong>Defeito:</strong> ' + (a.descricao_defeito || '—') + '</p>' +
      (a.resolucao ? '<p style="margin:0 0 8px; font-size:0.88rem;"><strong>Resolução:</strong> ' + a.resolucao + '</p>' : '') +
      '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">' +
        '<button type="button" class="btn btn-outline" style="padding:6px 12px; font-size:0.78rem;" data-editar-assistencia="' + a.id + '">Editar</button>' +
      '</div>' +
    '</div>';
  }).join('');

  conteudo.querySelectorAll('[data-editar-assistencia]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      abrirEdicaoAssistencia(btn.dataset.editarAssistencia);
    });
  });
}

/* ===================== ALERTA DE EQUIPAMENTO JÁ COM ASSISTÊNCIAS ANTERIORES ===================== */

async function contarAssistenciasPorEquipamento(equipamentoId, excluirId) {
  if (!equipamentoId) return 0;
  var query = supabaseClient
    .from('assistencias_tecnicas')
    .select('id', { count: 'exact', head: true })
    .eq('equipamento_id', equipamentoId);
  if (excluirId) query = query.neq('id', excluirId);
  var { count, error } = await query;
  if (error) return 0;
  return count || 0;
}
