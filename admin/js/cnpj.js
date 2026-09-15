// Consulta de CNPJ via BrasilAPI (gratuita, sem chave, dados oficiais da Receita Federal).
// https://brasilapi.com.br/api/cnpj/v1/{cnpj}

function onlyDigits(str) {
  return (str || '').replace(/\D/g, '');
}

async function fetchCnpj(cnpjInput) {
  var cnpj = onlyDigits(cnpjInput);

  if (cnpj.length !== 14) {
    throw new Error('CNPJ deve ter 14 dígitos.');
  }

  var response;
  try {
    response = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + cnpj);
  } catch (networkError) {
    throw new Error('Não foi possível conectar à consulta de CNPJ. Verifique sua internet.');
  }

  if (response.status === 404) {
    throw new Error('CNPJ não encontrado na Receita Federal.');
  }
  if (!response.ok) {
    throw new Error('Consulta de CNPJ indisponível no momento (tente novamente em instantes).');
  }

  var data = await response.json();

  var telefone = '';
  if (data.ddd_telefone_1) {
    telefone = data.ddd_telefone_1;
  }

  return {
    cnpj: data.cnpj || cnpj,
    razaoSocial: data.razao_social || '',
    nomeFantasia: data.nome_fantasia || '',
    logradouro: [data.descricao_tipo_de_logradouro, data.logradouro].filter(Boolean).join(' ').trim(),
    numero: data.numero || '',
    complemento: data.complemento || '',
    bairro: data.bairro || '',
    cep: data.cep || '',
    municipio: data.municipio || '',
    uf: data.uf || '',
    telefone: telefone,
    email: data.email || ''
  };
}
