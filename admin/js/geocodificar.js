// Localiza um endereço no mapa (latitude/longitude) para montar a rota dos técnicos.
// Usa o serviço gratuito Nominatim (OpenStreetMap): poucas consultas por vez e 1 por segundo.
//   geocodificarEndereco({ logradouro, numero, bairro, municipio, uf, cep }) → { lat, lng } | null

var ULTIMA_CONSULTA_GEO = 0;

function montarEnderecoTexto(c) {
  var rua = [c.logradouro, c.numero].filter(Boolean).join(', ');
  var partes = [rua, c.bairro, c.municipio, c.uf, c.cep, 'Brasil'].filter(Boolean);
  return partes.join(', ');
}

async function geocodificarEndereco(c) {
  var texto = montarEnderecoTexto(c);
  if (!c || (!c.logradouro && !c.cep && !c.municipio)) return null;

  // respeita 1 consulta por segundo
  var espera = ULTIMA_CONSULTA_GEO + 1100 - Date.now();
  if (espera > 0) await new Promise(function (r) { setTimeout(r, espera); });
  ULTIMA_CONSULTA_GEO = Date.now();

  async function buscar(q) {
    var resp = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=' + encodeURIComponent(q), {
      headers: { 'Accept-Language': 'pt-BR' }
    });
    if (!resp.ok) return null;
    var dados = await resp.json();
    if (!dados || !dados.length) return null;
    return { lat: parseFloat(dados[0].lat), lng: parseFloat(dados[0].lon) };
  }

  try {
    var achou = await buscar(texto);
    if (achou) return achou;
    // sem o número da casa, ainda localiza a rua
    if (c.numero) {
      var semNumero = Object.assign({}, c, { numero: '' });
      await new Promise(function (r) { setTimeout(r, 1100); });
      ULTIMA_CONSULTA_GEO = Date.now();
      return await buscar(montarEnderecoTexto(semNumero));
    }
    return null;
  } catch (e) {
    return null;
  }
}
