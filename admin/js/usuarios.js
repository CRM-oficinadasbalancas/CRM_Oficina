var allUsuarios = [];

var ROLE_LABELS = { admin: 'Administrador', tecnico: 'Técnico', atendente: 'Atendente' };

async function chamarGerenciarUsuario(payload) {
  var { data: { session } } = await supabaseClient.auth.getSession();
  var resp = await fetch('/api/gerenciar-usuario', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ accessToken: session ? session.access_token : null }, payload))
  });
  var data = await resp.json().catch(function () { return {}; });
  if (!resp.ok) throw new Error(data.error || 'Erro na operação.');
  return data;
}

async function loadUsuarios() {
  var { data, error } = await supabaseClient.from('profiles').select('*').order('nome_exibicao');
  if (error) {
    showToast('Erro ao carregar usuários: ' + error.message, 'error');
    return;
  }
  allUsuarios = data || [];
  renderUsuariosTable();
}

function renderUsuariosTable() {
  var tbody = document.getElementById('usuarios-tbody');
  if (!allUsuarios.length) {
    tbody.innerHTML = '<tr><td colspan="5">Nenhum usuário cadastrado.</td></tr>';
    return;
  }

  tbody.innerHTML = allUsuarios.map(function (u) {
    var pendente = u.must_change_password
      ? '<span class="badge badge-warning">Pendente</span>'
      : '<span class="badge badge-ok">Ok</span>';

    var opcoesRole = Object.keys(ROLE_LABELS).map(function (r) {
      return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>';
    }).join('');

    return '<tr>' +
      '<td>' + u.nome_exibicao + '</td>' +
      '<td>' + (u.nome_usuario || '') + '</td>' +
      '<td><select data-role-select="' + u.id + '" style="padding:6px 8px; border-radius:6px; border:1px solid #d7ddea;">' + opcoesRole + '</select></td>' +
      '<td>' + pendente + '</td>' +
      '<td class="row-actions"><button data-resetar="' + u.id + '">Resetar senha</button></td>' +
    '</tr>';
  }).join('');

  tbody.querySelectorAll('[data-role-select]').forEach(function (select) {
    select.addEventListener('change', async function () {
      try {
        await chamarGerenciarUsuario({ acao: 'mudar_role', userId: select.dataset.roleSelect, role: select.value });
        showToast('Perfil atualizado.', 'ok');
        loadUsuarios();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  tbody.querySelectorAll('[data-resetar]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var usuario = allUsuarios.find(function (u) { return u.id === btn.dataset.resetar; });
      if (!usuario) return;
      usuarioEmReset = usuario;
      document.getElementById('resetar-usuario-nome').textContent = usuario.nome_exibicao + ' (' + usuario.nome_usuario + ')';
      document.getElementById('resetar-nova-senha').value = '';
      document.getElementById('resetar-error').style.display = 'none';
      document.getElementById('modal-resetar-senha').classList.add('open');
    });
  });
}

/* ===================== RESETAR SENHA ===================== */

var usuarioEmReset = null;

document.getElementById('resetar-cancelar').addEventListener('click', function () {
  document.getElementById('modal-resetar-senha').classList.remove('open');
  usuarioEmReset = null;
});

document.getElementById('resetar-confirmar').addEventListener('click', async function () {
  if (!usuarioEmReset) return;
  var errorEl = document.getElementById('resetar-error');
  errorEl.style.display = 'none';

  var novaSenha = document.getElementById('resetar-nova-senha').value.trim();
  if (novaSenha.length < 6) {
    errorEl.textContent = 'A senha precisa ter pelo menos 6 caracteres.';
    errorEl.style.display = 'block';
    return;
  }

  var btn = this;
  btn.disabled = true;
  btn.textContent = 'Resetando...';

  try {
    await chamarGerenciarUsuario({ acao: 'resetar_senha', userId: usuarioEmReset.id, novaSenha: novaSenha });
    showToast('Senha resetada. A pessoa vai trocar no próximo login.', 'ok');
    document.getElementById('modal-resetar-senha').classList.remove('open');
    usuarioEmReset = null;
    loadUsuarios();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Resetar';
  }
});

/* ===================== CRIAR USUÁRIO ===================== */

document.getElementById('usuario-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var errorEl = document.getElementById('usuario-error');
  var saveBtn = document.getElementById('usuario-save-btn');
  errorEl.style.display = 'none';

  var payload = {
    acao: 'criar',
    nomeExibicao: document.getElementById('nome_exibicao').value.trim(),
    nomeUsuario: document.getElementById('nome_usuario').value.trim(),
    email: document.getElementById('email_pessoal').value.trim() || null,
    role: document.getElementById('role').value,
    senha: document.getElementById('senha_inicial').value.trim()
  };

  saveBtn.disabled = true;
  saveBtn.textContent = 'Criando...';

  try {
    await chamarGerenciarUsuario(payload);
    showToast('Usuário criado com sucesso.', 'ok');
    document.getElementById('usuario-form').reset();
    loadUsuarios();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Criar usuário';
  }
});

/* ===================== INIT ===================== */

(async function () {
  var auth = await window.ADMIN_AUTH_READY;
  if (!auth) return;
  loadUsuarios();
})();
