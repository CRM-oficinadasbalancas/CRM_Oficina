// Inclua este script em toda página do admin, EXCETO login.html.
// Garante: sessão válida + troca de senha obrigatória cumprida.
// Expõe window.ADMIN_AUTH_READY (Promise) que resolve com { session, profile }
// depois que o guard concluiu (só chega lá se a página não foi redirecionada).

// Normaliza o nome da página independente de ".html" estar presente na URL
// (servidores estáticos costumam remover a extensão, ex: /admin/trocar-senha).
var CURRENT_PAGE = location.pathname.split('/').pop().replace(/\.html$/, '');

window.ADMIN_AUTH_READY = (async function () {
  var { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    location.replace('login.html');
    return new Promise(function () {}); // nunca resolve, a navegação já está saindo da página
  }

  var { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (error || !profile) {
    await supabaseClient.auth.signOut();
    location.replace('login.html');
    return new Promise(function () {});
  }

  if (profile.must_change_password && CURRENT_PAGE !== 'trocar-senha') {
    location.replace('trocar-senha.html');
    return new Promise(function () {});
  }

  // Admin vê tudo. Técnico e Atendente só acessam as páginas do próprio
  // perfil — tanto por URL direta quanto pelos links do menu.
  var PAGINAS_POR_ROLE = {
    tecnico: ['assistencia-tecnica', 'estoque'],
    atendente: ['clientes', 'pedido', 'catalogo', 'financeiro']
  };
  if (profile.role !== 'admin') {
    var paginasPermitidas = PAGINAS_POR_ROLE[profile.role] || [];
    if (CURRENT_PAGE !== 'trocar-senha' && paginasPermitidas.indexOf(CURRENT_PAGE) === -1) {
      location.replace(paginasPermitidas[0] + '.html');
      return new Promise(function () {});
    }
  }

  // Não usar DOMContentLoaded aqui: como este código já passou por vários
  // awaits, o DOM certamente já está pronto — e o evento pode já ter disparado
  // antes de chegarmos aqui, o que faria o listener nunca executar.
  var nameEls = document.querySelectorAll('[data-user-name]');
  nameEls.forEach(function (el) { el.textContent = profile.nome_exibicao; });

  // Esconde do menu os links de páginas fora do perfil de quem logou
  // (ex: Atendente não vê Estoque nem Usuários no menu).
  if (profile.role !== 'admin') {
    document.querySelectorAll('[data-role]').forEach(function (el) {
      var roles = el.getAttribute('data-role').split(' ');
      if (roles.indexOf(profile.role) === -1) el.remove();
    });
  }

  var logoutBtns = document.querySelectorAll('[data-logout]');
  logoutBtns.forEach(function (btn) {
    btn.addEventListener('click', async function () {
      await supabaseClient.auth.signOut();
      location.replace('login.html');
    });
  });

  return { session: session, profile: profile };
})();
