var currentUserId = null;

var QUADRANTES = [
  { categoria: 'venda', label: 'Vendas', pagina: 'vendas.html' },
  { categoria: 'manutencao', label: 'Manutenção', pagina: 'manutencao.html' },
  { categoria: 'pos_venda', label: 'Pós-venda / Follow-up', pagina: 'pos-venda.html' }
];

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

async function carregarQuadrante(quadrante) {
  var { data: clientes, error } = await supabaseClient
    .from('clientes')
    .select('id, razao_social, telefone_empresa, email_empresa, created_at, categoria')
    .eq('categoria', quadrante.categoria);

  if (error) {
    showToast('Erro ao carregar ' + quadrante.label + ': ' + error.message, 'error');
    return;
  }
  clientes = clientes || [];

  var contagemEl = document.getElementById('quad-count-' + quadrante.categoria);
  contagemEl.textContent = clientes.length;

  if (!clientes.length) {
    document.getElementById('quad-lista-' + quadrante.categoria).innerHTML =
      '<p style="color:var(--gray-400); font-size:0.85rem;">Nenhum cliente neste funil ainda.</p>';
    return;
  }

  var ids = clientes.map(function (c) { return c.id; });
  var { data: historico } = await supabaseClient
    .from('cliente_historico')
    .select('cliente_id, created_at, resultado')
    .in('cliente_id', ids)
    .order('created_at', { ascending: true });

  var historicoPorCliente = {};
  (historico || []).forEach(function (h) {
    if (!historicoPorCliente[h.cliente_id]) historicoPorCliente[h.cliente_id] = [];
    historicoPorCliente[h.cliente_id].push(h);
  });

  // --- Tratado hoje: contatos registrados no dia, mais recentes primeiro ---
  var hoje = inicioDeHoje();
  var clientesPorId = {};
  clientes.forEach(function (c) { clientesPorId[c.id] = c; });

  var tratadoHoje = (historico || [])
    .filter(function (h) { return new Date(h.created_at) >= hoje; })
    .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });

  var tratadoEl = document.getElementById('quad-tratado-' + quadrante.categoria);
  if (tratadoEl) {
    if (!tratadoHoje.length) {
      tratadoEl.innerHTML = '<p style="color:var(--gray-400); font-size:0.85rem;">Nenhum contato registrado hoje ainda.</p>';
    } else {
      tratadoEl.innerHTML = tratadoHoje.map(function (h) {
        var cliente = clientesPorId[h.cliente_id];
        var horaStr = new Date(h.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        var badgeClasse = h.resultado === 'positivo' ? 'badge-ok' : (h.resultado === 'negativo' ? 'badge-danger' : 'badge-warning');
        return '<div style="padding:8px 0; border-bottom:1px solid var(--off-white);">' +
          '<strong>' + (cliente ? cliente.razao_social : '—') + '</strong> ' +
          '<span class="badge ' + badgeClasse + '">' + labelResultado(quadrante.categoria, h.resultado) + '</span><br>' +
          '<span style="font-size:0.78rem; color:var(--gray-400);">' + horaStr + '</span>' +
        '</div>';
      }).join('');
    }
  }
  var contagemTratadoEl = document.getElementById('quad-count-tratado-' + quadrante.categoria);
  if (contagemTratadoEl) contagemTratadoEl.textContent = tratadoHoje.length;

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

  if (!comPrazo.length) {
    document.getElementById('quad-lista-' + quadrante.categoria).innerHTML =
      '<p style="color:var(--gray-400); font-size:0.85rem;">Tudo em dia por aqui.</p>';
    return;
  }

  var top5 = comPrazo.slice(0, 5);
  document.getElementById('quad-lista-' + quadrante.categoria).innerHTML = top5.map(function (item) {
    var prazo = formatarPrazo(item.retorno);
    var badge = prazo.classe ? '<span class="badge ' + prazo.classe + '">' + prazo.texto + '</span>' : prazo.texto;
    return '<div style="padding:8px 0; border-bottom:1px solid var(--off-white);">' +
      '<strong>' + item.cliente.razao_social + '</strong><br>' +
      '<span style="font-size:0.8rem;">' + badge + '</span>' +
    '</div>';
  }).join('');
}

function configurarFormRapido(quadrante) {
  var form = document.getElementById('quad-form-' + quadrante.categoria);
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var errorEl = document.getElementById('quad-error-' + quadrante.categoria);
    errorEl.style.display = 'none';

    var nome = document.getElementById('quad-nome-' + quadrante.categoria).value.trim();
    var telefone = document.getElementById('quad-telefone-' + quadrante.categoria).value.trim();
    var email = document.getElementById('quad-email-' + quadrante.categoria).value.trim();

    if (!nome) {
      errorEl.textContent = 'Nome é obrigatório.';
      errorEl.style.display = 'block';
      return;
    }
    if (!telefone && !email) {
      errorEl.textContent = 'Telefone ou e-mail obrigatório.';
      errorEl.style.display = 'block';
      return;
    }

    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;

    var { error } = await supabaseClient.from('clientes').insert({
      razao_social: nome, telefone_empresa: telefone || null, email_empresa: email || null,
      categoria: quadrante.categoria, created_by: currentUserId
    });

    btn.disabled = false;

    if (error) {
      errorEl.textContent = 'Erro ao salvar: ' + error.message;
      errorEl.style.display = 'block';
      return;
    }

    form.reset();
    showToast('Contato adicionado em ' + quadrante.label + '.', 'ok');
    carregarQuadrante(quadrante);
  });
}

(async function () {
  var auth = await window.ADMIN_AUTH_READY;
  if (!auth) return;
  currentUserId = auth.session.user.id;

  var visiveis = QUADRANTES.filter(function (q) {
    return !!document.getElementById('quad-' + q.categoria);
  });

  visiveis.forEach(function (q) {
    configurarFormRapido(q);
    carregarQuadrante(q);
  });
})();
