/// <reference lib="webworker" />
const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = 'orchestrate-v1';

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
                // Offline: serve from cache, fall back to index.html for SPA routing
                caches.match(event.request).then(
                    (cached) => cached || caches.match('/orchestrate/index.html') as Promise<Response>,
                ),
            ),
    );
});
