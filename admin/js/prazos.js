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
// Pós-venda: sem histórico ainda → 30 dias pro 1º retorno. Depois:
//   - "positivo" → resolvido, não agenda mais nada.
//   - "negativo" → mais 30 dias.
//   - sem resultado → precisa definir (prioridade máxima).

var HORAS_VENDAS = [24, 72, 120];

function addHoras(data, horas) {
  return new Date(data.getTime() + horas * 60 * 60 * 1000);
}
function addDias(data, dias) {
  return new Date(data.getTime() + dias * 24 * 60 * 60 * 1000);
}

// historico: array de { created_at, resultado } ordenado ASC por created_at.
// Retorna: { data: Date|null, prioridadeMaxima: boolean, concluido: boolean }
// prioridadeMaxima = precisa de ação agora (sem histórico, ou sem resultado definido).
// concluido = já cumpriu toda a cadência prevista, não precisa mais de retorno.
function calcularProximoRetorno(cliente, historico) {
  var categoria = cliente.categoria;
  historico = historico || [];

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
      return { data: null, prioridadeMaxima: true, concluido: false };
    }
    var ultimaM = historico[historico.length - 1];
    if (!ultimaM.resultado) {
      return { data: null, prioridadeMaxima: true, concluido: false };
    }
    if (ultimaM.resultado === 'positivo') {
      var fechados = historico.filter(function (h) { return h.resultado === 'positivo'; });
      if (fechados.length >= 2) return { data: null, prioridadeMaxima: false, concluido: true };
      return { data: addDias(new Date(ultimaM.created_at), 60), prioridadeMaxima: false, concluido: false };
    }
    // negativo: cai na cadência de vendas
    var negativos = historico.filter(function (h) { return h.resultado === 'negativo'; });
    if (negativos.length > HORAS_VENDAS.length) return { data: null, prioridadeMaxima: false, concluido: true };
    var idx = Math.min(negativos.length - 1, HORAS_VENDAS.length - 1);
    return { data: addHoras(new Date(ultimaM.created_at), HORAS_VENDAS[idx]), prioridadeMaxima: false, concluido: false };
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

// Rótulos do seletor de resultado, adaptados por categoria.
var RESULTADO_LABELS_POR_CATEGORIA = {
  manutencao: { positivo: 'Fechou o serviço', negativo: 'Não fechou' },
  pos_venda: { positivo: 'Retorno positivo', negativo: 'Retorno negativo' }
};
