// Nome do cache — incrementar ao fazer deploy com mudanças nos assets
const CACHE_NAME = 'wabot-v3';

// Assets locais sempre incluídos no pré-cache
const ASSETS_LOCAL = [
    '/',
    '/estatisticas',
    '/manifest.json'
];

// Assets externos de CDN — cacheados de forma separada para não bloquear o install
const ASSETS_CDN = [
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js'
];

// Rotas de API que NUNCA devem ser cacheadas (dados em tempo real)
const API_ROUTES = ['/api/stats', '/api/sysinfo', '/api/mcstatus'];

// Instalação — pré-cache dos assets locais; CDN em best-effort (não bloqueia install)
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            // Assets locais são obrigatórios — falha aqui cancela o install
            await cache.addAll(ASSETS_LOCAL);

            // Assets de CDN em best-effort — falha não cancela o install
            await Promise.allSettled(
                ASSETS_CDN.map((url) =>
                    fetch(url).then((res) => {
                        if (res.ok) cache.put(url, res);
                    })
                )
            );

            // Força a ativação imediata após o cache estar pronto
            self.skipWaiting();
        })
    );
});

// Ativação — limpeza de caches antigos e assunção de controle
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            // Remove versões anteriores de cache
            caches.keys().then((cacheNames) =>
                Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => caches.delete(name))
                )
            ),
            // Assume controle das páginas abertas imediatamente
            self.clients.claim()
        ])
    );
});

// Fetch — estratégia Stale-While-Revalidate para assets estáticos
// Rotas de API sempre passam direto para a rede (sem cache)
self.addEventListener('fetch', (event) => {
    // Apenas requisições GET
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // Rotas de API: sempre busca da rede, nunca do cache
    if (url.origin === self.location.origin && API_ROUTES.includes(url.pathname)) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Assets estáticos: Stale-While-Revalidate
    event.respondWith(
        caches.open(CACHE_NAME).then((cache) =>
            cache.match(event.request).then((cachedResponse) => {
                const networkFetch = fetch(event.request)
                    .then((networkResponse) => {
                        // Atualiza o cache somente com respostas válidas e não-opacas
                        if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'error') {
                            try {
                                cache.put(event.request, networkResponse.clone());
                            } catch {
                                // Ignora falhas de cache (ex.: storage cheio, CORS)
                            }
                        }
                        return networkResponse;
                    })
                    .catch(() => null); // Offline: retorna null, fallback para cache abaixo

                // Serve cache imediatamente; revalida em segundo plano
                return cachedResponse || networkFetch;
            })
        )
    );
});
