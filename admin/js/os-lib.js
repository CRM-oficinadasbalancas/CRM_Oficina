// OS e comprovante do chamado: dados da empresa, PDF (jsPDF), assinatura na tela e envio pelo WhatsApp.
// Usado pela impressão da OS (admin/os.html) e pelo app do celular (/app/).
// Requer supabaseClient (e, para gerar PDF, a biblioteca jsPDF carregada antes).

// Dados que saem no cabeçalho da OS e do comprovante. Ajuste aqui se algo mudar.
var OS_EMPRESA = {
  nome: 'Oficina das Balanças Comércio e Serviços Ltda',
  fantasia: 'Oficina das Balanças',
  cnpj: '15.267.827/0001-33',
  endereco: 'Av. Orosimbo Maia, 1475 - Cambuí - Campinas/SP - CEP 13023-002',
  telefone: '(19) 99940-1288',
  email: 'lucasbalancas@hotmail.com'
};

function osData(iso) { return iso ? new Date(iso).toLocaleDateString('pt-BR') : ''; }
function osDataHora(iso) { return iso ? new Date(iso).toLocaleDateString('pt-BR') + ' ' + new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''; }

function osEnderecoCliente(cl) {
  cl = cl || {};
  var rua = [cl.logradouro, cl.numero].filter(Boolean).join(', ');
  var cid = [cl.municipio, cl.uf].filter(Boolean).join('/');
  return [rua, cl.bairro, cid].filter(Boolean).join(' - ');
}

// Telefone no formato do WhatsApp (55 + DDD + número). Devolve null se não der para montar.
function osTelefoneWhats(tel) {
  var d = String(tel || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) return '55' + d;
  if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) return d;
  return null;
}
function osUrlWhats(tel, texto) {
  return 'https://wa.me/' + (osTelefoneWhats(tel) || '') + '?text=' + encodeURIComponent(texto || '');
}

// Logo para o PDF (convertido para PNG pelo navegador). Se não carregar, o PDF sai só com texto.
function osCarregarLogo() {
  return new Promise(function (resolve) {
    var img = new Image();
    img.onload = function () {
      try {
        // reduz o logo (arquivo leve para enviar pelo WhatsApp)
        var esc = Math.min(1, 420 / img.naturalWidth);
        var w = Math.round(img.naturalWidth * esc), h = Math.round(img.naturalHeight * esc);
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve({ data: cv.toDataURL('image/png'), w: w, h: h });
      } catch (e) { resolve(null); }
    };
    img.onerror = function () { resolve(null); };
    img.src = '../assets/img/logo-oficina.webp';
  });
}

/* ===================== PDF ===================== */

// dados: { c (chamado com clientes e equipamentos), itens, assinatura (dataURL|null), nomeAssinante, naoAssinou, tecnico, logo }
function osGerarPdf(dados) {
  var J = window.jspdf.jsPDF;
  var doc = new J({ unit: 'mm', format: 'a4' });
  var W = 210, M = 14, y = 14;
  var c = dados.c, cl = c.clientes || {}, eq = c.equipamentos || {};
  var itens = dados.itens || [];

  function garantir(h) { if (y + h > 282) { doc.addPage(); y = 14; } }
  function secao(t) {
    garantir(14);
    y += 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(217, 48, 53);
    doc.text(t.toUpperCase(), M, y);
    y += 1.6; doc.setDrawColor(200); doc.line(M, y, W - M, y); y += 4.6;
    doc.setTextColor(20);
  }
  function par(rot, val) {
    val = String(val == null || val === '' ? '-' : val);
    var linhas = doc.splitTextToSize(val, W - M - M - 36);
    garantir(linhas.length * 4.8 + 1);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(rot, M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(20);
    doc.text(linhas, M + 36, y);
    y += linhas.length * 4.8 + 0.8;
  }

  // cabeçalho
  var xTexto = M;
  if (dados.logo) {
    var hLogo = 15, wLogo = hLogo * dados.logo.w / dados.logo.h;
    if (wLogo > 50) { wLogo = 50; hLogo = wLogo * dados.logo.h / dados.logo.w; }
    try { doc.addImage(dados.logo.data, 'PNG', M, y - 2, wLogo, hLogo); xTexto = M + wLogo + 5; } catch (e) { xTexto = M; }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20);
  doc.text(OS_EMPRESA.fantasia, xTexto, y + 2);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(80);
  doc.text(OS_EMPRESA.nome + ' - CNPJ ' + OS_EMPRESA.cnpj, xTexto, y + 6.5);
  doc.text(OS_EMPRESA.endereco, xTexto, y + 10.5);
  doc.text('Tel. ' + OS_EMPRESA.telefone + '  |  ' + OS_EMPRESA.email, xTexto, y + 14.5);
  y += 20;

  // faixa do título
  doc.setFillColor(27, 27, 24); doc.rect(M, y, W - 2 * M, 10, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(255);
  doc.text('COMPROVANTE DE ATENDIMENTO', M + 4, y + 6.6);
  doc.text('OS ' + (c.codigo || c.numero), W - M - 4, y + 6.6, { align: 'right' });
  y += 14; doc.setTextColor(20);

  secao('Atendimento');
  par('Abertura', osData(c.created_at));
  par('Fechamento', osDataHora(c.fechado_em || new Date().toISOString()));
  par('Técnico', dados.tecnico);

  secao('Cliente');
  par('Nome', cl.razao_social);
  if (cl.cnpj_cpf) par('CNPJ/CPF', cl.cnpj_cpf);
  par('Endereço', osEnderecoCliente(cl));
  par('Telefone', cl.telefone_empresa);

  secao('Equipamento');
  par('Equipamento', [eq.marca, eq.modelo].filter(Boolean).join(' '));
  par('Nº de série', eq.numero_serie);

  secao('Defeito relatado');
  par('Defeito', c.descricao_defeito);
  secao('Serviço realizado');
  par('Descrição', c.resolucao);

  secao('Selos e lacres');
  par('Selo antigo', c.selo_antigo_ausente ? 'Não possui' : c.selo_antigo);
  par('Selo novo', c.selo_novo);
  par('Lacre antigo', c.lacre_antigo_ausente ? 'Não possui' : c.lacre_antigo);
  par('Lacre novo', c.lacre_novo);

  if (itens.length) {
    secao('Peças');
    var temPreco = itens.some(function (i) { return i.preco_unit != null; });
    var total = 0;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(90);
    garantir(8);
    doc.text('Peça', M, y); doc.text('Qtd', W - M - (temPreco ? 62 : 0), y, { align: 'right' });
    if (temPreco) { doc.text('Unit.', W - M - 30, y, { align: 'right' }); doc.text('Subtotal', W - M, y, { align: 'right' }); }
    y += 4.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(20);
    itens.forEach(function (i) {
      var p = i.estoque_pecas || {};
      var nome = doc.splitTextToSize((p.codigo || '') + ' - ' + (p.tipo_modelo || ''), temPreco ? 100 : 150);
      garantir(nome.length * 4.6 + 1);
      doc.text(nome, M, y);
      doc.text(String(Number(i.quantidade).toLocaleString('pt-BR')), W - M - (temPreco ? 62 : 0), y, { align: 'right' });
      if (temPreco && i.preco_unit != null) {
        var sub = Number(i.quantidade) * Number(i.preco_unit); total += sub;
        doc.text(Number(i.preco_unit).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), W - M - 30, y, { align: 'right' });
        doc.text(sub.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), W - M, y, { align: 'right' });
      }
      y += nome.length * 4.6 + 0.6;
    });
    if (temPreco) {
      doc.setDrawColor(40); doc.line(M, y, W - M, y); y += 5;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text('Total das peças', M, y);
      doc.text(total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), W - M, y, { align: 'right' });
      y += 5;
    }
  }

  // assinatura do cliente
  garantir(52);
  secao('Assinatura do cliente');
  if (dados.assinatura) {
    try { doc.setDrawColor(150); doc.rect(M, y, 84, 30); doc.addImage(dados.assinatura, 'PNG', M + 1, y + 1, 82, 28); } catch (e) { /* segue sem a imagem */ }
    y += 34;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(20);
    doc.text('Recebido por: ' + (dados.nomeAssinante || '-'), M, y);
    doc.text('Assinado na tela do aparelho em ' + osDataHora(c.fechado_em || new Date().toISOString()), M, y + 4.6);
    y += 9;
  } else {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(90);
    doc.text(dados.naoAssinou ? 'O cliente não assinou este comprovante.' : '-', M, y + 2);
    y += 8;
  }

  // rodapé com paginação
  var n = doc.getNumberOfPages();
  for (var p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(130);
    doc.text(OS_EMPRESA.fantasia + ' - comprovante gerado pelo sistema - OS ' + (c.codigo || c.numero), M, 290);
    doc.text('Página ' + p + ' de ' + n, W - M, 290, { align: 'right' });
  }
  return doc.output('blob');
}

/* ===================== COMPARTILHAR / BAIXAR ===================== */

function osBaixar(blob, nome) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

// Abre a lista de compartilhamento do aparelho com o PDF anexado (o técnico escolhe o WhatsApp e o contato do cliente).
// Devolve { ok } | { cancelado } | { semCompartilhamento } (aparelho sem suporte a anexar arquivo).
async function osCompartilhar(blob, nome, texto) {
  var file = new File([blob], nome, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nome, text: texto }); return { ok: true }; }
    catch (e) { if (e && e.name === 'AbortError') return { cancelado: true }; }
  }
  return { semCompartilhamento: true };
}

/* ===================== ASSINATURA NA TELA ===================== */

function osAssinaturaPad(canvas) {
  var ctx, desenhando = false, tem = false;
  function preparar() {
    var r = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * ratio); canvas.height = Math.round(r.height * ratio);
    ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height);
    ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    tem = false;
  }
  function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', function (e) {
    desenhando = true; try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
    var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y + 0.1); ctx.stroke(); tem = true; e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!desenhando) return;
    var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { canvas.addEventListener(ev, function () { desenhando = false; }); });
  preparar();
  return {
    limpar: preparar,
    vazio: function () { return !tem; },
    dataUrl: function () { return canvas.toDataURL('image/png'); }
  };
}

/* ===================== SALVAR NO CHAMADO ===================== */

var OS_BUCKET = 'os-documentos';

// Guarda a assinatura e o PDF no chamado (bucket privado) e registra em chamado_documentos.
async function osSalvarDocumentos(chamadoId, autorId, pdfBlob, assinaturaDataUrl, nomeAssinante, naoAssinou) {
  var base = chamadoId + '/' + Date.now();
  var erros = [];
  var docs = supabaseClient.from('chamado_documentos');
  if (assinaturaDataUrl) {
    var blobAss = await (await fetch(assinaturaDataUrl)).blob();
    var up = await supabaseClient.storage.from(OS_BUCKET).upload(base + '-assinatura.png', blobAss, { contentType: 'image/png' });
    if (up.error) erros.push('assinatura: ' + up.error.message);
    else {
      var r1 = await docs.insert({ chamado_id: chamadoId, tipo: 'assinatura', caminho: base + '-assinatura.png', nome_assinante: nomeAssinante || null, created_by: autorId });
      if (r1.error) erros.push(r1.error.message);
    }
  } else if (naoAssinou) {
    var r0 = await docs.insert({ chamado_id: chamadoId, tipo: 'assinatura', caminho: '', cliente_nao_assinou: true, created_by: autorId });
    if (r0.error) erros.push(r0.error.message);
  }
  var up2 = await supabaseClient.storage.from(OS_BUCKET).upload(base + '-comprovante.pdf', pdfBlob, { contentType: 'application/pdf' });
  if (up2.error) erros.push('PDF: ' + up2.error.message);
  else {
    var r2 = await docs.insert({ chamado_id: chamadoId, tipo: 'comprovante_pdf', caminho: base + '-comprovante.pdf', created_by: autorId });
    if (r2.error) erros.push(r2.error.message);
  }
  return { erro: erros.length ? erros.join('; ') : null };
}

// Assinatura já salva do chamado (para gerar o comprovante de novo depois).
async function osCarregarAssinaturaSalva(chamadoId) {
  var r = await supabaseClient.from('chamado_documentos').select('caminho, nome_assinante, cliente_nao_assinou')
    .eq('chamado_id', chamadoId).eq('tipo', 'assinatura').order('created_at', { ascending: false }).limit(1);
  var d = r.data && r.data[0];
  if (!d) return { assinatura: null, nomeAssinante: '', naoAssinou: false };
  if (d.cliente_nao_assinou || !d.caminho) return { assinatura: null, nomeAssinante: '', naoAssinou: true };
  var dl = await supabaseClient.storage.from(OS_BUCKET).download(d.caminho);
  if (dl.error || !dl.data) return { assinatura: null, nomeAssinante: d.nome_assinante || '', naoAssinou: false };
  var dataUrl = await new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.readAsDataURL(dl.data); });
  return { assinatura: dataUrl, nomeAssinante: d.nome_assinante || '', naoAssinou: false };
}
