// Regras do chamado compartilhadas pelo sistema (PC) e pelo app do celular (/app/).
// As regras de verdade também estão no banco (gatilho validar_chamado); aqui ficam as
// mensagens amigáveis, as ações de cada perfil e a otimização da rota.
// Requer supabaseClient (carregado antes).

var CH_STATUS = {
  aberta: 'Aberto',
  em_andamento: 'Em atendimento',
  pendente: 'Aguardando orçamento (recepção)',
  orcamento_aprovado: 'Orçamento aprovado',
  nao_aprovada: 'Orçamento recusado — devolver ao cliente',
  concluida: 'Fechado'
};
var CH_STATUS_CURTO = {
  aberta: 'Aberto', em_andamento: 'Em atendimento', pendente: 'Aguard. orçamento',
  orcamento_aprovado: 'Orç. aprovado', nao_aprovada: 'Orç. recusado', concluida: 'Fechado'
};
var CH_ALFANUM = /^[A-Za-z0-9]{1,20}$/;
var CH_SEM_SERIE = 'NÃO CONSTA';

// Nº de série: só letras e números (até 20, sem espaços) ou a expressão NÃO CONSTA, permitida apenas
// quando a balança não possui número de série. Devolve { valor } normalizado ou { erro }.
function chNormalizarSerie(texto) {
  var s = String(texto || '').trim().replace(/\s+/g, ' ');
  if (!s) return { erro: 'Informe o nº de série. Se a balança não possuir, marque "A balança não possui número de série".' };
  var semAcento = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (semAcento === 'NAO CONSTA') return { valor: CH_SEM_SERIE };
  if (CH_ALFANUM.test(s)) return { valor: s.toUpperCase() };
  return { erro: 'Nº de série: use só letras e números (sem espaços, traços ou barras), até 20 caracteres. A expressão NÃO CONSTA só é permitida quando a balança não possui número de série.' };
}

var CH_QTD = /^\d{1,5}(\.\d{1,2})?$/;

// Número do chamado: OF-0001 (oficina interna) ou EX-0001 (rua).
function chNumero(c) { return c.codigo || ('Nº ' + c.numero); }

function chMoeda(v) {
  if (v == null || v === '' || isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Peças do chamado (orçamento e serviço): várias por chamado, com o preço de venda do momento.
async function chCarregarItens(chamadoId) {
  var r = await supabaseClient.from('chamado_itens').select('id, quantidade, preco_unit, peca_id, estoque_pecas(codigo, tipo_modelo, marca)')
    .eq('chamado_id', chamadoId).order('created_at', { ascending: true });
  return r.data || [];
}

function chTotalItens(itens) {
  var total = 0, semPreco = 0;
  (itens || []).forEach(function (i) {
    if (i.preco_unit == null) semPreco++; else total += Number(i.quantidade) * Number(i.preco_unit);
  });
  return { total: total, semPreco: semPreco };
}

async function chAddItem(chamadoId, pecaId, qtdTxt, autorId) {
  var q = String(qtdTxt || '').trim().replace(',', '.');
  if (!pecaId) return { erro: 'Escolha a peça.' };
  if (!q) return { erro: 'Informe a quantidade.' };
  if (!CH_QTD.test(q) || parseFloat(q) <= 0) return { erro: 'Quantidade inválida (use um número maior que zero, até 2 casas decimais).' };
  var r = await supabaseClient.from('chamado_itens').insert({ chamado_id: chamadoId, peca_id: pecaId, quantidade: parseFloat(q), created_by: autorId });
  return r.error ? { erro: r.error.message } : {};
}

async function chRemoverItem(itemId) {
  var r = await supabaseClient.from('chamado_itens').delete().eq('id', itemId);
  return r.error ? { erro: r.error.message } : {};
}

// Tabela das peças com preços e total (editavel = mostra o botão de remover).
function chItensTabelaHtml(itens, editavel) {
  function e(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  if (!itens || !itens.length) return '<p class="ch-itens-vazio">Nenhuma peça informada.</p>';
  var t = chTotalItens(itens);
  var linhas = itens.map(function (i) {
    var p = i.estoque_pecas || {};
    var sub = i.preco_unit == null ? null : Number(i.quantidade) * Number(i.preco_unit);
    return '<tr><td>' + e(p.codigo) + ' — ' + e((p.tipo_modelo || '').slice(0, 40)) + (p.marca ? '<br><small>' + e(p.marca) + '</small>' : '') + '</td>' +
      '<td class="n">' + Number(i.quantidade).toLocaleString('pt-BR') + '</td><td class="n">' + chMoeda(i.preco_unit) + '</td><td class="n">' + chMoeda(sub) + '</td>' +
      (editavel ? '<td><button type="button" class="ch-item-rm" data-rm="' + i.id + '" aria-label="Remover peça" title="Remover">&times;</button></td>' : '') + '</tr>';
  }).join('');
  return '<table class="ch-itens"><thead><tr><th>Peça</th><th class="n">Qtd</th><th class="n">Preço</th><th class="n">Subtotal</th>' + (editavel ? '<th></th>' : '') + '</tr></thead><tbody>' + linhas +
    '</tbody><tfoot><tr><td colspan="3"><b>Total</b></td><td class="n"><b>' + chMoeda(t.total) + '</b></td>' + (editavel ? '<td></td>' : '') + '</tr></tfoot></table>' +
    (t.semPreco ? '<p class="ch-itens-aviso">' + t.semPreco + ' peça(s) sem preço de venda cadastrado no estoque (fora do total).</p>' : '');
}

// Ações possíveis por perfil e situação do chamado.
function chAcoes(papel, c) {
  var a = [];
  var s = c.status;
  var admin = papel === 'admin';
  // Técnico de rua (chamado EX): inicia, envia para orçamento (pela anotação), executa e fecha, devolve se recusado
  // ou transfere para a oficina interna.
  if ((admin || papel === 'tecnico') && c.tipo === 'campo') {
    if (s === 'aberta') a.push('iniciar', 'pendencia');
    if (s === 'em_andamento') a.push('pendencia', 'fechar');
    if (s === 'orcamento_aprovado') a.push('iniciar', 'fechar');
    if (s === 'nao_aprovada') a.push('devolver');
  }
  // Oficina interna: a fila dela é Aberto, Em atendimento e Orçamento aprovado. Para pedir orçamento usa
  // "Adicionar anotação" + "Enviar para orçamento". Orçamento recusado: fecha e devolve o equipamento.
  if ((admin || papel === 'oficina_interna') && c.tipo === 'oficina') {
    if (s === 'aberta' || s === 'orcamento_aprovado') a.push('iniciar');
    if (s === 'aberta' || s === 'em_andamento' || s === 'orcamento_aprovado') a.push('fechar');
    if (s === 'nao_aprovada') a.push('devolver');
  }
  if (admin || papel === 'programadora' || papel === 'recepcao') {
    if (s === 'pendente') a.push('aprovar', 'recusar');
  }
  if ((admin || papel === 'programadora') && c.tipo === 'campo' && (s === 'aberta' || s === 'em_andamento')) a.push('agendar');
  // faturamento: só o Financeiro (e o admin)
  if ((admin || papel === 'financeiro') && chAFaturar(c)) a.push('faturar');
  // anotação no histórico (diagnóstico, observação): qualquer perfil do chamado, enquanto ele não está encerrado
  if (admin || ((papel === 'tecnico' || papel === 'oficina_interna' || papel === 'programadora' || papel === 'recepcao') && s !== 'concluida' && s !== 'nao_aprovada')) a.push('anotar');
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
  if (texto) await chHistorico(c.id, autorId, tipoHist, r.data.status, texto);
  return { chamado: r.data };
}

// Chamado fechado a faturar: oficina sempre; rua só se passou por orçamento. Devolvido sem conserto não fatura.
function chAFaturar(c) { return c.status === 'concluida' && !c.devolvido && !c.faturado_em && (c.tipo === 'oficina' || !!c.orcamento_em); }

async function chFaturar(c, autorId, texto) {
  texto = (texto || '').trim();
  var r = await supabaseClient.from('assistencias_tecnicas').update({ faturado_em: new Date().toISOString() }).eq('id', c.id).select().single();
  if (r.error) return { erro: r.error.message };
  await chHistorico(c.id, autorId, 'nota', r.data.status, 'Serviço faturado.' + (texto ? ' ' + texto : ''));
  return { chamado: r.data };
}

// A oficina pode pedir orçamento a partir de uma anotação: o chamado vai para a recepção (Aguardando orçamento).
function chPodeEnviarOrcamento(papel, c) {
  var meu = (papel === 'admin') || (papel === 'oficina_interna' && c.tipo === 'oficina') || (papel === 'tecnico' && c.tipo === 'campo');
  return meu && (c.status === 'aberta' || c.status === 'em_andamento' || c.status === 'orcamento_aprovado');
}

async function chEnviarOrcamento(c, autorId, texto) {
  texto = (texto || '').trim();
  if (!texto) return { erro: 'Escreva na anotação o que precisa de orçamento (peças, mão de obra, problema encontrado).' };
  return chAtualizar(c, { status: 'pendente' }, autorId, 'pendencia', 'Enviado para orçamento (recepção): ' + texto);
}

// Orçamento recusado: a oficina fecha o chamado e devolve o equipamento. Selos e lacres continuam os antigos.
async function chDevolver(c, autorId, texto) {
  texto = (texto || '').trim();
  if (!texto) return { erro: 'Escreva uma observação da devolução (ex.: equipamento devolvido ao cliente sem conserto).' };
  return chAtualizar(c, { status: 'concluida', resolucao: texto }, autorId, 'fechamento', 'Equipamento devolvido ao cliente sem conserto (orçamento recusado). Selos e lacres continuam os antigos. ' + texto);
}

// Anotação livre no histórico do chamado (não muda status nem campos do chamado).
async function chAnotar(c, autorId, texto) {
  texto = (texto || '').trim();
  if (!texto) return { erro: 'Escreva a anotação.' };
  var r = await chHistorico(c.id, autorId, 'nota', c.status, texto);
  if (r.error) return { erro: r.error.message };
  return { chamado: c };
}

async function chIniciar(c, autorId) {
  var semAprovacao = c.status === 'pendente' && c.tipo === 'oficina';
  return chAtualizar(c, { status: 'em_andamento' }, autorId, 'inicio', 'Atendimento iniciado' + (semAprovacao ? ' (orçamento ainda não aprovado).' : '.'));
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
  campos.tipo = 'oficina';    // o chamado vira da oficina interna (mantém o número EX) e entra na fila dela
  campos.status = 'aberta';
  return chAtualizar(c, campos, autorId, 'pendencia', 'Transferido para a oficina interna: ' + texto);
}

// Fechamento: histórico + selo/lacre novo e antigo obrigatórios (antigo dispensável pela marcação "Não possui").
async function chFechar(c, autorId, f) {
  var texto = (f.historico || '').trim();
  if (!texto) return { erro: 'Preencha o histórico do chamado (o que foi feito).' };
  var erros = chCamposVedacao(f, true);
  if (erros.length) return { erro: erros[0] };
  var campos = chCamposDoFormulario(f);
  campos.status = 'concluida';
  campos.resolucao = texto;
  // as peças usadas são as da lista do chamado (o estoque baixa ao fechar; sem peças, não baixa)
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

if (typeof module !== 'undefined') module.exports = { chNumero: chNumero, chTotalItens: chTotalItens, chPodeEnviarOrcamento: chPodeEnviarOrcamento, chAFaturar: chAFaturar, chOtimizarRota: chOtimizarRota, chKm: chKm, chUrlRota: chUrlRota, chAcoes: chAcoes, chPorAbertura: chPorAbertura, chCamposVedacao: chCamposVedacao };
