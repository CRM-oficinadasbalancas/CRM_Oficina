// Requer que o script da CDN do supabase-js já tenha sido carregado antes deste arquivo.
var supabaseClient = window.supabase.createClient(
  ADMIN_CONFIG.supabaseUrl,
  ADMIN_CONFIG.supabaseAnonKey
);

function usernameToEmail(username) {
  return username.trim().toLowerCase().replace(/\s+/g, '.') + ADMIN_CONFIG.syntheticEmailDomain;
}
