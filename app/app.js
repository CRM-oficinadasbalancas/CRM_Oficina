// App de chamados (assistência técnica) — versão instalável (PWA) para o celular.
// Perfis: técnico e admin. Usa as mesmas tabelas do sistema (assistencias_tecnicas,
// equipamentos, estoque_pecas) e as mesmas regras do cadastro do computador.
// A baixa no estoque é feita pelo banco (gatilho) ao salvar o chamado.

var STATUS_LABELS = { aberta: 'Aberta', em_andamento: 'Em andamento', pendente: 'Pendente', concluida: 'Concluída', nao_aprovada: 'Não aprovado' };
var STATUS_FECHAMENTO = ['concluida', 'nao_aprovada'];
var ALFANUMERICO = /^[A-Za-z0-9]{1,20}$/;
var QUANTIDADE = /^\d{1,5}(\.\d{1,2})?$/;

var estado = {
  sessao: null, perfil: null,
  chamados: [], filtroStatus: '', busca: '',
  clientes: [], pecas: [], equipamentos: [],
  editando: null // chamado em edição (ou null = novo)
};

function $(id) { return document.getElementById(id); }
function esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtQtd(n) { return n == null ? '' : String(parseFloat(n)).replace('.', ','); }

var avisoTimer = null;
function avisar(msg, tipo) {
  var el = $('aviso');
  el.textContent = msg;
  el.className = 'aviso' + (tipo === 'erro' ? ' erro-aviso' : tipo === 'ok' ? ' ok' : '');
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(function () { el.hidden = true; }, 3800);
}

function mostrar(tela) {
  ['view-login', 'view-troca', 'view-sem-acesso', 'view-lista', 'view-form'].forEach(function (id) {
    $(id).hidden = id !== tela;
  });
  window.scrollTo(0, 0);
}

/* ===================== ENTRADA / SESSÃO ===================== */

async function iniciar() {
  var r = await supabaseClient.auth.getSession();
  estado.sessao = r.data.session;
  if (!estado.sessao) { mostrar('view-login'); return; }
  await carregarPerfil();
}

async function carregarPerfil() {
  var r = await supabaseClient.from('profiles').select('*').eq('id', estado.sessao.user.id).single();
  if (r.error || !r.data) {
    await supabaseClient.auth.signOut();
    estado.sessao = null;
    mostrar('view-login');
    return;
  }
  estado.perfil = r.data;
  if (['admin', 'tecnico'].indexOf(r.data.role) === -1) { mostrar('view-sem-acesso'); return; }
  if (r.data.must_change_password) { mostrar('view-troca'); return; }
  mostrar('view-lista');
  carregarChamados();
}

$('form-login').addEventListener('submit', async function (e) {
  e.preventDefault();
  var erro = $('login-erro'); erro.hidden = true;
  var btn = $('login-btn'); btn.disabled = true; btn.textContent = 'Entrando...';
  var r = await supabaseClient.auth.signInWithPassword({
    email: usernameToEmail($('login-usuario').value),
    password: $('login-senha').value
  });
  btn.disabled = false; btn.textContent = 'Entrar';
  if (r.error) { erro.textContent = 'Usuário ou senha inválidos.'; erro.hidden = false; return; }
  estado.sessao = r.data.session;
  $('login-senha').value = '';
  await carregarPerfil();
});

$('form-troca').addEventListener('submit', async function (e) {
  e.preventDefault();
  var erro = $('troca-erro'); erro.hidden = true;
  var s1 = $('troca-senha').value, s2 = $('troca-senha2').value;
  if (s1 !== s2) { erro.textContent = 'As senhas não conferem.'; erro.hidden = false; return; }
  var r = await supabaseClient.auth.updateUser({ password: s1 });
  if (r.error) { erro.textContent = 'Não foi possível trocar a senha: ' + r.error.message; erro.hidden = false; return; }
  await supabaseClient.from('profiles').update({ must_change_password: false }).eq('id', estado.sessao.user.id);
  $('troca-senha').value = ''; $('troca-senha2').value = '';
  await carregarPerfil();
});

document.querySelectorAll('[data-sair]').forEach(function (b) {
  b.addEventListener('click', async function () {
    await supabaseClient.auth.signOut();
    estado = { sessao: null, perfil: null, chamados: [], filtroStatus: '', busca: '', clientes: [], pecas: [], equipamentos: [], editando: null };
    mostrar('view-login');
  });
});

/* ===================== LISTA ===================== */

async function carregarChamados() {
  $('lista').innerHTML = '<p class="vazio">Carregando...</p>';
  var r = await supabaseClient
    .from('assistencias_tecnicas')
    .select('*, clientes(razao_social), equipamentos(marca, modelo, numero_serie)')
    .order('created_at', { ascending: false })
    .limit(300);
  if (r.error) {
    $('lista').innerHTML = '<p class="vazio">Não foi possível carregar os chamados. Verifique a internet e tente de novo.</p>';
    return;
  }
  estado.chamados = r.data || [];
  desenharLista();
}

function desenharLista() {
  var termo = estado.busca.trim().toLowerCase();
  var itens = estado.chamados.filter(function (c) {
    if (estado.filtroStatus && c.status !== estado.filtroStatus) return false;
    if (!termo) return true;
    var eq = c.equipamentos || {};
    var texto = [c.numero, c.clientes && c.clientes.razao_social, eq.marca, eq.modelo, eq.numero_serie, c.descricao_defeito].join(' ').toLowerCase();
    return texto.indexOf(termo) !== -1;
  });
  if (!itens.length) {
    $('lista').innerHTML = '<p class="vazio">' + (estado.chamados.length ? 'Nenhum chamado neste filtro.' : 'Nenhum chamado ainda. Toque em “Novo chamado”.') + '</p>';
    return;
  }
  $('lista').innerHTML = itens.map(function (c) {
    var eq = c.equipamentos || {};
    var equip = [eq.marca, eq.modelo].filter(Boolean).join(' ') || 'Equipamento';
    return '<button type="button" class="card s-' + c.status + '" data-id="' + c.id + '">' +
      '<div class="card-topo"><span class="card-num">Nº ' + c.numero + '</span><span class="badge b-' + c.status + '">' + (STATUS_LABELS[c.status] || c.status) + '</span></div>' +
      '<div class="card-cli">' + esc(c.clientes ? c.clientes.razao_social : '—') + '</div>' +
      '<div class="card-eq">' + esc(equip) + (eq.numero_serie ? ' · série ' + esc(eq.numero_serie) : '') + '</div>' +
      '<div class="card-defeito">' + esc(c.descricao_defeito) + '</div>' +
      '<div class="card-data">' + new Date(c.created_at).toLocaleDateString('pt-BR') + '</div>' +
    '</button>';
  }).join('');
  $('lista').querySelectorAll('.card').forEach(function (b) {
    b.addEventListener('click', function () { abrirForm(b.dataset.id); });
  });
}

$('busca').addEventListener('input', function () { estado.busca = this.value; desenharLista(); });
$('chips').addEventListener('click', function (e) {
  var chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('ativo'); });
  chip.classList.add('ativo');
  estado.filtroStatus = chip.dataset.status;
  desenharLista();
});
$('btn-novo').addEventListener('click', function () { abrirForm(null); });

/* ===================== FORMULÁRIO ===================== */

async function carregarApoio() {
  var res = await Promise.all([
    supabaseClient.from('clientes').select('id, razao_social, nome_fantasia').eq('eh_cliente', true).order('razao_social'),
    supabaseClient.from('estoque_pecas').select('id, codigo, tipo_modelo, quantidade, localidade').order('codigo')
  ]);
  estado.clientes = res[0].data || [];
  estado.pecas = res[1].data || [];
}

function opcoesClientes(filtro) {
  var f = (filtro || '').trim().toLowerCase();
  var lista = estado.clientes.filter(function (c) {
    return !f || (c.razao_social || '').toLowerCase().indexOf(f) !== -1 || (c.nome_fantasia || '').toLowerCase().indexOf(f) !== -1;
  });
  $('cli-select').innerHTML = '<option value="">— Selecione (' + lista.length + ') —</option>' + lista.map(function (c) {
    return '<option value="' + c.id + '">' + esc(c.razao_social) + (c.nome_fantasia ? ' (' + esc(c.nome_fantasia) + ')' : '') + '</option>';
  }).join('');
}

async function carregarEquipamentos(clienteId) {
  var sel = $('eq-select');
  $('eq-novo').hidden = true;
  if (!clienteId) { sel.innerHTML = '<option value="">Escolha o cliente primeiro</option>'; return; }
  sel.innerHTML = '<option value="">Carregando...</option>';
  var r = await supabaseClient.from('equipamentos').select('*').eq('cliente_id', clienteId).order('created_at', { ascending: false });
  estado.equipamentos = r.data || [];
  sel.innerHTML = '<option value="">— Selecione —</option>' + estado.equipamentos.map(function (eq) {
    return '<option value="' + eq.id + '">' + esc([eq.marca, eq.modelo].filter(Boolean).join(' ') || 'Equipamento') + ' · série ' + esc(eq.numero_serie) + '</option>';
  }).join('') + '<option value="__novo">+ Cadastrar novo equipamento</option>';
}

function opcoesPecas(selecionada) {
  $('peca').innerHTML = '<option value="">— Nenhuma —</option>' + estado.pecas.map(function (p) {
    return '<option value="' + p.id + '"' + (p.id === selecionada ? ' selected' : '') + '>' + esc(p.codigo) + ' — ' + esc((p.tipo_modelo || '').slice(0, 50)) + ' (estoque: ' + fmtQtd(p.quantidade) + ')</option>';
  }).join('');
  atualizarInfoPeca();
}

function atualizarInfoPeca() {
  var p = estado.pecas.find(function (x) { return x.id === $('peca').value; });
  $('peca-info').textContent = p ? 'Estoque atual: ' + fmtQtd(p.quantidade) + (p.localidade ? ' — ' + p.localidade : '') : '';
}

function atualizarObrigatorios() {
  $('res-obrig').hidden = STATUS_FECHAMENTO.indexOf($('status').value) === -1;
  $('bloco-peca').hidden = $('status').value === 'nao_aprovada';
}

async function abrirForm(id) {
  mostrar('view-form');
  $('form-erro').hidden = true;
  $('btn-salvar').disabled = true;
  await carregarApoio();
  $('btn-salvar').disabled = false;

  var c = id ? estado.chamados.find(function (x) { return x.id === id; }) : null;
  estado.editando = c;
  $('form-titulo').textContent = c ? 'Chamado Nº ' + c.numero : 'Novo chamado';
  $('btn-salvar').textContent = c ? 'Salvar alterações' : 'Salvar chamado';

  $('bloco-cliente').hidden = !!c;
  $('bloco-cliente-fixo').hidden = !c;
  if (c) {
    var eq = c.equipamentos || {};
    $('bloco-cliente-fixo').innerHTML = '<strong>' + esc(c.clientes ? c.clientes.razao_social : '—') + '</strong><br>' +
      '<span class="dica">' + esc([eq.marca, eq.modelo].filter(Boolean).join(' ') || 'Equipamento') + ' · série ' + esc(eq.numero_serie || '—') + '</span>';
  } else {
    $('cli-busca').value = '';
    opcoesClientes('');
    await carregarEquipamentos('');
    ['eq-marca', 'eq-modelo', 'eq-serie'].forEach(function (x) { $(x).value = ''; });
  }

  $('defeito').value = c ? c.descricao_defeito : '';
  $('status').value = c ? c.status : 'aberta';
  $('resolucao').value = c && c.resolucao ? c.resolucao : '';
  opcoesPecas(c ? c.peca_id : null);
  $('peca-qtd').value = c && c.quantidade_peca_utilizada != null ? String(parseFloat(c.quantidade_peca_utilizada)) : '';
  $('selo-antigo').value = c && c.selo_antigo ? c.selo_antigo : '';
  $('selo-novo').value = c && c.selo_novo ? c.selo_novo : '';
  $('lacre-antigo').value = c && c.lacre_antigo ? c.lacre_antigo : '';
  $('lacre-novo').value = c && c.lacre_novo ? c.lacre_novo : '';
  atualizarObrigatorios();
}

$('cli-busca').addEventListener('input', function () { opcoesClientes(this.value); carregarEquipamentos(''); });
$('cli-select').addEventListener('change', function () { carregarEquipamentos(this.value); });
$('eq-select').addEventListener('change', function () { $('eq-novo').hidden = this.value !== '__novo'; });
$('peca').addEventListener('change', atualizarInfoPeca);
$('status').addEventListener('change', atualizarObrigatorios);
$('btn-voltar').addEventListener('click', function () { mostrar('view-lista'); carregarChamados(); });

function erroForm(msg) { var el = $('form-erro'); el.textContent = msg; el.hidden = false; el.scrollIntoView({ block: 'center' }); return false; }

function campoAlfa(id, rotulo) {
  var v = $(id).value.trim();
  if (!v) return '';
  if (!ALFANUMERICO.test(v)) { erroForm(rotulo + ' deve ter só letras e números (sem espaços), até 20 caracteres.'); return null; }
  return v;
}

$('form-chamado').addEventListener('submit', async function (e) {
  e.preventDefault();
  $('form-erro').hidden = true;
  var c = estado.editando;

  var clienteId = c ? c.cliente_id : $('cli-select').value;
  var equipamentoId = c ? c.equipamento_id : $('eq-select').value;
  if (!c) {
    if (!clienteId) return erroForm('Selecione o cliente.');
    if (!equipamentoId) return erroForm('Selecione (ou cadastre) o equipamento.');
  }
  var defeito = $('defeito').value.trim();
  if (!defeito) return erroForm('Descreva o defeito.');

  var status = $('status').value;
  var resolucao = $('resolucao').value.trim();
  if (STATUS_FECHAMENTO.indexOf(status) !== -1 && !resolucao) return erroForm('Informe a Resolução para fechar como "' + STATUS_LABELS[status] + '".');

  var pecaId = $('peca').value || null;
  var qtdStr = $('peca-qtd').value.trim().replace(',', '.');
  var qtd = qtdStr ? parseFloat(qtdStr) : null;
  if (status === 'nao_aprovada') { pecaId = null; qtd = null; qtdStr = ''; } // reparo não aprovado: nada foi usado
  if (pecaId && !qtdStr) return erroForm('Informe a quantidade usada da peça.');
  if (qtdStr && !pecaId) return erroForm('Escolha a peça da quantidade informada.');
  if (qtdStr && !QUANTIDADE.test(qtdStr)) return erroForm('Quantidade inválida (até 5 dígitos, 2 casas decimais).');

  var seloAntigo = campoAlfa('selo-antigo', 'Selo antigo'); if (seloAntigo === null) return;
  var seloNovo = campoAlfa('selo-novo', 'Selo novo'); if (seloNovo === null) return;
  var lacreAntigo = campoAlfa('lacre-antigo', 'Lacre antigo'); if (lacreAntigo === null) return;
  var lacreNovo = campoAlfa('lacre-novo', 'Lacre novo'); if (lacreNovo === null) return;

  var btn = $('btn-salvar');
  btn.disabled = true; btn.textContent = 'Salvando...';

  // Equipamento novo: cadastra antes do chamado
  if (!c && equipamentoId === '__novo') {
    var serie = $('eq-serie').value.trim();
    if (!ALFANUMERICO.test(serie)) { btn.disabled = false; btn.textContent = 'Salvar chamado'; return erroForm('Nº de série deve ter só letras e números (sem espaços), até 20 caracteres.'); }
    var novoEq = await supabaseClient.from('equipamentos').insert({
      cliente_id: clienteId, marca: $('eq-marca').value.trim() || null, modelo: $('eq-modelo').value.trim() || null,
      numero_serie: serie, created_by: estado.sessao.user.id
    }).select().single();
    if (novoEq.error) { btn.disabled = false; btn.textContent = 'Salvar chamado'; return erroForm('Erro ao cadastrar equipamento: ' + novoEq.error.message); }
    equipamentoId = novoEq.data.id;
  }

  // "Pendente" congela o prazo: guarda quando entrou no status e preserva enquanto continuar pendente.
  var pausadoEm = null;
  if (status === 'pendente') {
    pausadoEm = (c && c.status === 'pendente' && c.pausado_em) ? c.pausado_em : new Date().toISOString();
  }

  var payload = {
    descricao_defeito: defeito, status: status, resolucao: resolucao || null,
    peca_id: pecaId, quantidade_peca_utilizada: qtd, pausado_em: pausadoEm,
    selo_antigo: seloAntigo || null, selo_novo: seloNovo || null,
    lacre_antigo: lacreAntigo || null, lacre_novo: lacreNovo || null
  };

  var r;
  if (c) {
    r = await supabaseClient.from('assistencias_tecnicas').update(payload).eq('id', c.id).select().single();
  } else {
    payload.cliente_id = clienteId; payload.equipamento_id = equipamentoId; payload.created_by = estado.sessao.user.id;
    r = await supabaseClient.from('assistencias_tecnicas').insert(payload).select().single();
  }
  btn.disabled = false; btn.textContent = c ? 'Salvar alterações' : 'Salvar chamado';

  if (r.error) return erroForm('Erro ao salvar: ' + r.error.message);

  avisar(c ? 'Chamado atualizado.' : 'Chamado Nº ' + r.data.numero + ' criado.', 'ok');
  mostrar('view-lista');
  carregarChamados();
});

/* ===================== CELULAR x COMPUTADOR ===================== */

// Sem instalação: o mesmo endereço do sistema serve os dois. No computador esta tela
// manda para o sistema completo; ?mobile=1 deixa abrir a tela de chamados no PC.
function ehCelular() {
  var ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
if (/[?&]mobile=1/.test(location.search)) { try { sessionStorage.removeItem('crm_forcar_desktop'); } catch (e) {} }

// Versão antiga do app instalável: tira o service worker e o cache, se existirem.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (regs) { regs.forEach(function (r) { r.unregister(); }); }).catch(function () {});
  if (window.caches) caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); }).catch(function () {});
}

window.addEventListener('offline', function () { avisar('Sem internet — o app precisa de conexão para salvar.', 'erro'); });

if (!ehCelular() && !/[?&]mobile=1/.test(location.search)) {
  location.replace('../admin/dashboard.html');
} else {
  iniciar();
}
