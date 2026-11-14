// Network-first service worker: when online the latest deployed version is
// always used (so there's no version number to bump), and the cached copy is
// used when offline or when the network is too slow. App data lives in
// localStorage and is never touched by updates.

const CACHE = 'daruma-shell';
const TIMEOUT = 3000;
// The font and the KanjiVG drawings (kanjivg/) aren't listed: they're large,
// and are cached as they're first used, like anything else fetched.
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/sync.js', 'js/github.js', 'js/markdown.js',
  'js/settings.js', 'js/ui.js', 'js/version.js', 'js/merge.js', 'js/kanji.js', 'js/corrections.js',
  'js/rtk.js', 'js/rtkdata.js', 'js/rtksource.js', 'js/kanjivg-animate.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // e.g. api.github.com
  e.respondWith(networkFirst(e));
});

// The network's answer if it comes within TIMEOUT, else the cached copy. With
// nothing cached it waits for the network however long it takes (e.g. the
// font on a slow connection), and a late answer is still cached for next time.
async function networkFirst(e) {
  const { request } = e;
  const cache = await caches.open(CACHE);
  const network = fetch(request.url, { cache: 'no-cache' });
  // (Registered first, so it clones the response before the page reads it.)
  e.waitUntil(network.then((r) => r.ok && cache.put(request.url, r.clone())).catch(() => {}));
  const timeout = new Promise((resolve) => setTimeout(resolve, TIMEOUT, null));
  try {
    const response = await Promise.race([network, timeout]);
    if (response) return response;
  } catch { /* offline: use the cache */ }
  const cached = (await cache.match(request.url, { ignoreSearch: true })) ||
    (request.mode === 'navigate' && (await cache.match('index.html')));
  return cached || network.catch(() => Response.error());
}
