// Núcleo da API de integração (somente leitura). Arquivos que começam com "_" não viram rota na Vercel.
// Autenticação: chave de API (cabeçalho Authorization: Bearer <chave> ou X-API-Key). Só o hash SHA-256
// da chave fica no banco (tabela api_chaves). Cada chave tem escopos: precos, custos, clientes.

var crypto = require('crypto');

var SUPABASE_URL = 'https://gbahaegarnzgebgzeumk.supabase.co';
var LIMITE_PADRAO = 500;
var LIMITE_MAXIMO = 1000;

function hashChave(chave) { return crypto.createHash('sha256').update(chave, 'utf8').digest('hex'); }

function extrairChave(req) {
  var auth = String(req.headers['authorization'] || '');
  var m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  var x = req.headers['x-api-key'];
  return x ? String(x).trim() : '';
}

// Valor de filtro seguro para a gramática do PostgREST (sem vírgula, parênteses, aspas, curingas).
function limpar(v) {
  return String(v == null ? '' : v).replace(/[,()*"\\%:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function dataIso(v) {
  if (!v) return null;
  var d = new Date(String(v));
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function csvCelula(v) {
  if (v == null) return '';
  var s = String(v);
  // evita "injeção de fórmula" ao abrir no Excel/Sheets
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function paraCsv(linhas, colunas) {
  var cab = colunas.join(';');
  var corpo = linhas.map(function (l) { return colunas.map(function (c) { return csvCelula(l[c]); }).join(';'); });
  return '\ufeff' + [cab].concat(corpo).join('\r\n') + '\r\n';
}

function criarCliente(serviceKey) {
  var cab = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };
  return {
    // GET no PostgREST; devolve { ok, status, dados, total }
    get: async function (caminho, contar) {
      var h = Object.assign({}, cab); if (contar) h.Prefer = 'count=exact';
      var r = await fetch(SUPABASE_URL + '/rest/v1/' + caminho, { headers: h });
      var dados = await r.json().catch(function () { return null; });
      var cr = r.headers.get('content-range') || '';
      var total = /\/(\d+)$/.test(cr) ? parseInt(cr.split('/')[1], 10) : null;
      return { ok: r.ok, status: r.status, dados: dados, total: total };
    },
    uso: function (id) {
      return fetch(SUPABASE_URL + '/rest/v1/rpc/registrar_uso_api', {
        method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, cab), body: JSON.stringify({ p_id: id })
      }).catch(function () {});
    }
  };
}

/**
 * escopo: escopo exigido da chave ('precos' | 'clientes')
 * montar(ctx): ctx = { query, escopos, pagina, limite, offset, db } ->
 *    { linhas, total, colunasCsv, erro? }  (erro = { status, mensagem })
 */
exports.handler = function (escopo, montar) {
  return async function (req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-API-Key, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'GET') { res.status(405).json({ erro: 'Método não permitido. Esta API é somente leitura (GET).' }); return; }

    var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) { res.status(500).json({ erro: 'API não configurada no servidor.' }); return; }

    var chave = extrairChave(req);
    if (!chave) { res.status(401).json({ erro: 'Informe a chave de API no cabeçalho Authorization: Bearer <chave>.' }); return; }

    var db = criarCliente(serviceKey);
    var reg = await db.get('api_chaves?chave_hash=eq.' + hashChave(chave) + '&ativa=eq.true&select=id,nome,escopos&limit=1');
    if (!reg.ok) { res.status(502).json({ erro: 'Falha ao validar a chave.' }); return; }
    if (!reg.dados || !reg.dados[0]) { res.status(401).json({ erro: 'Chave de API inválida ou revogada.' }); return; }
    var k = reg.dados[0];
    if (k.escopos.indexOf(escopo) === -1) { res.status(403).json({ erro: 'Esta chave não tem permissão para este recurso (' + escopo + ').' }); return; }

    var q = req.query || {};
    var limite = Math.min(Math.max(parseInt(q.limite, 10) || LIMITE_PADRAO, 1), LIMITE_MAXIMO);
    var pagina = Math.max(parseInt(q.pagina, 10) || 1, 1);
    var offset = (pagina - 1) * limite;

    var r;
    try { r = await montar({ query: q, escopos: k.escopos, pagina: pagina, limite: limite, offset: offset, db: db }); }
    catch (e) { res.status(500).json({ erro: 'Erro ao consultar os dados.' }); return; }
    if (r.erro) { res.status(r.erro.status || 400).json({ erro: r.erro.mensagem }); return; }

    await db.uso(k.id);

    if (String(q.formato || '').toLowerCase() === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.status(200).send(paraCsv(r.linhas, r.colunasCsv));
      return;
    }
    res.status(200).json({
      dados: r.linhas,
      paginacao: { pagina: pagina, limite: limite, total: r.total, paginas: r.total == null ? null : Math.max(Math.ceil(r.total / limite), 1) },
      gerado_em: new Date().toISOString()
    });
  };
};

exports.limpar = limpar;
exports.dataIso = dataIso;
exports.hashChave = hashChave;
