// Função serverless (Vercel) — criar usuário, resetar senha ou mudar perfil.
// Só o Administrador (role === 'admin') pode chamar; usa a service_role
// key do Supabase, que nunca fica exposta no navegador.

var SUPABASE_URL = 'https://gbahaegarnzgebgzeumk.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_KymWyWGjso1Y2EmZ9WbyfQ_ou9_M8QJ';
var SYNTHETIC_DOMAIN = '@oficinadasbalancas.internal';

function usernameToEmail(username) {
  return username.trim().toLowerCase().replace(/\s+/g, '.') + SYNTHETIC_DOMAIN;
}

async function usuarioEhAdmin(accessToken) {
  if (!accessToken) return null;
  var userResp = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + accessToken }
  });
  if (!userResp.ok) return null;
  var user = await userResp.json();

  var profileResp = await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + user.id + '&select=role', {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + accessToken }
  });
  if (!profileResp.ok) return null;
  var rows = await profileResp.json();
  return rows[0] && rows[0].role === 'admin' ? user : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  var body = req.body || {};
  var chamador = await usuarioEhAdmin(body.accessToken);
  if (!chamador) {
    res.status(401).json({ error: 'Sessão inválida ou sem permissão de Administrador.' });
    return;
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Gerenciamento de usuários não configurado no servidor.' });
    return;
  }
  var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var adminHeaders = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };

  try {
    if (body.acao === 'criar') {
      var nomeUsuario = (body.nomeUsuario || '').trim();
      var nomeExibicao = (body.nomeExibicao || '').trim();
      var senha = (body.senha || '').trim();
      var role = body.role;

      if (!nomeUsuario || !nomeExibicao || !senha || !role) {
        res.status(400).json({ error: 'Preencha nome de usuário, nome de exibição, senha e perfil.' });
        return;
      }

      var email = usernameToEmail(nomeUsuario);
      var criarResp = await fetch(SUPABASE_URL + '/auth/v1/admin/users', {
        method: 'POST', headers: adminHeaders,
        body: JSON.stringify({ email: email, password: senha, email_confirm: true })
      });
      var criarData = await criarResp.json();
      if (!criarResp.ok) {
        res.status(400).json({ error: criarData.msg || criarData.message || 'Erro ao criar login.' });
        return;
      }

      var profileResp = await fetch(SUPABASE_URL + '/rest/v1/profiles', {
        method: 'POST', headers: Object.assign({}, adminHeaders, { Prefer: 'return=representation' }),
        body: JSON.stringify({
          id: criarData.id, nome_usuario: nomeUsuario, nome_exibicao: nomeExibicao,
          role: role, must_change_password: true, email: body.email || null
        })
      });
      if (!profileResp.ok) {
        var profileErro = await profileResp.json().catch(function () { return {}; });
        res.status(400).json({ error: profileErro.message || 'Login criado, mas erro ao salvar o perfil.' });
        return;
      }

      res.status(200).json({ ok: true });
      return;
    }

    if (body.acao === 'resetar_senha') {
      if (!body.userId || !body.novaSenha) {
        res.status(400).json({ error: 'Faltam dados pra resetar a senha.' });
        return;
      }
      var resetResp = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + body.userId, {
        method: 'PUT', headers: adminHeaders, body: JSON.stringify({ password: body.novaSenha })
      });
      if (!resetResp.ok) {
        var resetErro = await resetResp.json().catch(function () { return {}; });
        res.status(400).json({ error: resetErro.msg || 'Erro ao resetar senha.' });
        return;
      }
      await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + body.userId, {
        method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ must_change_password: true })
      });
      res.status(200).json({ ok: true });
      return;
    }

    if (body.acao === 'mudar_role') {
      if (!body.userId || !body.role) {
        res.status(400).json({ error: 'Faltam dados pra mudar o perfil.' });
        return;
      }
      var roleResp = await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + body.userId, {
        method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ role: body.role })
      });
      if (!roleResp.ok) {
        res.status(400).json({ error: 'Erro ao mudar o perfil.' });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
