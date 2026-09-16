// Compartilhado entre clientes.html, vendas/manutencao/pos-venda (pipeline.js)
// e assistencia-tecnica.html.

var HISTORICO_STATUS_ASSISTENCIA_LABELS = {
  aberta: 'Aberta', em_andamento: 'Em andamento', pendente: 'Pendente', concluida: 'Concluída', nao_aprovada: 'Não aprovado pelo cliente'
};

var HISTORICO_STATUS_ASSISTENCIA_BADGE = {
  aberta: 'badge-warning', em_andamento: 'badge-warning', pendente: 'badge-warning', concluida: 'badge-ok', nao_aprovada: 'badge-danger'
};

/* ===================== HISTÓRICO DE FOLLOW-UP (Venda/Manutenção/Pós-venda) ===================== */

async function loadHistoricoContatos(clienteId, containerId) {
  var conteudo = document.getElementById(containerId || 'historico-conteudo');
  conteudo.textContent = 'Carregando...';

  var { data, error } = await supabaseClient
    .from('cliente_historico')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false });

  if (error) {
    conteudo.textContent = 'Erro ao carregar histórico: ' + error.message;
    return;
  }

  if (!data || !data.length) {
    conteudo.innerHTML = '<p style="color:var(--gray-400);">Nenhuma anotação registrada ainda.</p>';
    return;
  }

  conteudo.innerHTML = data.map(function (h) {
    var dataStr = new Date(h.created_at).toLocaleString('pt-BR');
    return '<div style="border-bottom:1px solid var(--off-white); padding:10px 0;">' +
      '<div style="color:var(--gray-400); font-size:0.78rem; margin-bottom:4px;">' + dataStr + '</div>' +
      '<div>' + h.anotacao.replace(/</g, '&lt;') + '</div>' +
    '</div>';
  }).join('');
}

async function salvarHistoricoContato(clienteId, anotacao, autorId) {
  return supabaseClient.from('cliente_historico').insert({
    cliente_id: clienteId, anotacao: anotacao, created_by: autorId
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
