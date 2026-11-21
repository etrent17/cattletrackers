const CACHE_NAME = 'cattle-trackers-v11';
const urlsToCache = [
  '/',
  '/index.html',
  '/login.html',
  '/login.css',
  '/styles.css',
  '/src/auth.js',
  '/src/app.js',
  '/src/controllers/CattleController.js',
  '/src/controllers/UsersController.js',
  '/src/models/Cattle.js',
  '/src/services/AccountService.js',
  '/src/services/CattleService.js',
  '/src/utils/DateHelpers.js',
  '/src/utils/escapeHtml.js',
  '/src/utils/feedback.js',
  '/src/utils/validators.js',
  '/src/views/DashboardView.js',
  '/src/views/FormView.js',
  '/src/views/ListView.js',
  '/src/views/SettingsView.js',
  '/src/views/UsersView.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(urlsToCache.map((u) => cache.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});