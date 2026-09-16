// Compartilhado por vendas.html, manutencao.html e pos-venda.html.
// Cada página define antes de incluir este script:
//   var PIPELINE_CATEGORIA = 'venda' | 'manutencao' | 'pos_venda';
//   var PIPELINE_LABEL = 'Vendas' | 'Manutenção' | 'Pós-venda';

var CATEGORIA_LABELS_PIPELINE = { venda: 'Venda', manutencao: 'Manutenção', pos_venda: 'Pós-venda' };

var currentUserId = null;
var pipelineClientes = [];
var pipelineHistoricoPorCliente = {};
var clienteEmHistorico = null;

async function loadPipeline() {
  var { data, error } = await supabaseClient
    .from('clientes')
    .select('*')
    .eq('categoria', PIPELINE_CATEGORIA)
    .order('razao_social', { ascending: true });

  if (error) {
    showToast('Erro ao carregar ' + PIPELINE_LABEL.toLowerCase() + ': ' + error.message, 'error');
    return;
  }

  pipelineClientes = data || [];
  pipelineHistoricoPorCliente = {};

  if (pipelineClientes.length) {
    var ids = pipelineClientes.map(function (c) { return c.id; });
    var { data: historico } = await supabaseClient
      .from('cliente_historico')
      .select('cliente_id, created_at, resultado')
      .in('cliente_id', ids)
      .order('created_at', { ascending: true });

    (historico || []).forEach(function (h) {
      if (!pipelineHistoricoPorCliente[h.cliente_id]) pipelineHistoricoPorCliente[h.cliente_id] = [];
      pipelineHistoricoPorCliente[h.cliente_id].push(h);
    });
  }

  renderPipelineTable();
}

function renderPipelineTable() {
  var tbody = document.getElementById('pipeline-tbody');
  if (!pipelineClientes.length) {
    tbody.innerHTML = '<tr><td colspan="5">Nenhum cliente em ' + PIPELINE_LABEL + ' ainda.</td></tr>';
    return;
  }

  var opcoesCategoria = ['venda', 'manutencao', 'pos_venda'].map(function (cat) {
    return '<option value="' + cat + '">' + CATEGORIA_LABELS_PIPELINE[cat] + '</option>';
  }).join('');

  var comPrazo = pipelineClientes.map(function (c) {
    var retorno = calcularProximoRetorno(c, pipelineHistoricoPorCliente[c.id] || []);
    return { cliente: c, retorno: retorno };
  });

  // Ordena por urgência: prioridade máxima e atrasados primeiro, depois por data mais próxima.
  comPrazo.sort(function (a, b) {
    if (a.retorno.concluido !== b.retorno.concluido) return a.retorno.concluido ? 1 : -1;
    if (a.retorno.prioridadeMaxima !== b.retorno.prioridadeMaxima) return a.retorno.prioridadeMaxima ? -1 : 1;
    if (!a.retorno.data && !b.retorno.data) return 0;
    if (!a.retorno.data) return 1;
    if (!b.retorno.data) return -1;
    return a.retorno.data - b.retorno.data;
  });

  tbody.innerHTML = comPrazo.map(function (item) {
    var c = item.cliente;
    var contato = [c.telefone_empresa, c.email_empresa].filter(Boolean).join(' — ') || '—';
    var prazo = formatarPrazo(item.retorno);
    var badgePrazo = prazo.classe ? '<span class="badge ' + prazo.classe + '">' + prazo.texto + '</span>' : prazo.texto;
    return '<tr>' +
      '<td>' + (c.razao_social || '') + '</td>' +
      '<td>' + contato + '</td>' +
      '<td>' + badgePrazo + '</td>' +
      '<td><select data-mover="' + c.id + '">' + opcoesCategoria.replace(
        'value="' + PIPELINE_CATEGORIA + '"', 'value="' + PIPELINE_CATEGORIA + '" selected'
      ) + '</select></td>' +
      '<td class="row-actions">' +
        '<button data-historico="' + c.id + '">Histórico</button>' +
        '<a href="clientes.html?editar=' + c.id + '" class="btn btn-outline" style="padding:6px 10px; font-size:0.8rem;">Editar cadastro</a>' +
        '<button data-remover="' + c.id + '">Remover do funil</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  tbody.querySelectorAll('[data-historico]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var cliente = pipelineClientes.find(function (c) { return c.id === btn.dataset.historico; });
      if (!cliente) return;
      abrirHistoricoFollowup(cliente);
    });
  });

  tbody.querySelectorAll('[data-mover]').forEach(function (select) {
    select.addEventListener('change', async function () {
      var { error } = await supabaseClient.from('clientes')
        .update({ categoria: select.value }).eq('id', select.dataset.mover);
      if (error) {
        showToast('Erro ao mover cliente: ' + error.message, 'error');
        return;
      }
      showToast('Cliente movido para ' + CATEGORIA_LABELS_PIPELINE[select.value] + '.', 'ok');
      loadPipeline();
    });
  });

  tbody.querySelectorAll('[data-remover]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      if (!confirm('Remover este cliente do funil de ' + PIPELINE_LABEL + '? O cadastro continua existindo em Clientes, só fica sem categoria.')) return;
      var { error } = await supabaseClient.from('clientes')
        .update({ categoria: null }).eq('id', btn.dataset.remover);
      if (error) {
        showToast('Erro ao remover: ' + error.message, 'error');
        return;
      }
      loadPipeline();
    });
  });
}

function configurarSeletorResultado() {
  var wrapper = document.getElementById('historico-resultado-wrapper');
  var select = document.getElementById('historico-resultado');
  var labels = RESULTADO_LABELS_POR_CATEGORIA[PIPELINE_CATEGORIA];
  if (!labels) {
    wrapper.style.display = 'none';
    return;
  }
  wrapper.style.display = 'block';
  select.innerHTML =
    '<option value="">Sem resultado ainda</option>' +
    '<option value="positivo">' + labels.positivo + '</option>' +
    '<option value="negativo">' + labels.negativo + '</option>';
}

function abrirHistoricoFollowup(cliente) {
  clienteEmHistorico = cliente;
  document.getElementById('historico-cliente-nome').textContent = cliente.razao_social;
  document.getElementById('historico-nova-anotacao').value = '';
  configurarSeletorResultado();
  document.getElementById('modal-historico').classList.add('open');
  loadHistoricoContatos(cliente.id, 'historico-conteudo');
}

document.getElementById('historico-btn-adicionar').addEventListener('click', async function () {
  if (!clienteEmHistorico) return;
  var textarea = document.getElementById('historico-nova-anotacao');
  var anotacao = textarea.value.trim();
  if (!anotacao) return;

  var resultadoSelect = document.getElementById('historico-resultado');
  var resultado = (RESULTADO_LABELS_POR_CATEGORIA[PIPELINE_CATEGORIA] && resultadoSelect.value) || null;

  var btn = this;
  btn.disabled = true;
  var { error } = await salvarHistoricoContato(clienteEmHistorico.id, anotacao, currentUserId, resultado);
  btn.disabled = false;

  if (error) {
    showToast('Erro ao salvar anotação: ' + error.message, 'error');
    return;
  }
  textarea.value = '';
  loadHistoricoContatos(clienteEmHistorico.id, 'historico-conteudo');
  loadPipeline();
});

document.getElementById('historico-btn-fechar').addEventListener('click', function () {
  document.getElementById('modal-historico').classList.remove('open');
});

/* ===================== NOVO CONTATO RÁPIDO ===================== */

document.getElementById('pipeline-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var errorEl = document.getElementById('pipeline-error');
  var saveBtn = document.getElementById('pipeline-save-btn');
  errorEl.style.display = 'none';

  var nome = document.getElementById('pipeline-nome').value.trim();
  var telefone = document.getElementById('pipeline-telefone').value.trim();
  var email = document.getElementById('pipeline-email').value.trim();

  if (!nome) {
    errorEl.textContent = 'Nome é obrigatório.';
    errorEl.style.display = 'block';
    return;
  }
  if (!telefone && !email) {
    errorEl.textContent = 'Preencha pelo menos o telefone ou o e-mail.';
    errorEl.style.display = 'block';
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Salvando...';

  var { error } = await supabaseClient.from('clientes').insert({
    razao_social: nome,
    telefone_empresa: telefone || null,
    email_empresa: email || null,
    categoria: PIPELINE_CATEGORIA,
    created_by: currentUserId
  });

  saveBtn.disabled = false;
  saveBtn.textContent = 'Adicionar';

  if (error) {
    errorEl.textContent = 'Erro ao salvar: ' + error.message;
    errorEl.style.display = 'block';
    return;
  }

  document.getElementById('pipeline-form').reset();
  showToast('Contato adicionado.', 'ok');
  loadPipeline();
});

(async function () {
  var auth = await window.ADMIN_AUTH_READY;
  if (!auth) return;
  currentUserId = auth.session.user.id;
  loadPipeline();
})();
