// sw.js — Unified service worker for LMH (I9: offline-first PWA + push)
// Handles: precache app shell, runtime caching, background sync, web push.
// Framework-agnostic (no build step) — served from /public.
// Registered by root layout (offline) + /me/notifications (push).

const CACHE_VERSION = 'lmh-v2';
const PRECACHE_URLS = [
  '/',
  '/offline',
  '/logo.png',
  '/manifest.json',
];

function isCacheableResponse(response) {
  const cacheControl = response.headers.get('cache-control') || '';
  return !cacheControl.toLowerCase().includes('no-store');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

// Helper: network-first with cache fallback (for pages)
async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && fresh.type === 'basic' && isCacheableResponse(fresh)) {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await cache.match('/offline');
    if (offline) return offline;
    throw err;
  }
}

// Helper: cache-first (for static assets)
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && isCacheableResponse(fresh)) {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (err) {
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip cross-origin requests (e.g. Supabase, Google Fonts) — let them go to network.
  if (url.origin !== self.location.origin) return;

  // Health probes must always reach the runtime and must never use offline data.
  if (url.pathname.startsWith('/api/health/')) return;

  // API dinamis (antrean, rekap, pengaduan, dsb.) tidak boleh tersaji dari
  // cache stale-while-revalidate — data lama membuat petugas melihat antrean beku.
  if (url.pathname.startsWith('/api/')) return;

  // Static assets: cache-first
  if (url.pathname.startsWith('/_next/static/') || url.pathname === '/logo.png' || url.pathname === '/manifest.json') {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Navigation requests (pages): network-first with offline fallback
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

  // Other same-origin GETs: stale-while-revalidate (best effort)
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((fresh) => {
          if (fresh && fresh.ok && isCacheableResponse(fresh)) cache.put(req, fresh.clone());
          return fresh;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});

// ============================================================
// Background Sync — replay queued offline actions (I9.3)
// ============================================================
// Tag didaftarkan oleh src/lib/offline/sync.ts. 'checkin-sync' = tag lama (pengunjung), tetap dilayani agar
// pendaftaran sync dari versi halaman sebelumnya tidak menggantung.
const SYNC_TAGS = ['fo-walkin-sync', 'checkin-sync'];
const REPLAY_ACK_TIMEOUT_MS = 20000;

self.addEventListener('sync', (event) => {
  if (SYNC_TAGS.includes(event.tag)) {
    event.waitUntil(replayQueueFromIDB());
  }
});

// Minta satu halaman memutar ulang antrean dan MENUNGGU konfirmasinya lewat MessageChannel.
// Pemutaran memerlukan sesi Supabase (cookie/klien) dan RPC bertanda kepemilikan (replay.ts), jadi
// dilakukan di halaman, bukan di sini. Tanpa konfirmasi sync dianggap GAGAL (promise ditolak) supaya
// browser menjadwalkan ulang; sebelumnya pesan hanya "dilempar" dan sync dianggap sukses (audit T3a).
function askClientToReplay(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), REPLAY_ACK_TIMEOUT_MS);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(!!(e.data && e.data.ok === true));
    };
    try {
      client.postMessage({ type: 'REPLAY_QUEUE' }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

async function replayQueueFromIDB() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  // Tidak ada halaman terbuka: tidak ada yang bisa memutar. Tolak agar sync dicoba lagi nanti; bila
  // pengguna membuka kembali aplikasi, halaman memutar antrean sendiri saat dimuat.
  if (clients.length === 0) throw new Error('replay: tidak ada halaman terbuka');
  const hasil = await Promise.all(clients.map(askClientToReplay));
  if (!hasil.some(Boolean)) throw new Error('replay: tidak ada konfirmasi dari halaman');
}

// ============================================================
// Push notifications (copied from sw-push.js — I5)
// ============================================================
self.addEventListener('push', (event) => {
  let data = { title: 'Notifikasi DPMPTSP Lampung', body: '' };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch {
    data.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Notifikasi DPMPTSP Lampung', {
      body: data.body || '',
      icon: '/logo.png',
      badge: '/logo.png',
      data: data.payload || {},
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/me';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(target) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }
      return null;
    }),
  );
});
