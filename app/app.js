// App de chamados (celular) — agenda do técnico, rota otimizada e atendimento do chamado.
// Perfis: tecnico (campo), oficina_interna e admin. Funciona pelo MESMO endereço do sistema:
// o sistema reconhece o celular e abre esta tela (sem instalar nada).
// Regras de negócio: ../admin/js/chamados-lib.js (e gatilhos no banco).

var estado = { sessao: null, perfil: null, chamados: [], pecas: [], atual: null, rota: null };
var OFICINA_FALLBACK = { lat: -22.9056, lng: -47.0608 }; // centro de Campinas, se o endereço não for localizado

function $(id) { return document.getElementById(id); }
function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function hojeISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function diasDesde(iso) { return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)); }
function fmtQtd(n) { return n == null ? '' : String(parseFloat(n)).replace('.', ','); }
function equipTxt(c) { var e = c.equipamentos || {}; return ([e.marca, e.modelo].filter(Boolean).join(' ') || 'Equipamento') + (e.numero_serie ? ' · série ' + e.numero_serie : ''); }
function enderecoTxt(cl) { return [[cl.logradouro, cl.numero].filter(Boolean).join(', '), cl.bairro, cl.municipio].filter(Boolean).join(' — '); }

var avisoTimer = null;
function avisar(msg, tipo) {
  var el = $('aviso');
  el.textContent = msg;
  el.className = 'aviso' + (tipo === 'erro' ? ' erro-aviso' : tipo === 'ok' ? ' ok' : '');
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(function () { el.hidden = true; }, 4200);
}

function mostrar(tela) {
  ['view-login', 'view-troca', 'view-sem-acesso', 'view-agenda', 'view-chamado'].forEach(function (id) { $(id).hidden = id !== tela; });
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
  if (r.error || !r.data) { await supabaseClient.auth.signOut(); estado.sessao = null; mostrar('view-login'); return; }
  estado.perfil = r.data;
  window.CH_AUTOR_NOME = r.data.nome_exibicao;
  if (['admin', 'tecnico', 'oficina_interna'].indexOf(r.data.role) === -1) { mostrar('view-sem-acesso'); return; }
  if (r.data.must_change_password) { mostrar('view-troca'); return; }
  mostrar('view-agenda');
  carregarAgenda();
}

$('form-login').addEventListener('submit', async function (e) {
  e.preventDefault();
  var erro = $('login-erro'); erro.hidden = true;
  var btn = $('login-btn'); btn.disabled = true; btn.textContent = 'Entrando...';
  var r = await supabaseClient.auth.signInWithPassword({ email: usernameToEmail($('login-usuario').value), password: $('login-senha').value });
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
    estado = { sessao: null, perfil: null, chamados: [], pecas: [], atual: null, rota: null };
    mostrar('view-login');
  });
});

/* ===================== AGENDA ===================== */

var SEL = '*, clientes(razao_social, telefone_empresa, logradouro, numero, bairro, municipio, uf, latitude, longitude), equipamentos(marca, modelo, numero_serie)';

async function carregarAgenda() {
  $('agenda').innerHTML = '<p class="vazio">Carregando...</p>';
  var papel = estado.perfil.role;
  var q = supabaseClient.from('assistencias_tecnicas').select(SEL);
  if (papel === 'tecnico') q = q.in('status', ['aberta', 'em_andamento']);
  else if (papel === 'oficina_interna') q = q.eq('tipo', 'oficina').in('status', ['orcamento_aprovado', 'em_andamento']);
  else q = q.in('status', ['aberta', 'em_andamento', 'orcamento_aprovado']);
  var r = await q.order('created_at', { ascending: true }).limit(500);
  if (r.error) { $('agenda').innerHTML = '<p class="vazio">Não foi possível carregar. Verifique a internet e toque em Atualizar.</p>'; return; }
  estado.chamados = r.data || [];
  estado.rota = null;
  $('rota-info').textContent = ''; $('rota-mapa').hidden = true;
  desenharAgenda();
}

function cartao(c, ordem) {
  var cl = c.clientes || {};
  var dias = diasDesde(c.created_at);
  var extra = '';
  if (estado.rota && estado.rota.dist && estado.rota.dist[c.id] != null) extra = '<span class="card-dist">+' + estado.rota.dist[c.id].toFixed(1).replace('.', ',') + ' km</span>';
  return '<button type="button" class="card s-' + c.status + '" data-id="' + c.id + '">' +
    '<div class="card-topo"><span class="card-num">' + (ordem ? '<span class="parada">' + ordem + '</span>' : '') + 'Nº ' + c.numero + '</span><span class="badge b-' + c.status + '">' + CH_STATUS_CURTO[c.status] + '</span></div>' +
    '<div class="card-cli">' + esc(cl.razao_social || '—') + '</div>' +
    '<div class="card-eq">' + esc(equipTxt(c)) + '</div>' +
    '<div class="card-end">' + esc(enderecoTxt(cl) || 'Endereço não informado') + ' ' + extra + '</div>' +
    '<div class="card-defeito">' + esc(c.descricao_defeito) + '</div>' +
    '<div class="card-data">Aberto há ' + dias + ' dia' + (dias === 1 ? '' : 's') + (c.tipo === 'oficina' ? ' · oficina interna' : '') + '</div>' +
  '</button>';
}

function secao(titulo, itens, numerar) {
  if (!itens.length) return '';
  return '<h3 class="sub-titulo">' + titulo + ' <span class="contagem">' + itens.length + '</span></h3>' +
    itens.map(function (c, i) { return cartao(c, numerar ? i + 1 : 0); }).join('');
}

function desenharAgenda() {
  var papel = estado.perfil.role;
  $('ag-nome').textContent = 'Olá, ' + (estado.perfil.nome_exibicao || '');
  var lista = chPorAbertura(estado.chamados); // prioridade: data de abertura mais antiga primeiro
  var html = '';
  var campo = lista.filter(function (c) { return c.tipo === 'campo'; });
  var oficina = lista.filter(function (c) { return c.tipo === 'oficina'; });
  var hoje = hojeISO();

  if (papel !== 'oficina_interna') {
    var atrasados = campo.filter(function (c) { return c.data_agendada && c.data_agendada < hoje; });
    var deHoje = campo.filter(function (c) { return !c.data_agendada || c.data_agendada === hoje; });
    var proximos = campo.filter(function (c) { return c.data_agendada && c.data_agendada > hoje; });
    if (estado.rota) deHoje = estado.rota.ordem; // ordem otimizada
    html += secao('Atrasados', atrasados, false);
    html += secao(estado.rota ? 'Hoje — rota otimizada' : 'Hoje (mais antigos primeiro)', deHoje, !!estado.rota);
    html += secao('Próximos dias', proximos, false);
    $('bloco-rota').hidden = !(deHoje.length > 1 || estado.rota);
  } else {
    $('bloco-rota').hidden = true;
  }
  if (papel !== 'tecnico') html += secao('Oficina interna — fila (mais antigos primeiro)', oficina, false);

  var n = estado.chamados.length;
  $('ag-sub').textContent = n ? ' · ' + n + ' chamado' + (n === 1 ? '' : 's') + ' em aberto' : '';
  $('agenda').innerHTML = html || '<p class="vazio">Nenhum chamado na sua agenda.</p>';
  $('agenda').querySelectorAll('.card').forEach(function (b) { b.addEventListener('click', function () { abrirChamado(b.dataset.id); }); });
}

$('btn-atualizar').addEventListener('click', carregarAgenda);

/* ===================== ROTA ===================== */

function posicaoAtual() {
  return new Promise(function (resolve) {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude, gps: true }); },
      function () { resolve(null); },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  });
}

async function origemDaRota() {
  var gps = await posicaoAtual();
  if (gps) return gps;
  try { var guardado = JSON.parse(localStorage.getItem('oficina_coord') || 'null'); if (guardado) return guardado; } catch (e) {}
  var pos = await geocodificarEndereco({ logradouro: 'Avenida Orosimbo Maia', numero: '1475', municipio: 'Campinas', uf: 'SP' });
  pos = pos || OFICINA_FALLBACK;
  try { localStorage.setItem('oficina_coord', JSON.stringify(pos)); } catch (e) {}
  return pos;
}

async function localizarFaltantes(lista) {
  var faltam = lista.filter(function (c) { var cl = c.clientes || {}; return cl.latitude == null || cl.longitude == null; });
  var feitos = {};
  for (var i = 0; i < faltam.length; i++) {
    var c = faltam[i], cl = c.clientes;
    if (feitos[c.cliente_id]) { cl.latitude = feitos[c.cliente_id].lat; cl.longitude = feitos[c.cliente_id].lng; continue; }
    $('rota-info').textContent = 'Localizando endereços no mapa (' + (i + 1) + ' de ' + faltam.length + ')...';
    var pos = await geocodificarEndereco(cl);
    if (pos) {
      cl.latitude = pos.lat; cl.longitude = pos.lng; feitos[c.cliente_id] = pos;
      supabaseClient.rpc('salvar_geocodigo', { p_cliente: c.cliente_id, p_lat: pos.lat, p_lng: pos.lng });
    }
  }
}

$('btn-rota').addEventListener('click', async function () {
  var btn = this; btn.disabled = true;
  $('rota-info').textContent = 'Calculando a melhor rota...';
  $('rota-mapa').hidden = true;
  var hoje = hojeISO();
  var doDia = chPorAbertura(estado.chamados.filter(function (c) { return c.tipo === 'campo' && (!c.data_agendada || c.data_agendada === hoje); }));
  if (doDia.length < 2) { $('rota-info').textContent = 'Precisa de pelo menos 2 chamados no dia para otimizar.'; btn.disabled = false; return; }

  await localizarFaltantes(doDia);
  var origem = await origemDaRota();
  var pontos = doDia.map(function (c) { var cl = c.clientes || {}; return { id: c.id, lat: cl.latitude, lng: cl.longitude, chamado: c }; });
  var res = chOtimizarRota(origem, pontos);

  var dist = {}, anterior = origem;
  res.ordem.forEach(function (p) {
    if (p.lat != null && p.lng != null) { dist[p.id] = chKm(anterior, p); anterior = p; }
  });
  estado.rota = { ordem: res.ordem.map(function (p) { return p.chamado; }), dist: dist };
  var url = chUrlRota(origem, res.ordem.filter(function (p) { return p.lat != null; }));
  desenharAgenda();
  $('rota-info').textContent = 'Saindo ' + (origem.gps ? 'da sua posição' : 'da oficina') + ': cerca de ' + res.kmEstimado.toFixed(0) + ' km de estrada em ' + (doDia.length - res.semLocalizacao) + ' paradas.' +
    (res.semLocalizacao ? ' ' + res.semLocalizacao + ' sem endereço localizado (ficam no fim).' : '');
  if (url) { $('rota-mapa').href = url; $('rota-mapa').hidden = false; }
  btn.disabled = false;
});

/* ===================== CHAMADO ===================== */

async function abrirChamado(id) {
  estado.atual = estado.chamados.find(function (c) { return c.id === id; });
  if (!estado.atual) return;
  mostrar('view-chamado');
  desenharChamado();
  carregarHistoricoChamado();
}

function desenharChamado() {
  var c = estado.atual, cl = c.clientes || {};
  $('ch-titulo').textContent = 'Chamado Nº ' + c.numero;
  var mapa = chUrlLocal(c);
  $('ch-cliente').innerHTML =
    '<div class="cli-nome">' + esc(cl.razao_social || '—') + '</div>' +
    (cl.telefone_empresa ? '<a class="linha-link" href="tel:' + esc(cl.telefone_empresa.replace(/[^\d+]/g, '')) + '">Ligar: ' + esc(cl.telefone_empresa) + '</a>' : '') +
    (enderecoTxt(cl) ? '<div class="linha-txt">' + esc(enderecoTxt(cl)) + '</div>' : '') +
    (mapa ? '<a class="btn btn-escuro btn-bloco" href="' + mapa + '" target="_blank" rel="noopener">Abrir no mapa</a>' : '');
  $('ch-dados').innerHTML =
    '<div class="par"><b>Status</b><span class="badge b-' + c.status + '">' + CH_STATUS[c.status] + '</span></div>' +
    '<div class="par"><b>Equipamento</b>' + esc(equipTxt(c)) + '</div>' +
    '<div class="par"><b>Defeito</b>' + esc(c.descricao_defeito) + '</div>' +
    '<div class="par"><b>Aberto em</b>' + new Date(c.created_at).toLocaleDateString('pt-BR') + ' (há ' + diasDesde(c.created_at) + ' dias)</div>' +
    (c.selo_antigo || c.selo_antigo_ausente ? '<div class="par"><b>Selo antigo</b>' + (c.selo_antigo_ausente ? 'Não possui' : esc(c.selo_antigo)) + '</div>' : '') +
    (c.lacre_antigo || c.lacre_antigo_ausente ? '<div class="par"><b>Lacre antigo</b>' + (c.lacre_antigo_ausente ? 'Não possui' : esc(c.lacre_antigo)) + '</div>' : '');

  var rot = { iniciar: 'Iniciar atendimento', pendencia: 'Pendente — enviar para a oficina', fechar: 'Fechar chamado' };
  var acoes = chAcoes(estado.perfil.role, c).filter(function (a) { return rot[a]; });
  $('ch-acoes').innerHTML = acoes.map(function (a) {
    return '<button type="button" class="btn ' + (a === 'pendencia' ? 'btn-escuro' : 'btn-vermelho') + ' btn-bloco" data-a="' + a + '">' + rot[a] + '</button>';
  }).join('') || '<p class="dica">Nenhuma ação disponível neste status.</p>';
  $('ch-acoes').querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { formAcao(b.dataset.a); }); });
  $('ch-form').innerHTML = '';
}

async function carregarHistoricoChamado() {
  $('ch-hist').innerHTML = '<p class="dica">Carregando...</p>';
  var r = await supabaseClient.from('chamado_historico').select('*').eq('chamado_id', estado.atual.id).order('created_at', { ascending: false });
  var h = r.data || [];
  $('ch-hist').innerHTML = h.length ? h.map(function (x) {
    return '<div class="hist-item"><small>' + new Date(x.created_at).toLocaleString('pt-BR') + (x.autor_nome ? ' · ' + esc(x.autor_nome) : '') + '</small>' + esc(x.texto) + '</div>';
  }).join('') : '<p class="dica">Sem registros ainda.</p>';
}

function vedacaoHtml(obrigatorio) {
  var c = estado.atual, ob = obrigatorio ? ' *' : '';
  return '<label for="f-selo-ant">Selo antigo' + ob + '</label><input id="f-selo-ant" type="text" maxlength="20" autocapitalize="characters" value="' + esc(c.selo_antigo || '') + '"' + (c.selo_antigo_ausente ? ' disabled' : '') + '>' +
    '<label class="marcar"><input type="checkbox" id="f-selo-aus"' + (c.selo_antigo_ausente ? ' checked' : '') + '> Não possui selo</label>' +
    '<label for="f-selo-novo">Selo novo' + ob + '</label><input id="f-selo-novo" type="text" maxlength="20" autocapitalize="characters" value="' + esc(c.selo_novo || '') + '">' +
    '<label for="f-lacre-ant">Lacre antigo' + ob + '</label><input id="f-lacre-ant" type="text" maxlength="20" autocapitalize="characters" value="' + esc(c.lacre_antigo || '') + '"' + (c.lacre_antigo_ausente ? ' disabled' : '') + '>' +
    '<label class="marcar"><input type="checkbox" id="f-lacre-aus"' + (c.lacre_antigo_ausente ? ' checked' : '') + '> Não possui lacre</label>' +
    '<label for="f-lacre-novo">Lacre novo' + ob + '</label><input id="f-lacre-novo" type="text" maxlength="20" autocapitalize="characters" value="' + esc(c.lacre_novo || '') + '">';
}

function ligarFlags() {
  [['f-selo-aus', 'f-selo-ant'], ['f-lacre-aus', 'f-lacre-ant']].forEach(function (p) {
    var chk = $(p[0]), inp = $(p[1]);
    chk.addEventListener('change', function () { inp.disabled = chk.checked; if (chk.checked) inp.value = ''; });
  });
}

function lerVedacao() {
  return {
    seloAntigo: $('f-selo-ant').value.trim(), seloAntigoAusente: $('f-selo-aus').checked, seloNovo: $('f-selo-novo').value.trim(),
    lacreAntigo: $('f-lacre-ant').value.trim(), lacreAntigoAusente: $('f-lacre-aus').checked, lacreNovo: $('f-lacre-novo').value.trim()
  };
}

async function formAcao(acao) {
  var c = estado.atual, box = $('ch-form');
  var rodape = '<p class="erro" id="f-erro" hidden></p><button type="button" class="btn btn-vermelho btn-bloco" id="f-ok">Confirmar</button>';

  if (acao === 'iniciar') {
    box.innerHTML = '<div class="caixa"><p>Iniciar o atendimento agora?</p>' + rodape + '</div>';
    $('f-ok').onclick = function () { executar(function () { return chIniciar(c, estado.sessao.user.id); }, 'Atendimento iniciado.', true); };
  } else if (acao === 'pendencia') {
    box.innerHTML = '<div class="caixa"><label for="f-hist">Histórico * — o que foi feito e por que vai para a oficina interna</label><textarea id="f-hist" rows="4" maxlength="5000"></textarea>' +
      '<details><summary>Selos e lacres (pode deixar em branco)</summary>' + vedacaoHtml(false) + '</details>' + rodape + '</div>';
    ligarFlags();
    $('f-ok').onclick = function () { var v = lerVedacao(); v.historico = $('f-hist').value; executar(function () { return chPendencia(c, estado.sessao.user.id, v); }, 'Enviado para a oficina interna (aguardando orçamento).', false); };
  } else if (acao === 'fechar') {
    if (!estado.pecas.length) {
      var rp = await supabaseClient.from('estoque_pecas').select('id, codigo, tipo_modelo, quantidade').order('codigo');
      estado.pecas = rp.data || [];
    }
    box.innerHTML = '<div class="caixa"><label for="f-hist">Histórico do chamado * — o que foi feito</label><textarea id="f-hist" rows="4" maxlength="5000"></textarea>' + vedacaoHtml(true) +
      '<label for="f-peca">Peça utilizada (se houve)</label><select id="f-peca"><option value="">Nenhuma — não baixa estoque</option>' +
      estado.pecas.map(function (p) { return '<option value="' + p.id + '">' + esc(p.codigo) + ' — ' + esc((p.tipo_modelo || '').slice(0, 40)) + ' (estoque: ' + fmtQtd(p.quantidade) + ')</option>'; }).join('') + '</select>' +
      '<label for="f-qtd">Quantidade usada</label><input id="f-qtd" type="text" inputmode="decimal" maxlength="8" placeholder="Ex: 1">' +
      '<p class="dica">O estoque só desce se você escolher uma peça.</p>' + rodape + '</div>';
    ligarFlags();
    $('f-ok').onclick = function () { var v = lerVedacao(); v.historico = $('f-hist').value; v.pecaId = $('f-peca').value; v.qtd = $('f-qtd').value; executar(function () { return chFechar(c, estado.sessao.user.id, v); }, 'Chamado fechado.', false); };
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function executar(fn, msgOk, ficaNoChamado) {
  var btn = $('f-ok'), erro = $('f-erro');
  erro.hidden = true; btn.disabled = true; btn.textContent = 'Salvando...';
  var r = await fn();
  btn.disabled = false; btn.textContent = 'Confirmar';
  if (r.erro) { erro.textContent = r.erro; erro.hidden = false; erro.scrollIntoView({ block: 'center' }); return; }
  avisar(msgOk, 'ok');
  if (ficaNoChamado) {
    var id = estado.atual.id;
    await carregarAgenda();
    estado.atual = estado.chamados.find(function (x) { return x.id === id; }) || r.chamado;
    desenharChamado();
    carregarHistoricoChamado();
  } else {
    mostrar('view-agenda');
    carregarAgenda();
  }
}

$('btn-voltar').addEventListener('click', function () { mostrar('view-agenda'); carregarAgenda(); });
window.addEventListener('offline', function () { avisar('Sem internet — o app precisa de conexão para salvar.', 'erro'); });

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

if (!ehCelular() && !/[?&]mobile=1/.test(location.search)) {
  location.replace('../admin/dashboard.html');
} else {
  iniciar();
}
