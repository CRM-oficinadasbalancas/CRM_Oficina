// Compartilhado por vendas.html, manutencao.html e pos-venda.html.
// Cada página define antes de incluir este script:
//   var PIPELINE_CATEGORIA = 'venda' | 'manutencao' | 'pos_venda';
//   var PIPELINE_LABEL = 'Vendas' | 'Manutenção' | 'Pós-venda';

var CATEGORIA_LABELS_PIPELINE = { venda: 'Venda', manutencao: 'Manutenção', pos_venda: 'Pós-venda' };

var currentUserId = null;
var pipelineClientes = [];
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
  renderPipelineTable();
}

function renderPipelineTable() {
  var tbody = document.getElementById('pipeline-tbody');
  if (!pipelineClientes.length) {
    tbody.innerHTML = '<tr><td colspan="4">Nenhum cliente em ' + PIPELINE_LABEL + ' ainda.</td></tr>';
    return;
  }

  var opcoesCategoria = ['venda', 'manutencao', 'pos_venda'].map(function (cat) {
    return '<option value="' + cat + '">' + CATEGORIA_LABELS_PIPELINE[cat] + '</option>';
  }).join('');

  tbody.innerHTML = pipelineClientes.map(function (c) {
    var contato = [c.telefone_empresa, c.email_empresa].filter(Boolean).join(' — ') || '—';
    return '<tr>' +
      '<td>' + (c.razao_social || '') + '</td>' +
      '<td>' + contato + '</td>' +
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

function abrirHistoricoFollowup(cliente) {
  clienteEmHistorico = cliente;
  document.getElementById('historico-cliente-nome').textContent = cliente.razao_social;
  document.getElementById('historico-nova-anotacao').value = '';
  document.getElementById('modal-historico').classList.add('open');
  loadHistoricoContatos(cliente.id, 'historico-conteudo');
}

document.getElementById('historico-btn-adicionar').addEventListener('click', async function () {
  if (!clienteEmHistorico) return;
  var textarea = document.getElementById('historico-nova-anotacao');
  var anotacao = textarea.value.trim();
  if (!anotacao) return;

  var btn = this;
  btn.disabled = true;
  var { error } = await salvarHistoricoContato(clienteEmHistorico.id, anotacao, currentUserId);
  btn.disabled = false;

  if (error) {
    showToast('Erro ao salvar anotação: ' + error.message, 'error');
    return;
  }
  textarea.value = '';
  loadHistoricoContatos(clienteEmHistorico.id, 'historico-conteudo');
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
