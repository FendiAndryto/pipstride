/*
 * Pipstride service worker — app shell only (ADR 0006, SPEC-002).
 *
 * Static assets use stale-while-revalidate so a flaky connection still renders the
 * shell. API traffic is deliberately NOT intercepted: MT5 telemetry is
 * time-sensitive, so a cached equity figure presented as current would be worse
 * than a visible failure. Bump CACHE_VERSION on every deploy that changes the shell.
 */

const CACHE_VERSION = 'pipstride-shell-v1';

const SHELL_ASSETS = [
  '/',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only same-origin GETs are cacheable. Everything else falls through to the network.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Telemetry, auth and health endpoints are never served from cache.
  if (url.pathname.startsWith('/api/') || url.pathname === '/health' || url.pathname === '/ready') {
    return;
  }

  // Navigations are network-first: a stale index.html would point at bundle hashes
  // that no longer exist after a deploy. Cache is only the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);

  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put('/index.html', response.clone());
    return response;
  } catch {
    const shell = (await cache.match('/index.html')) || (await cache.match('/'));
    if (shell) return shell;
    return Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const response = await network;
  if (response) return response;

  return Response.error();
}
