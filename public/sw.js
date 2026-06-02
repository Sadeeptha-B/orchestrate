/// <reference lib="webworker" />
const sw = self;

const CACHE_NAME = 'orchestrate-v2';

// Cache app shell on install
sw.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            cache.addAll([
                '/orchestrate/',
                '/orchestrate/index.html',
                '/orchestrate/manifest.json',
                '/orchestrate/favicon.svg',
                '/orchestrate/favicon.ico',
            ]),
        ),
    );
    sw.skipWaiting();
});

// Clean old caches on activate
sw.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
            ),
        ),
    );
    sw.clients.claim();
});

// Network-first strategy: try network, fall back to cache
sw.addEventListener('fetch', (event) => {
    // Skip non-GET and cross-origin requests
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== sw.location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Cache successful responses
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() =>
                // Offline / network error: serve from cache when we have it.
                caches.match(event.request).then((cached) => {
                    if (cached) return cached;
                    // Only substitute the app shell for navigations (SPA deep-link routing).
                    // NEVER return index.html in place of a failed asset/module request —
                    // feeding HTML to a dynamic `import()` breaks lazy routes with
                    // "Failed to fetch dynamically imported module".
                    if (event.request.mode === 'navigate') {
                        return caches.match('/orchestrate/index.html').then(
                            (fallback) => fallback || Response.error(),
                        );
                    }
                    return Response.error();
                }),
            ),
    );
});
