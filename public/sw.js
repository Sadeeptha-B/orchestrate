/// <reference lib="webworker" />
const sw = self;

// Bumped to v3 for the move to the domain root (was cached under /orchestrate/ on GitHub Pages);
// the activate handler purges the stale v2 caches.
const CACHE_NAME = 'orchestrate-v3';

// Cache app shell on install
sw.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            cache.addAll([
                '/',
                '/index.html',
                '/manifest.json',
                '/favicon.svg',
                '/favicon.ico',
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
                        return caches.match('/index.html').then(
                            (fallback) => fallback || Response.error(),
                        );
                    }
                    return Response.error();
                }),
            ),
    );
});
