// The app shell, so the page opens without a connection. Cattle data is NOT cached here:
// requests to /api/ are never intercepted. The herd's offline copy lives in IndexedDB
// (src/services/OfflineStore.js).
const CACHE_NAME = 'cattle-trackers-v17';
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
  '/src/controllers/SyncController.js',
  '/src/services/OfflineStore.js',
  '/src/services/SyncEngine.js',
  '/src/utils/connectivity.js',
  '/src/views/SyncView.js',
  '/src/controllers/CalvingController.js',
  '/src/services/CalvingService.js',
  '/src/views/CalvingView.js',
  '/src/controllers/TreatmentController.js',
  '/src/services/TreatmentService.js',
  '/src/views/TreatmentView.js',
  '/src/controllers/BreedingController.js',
  '/src/services/BreedingService.js',
  '/src/views/BreedingView.js',
  '/src/controllers/WeightController.js',
  '/src/services/WeightService.js',
  '/src/views/WeightView.js',
  '/src/controllers/FinanceController.js',
  '/src/services/FinanceService.js',
  '/src/utils/csv.js',
  '/src/utils/money.js',
  '/src/views/FinanceView.js',
  '/src/controllers/ReportsController.js',
  '/src/services/ReportsService.js',
  '/src/views/ReportsView.js',
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

// Bootstrap and Font Awesome come from CDNs. Without them the page cannot start (index.html
// uses Bootstrap's script), so they are part of the shell too. Each is requested the way
// index.html requests it (`mode`), because a cached answer only fits a request of the same kind.
const cdnAssets = [
  { url: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css', mode: 'no-cors' },
  { url: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js', mode: 'no-cors' },
  { url: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css', mode: 'cors' },
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

// An answer worth keeping: a normal 200, or an opaque one from a no-cors CDN request.
const cacheable = (res) => Boolean(res) && (res.status === 200 || res.type === 'opaque');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all([
        ...urlsToCache.map((u) => cache.add(u).catch(() => null)),
        ...cdnAssets.map(({ url, mode }) =>
          fetch(new Request(url, { mode, credentials: 'omit' }))
            .then((res) => (cacheable(res) ? cache.put(url, res) : null))
            .catch(() => null)),
      ])
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
  if (req.method !== 'GET') return;
  if (CDN_HOSTS.includes(url.hostname)) {
    // Versioned files that never change: the cached copy first, the network otherwise (the icon
    // fonts are picked up this way the first time they are used).
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (cacheable(res)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      }))
    );
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
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