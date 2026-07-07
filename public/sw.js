/// <reference lib="webworker" />
const sw = self;

// Bumped to v4 to purge any cached `/api/*` responses from before those were excluded (the sync
// sidecar's GET /api/state must never be served stale from cache); the activate handler purges older
// caches. (v3 was the move to the domain root from GitHub Pages's /orchestrate/ path.)
const CACHE_NAME = 'orchestrate-v4';

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
    // Never cache or intercept the Pages Functions API (auth, Todoist proxy, state sync) — these are
    // dynamic, secret-guarded, and marked no-store; a cached response would break sync + integrations.
    if (url.pathname.startsWith('/api/')) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Cache successful, non-redirected responses. An expired Cloudflare Access session
                // turns a navigation into a redirect chain ending at the Access login page — a 200
                // that must never be cached as the app shell.
                if (response.ok && !response.redirected) {
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
