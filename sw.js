// ============================================================
// Equatorial Energia — Service Worker com Cache Busting
// Versão: incremente CACHE_VERSION sempre que mudar o app
// ============================================================

const CACHE_VERSION = 'v1';
const CACHE_STATIC  = `equatorial-static-${CACHE_VERSION}`;
const CACHE_DYNAMIC = `equatorial-dynamic-${CACHE_VERSION}`;

// Recursos estáticos para pre-cache no install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Inter:wght@300;400;500&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

// Domínios que NUNCA devem ser cacheados (Firebase, APIs em tempo real)
const BYPASS_DOMAINS = [
  'firebaseapp.com',
  'googleapis.com',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'gstatic.com/firebasejs',
  'openstreetmap.org',   // tiles do mapa — sempre frescos
];

// ── INSTALL: pre-cacheia os assets estáticos ──────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()) // ativa imediatamente
  );
});

// ── ACTIVATE: remove caches de versões antigas ────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key =>
            (key.startsWith('equatorial-static-') || key.startsWith('equatorial-dynamic-')) &&
            key !== CACHE_STATIC &&
            key !== CACHE_DYNAMIC
          )
          .map(key => {
            console.log('[SW] Removendo cache antigo:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: estratégia por tipo de recurso ─────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // 1. Ignorar requisições não-GET
  if (event.request.method !== 'GET') return;

  // 2. Ignorar domínios do Firebase e tiles do mapa
  const shouldBypass = BYPASS_DOMAINS.some(domain => url.includes(domain));
  if (shouldBypass) return;

  // 3. index.html — Network First (garante sempre a versão mais recente)
  if (url.endsWith('/') || url.endsWith('/index.html') || url.endsWith('index.html')) {
    event.respondWith(networkFirst(event.request, CACHE_STATIC));
    return;
  }

  // 4. Assets estáticos conhecidos — Cache First
  const isStaticAsset = STATIC_ASSETS.some(asset => url === asset || url.startsWith(asset));
  if (isStaticAsset) {
    event.respondWith(cacheFirst(event.request, CACHE_STATIC));
    return;
  }

  // 5. Outros recursos externos (fontes, CDNs) — Stale While Revalidate
  if (url.startsWith('https://')) {
    event.respondWith(staleWhileRevalidate(event.request, CACHE_DYNAMIC));
  }
});

// ── ESTRATÉGIAS ───────────────────────────────────────────────

// Network First: tenta rede, cai no cache se offline
async function networkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback();
  }
}

// Cache First: serve do cache, busca na rede se não tiver
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return offlineFallback();
  }
}

// Stale While Revalidate: serve cache imediatamente, atualiza em background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || await networkFetch || offlineFallback();
}

// Fallback offline simples
function offlineFallback() {
  return new Response(
    `<!DOCTYPE html>
    <html lang="pt-BR">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Sem conexão</title>
    <style>
      body { font-family: sans-serif; display: flex; align-items: center; justify-content: center;
             min-height: 100vh; margin: 0; background: #f0f4f8; }
      .box { text-align: center; padding: 40px; background: white; border-radius: 16px;
             box-shadow: 0 4px 24px rgba(0,0,0,0.1); max-width: 360px; }
      h2 { font-size: 20px; margin-bottom: 8px; color: #0d1230; }
      p  { font-size: 14px; color: #6b7a99; }
      .icon { font-size: 48px; margin-bottom: 16px; }
    </style></head>
    <body>
      <div class="box">
        <div class="icon">📡</div>
        <h2>Sem conexão</h2>
        <p>Verifique sua internet e tente novamente.</p>
      </div>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}

// ── MENSAGENS: permite forçar update via postMessage ──────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
