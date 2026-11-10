// Integrações: gerenciar as chaves de acesso da API (/api/v1/precos e /api/v1/clientes).
// A chave é gerada aqui no navegador; só o hash SHA-256 vai para o banco. A chave completa aparece uma única vez.

var PERFIL = null;
var ESCOPO_ROTULO = { precos: 'Lista de preços', custos: 'Custo das peças', clientes: 'Clientes' };

function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function dataHora(v) { return v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'; }

function gerarChave() {
  var b = new Uint8Array(32); crypto.getRandomValues(b);
  return 'ob_' + Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
}
async function sha256(txt) {
  var h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return Array.prototype.map.call(new Uint8Array(h), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
}

async function carregarChaves() {
  var r = await supabaseClient.from('api_chaves').select('*').order('created_at', { ascending: false });
  var tb = document.getElementById('chaves-tbody');
  if (r.error) { tb.innerHTML = '<tr><td colspan="8">Erro ao carregar: ' + esc(r.error.message) + '</td></tr>'; return; }
  if (!r.data.length) { tb.innerHTML = '<tr><td colspan="8">Nenhuma chave criada ainda.</td></tr>'; return; }
  tb.innerHTML = r.data.map(function (k) {
    return '<tr' + (k.ativa ? '' : ' style="opacity:0.55;"') + '><td><b>' + esc(k.nome) + '</b></td>' +
      '<td><code>' + esc(k.prefixo) + '…</code></td>' +
      '<td>' + k.escopos.map(function (e) { return '<span class="badge ' + (e === 'precos' ? 'badge-info' : 'badge-warning') + '">' + esc(ESCOPO_ROTULO[e] || e) + '</span>'; }).join(' ') + '</td>' +
      '<td>' + dataHora(k.created_at) + '</td><td>' + dataHora(k.ultimo_uso) + '</td><td>' + k.total_usos + '</td>' +
      '<td>' + (k.ativa ? '<span class="badge badge-ok">Ativa</span>' : '<span class="badge badge-danger">Revogada ' + dataHora(k.revogada_em) + '</span>') + '</td>' +
      '<td>' + (k.ativa ? '<button type="button" class="btn btn-outline" data-revogar="' + k.id + '" data-nome="' + esc(k.nome) + '">Revogar</button>' : '') + '</td></tr>';
  }).join('');
  tb.querySelectorAll('[data-revogar]').forEach(function (b) {
    b.onclick = async function () {
      if (!confirm('Revogar a chave "' + b.dataset.nome + '"?\n\nQuem usa essa chave perde o acesso na hora. Isso não pode ser desfeito.')) return;
      var u = await supabaseClient.from('api_chaves').update({ ativa: false }).eq('id', b.dataset.revogar);
      if (u.error) { showToast('Erro ao revogar: ' + u.error.message, 'error'); return; }
      showToast('Chave revogada.', 'ok');
      carregarChaves();
    };
  });
}

function mostrarExemplos() {
  var base = location.origin + '/api/v1';
  document.getElementById('base-url').textContent = base;
  document.getElementById('ex-curl').textContent =
    'curl -H "Authorization: Bearer SUA_CHAVE" \\\n  "' + base + '/precos?marca=Toledo&limite=100"\n\n' +
    'curl -H "Authorization: Bearer SUA_CHAVE" \\\n  "' + base + '/clientes?incluir=equipamentos&atualizado_desde=2026-11-01"';
  document.getElementById('ex-js').textContent =
    'const r = await fetch("' + base + '/precos", {\n  headers: { Authorization: "Bearer SUA_CHAVE" }\n});\nconst { dados, paginacao } = await r.json();\n// dados = [{ codigo, marca, modelo, preco_venda, atualizado_em }, ...]';
}

document.getElementById('chave-form').addEventListener('submit', async function (ev) {
  ev.preventDefault();
  var erro = document.getElementById('chave-erro'), btn = document.getElementById('chave-criar');
  erro.style.display = 'none';
  var escopos = [];
  if (document.getElementById('esc-precos').checked) escopos.push('precos');
  if (document.getElementById('esc-custos').checked) escopos.push('custos');
  if (document.getElementById('esc-clientes').checked) escopos.push('clientes');
  if (escopos.indexOf('custos') !== -1 && escopos.indexOf('precos') === -1) escopos.push('precos'); // custo só existe dentro da lista de preços
  var nome = document.getElementById('chave-nome').value.trim();
  if (!nome) { erro.textContent = 'Dê um nome à integração.'; erro.style.display = 'block'; return; }
  if (!escopos.length) { erro.textContent = 'Marque pelo menos uma permissão.'; erro.style.display = 'block'; return; }

  btn.disabled = true;
  var chave = gerarChave();
  var ins = await supabaseClient.from('api_chaves').insert({
    nome: nome, prefixo: chave.slice(0, 11), chave_hash: await sha256(chave), escopos: escopos, criada_por: PERFIL.id
  });
  btn.disabled = false;
  if (ins.error) { erro.textContent = 'Não foi possível criar a chave: ' + ins.error.message; erro.style.display = 'block'; return; }

  document.getElementById('chave-valor').textContent = chave;
  document.getElementById('modal-chave').classList.add('open');
  document.getElementById('chave-form').reset();
  document.getElementById('esc-precos').checked = true;
  carregarChaves();
});

document.getElementById('chave-copiar').onclick = async function () {
  var txt = document.getElementById('chave-valor').textContent;
  try { await navigator.clipboard.writeText(txt); showToast('Chave copiada.', 'ok'); }
  catch (e) {
    var r = document.createRange(); r.selectNodeContents(document.getElementById('chave-valor'));
    var s = getSelection(); s.removeAllRanges(); s.addRange(r);
    showToast('Selecionada: pressione Ctrl+C para copiar.', 'ok');
  }
};
document.getElementById('chave-fechar').onclick = function () {
  document.getElementById('chave-valor').textContent = '';
  document.getElementById('modal-chave').classList.remove('open');
};

(async function () {
  var auth = await window.ADMIN_AUTH_READY;
  if (!auth) return;
  PERFIL = auth.profile;
  mostrarExemplos();
  carregarChaves();
})();
