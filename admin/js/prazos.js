// Regras de cadência de follow-up por categoria. Compartilhado por
// dashboard.js, pipeline.js e clientes.js.
//
// Vendas: retornos encadeados em 24h, 72h e 120h — cada prazo conta a
// partir do retorno anterior (ou do cadastro, pro 1º). Independe de
// resultado.
//
// Manutenção: sem histórico ainda, precisa de 1º contato (prioridade
// máxima). Depois, olha o resultado da ÚLTIMA anotação:
//   - "positivo" (fechou o serviço) → check-in de manutenção preventiva
//     em 60 dias; even depois de 2 check-ins, não agenda mais nada.
//   - "negativo" (não fechou) → cai na cadência de Vendas (24h/72h/120h),
//     contando os "negativo" acumulados pra saber em qual das 3 etapas está.
//   - sem resultado marcado ainda → precisa definir (prioridade máxima).
//
// Revisita: lead de Manutenção que já fechou (situação Ganho, com ao menos um contato
// "Fechou o serviço") volta como "Revisão" 180 dias (semestral) depois do último contato
// positivo, e se repete a cada novo contato positivo. Contato negativo: cadência 24/72/120h
// (contados desde o último positivo). A situação Ganho (e a taxa de fechamento) não muda.
//
// Pós-venda: sem histórico ainda → 30 dias pro 1º retorno. Depois:
//   - "positivo" → resolvido, não agenda mais nada.
//   - "negativo" → mais 30 dias.
//   - sem resultado → precisa definir (prioridade máxima).

var HORAS_VENDAS = [24, 72, 120];
// Revisita de quem já fechou em Manutenção (semestral, se repete a cada contato positivo).
var REVISITA_DIAS = 180;
// A revisita só entra nas listas de trabalho quando falta até isso (dias) pra vencer.
var REVISITA_AVISO_DIAS = 30;

function addHoras(data, horas) {
  return new Date(data.getTime() + horas * 60 * 60 * 1000);
}
function addDias(data, dias) {
  return new Date(data.getTime() + dias * 24 * 60 * 60 * 1000);
}

// Revisita que merece aparecer nas listas de trabalho (vence em até REVISITA_AVISO_DIAS ou precisa de contato).
function revisitaEmAviso(retorno) {
  if (!retorno.revisao || retorno.concluido) return false;
  if (retorno.prioridadeMaxima) return true;
  return !!retorno.data && retorno.data.getTime() <= Date.now() + REVISITA_AVISO_DIAS * 86400000;
}

function marcarRevisao(retorno, revisao) {
  retorno.revisao = !!revisao;
  return retorno;
}

// historico: array de { created_at, resultado } ordenado ASC por created_at.
// Retorna: { data: Date|null, prioridadeMaxima: boolean, concluido: boolean }
// prioridadeMaxima = precisa de ação agora (sem histórico, ou sem resultado definido).
// concluido = já cumpriu toda a cadência prevista, não precisa mais de retorno.
function calcularProximoRetorno(cliente, historico) {
  var categoria = cliente.categoria;
  historico = historico || [];

  // Lead já encerrado (ganho/perdido) não gera mais retorno, exceto a revisão preventiva
  // de Manutenção (ganho com serviço fechado no histórico).
  var revisao = false;
  if (cliente.situacao && cliente.situacao !== 'ativo') {
    var fechouServico = categoria === 'manutencao' && cliente.situacao === 'ganho' &&
      historico.some(function (h) { return h.resultado === 'positivo'; });
    if (!fechouServico) {
      return { data: null, prioridadeMaxima: false, concluido: true, situacao: cliente.situacao };
    }
    revisao = true;
  }

  if (categoria === 'venda') {
    if (!historico.length) {
      return { data: addHoras(new Date(cliente.created_at), HORAS_VENDAS[0]), prioridadeMaxima: false, concluido: false };
    }
    if (historico.length >= HORAS_VENDAS.length) {
      return { data: null, prioridadeMaxima: false, concluido: true };
    }
    var ultima = historico[historico.length - 1];
    return { data: addHoras(new Date(ultima.created_at), HORAS_VENDAS[historico.length]), prioridadeMaxima: false, concluido: false };
  }

  if (categoria === 'manutencao') {
    if (!historico.length) {
      return marcarRevisao({ data: null, prioridadeMaxima: true, concluido: false }, revisao);
    }
    var ultimaM = historico[historico.length - 1];
    if (!ultimaM.resultado) {
      return marcarRevisao({ data: null, prioridadeMaxima: true, concluido: false }, revisao);
    }
    if (revisao) {
      var idxPos = -1;
      historico.forEach(function (h, i) { if (h.resultado === 'positivo') idxPos = i; });
      if (ultimaM.resultado === 'positivo') {
        return marcarRevisao({ data: addDias(new Date(ultimaM.created_at), REVISITA_DIAS), prioridadeMaxima: false, concluido: false }, true);
      }
      var negRev = historico.slice(idxPos + 1).filter(function (h) { return h.resultado === 'negativo'; }).length;
      if (negRev > HORAS_VENDAS.length) {
        // 3 tentativas sem sucesso: tenta de novo só no próximo semestre
        return marcarRevisao({ data: addDias(new Date(ultimaM.created_at), REVISITA_DIAS), prioridadeMaxima: false, concluido: false }, true);
      }
      return marcarRevisao({ data: addHoras(new Date(ultimaM.created_at), HORAS_VENDAS[Math.min(negRev - 1, HORAS_VENDAS.length - 1)]), prioridadeMaxima: false, concluido: false }, true);
    }
    if (ultimaM.resultado === 'positivo') {
      var fechados = historico.filter(function (h) { return h.resultado === 'positivo'; });
      if (fechados.length >= 2) return marcarRevisao({ data: null, prioridadeMaxima: false, concluido: true }, revisao);
      return marcarRevisao({ data: addDias(new Date(ultimaM.created_at), 60), prioridadeMaxima: false, concluido: false }, revisao);
    }
    // negativo: cai na cadência de vendas
    var negativos = historico.filter(function (h) { return h.resultado === 'negativo'; });
    if (negativos.length > HORAS_VENDAS.length) return marcarRevisao({ data: null, prioridadeMaxima: false, concluido: true }, revisao);
    var idx = Math.min(negativos.length - 1, HORAS_VENDAS.length - 1);
    return marcarRevisao({ data: addHoras(new Date(ultimaM.created_at), HORAS_VENDAS[idx]), prioridadeMaxima: false, concluido: false }, revisao);
  }

  if (categoria === 'pos_venda') {
    if (!historico.length) {
      return { data: addDias(new Date(cliente.created_at), 30), prioridadeMaxima: false, concluido: false };
    }
    var ultimaP = historico[historico.length - 1];
    if (!ultimaP.resultado) {
      return { data: null, prioridadeMaxima: true, concluido: false };
    }
    if (ultimaP.resultado === 'positivo') {
      return { data: null, prioridadeMaxima: false, concluido: true };
    }
    return { data: addDias(new Date(ultimaP.created_at), 30), prioridadeMaxima: false, concluido: false };
  }

  return { data: null, prioridadeMaxima: false, concluido: true };
}

// Texto curto pra exibir na UI (badge de prazo).
function formatarPrazo(retorno) {
  if (retorno.revisao && !retorno.concluido) {
    var base = formatarPrazo(Object.assign({}, retorno, { revisao: false }));
    return { texto: 'Revisão — ' + base.texto, classe: base.classe };
  }
  if (retorno.situacao === 'ganho') return { texto: 'Ganho', classe: 'badge-ok' };
  if (retorno.situacao === 'perdido') return { texto: 'Perdido', classe: '' };
  if (retorno.concluido) return { texto: 'Concluído', classe: 'badge-ok' };
  if (retorno.prioridadeMaxima) return { texto: 'Precisa de contato', classe: 'badge-danger' };
  if (!retorno.data) return { texto: '—', classe: '' };

  var diffMs = retorno.data.getTime() - Date.now();
  var diffDias = Math.round(diffMs / (1000 * 60 * 60 * 24));
  var diffHoras = Math.round(diffMs / (1000 * 60 * 60));

  if (diffMs < 0) {
    var atraso = Math.abs(diffDias) >= 1 ? Math.abs(diffDias) + ' dia(s)' : Math.abs(diffHoras) + ' hora(s)';
    return { texto: 'Atrasado (' + atraso + ')', classe: 'badge-danger' };
  }
  if (diffHoras <= 24) return { texto: 'Hoje/amanhã', classe: 'badge-warning' };
  if (diffDias <= 1) return { texto: 'Amanhã', classe: 'badge-warning' };
  return { texto: 'Em ' + diffDias + ' dia(s)', classe: '' };
}

// Rótulos do seletor de resultado, adaptados por categoria. Em Vendas o
// resultado não muda o cálculo do prazo (cadência fixa 24h/72h/120h), mas
// ainda é registrado — alimenta o alerta de "3 negativas seguidas".
var RESULTADO_LABELS_POR_CATEGORIA = {
  venda: { positivo: 'Positivo', negativo: 'Negativo (sem retorno / não quer contato)' },
  manutencao: { positivo: 'Fechou o serviço', negativo: 'Não fechou' },
  pos_venda: { positivo: 'Retorno positivo', negativo: 'Retorno negativo' }
};

// Canal de aquisição do lead (de onde ele veio) e situação do lead no funil.
var CANAIS_AQUISICAO = ['Google Ads', 'Instagram', 'Facebook', 'Meta Ads', 'Indicação', 'Cliente antigo', 'Passou em frente', 'Outro'];
var SITUACAO_LABELS = { ativo: 'Ativo', ganho: 'Ganho', perdido: 'Perdido' };

function opcoesCanalHtml(selecionado) {
  return '<option value="">—</option>' + CANAIS_AQUISICAO.map(function (c) {
    return '<option value="' + c + '"' + (c === selecionado ? ' selected' : '') + '>' + c + '</option>';
  }).join('');
}
function opcoesSituacaoHtml(selecionada) {
  return Object.keys(SITUACAO_LABELS).map(function (s) {
    return '<option value="' + s + '"' + (s === selecionada ? ' selected' : '') + '>' + SITUACAO_LABELS[s] + '</option>';
  }).join('');
}

// Semáforo do prazo: 'vermelho' (atrasado / precisa de contato), 'amarelo'
// (vence em até 24h) ou 'verde' (em dia). Mesmo corte do formatarPrazo.
function classificarUrgencia(retorno) {
  if (retorno.concluido) return 'verde';
  if (retorno.prioridadeMaxima) return 'vermelho';
  if (!retorno.data) return 'verde';
  var diffMs = retorno.data.getTime() - Date.now();
  if (diffMs < 0) return 'vermelho';
  if (diffMs <= 24 * 60 * 60 * 1000) return 'amarelo';
  return 'verde';
}
