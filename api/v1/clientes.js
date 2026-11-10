// GET /api/v1/clientes — cadastro completo dos clientes.
// Filtros: q (nome, fantasia, CNPJ/CPF ou código), uf, municipio, id, atualizado_desde, incluir=equipamentos,
//          incluir_leads=1 (por padrão só vêm clientes; leads em prospecção ficam de fora), pagina, limite, formato=csv
var lib = require('../_integracao');

var CAMPOS = ['id', 'codigo', 'cnpj_cpf', 'razao_social', 'nome_fantasia', 'ie',
  'logradouro', 'numero', 'complemento', 'bairro', 'cep', 'municipio', 'uf',
  'telefone_empresa', 'email_empresa', 'contato_nome', 'contato_telefone', 'contato_email',
  'forma_pagamento_padrao', 'local_entrega_preferencial', 'observacoes',
  'categoria', 'canal_aquisicao', 'situacao', 'origem', 'eh_cliente', 'latitude', 'longitude',
  'created_at', 'updated_at'];

var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = lib.handler('clientes', async function (ctx) {
  var q = ctx.query;
  var desde = lib.dataIso(q.atualizado_desde);
  if (desde === undefined) return { erro: { status: 400, mensagem: 'atualizado_desde inválido. Use uma data ISO, ex.: 2026-11-01 ou 2026-11-01T08:00:00Z.' } };
  var comEquip = String(q.incluir || '').toLowerCase().split(',').indexOf('equipamentos') !== -1;

  var partes = ['select=' + CAMPOS.join(',') + (comEquip ? ',equipamentos(id,marca,modelo,numero_serie)' : ''),
                'order=razao_social.asc,id.asc', 'limit=' + ctx.limite, 'offset=' + ctx.offset];
  if (String(q.incluir_leads || '') !== '1') partes.push('eh_cliente=eq.true');
  if (q.id) {
    if (!UUID.test(String(q.id))) return { erro: { status: 400, mensagem: 'id inválido.' } };
    partes.push('id=eq.' + q.id);
  }
  var uf = lib.limpar(q.uf); if (uf) partes.push('uf=ilike.' + encodeURIComponent(uf));
  var mun = lib.limpar(q.municipio); if (mun) partes.push('municipio=ilike.' + encodeURIComponent(mun));
  var busca = lib.limpar(q.q);
  if (busca) {
    var b = encodeURIComponent('*' + busca + '*');
    partes.push('or=(razao_social.ilike.' + b + ',nome_fantasia.ilike.' + b + ',cnpj_cpf.ilike.' + b + ',codigo.ilike.' + b + ')');
  }
  if (desde) partes.push('updated_at=gte.' + encodeURIComponent(desde));

  var r = await ctx.db.get('clientes?' + partes.join('&'), true);
  if (!r.ok) return { erro: { status: 502, mensagem: 'Falha ao consultar os clientes.' } };

  var linhas = r.dados;
  var colunasCsv = CAMPOS.slice();
  if (comEquip) {
    colunasCsv.push('equipamentos');
    // no CSV os equipamentos viram um texto; no JSON continuam como lista
    if (String(q.formato || '').toLowerCase() === 'csv') {
      linhas = linhas.map(function (c) {
        var o = Object.assign({}, c);
        o.equipamentos = (c.equipamentos || []).map(function (e) { return [e.marca, e.modelo].filter(Boolean).join(' ') + ' (série ' + (e.numero_serie || '—') + ')'; }).join(' | ');
        return o;
      });
    }
  }
  return { linhas: linhas, total: r.total, colunasCsv: colunasCsv };
});
