// Ficha do cliente (modal) compartilhada por dashboard, funis e Clientes.
// Mostra os dados editáveis + o histórico de cara; o campo de nova informação
// só abre ao clicar em "Adicionar informação".
//
//   abrirClienteDetalhe(clienteId, { onChange: function () { ...recarregar a tela... } })
//
// Depende de: supabaseClient, showToast, prazos.js (canais, situação, resultados).

var STATUS_HISTORICO_LABELS = { aberto: 'Aberto', pendente: 'Pendente', continuacao: 'Continuação', fechado: 'Fechado' };
var STATUS_HISTORICO_BADGE = { aberto: 'badge-info', pendente: 'badge-warning', continuacao: 'badge-info', fechado: 'badge-ok' };

var detalheCliente = null;
var detalheOnChange = null;

function escHtml(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function garantirModalDetalhe() {
  if (document.getElementById('modal-cliente-detalhe')) return;
  var div = document.createElement('div');
  div.className = 'modal-overlay';
  div.id = 'modal-cliente-detalhe';
  div.innerHTML =
    '<div class="modal-box" style="max-width:760px;">' +
      '<h3 id="det-titulo">Cliente</h3>' +
      '<div class="form-grid" style="margin-bottom:12px;">' +
        '<div class="form-field"><label for="det-tipo">Tipo *</label><select id="det-tipo">' +
          '<option value="false">Lead (funis)</option><option value="true">Cliente da Oficina (Assistência Técnica)</option>' +
        '</select></div>' +
        '<div class="form-field span-2"><label for="det-nome">Nome *</label><input type="text" id="det-nome"></div>' +
        '<div class="form-field"><label for="det-telefone">Telefone</label><input type="text" id="det-telefone"></div>' +
        '<div class="form-field"><label for="det-email">E-mail</label><input type="email" id="det-email"></div>' +
        '<div class="form-field"><label for="det-canal">Canal de aquisição</label><select id="det-canal"></select></div>' +
        '<div class="form-field"><label for="det-categoria">Funil</label><select id="det-categoria">' +
          '<option value="">— Sem funil —</option>' +
          '<option value="venda">Venda</option><option value="manutencao">Manutenção</option><option value="pos_venda">Pós-venda</option>' +
        '</select></div>' +
        '<div class="form-field"><label for="det-situacao">Situação</label><select id="det-situacao"></select></div>' +
      '</div>' +
      '<p id="det-erro" class="error-message" style="display:none;"></p>' +
      '<div class="form-actions" style="margin-bottom:8px;">' +
        '<button type="button" class="btn btn-primary" id="det-salvar">Salvar dados</button>' +
        '<a class="btn btn-outline" id="det-cadastro" href="#">Cadastro completo</a>' +
      '</div>' +
      '<hr style="border:0; border-top:1px solid var(--gray-100); margin:18px 0;">' +
      '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px;">' +
        '<h4 style="margin:0; color:var(--navy-900);">Histórico</h4>' +
        '<button type="button" class="btn btn-primary" id="det-add-toggle">+ Adicionar informação</button>' +
      '</div>' +
      '<div id="det-add-box" style="display:none; background:var(--off-white); border-radius:10px; padding:14px; margin-bottom:14px;">' +
        '<div class="form-field" style="margin-bottom:10px;"><label for="det-info">Informação *</label>' +
          '<textarea id="det-info" rows="3" placeholder="O que foi tratado com o cliente..."></textarea></div>' +
        '<div class="form-grid" style="margin-bottom:10px;">' +
          '<div class="form-field"><label for="det-status">Status *</label><select id="det-status"></select></div>' +
          '<div class="form-field" id="det-resultado-wrap"><label for="det-resultado">Resultado do contato</label><select id="det-resultado"></select></div>' +
        '</div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-primary" id="det-add-salvar">Salvar informação</button>' +
          '<button type="button" class="btn btn-outline" id="det-add-cancelar">Cancelar</button>' +
        '</div>' +
      '</div>' +
      '<div id="det-historico">Carregando...</div>' +
      '<div class="form-actions"><button type="button" class="btn btn-outline" id="det-fechar">Fechar</button></div>' +
    '</div>';
  document.body.appendChild(div);

  document.getElementById('det-canal').innerHTML = opcoesCanalHtml('');
  document.getElementById('det-situacao').innerHTML = opcoesSituacaoHtml('ativo');
  document.getElementById('det-status').innerHTML = Object.keys(STATUS_HISTORICO_LABELS).map(function (s) {
    return '<option value="' + s + '">' + STATUS_HISTORICO_LABELS[s] + '</option>';
  }).join('');

  document.getElementById('det-fechar').addEventListener('click', fecharClienteDetalhe);
  div.addEventListener('click', function (e) { if (e.target === div) fecharClienteDetalhe(); });
  document.getElementById('det-salvar').addEventListener('click', salvarDadosDetalhe);
  document.getElementById('det-add-toggle').addEventListener('click', function () { mostrarAddInfo(true); });
  document.getElementById('det-add-cancelar').addEventListener('click', function () { mostrarAddInfo(false); });
  document.getElementById('det-add-salvar').addEventListener('click', salvarInformacaoDetalhe);
  document.getElementById('det-categoria').addEventListener('change', configurarResultadoDetalhe);
  document.getElementById('det-tipo').addEventListener('change', atualizarCamposDetalhePorTipo);
}

// Cliente da Oficina não usa funil nem canal: esconde (valores gravados ficam intactos).
function atualizarCamposDetalhePorTipo() {
  var ehCliente = document.getElementById('det-tipo').value === 'true';
  ['det-canal', 'det-categoria', 'det-situacao'].forEach(function (id) {
    document.getElementById(id).closest('.form-field').style.display = ehCliente ? 'none' : '';
  });
}

function mostrarAddInfo(abrir) {
  document.getElementById('det-add-box').style.display = abrir ? 'block' : 'none';
  document.getElementById('det-add-toggle').style.display = abrir ? 'none' : '';
  if (abrir) {
    document.getElementById('det-info').value = '';
    document.getElementById('det-status').value = 'aberto';
    configurarResultadoDetalhe();
    document.getElementById('det-info').focus();
  }
}

function configurarResultadoDetalhe() {
  var wrap = document.getElementById('det-resultado-wrap');
  var select = document.getElementById('det-resultado');
  var categoria = document.getElementById('det-categoria').value;
  var labels = RESULTADO_LABELS_POR_CATEGORIA[categoria];
  if (!labels) { wrap.style.display = 'none'; select.innerHTML = ''; return; }
  wrap.style.display = '';
  select.innerHTML = '<option value="">Sem resultado ainda</option>' +
    '<option value="positivo">' + labels.positivo + '</option>' +
    '<option value="negativo">' + labels.negativo + '</option>';
}

function fecharClienteDetalhe() {
  document.getElementById('modal-cliente-detalhe').classList.remove('open');
}

async function abrirClienteDetalhe(clienteId, opcoes) {
  garantirModalDetalhe();
  detalheOnChange = (opcoes && opcoes.onChange) || null;

  var { data, error } = await supabaseClient.from('clientes').select('*').eq('id', clienteId).single();
  if (error || !data) {
    showToast('Não foi possível abrir o cliente: ' + (error ? error.message : 'não encontrado'), 'error');
    return;
  }
  detalheCliente = data;

  document.getElementById('det-titulo').textContent = data.razao_social || 'Cliente';
  document.getElementById('det-nome').value = data.razao_social || '';
  document.getElementById('det-telefone').value = data.telefone_empresa || '';
  document.getElementById('det-email').value = data.email_empresa || '';
  document.getElementById('det-canal').innerHTML = opcoesCanalHtml(data.canal_aquisicao || '');
  document.getElementById('det-categoria').value = data.categoria || '';
  document.getElementById('det-situacao').innerHTML = opcoesSituacaoHtml(data.situacao || 'ativo');
  document.getElementById('det-tipo').value = String(!!data.eh_cliente);
  atualizarCamposDetalhePorTipo();
  document.getElementById('det-cadastro').href = 'clientes.html?editar=' + data.id;
  document.getElementById('det-erro').style.display = 'none';
  mostrarAddInfo(false);

  document.getElementById('modal-cliente-detalhe').classList.add('open');
  carregarHistoricoDetalhe();
}

async function carregarHistoricoDetalhe() {
  var box = document.getElementById('det-historico');
  box.textContent = 'Carregando...';
  var { data, error } = await supabaseClient
    .from('cliente_historico').select('*')
    .eq('cliente_id', detalheCliente.id)
    .order('created_at', { ascending: false });
  if (error) { box.textContent = 'Erro ao carregar histórico: ' + error.message; return; }
  if (!data || !data.length) {
    box.innerHTML = '<p style="color:var(--gray-400);">Nenhuma informação registrada ainda.</p>';
    return;
  }
  box.innerHTML = data.map(function (h) {
    var badges = '';
    if (h.status) badges += ' <span class="badge ' + STATUS_HISTORICO_BADGE[h.status] + '">' + STATUS_HISTORICO_LABELS[h.status] + '</span>';
    if (h.resultado === 'positivo') badges += ' <span class="badge badge-ok">Positivo</span>';
    else if (h.resultado === 'negativo') badges += ' <span class="badge badge-danger">Negativo</span>';
    return '<div style="border-bottom:1px solid var(--off-white); padding:10px 0;">' +
      '<div style="color:var(--gray-400); font-size:0.78rem; margin-bottom:4px;">' +
        new Date(h.created_at).toLocaleString('pt-BR') + badges + '</div>' +
      '<div>' + escHtml(h.anotacao) + '</div></div>';
  }).join('');
}

function avisarMudancaDetalhe() {
  if (detalheOnChange) detalheOnChange();
}

async function salvarDadosDetalhe() {
  var erroEl = document.getElementById('det-erro');
  erroEl.style.display = 'none';
  var nome = document.getElementById('det-nome').value.trim();
  var tel = document.getElementById('det-telefone').value.trim();
  var email = document.getElementById('det-email').value.trim();
  if (!nome) { erroEl.textContent = 'Nome é obrigatório.'; erroEl.style.display = 'block'; return; }
  if (!tel && !email) { erroEl.textContent = 'Preencha pelo menos o telefone ou o e-mail.'; erroEl.style.display = 'block'; return; }

  // Lead que virou ganho: oferece migrar pra Assistência Técnica.
  var tipoSel = document.getElementById('det-tipo');
  var situacaoNova = document.getElementById('det-situacao').value;
  if (situacaoNova === 'ganho' && detalheCliente.situacao !== 'ganho' && tipoSel.value === 'false') {
    if (confirm('Este lead virou cliente. Migrar para a Assistência Técnica (marcar como Cliente da Oficina)?')) {
      tipoSel.value = 'true';
    }
  }

  // Cliente da Oficina é sempre "ativo" e sem funil (exceto lead ganho que foi migrado).
  var categoriaFinal = document.getElementById('det-categoria').value || null;
  if (tipoSel.value === 'true' && situacaoNova !== 'ganho') {
    situacaoNova = 'ativo';
    categoriaFinal = null;
  }

  var btn = document.getElementById('det-salvar');
  btn.disabled = true;
  var { error } = await supabaseClient.from('clientes').update({
    razao_social: nome,
    telefone_empresa: tel || null,
    email_empresa: email || null,
    canal_aquisicao: document.getElementById('det-canal').value || null,
    categoria: categoriaFinal,
    situacao: situacaoNova,
    eh_cliente: tipoSel.value === 'true'
  }).eq('id', detalheCliente.id);
  btn.disabled = false;

  if (error) { erroEl.textContent = 'Erro ao salvar: ' + error.message; erroEl.style.display = 'block'; return; }
  detalheCliente.situacao = situacaoNova;
  document.getElementById('det-situacao').value = situacaoNova;
  document.getElementById('det-categoria').value = categoriaFinal || '';
  atualizarCamposDetalhePorTipo();
  document.getElementById('det-titulo').textContent = nome;
  showToast('Dados do cliente salvos.', 'ok');
  avisarMudancaDetalhe();
}

async function salvarInformacaoDetalhe() {
  var anotacao = document.getElementById('det-info').value.trim();
  if (!anotacao) { showToast('Escreva a informação antes de salvar.', 'warning'); return; }

  var categoria = document.getElementById('det-categoria').value;
  var resultado = (RESULTADO_LABELS_POR_CATEGORIA[categoria] && document.getElementById('det-resultado').value) || null;
  var sessao = await supabaseClient.auth.getSession();
  var autorId = sessao.data && sessao.data.session ? sessao.data.session.user.id : null;

  var btn = document.getElementById('det-add-salvar');
  btn.disabled = true;
  var { error } = await supabaseClient.from('cliente_historico').insert({
    cliente_id: detalheCliente.id,
    anotacao: anotacao,
    status: document.getElementById('det-status').value,
    resultado: resultado,
    created_by: autorId
  });
  btn.disabled = false;

  if (error) { showToast('Erro ao salvar informação: ' + error.message, 'error'); return; }
  showToast('Informação registrada.', 'ok');
  mostrarAddInfo(false);
  carregarHistoricoDetalhe();
  avisarMudancaDetalhe();
}
