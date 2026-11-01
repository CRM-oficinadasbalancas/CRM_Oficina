// Service worker do app de chamados. Só guarda a "casca" do app (HTML/CSS/JS/ícones)
// para abrir rápido e instalar na tela inicial. Os dados vêm sempre online do Supabase
// (nunca são guardados aqui): sem internet o app avisa e não deixa salvar.
var VERSAO = 'chamados-v2';
var CASCA = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './apple-touch-icon.png',
  './instalar.html',
  '../admin/js/admin-config.js',
  '../admin/js/supabase-client.js',
  '../assets/img/logo-oficina-branca.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(CASCA); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.filter(function (n) { return n !== VERSAO; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase e CDNs: direto da rede, sem cache

  // Rede primeiro (pega atualizações); se estiver offline, usa a casca guardada.
  e.respondWith(
    fetch(req).then(function (resp) {
      var copia = resp.clone();
      caches.open(VERSAO).then(function (c) { c.put(req, copia); });
      return resp;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); });
    })
  );
});
