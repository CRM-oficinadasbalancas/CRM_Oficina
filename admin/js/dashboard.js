var currentUserId = null;

var QUADRANTES = [
  { categoria: 'venda', label: 'Vendas', pagina: 'vendas.html' },
  { categoria: 'manutencao', label: 'Manutenção', pagina: 'manutencao.html' },
  { categoria: 'pos_venda', label: 'Pós-venda / Follow-up', pagina: 'pos-venda.html' }
];

function diasDesde(dataStr) {
  var diff = Date.now() - new Date(dataStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

async function carregarQuadrante(quadrante) {
  var { data: clientes, error } = await supabaseClient
    .from('clientes')
    .select('id, razao_social, telefone_empresa, email_empresa, created_at')
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
    .select('cliente_id, created_at')
    .in('cliente_id', ids)
    .order('created_at', { ascending: false });

  var ultimoContato = {};
  (historico || []).forEach(function (h) {
    if (!ultimoContato[h.cliente_id]) ultimoContato[h.cliente_id] = h.created_at;
  });

  clientes.forEach(function (c) {
    c._ultimoContato = ultimoContato[c.id] || null;
  });

  // Sem contato registrado ainda vem primeiro; entre os que já têm contato,
  // o mais antigo (mais tempo parado) vem primeiro — é quem mais precisa de atenção.
  clientes.sort(function (a, b) {
    if (!a._ultimoContato && !b._ultimoContato) return new Date(a.created_at) - new Date(b.created_at);
    if (!a._ultimoContato) return -1;
    if (!b._ultimoContato) return 1;
    return new Date(a._ultimoContato) - new Date(b._ultimoContato);
  });

  var top5 = clientes.slice(0, 5);
  document.getElementById('quad-lista-' + quadrante.categoria).innerHTML = top5.map(function (c) {
    var status = c._ultimoContato
      ? 'último contato há ' + diasDesde(c._ultimoContato) + ' dia(s)'
      : 'sem contato registrado';
    return '<div style="padding:8px 0; border-bottom:1px solid var(--off-white);">' +
      '<strong>' + c.razao_social + '</strong><br>' +
      '<span style="font-size:0.8rem; color:var(--gray-400);">' + status + '</span>' +
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
