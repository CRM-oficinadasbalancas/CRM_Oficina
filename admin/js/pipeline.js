// Compartilhado por vendas.html, manutencao.html e pos-venda.html.
// Cada página define antes de incluir este script:
//   var PIPELINE_CATEGORIA = 'venda' | 'manutencao' | 'pos_venda';
//   var PIPELINE_LABEL = 'Vendas' | 'Manutenção' | 'Pós-venda';

var CATEGORIA_LABELS_PIPELINE = { venda: 'Venda', manutencao: 'Manutenção', pos_venda: 'Pós-venda' };

var currentUserId = null;
var pipelineClientes = [];
var pipelineHistoricoPorCliente = {};

async function loadPipeline() {
  var { data, error } = await supabaseClient
    .from('clientes')
    .select('*, cliente_historico(created_at, resultado)')
    .eq('categoria', PIPELINE_CATEGORIA)
    .order('razao_social', { ascending: true })
    .order('created_at', { referencedTable: 'cliente_historico', ascending: true });

  if (error) {
    showToast('Erro ao carregar ' + PIPELINE_LABEL.toLowerCase() + ': ' + error.message, 'error');
    return;
  }

  pipelineClientes = data || [];
  pipelineHistoricoPorCliente = {};
  pipelineClientes.forEach(function (c) {
    pipelineHistoricoPorCliente[c.id] = c.cliente_historico || [];
  });

  renderPipelineTable();
}

function renderPipelineTable() {
  var tbody = document.getElementById('pipeline-tbody');
  var filtro = document.getElementById('pipeline-filtro-situacao').value;
  var visiveis = pipelineClientes.filter(function (c) { return !filtro || c.situacao === filtro; });
  if (!visiveis.length) {
    tbody.innerHTML = '<tr><td colspan="7">Nenhum cliente neste filtro em ' + PIPELINE_LABEL + '.</td></tr>';
    return;
  }

  var opcoesCategoria = ['venda', 'manutencao', 'pos_venda'].map(function (cat) {
    return '<option value="' + cat + '">' + CATEGORIA_LABELS_PIPELINE[cat] + '</option>';
  }).join('');

  var comPrazo = visiveis.map(function (c) {
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
      '<td><button type="button" class="link-cliente" data-abrir="' + c.id + '">' + escHtml(c.razao_social || '') + '</button></td>' +
      '<td>' + contato + '</td>' +
      '<td>' + (c.canal_aquisicao || '—') + '</td>' +
      '<td>' + badgePrazo + '</td>' +
      '<td><select data-situacao="' + c.id + '">' + opcoesSituacaoHtml(c.situacao) + '</select></td>' +
      '<td><select data-mover="' + c.id + '">' + opcoesCategoria.replace(
        'value="' + PIPELINE_CATEGORIA + '"', 'value="' + PIPELINE_CATEGORIA + '" selected'
      ) + '</select></td>' +
      '<td class="row-actions">' +
        '<button data-abrir="' + c.id + '">Abrir</button>' +
        '<button data-remover="' + c.id + '">Remover do funil</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  tbody.querySelectorAll('[data-abrir]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      abrirClienteDetalhe(btn.dataset.abrir, { onChange: loadPipeline });
    });
  });

  tbody.querySelectorAll('[data-situacao]').forEach(function (select) {
    select.addEventListener('change', async function () {
      var { error } = await supabaseClient.from('clientes')
        .update({ situacao: select.value }).eq('id', select.dataset.situacao);
      if (error) {
        showToast('Erro ao atualizar situação: ' + error.message, 'error');
        return;
      }
      showToast('Situação atualizada para ' + SITUACAO_LABELS[select.value] + '.', 'ok');
      loadPipeline();
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
    canal_aquisicao: document.getElementById('pipeline-canal').value || null,
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

document.getElementById('pipeline-canal').innerHTML = opcoesCanalHtml('');
document.getElementById('pipeline-filtro-situacao').addEventListener('change', renderPipelineTable);

(async function () {
  var auth = await window.ADMIN_AUTH_READY;
  if (!auth) return;
  currentUserId = auth.session.user.id;
  loadPipeline();
})();
