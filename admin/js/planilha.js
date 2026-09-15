// Compartilhado entre as telas que importam/exportam Excel (Clientes, Estoque, Equipamentos).
// Requer que o script da CDN do SheetJS (xlsx) já tenha sido carregado antes deste arquivo.

function baixarModeloExcel(nomeArquivo, colunas, linhasExemplo) {
  var cabecalho = colunas.map(function (c) { return c.titulo; });
  var linhas = (linhasExemplo || []).map(function (linha) {
    return colunas.map(function (c) { return linha[c.chave] != null ? linha[c.chave] : ''; });
  });
  var ws = XLSX.utils.aoa_to_sheet([cabecalho].concat(linhas));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Modelo');
  XLSX.writeFile(wb, nomeArquivo);
}

function exportarExcel(nomeArquivo, dados, colunas, nomeAba) {
  var cabecalho = colunas.map(function (c) { return c.titulo; });
  var linhas = dados.map(function (item) {
    return colunas.map(function (c) {
      return typeof c.valor === 'function' ? c.valor(item) : (item[c.chave] != null ? item[c.chave] : '');
    });
  });
  var ws = XLSX.utils.aoa_to_sheet([cabecalho].concat(linhas));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, nomeAba || 'Dados');
  XLSX.writeFile(wb, nomeArquivo);
}

function lerArquivoExcel(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = new Uint8Array(e.target.result);
        var wb = XLSX.read(data, { type: 'array' });
        var primeiraAba = wb.SheetNames[0];
        var ws = wb.Sheets[primeiraAba];
        var linhas = XLSX.utils.sheet_to_json(ws, { defval: '' });
        resolve(linhas);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = function () { reject(new Error('Não foi possível ler o arquivo.')); };
    reader.readAsArrayBuffer(file);
  });
}

// Casa as colunas de uma linha lida do Excel (chaves = cabeçalhos digitados pelo usuário)
// com as chaves internas esperadas, comparando por título sem diferenciar maiúsculas/espaços.
function normalizarLinhaExcel(linha, colunas) {
  var resultado = {};
  colunas.forEach(function (c) {
    var chaveEncontrada = Object.keys(linha).find(function (k) {
      return k.trim().toLowerCase() === c.titulo.trim().toLowerCase();
    });
    var valor = chaveEncontrada ? linha[chaveEncontrada] : '';
    resultado[c.chave] = (valor === undefined || valor === null) ? '' : String(valor).trim();
  });
  return resultado;
}

function dataParaNomeArquivo() {
  return new Date().toISOString().slice(0, 10);
}
