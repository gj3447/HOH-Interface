/* Only public application-shell assets may enter this cache. Profile/API responses never do. */
const CACHE = 'mhb-feed-shell-hoh-v1';
const SHELL = ['/feed/', '/feed/app.css', '/feed/app.js', '/feed/hoh-ui.js', '/feed/shell.js', '/feed/program-feed-adapter.js', '/feed/pwa.js', '/feed/manifest.webmanifest',
  '/feed/icons/icon.svg', '/feed/icons/icon-192.png', '/feed/icons/icon-512.png', '/feed/icons/maskable-512.png'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('mhb-feed-shell-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // The whitelist excludes /api/**, external URLs and future application data routes.
  const navigation = request.mode === 'navigate' && (url.pathname === '/feed/' || url.pathname === '/feed');
  if (!navigation && (!SHELL.includes(url.pathname) || url.search)) return;
  const key = navigation ? '/feed/' : url.pathname;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok && !response.redirected && response.type === 'basic') await cache.put(key, response.clone());
      return response;
    } catch {
      return await cache.match(key) || new Response('연결을 확인한 뒤 다시 열어주세요.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
