const CACHE_NAME = 'wabot-v2'; // Incrementado de v1 para v2
const ASSETS = [
    '/',
    '/estatisticas',
    '/manifest.json',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js'
];

// Instalação - Pré-cache de assets essenciais
self.addEventListener('install', (event) => {
    self.skipWaiting(); // Força a atualização imediata do Service Worker
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

// Ativação - Limpeza de caches antigos e assumir controle
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            // Limpa versões anteriores de cache
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.filter((name) => name !== CACHE_NAME)
                        .map((name) => caches.delete(name))
                );
            }),
            // Assume o controle das páginas abertas imediatamente
            self.clients.claim()
        ])
    );
});

// Fetch - Estratégia Stale-While-Revalidate
// Serve do cache imediatamente e atualiza em segundo plano
self.addEventListener('fetch', (event) => {
    // Apenas requisições GET
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request).then((cachedResponse) => {
                const fetchedResponse = fetch(event.request).then((networkResponse) => {
                    // Atualiza o cache se a resposta for válida
                    if (networkResponse && networkResponse.status === 200) {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                }).catch(() => {
                    // Se falhar na rede, apenas retorna o que tiver no cache
                    return null;
                });

                // Retorna a resposta do cache imediatamente ou aguarda a rede se não houver cache
                return cachedResponse || fetchedResponse;
            });
        })
    );
});

