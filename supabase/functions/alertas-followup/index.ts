// Roda periodicamente (agendado via pg_cron, ver migração 0007) e:
//   1. Manda e-mail pro gerente comercial quando um cliente fica 12 HORAS
//      ÚTEIS atrasado sem justificativa (sem novo contato registrado).
//   2. Manda e-mail pro gerente quando um cliente acumula 3 respostas
//      "negativo" SEGUIDAS no histórico (reseta se tiver um "positivo").
//
// Horas úteis: segunda a sexta, 08h-18h, com almoço 13h-14h fora da conta.
// Fuso: horário de Brasília fixo (UTC-3, sem horário de verão).
//
// Idempotência: cada alerta já disparado fica registrado em
// alertas_enviados (cliente_id + tipo + chave, unique) — se a inserção
// falhar por duplicidade, o e-mail não é reenviado.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const GERENTE_EMAIL = 'lucasbalancas@hotmail.com';
const REMETENTE = 'CRM Oficina das Balanças <onboarding@resend.dev>';

const HORAS_VENDAS = [24, 72, 120];
const TZ_OFFSET_HORAS = -3; // Horário de Brasília, sem DST

const CATEGORIA_LABEL: Record<string, string> = {
  venda: 'Vendas', manutencao: 'Manutenção', pos_venda: 'Pós-venda'
};

interface HistoricoEntry { created_at: string; resultado: string | null; }
interface Cliente {
  id: string; razao_social: string; categoria: string; created_at: string;
  telefone_empresa: string | null; email_empresa: string | null;
}
interface Retorno { data: Date | null; prioridadeMaxima: boolean; concluido: boolean; }

function addHoras(data: Date, horas: number): Date {
  return new Date(data.getTime() + horas * 60 * 60 * 1000);
}
function addDias(data: Date, dias: number): Date {
  return new Date(data.getTime() + dias * 24 * 60 * 60 * 1000);
}

// Porta fiel de admin/js/prazos.js (calcularProximoRetorno) — mantenha as
// duas versões em sincronia se a regra de cadência mudar.
function calcularProximoRetorno(cliente: Cliente, historico: HistoricoEntry[]): Retorno {
  const categoria = cliente.categoria;

  if (categoria === 'venda') {
    if (!historico.length) {
      return { data: addHoras(new Date(cliente.created_at), HORAS_VENDAS[0]), prioridadeMaxima: false, concluido: false };
    }
    if (historico.length >= HORAS_VENDAS.length) {
      return { data: null, prioridadeMaxima: false, concluido: true };
    }
    const ultima = historico[historico.length - 1];
    return { data: addHoras(new Date(ultima.created_at), HORAS_VENDAS[historico.length]), prioridadeMaxima: false, concluido: false };
  }

  if (categoria === 'manutencao') {
    if (!historico.length) return { data: null, prioridadeMaxima: true, concluido: false };
    const ultimaM = historico[historico.length - 1];
    if (!ultimaM.resultado) return { data: null, prioridadeMaxima: true, concluido: false };
    if (ultimaM.resultado === 'positivo') {
      const fechados = historico.filter((h) => h.resultado === 'positivo');
      if (fechados.length >= 2) return { data: null, prioridadeMaxima: false, concluido: true };
      return { data: addDias(new Date(ultimaM.created_at), 60), prioridadeMaxima: false, concluido: false };
    }
    const negativos = historico.filter((h) => h.resultado === 'negativo');
    if (negativos.length > HORAS_VENDAS.length) return { data: null, prioridadeMaxima: false, concluido: true };
    const idx = Math.min(negativos.length - 1, HORAS_VENDAS.length - 1);
    return { data: addHoras(new Date(ultimaM.created_at), HORAS_VENDAS[idx]), prioridadeMaxima: false, concluido: false };
  }

  if (categoria === 'pos_venda') {
    if (!historico.length) {
      return { data: addDias(new Date(cliente.created_at), 30), prioridadeMaxima: false, concluido: false };
    }
    const ultimaP = historico[historico.length - 1];
    if (!ultimaP.resultado) return { data: null, prioridadeMaxima: true, concluido: false };
    if (ultimaP.resultado === 'positivo') return { data: null, prioridadeMaxima: false, concluido: true };
    return { data: addDias(new Date(ultimaP.created_at), 30), prioridadeMaxima: false, concluido: false };
  }

  return { data: null, prioridadeMaxima: false, concluido: true };
}

function paraLocal(dataUtc: Date): Date {
  return new Date(dataUtc.getTime() + TZ_OFFSET_HORAS * 60 * 60 * 1000);
}

function isHoraUtil(dataUtc: Date): boolean {
  const local = paraLocal(dataUtc);
  const dia = local.getUTCDay(); // já deslocado pro fuso local
  if (dia === 0 || dia === 6) return false; // domingo, sábado
  const hora = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (hora < 8 || hora >= 18) return false;
  if (hora >= 13 && hora < 14) return false;
  return true;
}

// Soma as horas úteis entre duas datas, avançando hora a hora (com fração
// no último passo) — preciso o bastante pra um limite de 12h checado a
// cada execução do cron.
function horasUteisEntre(inicio: Date, fim: Date): number {
  if (fim <= inicio) return 0;
  let total = 0;
  let cursor = new Date(inicio);
  while (cursor < fim) {
    const proximaHora = new Date(cursor);
    proximaHora.setUTCMinutes(0, 0, 0);
    proximaHora.setUTCHours(proximaHora.getUTCHours() + 1);
    const fimPasso = proximaHora < fim ? proximaHora : fim;
    const fracaoHora = (fimPasso.getTime() - cursor.getTime()) / (1000 * 60 * 60);
    if (isHoraUtil(cursor)) total += fracaoHora;
    cursor = fimPasso;
  }
  return total;
}

async function enviarEmail(assunto: string, html: string) {
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY não configurada — e-mail não enviado:', assunto);
    return;
  }
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: REMETENTE, to: [GERENTE_EMAIL], subject: assunto, html })
  });
  if (!resp.ok) {
    console.error('Erro ao enviar e-mail via Resend:', await resp.text());
  }
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: clientes, error: clientesErro } = await supabase
    .from('clientes')
    .select('id, razao_social, categoria, created_at, telefone_empresa, email_empresa')
    .not('categoria', 'is', null);

  if (clientesErro) {
    return new Response(JSON.stringify({ ok: false, error: clientesErro.message }), { status: 500 });
  }

  const listaClientes = (clientes ?? []) as Cliente[];
  const ids = listaClientes.map((c) => c.id);

  let historicoTodos: HistoricoEntry[] & { cliente_id?: string }[] = [];
  if (ids.length) {
    const { data } = await supabase
      .from('cliente_historico')
      .select('cliente_id, created_at, resultado')
      .in('cliente_id', ids)
      .order('created_at', { ascending: true });
    historicoTodos = (data ?? []) as any;
  }

  const historicoPorCliente: Record<string, HistoricoEntry[]> = {};
  for (const h of historicoTodos as any[]) {
    (historicoPorCliente[h.cliente_id] ??= []).push(h);
  }

  const agora = new Date();
  let alertasAtraso = 0;
  let alertasNegativas = 0;

  for (const cliente of listaClientes) {
    const historico = historicoPorCliente[cliente.id] ?? [];
    const retorno = calcularProximoRetorno(cliente, historico);

    // --- Alerta: atraso sem justificativa (12h úteis) ---
    let inicioContagem: Date | null = null;
    if (retorno.data) inicioContagem = retorno.data;
    else if (retorno.prioridadeMaxima) {
      inicioContagem = historico.length
        ? new Date(historico[historico.length - 1].created_at)
        : new Date(cliente.created_at);
    }

    if (inicioContagem && inicioContagem <= agora) {
      const horasAtraso = horasUteisEntre(inicioContagem, agora);
      if (horasAtraso >= 12) {
        const chave = inicioContagem.toISOString();
        const { error: insErro } = await supabase
          .from('alertas_enviados')
          .insert({ cliente_id: cliente.id, tipo: 'atraso', chave });
        if (!insErro) {
          const contato = [cliente.telefone_empresa, cliente.email_empresa].filter(Boolean).join(' — ') || 'sem contato cadastrado';
          await enviarEmail(
            'Atraso de follow-up — ' + cliente.razao_social,
            '<p>O cliente <strong>' + cliente.razao_social + '</strong> (' + (CATEGORIA_LABEL[cliente.categoria] || cliente.categoria) + ') está com um contato pendente há mais de 12 horas úteis, sem justificativa registrada.</p>' +
            '<p>Contato: ' + contato + '</p>'
          );
          alertasAtraso++;
        }
      }
    }

    // --- Alerta: 3 negativas seguidas (reseta em positivo) ---
    let streak = 0;
    for (const h of historico) {
      if (h.resultado === 'negativo') streak++;
      else if (h.resultado === 'positivo') streak = 0;

      if (streak > 0 && streak % 3 === 0) {
        const chave = 'streak-' + streak + '-' + h.created_at;
        const { error: insErro2 } = await supabase
          .from('alertas_enviados')
          .insert({ cliente_id: cliente.id, tipo: 'tres_negativas', chave });
        if (!insErro2) {
          await enviarEmail(
            'Cliente com ' + streak + ' negativas seguidas — ' + cliente.razao_social,
            '<p>O cliente <strong>' + cliente.razao_social + '</strong> (' + (CATEGORIA_LABEL[cliente.categoria] || cliente.categoria) + ') acumulou ' + streak + ' respostas negativas seguidas no histórico de follow-up. Vale avaliar se compensa continuar tentando.</p>'
          );
          alertasNegativas++;
        }
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: true, clientesAvaliados: listaClientes.length, alertasAtraso, alertasNegativas }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
