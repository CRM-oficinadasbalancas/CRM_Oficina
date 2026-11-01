// Regras do chamado compartilhadas pelo sistema (PC) e pelo app do celular (/app/).
// As regras de verdade também estão no banco (gatilho validar_chamado); aqui ficam as
// mensagens amigáveis, as ações de cada perfil e a otimização da rota.
// Requer supabaseClient (carregado antes).

var CH_STATUS = {
  aberta: 'Aberto',
  em_andamento: 'Em atendimento',
  pendente: 'Pendente — oficina (aguardando orçamento)',
  orcamento_aprovado: 'Orçamento aprovado',
  nao_aprovada: 'Orçamento recusado',
  concluida: 'Fechado'
};
var CH_STATUS_CURTO = {
  aberta: 'Aberto', em_andamento: 'Em atendimento', pendente: 'Pendente',
  orcamento_aprovado: 'Orç. aprovado', nao_aprovada: 'Orç. recusado', concluida: 'Fechado'
};
var CH_ALFANUM = /^[A-Za-z0-9]{1,20}$/;
var CH_QTD = /^\d{1,5}(\.\d{1,2})?$/;

// Ações possíveis por perfil e situação do chamado.
function chAcoes(papel, c) {
  var a = [];
  var s = c.status;
  var admin = papel === 'admin';
  if (admin || papel === 'tecnico') {
    if (s === 'aberta') a.push('iniciar', 'pendencia');
    if (s === 'em_andamento' && c.tipo === 'campo') a.push('pendencia', 'fechar');
  }
  if (admin || papel === 'oficina_interna') {
    if (s === 'orcamento_aprovado') a.push('iniciar');
    if (s === 'em_andamento' && c.tipo === 'oficina') a.push('fechar');
  }
  if (admin || papel === 'programadora' || papel === 'recepcao') {
    if (s === 'pendente') a.push('aprovar', 'recusar');
  }
  if ((admin || papel === 'programadora') && c.tipo === 'campo' && (s === 'aberta' || s === 'em_andamento')) a.push('agendar');
  return a.filter(function (x, i) { return a.indexOf(x) === i; });
}

async function chHistorico(chamadoId, autorId, tipo, statusPara, texto) {
  return supabaseClient.from('chamado_historico').insert({
    chamado_id: chamadoId, autor_id: autorId, autor_nome: window.CH_AUTOR_NOME || null, tipo: tipo, status_para: statusPara || null, texto: texto
  });
}

async function chAtualizar(c, campos, autorId, tipoHist, texto) {
  var r = await supabaseClient.from('assistencias_tecnicas').update(campos).eq('id', c.id).select().single();
  if (r.error) return { erro: r.error.message };
  if (texto) await chHistorico(c.id, autorId, tipoHist, campos.status, texto);
  return { chamado: r.data };
}

async function chIniciar(c, autorId) {
  return chAtualizar(c, { status: 'em_andamento' }, autorId, 'inicio', 'Atendimento iniciado.');
}

function chCamposVedacao(f, obrigatorios) {
  var erros = [];
  function alfa(valor, rotulo) {
    if (valor && !CH_ALFANUM.test(valor)) erros.push(rotulo + ' deve ter só letras e números (sem espaços), até 20 caracteres.');
  }
  alfa(f.seloAntigo, 'Selo antigo'); alfa(f.seloNovo, 'Selo novo');
  alfa(f.lacreAntigo, 'Lacre antigo'); alfa(f.lacreNovo, 'Lacre novo');
  if (obrigatorios) {
    if (!f.seloAntigo && !f.seloAntigoAusente) erros.push('Informe o selo antigo ou marque "Não possui selo".');
    if (!f.seloNovo) erros.push('Informe o selo novo.');
    if (!f.lacreAntigo && !f.lacreAntigoAusente) erros.push('Informe o lacre antigo ou marque "Não possui lacre".');
    if (!f.lacreNovo) erros.push('Informe o lacre novo.');
  }
  return erros;
}

function chCamposDoFormulario(f) {
  return {
    selo_antigo: f.seloAntigoAusente ? null : (f.seloAntigo || null),
    selo_antigo_ausente: !!f.seloAntigoAusente,
    selo_novo: f.seloNovo || null,
    lacre_antigo: f.lacreAntigoAusente ? null : (f.lacreAntigo || null),
    lacre_antigo_ausente: !!f.lacreAntigoAusente,
    lacre_novo: f.lacreNovo || null
  };
}

// Pendência / transferência para a oficina interna: histórico obrigatório, selos e lacres opcionais.
async function chPendencia(c, autorId, f) {
  var texto = (f.historico || '').trim();
  if (!texto) return { erro: 'Conte no histórico o que foi feito e por que o equipamento vai para a oficina interna.' };
  var erros = chCamposVedacao(f, false);
  if (erros.length) return { erro: erros[0] };
  var campos = chCamposDoFormulario(f);
  campos.status = 'pendente';
  return chAtualizar(c, campos, autorId, 'pendencia', texto);
}

// Fechamento: histórico + selo/lacre novo e antigo obrigatórios (antigo dispensável pela marcação "Não possui").
async function chFechar(c, autorId, f) {
  var texto = (f.historico || '').trim();
  if (!texto) return { erro: 'Preencha o histórico do chamado (o que foi feito).' };
  var erros = chCamposVedacao(f, true);
  if (erros.length) return { erro: erros[0] };
  var qtdStr = (f.qtd || '').trim().replace(',', '.');
  var pecaId = f.pecaId || null;
  if (pecaId && !qtdStr) return { erro: 'Informe a quantidade usada da peça.' };
  if (!pecaId && qtdStr) return { erro: 'Escolha a peça da quantidade informada.' };
  if (qtdStr && !CH_QTD.test(qtdStr)) return { erro: 'Quantidade inválida (até 5 dígitos e 2 casas decimais).' };
  var campos = chCamposDoFormulario(f);
  campos.status = 'concluida';
  campos.resolucao = texto;
  campos.peca_id = pecaId;
  campos.quantidade_peca_utilizada = pecaId ? parseFloat(qtdStr) : null; // sem peça: o estoque não é baixado
  return chAtualizar(c, campos, autorId, 'fechamento', texto);
}

// Orçamento: aprovado segue para a oficina interna; recusado = devolver o equipamento ao cliente.
async function chDecidirOrcamento(c, autorId, aprovar, texto) {
  texto = (texto || '').trim();
  var base = aprovar ? 'Orçamento aprovado — segue para a oficina interna.' : 'Orçamento recusado — devolver o equipamento ao cliente sem conserto.';
  return chAtualizar(c, { status: aprovar ? 'orcamento_aprovado' : 'nao_aprovada' }, autorId, 'orcamento', texto ? base + ' ' + texto : base);
}

/* ===================== ROTA ===================== */

function chKm(a, b) {
  var R = 6371, rad = Math.PI / 180;
  var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

function chComprimento(origem, seq) {
  var total = 0, atual = origem;
  seq.forEach(function (p) { total += chKm(atual, p); atual = p; });
  return total;
}

// Melhor ordem de visita saindo de "origem": vizinho mais próximo + melhoria 2-opt (caminho aberto).
// Pontos sem coordenadas ficam no fim (na ordem de abertura recebida).
function chOtimizarRota(origem, pontos) {
  var ok = pontos.filter(function (p) { return isFinite(p.lat) && isFinite(p.lng) && p.lat != null && p.lng != null; });
  var sem = pontos.filter(function (p) { return ok.indexOf(p) === -1; });
  var restante = ok.slice(), seq = [], atual = origem;
  while (restante.length) {
    var melhor = 0, dist = Infinity;
    restante.forEach(function (p, i) { var d = chKm(atual, p); if (d < dist) { dist = d; melhor = i; } });
    atual = restante.splice(melhor, 1)[0];
    seq.push(atual);
  }
  var melhorou = true, voltas = 0;
  while (melhorou && voltas < 50) {
    melhorou = false; voltas++;
    for (var i = 0; i < seq.length - 1; i++) {
      for (var j = i + 1; j < seq.length; j++) {
        var cand = seq.slice(0, i).concat(seq.slice(i, j + 1).reverse(), seq.slice(j + 1));
        if (chComprimento(origem, cand) + 1e-9 < chComprimento(origem, seq)) { seq = cand; melhorou = true; }
      }
    }
  }
  return { ordem: seq.concat(sem), kmLinhaReta: chComprimento(origem, seq), kmEstimado: chComprimento(origem, seq) * 1.3, semLocalizacao: sem.length };
}

// Link que abre o aplicativo de mapas (Google Maps; no iPhone o navegador oferece Apple Mapas) com todas as paradas.
function chUrlRota(origem, paradas) {
  if (!paradas.length) return null;
  function pt(p) { return p.lat + ',' + p.lng; }
  var destino = paradas[paradas.length - 1];
  var meio = paradas.slice(0, -1).slice(0, 9);
  var url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(pt(destino));
  if (origem) url += '&origin=' + encodeURIComponent(pt(origem));
  if (meio.length) url += '&waypoints=' + meio.map(function (p) { return encodeURIComponent(pt(p)); }).join('%7C');
  return url;
}

function chUrlLocal(c) {
  var cl = c.clientes || c;
  if (cl.latitude != null && cl.longitude != null) return 'https://www.google.com/maps/search/?api=1&query=' + cl.latitude + ',' + cl.longitude;
  var end = [cl.logradouro, cl.numero, cl.bairro, cl.municipio, cl.uf].filter(Boolean).join(', ');
  return end ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(end) : null;
}

// Mais antigo primeiro (prioridade de atendimento).
function chPorAbertura(lista) {
  return lista.slice().sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
}

if (typeof module !== 'undefined') module.exports = { chOtimizarRota: chOtimizarRota, chKm: chKm, chUrlRota: chUrlRota, chAcoes: chAcoes, chPorAbertura: chPorAbertura, chCamposVedacao: chCamposVedacao };
