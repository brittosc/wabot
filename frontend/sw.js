// Nome do cache — incrementar ao fazer deploy
const CACHE_NAME = "wabot-frontend-v1";

// Assets de CDN cacheados em best-effort
const ASSETS_CDN = [
  "https://cdn.jsdelivr.net/npm/chart.js",
  "https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js",
];

// Rotas que nunca devem ser cacheadas (API externa)
const isApiUrl = (url) => url.includes("/api/");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(["/"]);
      await Promise.allSettled(
        ASSETS_CDN.map((url) =>
          fetch(url).then((res) => {
            if (res.ok) cache.put(url, res);
          }),
        ),
      );
      self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((n) => n !== CACHE_NAME)
              .map((n) => caches.delete(n)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = event.request.url;

  // API — sempre busca da rede
  if (isApiUrl(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Assets estáticos — Stale-While-Revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request)
          .then((res) => {
            if (res && res.status === 200 && res.type !== "error") {
              try {
                cache.put(event.request, res.clone());
              } catch {
                // Ignora falhas de cache
              }
            }
            return res;
          })
          .catch(() => null);
        return cached || networkFetch;
      }),
    ),
  );
});
