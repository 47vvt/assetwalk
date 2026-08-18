// Offline is the whole game: audits happen in warehouses, comms rooms and
// storage closets with no signal, and an app that will not start there is an
// app that does not work. This caches the shell so it launches from a home
// screen with the radio off.
//
// It caches the shell and NOTHING ELSE. Positional history is held in memory
// only and never persisted (§5); a service worker that cached an API response
// would put a shelf's worth of asset tags on the device indefinitely, which is
// exactly the thing the backend exists to prevent. The guard is below and
// there is a test that fails if it is removed.
//
// Written in plain JavaScript rather than TypeScript: it is not part of the
// module graph the compiler sees, and a reviewer should be able to read the
// file that is actually served.

const CACHE = 'assetwalk-shell-v1';

// Everything needed to render the first screen with no network. config.json is
// deliberately absent: it is deployment state, it changes without the shell
// changing, and a stale copy would point the app at the wrong backend.
const SHELL = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './favicon.svg',
  './icon-192.png',
  './dist/main.js',
];

self.addEventListener('install', (event) => {
  // The rest of the module graph is pulled in on first run by the fetch
  // handler below. Listing every emitted file here would be a list that rots
  // silently the first time a module is added.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

function isOurs(url) {
  return url.origin === self.location.origin && !url.pathname.includes('/api/');
}

function isConfig(url) {
  return url.pathname.endsWith('/config.json');
}

// Network first, cache as a fallback. Deployment config has no audit data in
// it — a backend path, an instance URL and a public client ID — so caching it
// is not what §5 forbids. Not caching it at all was worse: offline the config
// fetch would fail, the app would fall back to its fixture, and an auditor
// would be walking a demo shelf without being told.
async function config(request) {
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const copy = fresh.clone();
      void caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return fresh;
  } catch (unreachable) {
    const hit = await caches.match(request);
    if (hit !== undefined) return hit;
    throw unreachable;
  }
}

async function shell(request) {
  // Every route renders the same document, so a navigation to ?walk=… has to
  // resolve to the cached index. Matching on the full URL never would: the
  // query string is part of the cache key.
  const key = request.mode === 'navigate' ? './index.html' : request;
  const hit = await caches.match(key);
  // Cache first, because the shell only changes when the app is redeployed and
  // an auditor at a rack should not wait on a timeout.
  if (hit !== undefined) return hit;

  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const copy = response.clone();
    void caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // API traffic goes to the network untouched, every time. Audit data must
  // never end up in a cache, and a stale roster would be worse than no roster.
  if (event.request.method !== 'GET' || !isOurs(url)) return;

  event.respondWith(isConfig(url) ? config(event.request) : shell(event.request));
});
