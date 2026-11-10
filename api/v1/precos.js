// GET /api/v1/precos — lista de preços das peças (código, marca, modelo, preço de venda e, se a chave tiver o escopo "custos", o custo).
// Filtros: marca, q (busca em código/modelo/marca), atualizado_desde (data ISO), pagina, limite, formato=csv
var lib = require('../_integracao');

module.exports = lib.handler('precos', async function (ctx) {
  var q = ctx.query, comCusto = ctx.escopos.indexOf('custos') !== -1;
  var desde = lib.dataIso(q.atualizado_desde);
  if (desde === undefined) return { erro: { status: 400, mensagem: 'atualizado_desde inválido. Use uma data ISO, ex.: 2026-11-01 ou 2026-11-01T08:00:00Z.' } };

  var partes = ['select=codigo,marca,tipo_modelo,preco_venda,updated_at' + (comCusto ? ',estoque_custos(custo,updated_at)' : ''),
                'order=codigo.asc', 'limit=' + ctx.limite, 'offset=' + ctx.offset];
  var marca = lib.limpar(q.marca);
  if (marca) partes.push('marca=ilike.' + encodeURIComponent(marca));
  var busca = lib.limpar(q.q);
  if (busca) {
    var b = encodeURIComponent('*' + busca + '*');
    partes.push('or=(codigo.ilike.' + b + ',tipo_modelo.ilike.' + b + ',marca.ilike.' + b + ')');
  }
  if (desde) partes.push('updated_at=gte.' + encodeURIComponent(desde));

  var r = await ctx.db.get('estoque_pecas?' + partes.join('&'), true);
  if (!r.ok) return { erro: { status: 502, mensagem: 'Falha ao consultar a lista de preços.' } };

  var linhas = r.dados.map(function (p) {
    var c = Array.isArray(p.estoque_custos) ? p.estoque_custos[0] : p.estoque_custos;
    var o = { codigo: p.codigo, marca: p.marca, modelo: p.tipo_modelo, preco_venda: p.preco_venda };
    if (comCusto) o.custo = c ? c.custo : null;
    var datas = [p.updated_at, c && c.updated_at].filter(Boolean).sort();
    o.atualizado_em = datas[datas.length - 1] || null;
    return o;
  });
  return { linhas: linhas, total: r.total, colunasCsv: ['codigo', 'marca', 'modelo', 'preco_venda'].concat(comCusto ? ['custo'] : [], ['atualizado_em']) };
});
