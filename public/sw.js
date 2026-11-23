// Registrasi baru memakai /sw.js. /sw-push.js memuat worker ini jika masih
// menjadi URL registrasi lama, sehingga scope dan langganan push tetap sama.
if (self.location.pathname === '/sw.js') importScripts('/sw-push.js');

const CACHE_VERSION = 'lmh-sw-v4';
const CACHE_PUBLIC = CACHE_VERSION + '-public';
const CACHE_STATIC = CACHE_VERSION + '-static';
const MAX_STATIC_ENTRIES = 256;
const MAX_PUBLIC_AGE_MS = 24 * 60 * 60 * 1000;
const OFFLINE_URL = '/offline';
const PUBLIC_PAGES = new Set(['/', OFFLINE_URL]);
const PUBLIC_ASSETS = new Set([
  '/logo.png',
  '/manifest.json',
  '/manifest-icon-192.png',
  '/manifest-icon-512.png',
  '/manifest-icon-maskable-512.png',
]);

function cacheDirectives(response) {
  const control = response.headers.get('cache-control') || '';
  return new Set(control.toLowerCase().split(',').map((entry) => entry.split('=')[0].trim()));
}

async function saveResponse(cacheName, request, response) {
  if (response.status !== 200 || response.type !== 'basic' || response.redirected) return;

  const directives = cacheDirectives(response);
  if (['no-store', 'no-cache', 'private'].some((directive) => directives.has(directive))) return;
  if (/\b(cookie|authorization)\b|\*/i.test(response.headers.get('vary') || '')) return;

  const path = new URL(request.url).pathname;
  if (PUBLIC_PAGES.has(path)) {
    if (response.headers.get('x-lmh-offline-cache') !== 'public') return;
    if (!response.headers.get('content-type')?.startsWith('text/html')) return;
  } else {
    if (!directives.has('public')) return;
    if (cacheName === CACHE_STATIC && !directives.has('immutable')) return;
  }

  // Klon sebelum await agar respons asli bisa mulai dikirim ke halaman.
  const copy = response.clone();
  const cache = await caches.open(cacheName);
  await cache.put(request, copy);
  if (cacheName === CACHE_STATIC) {
    const entries = await cache.keys();
    const excess = entries.length - MAX_STATIC_ENTRIES;
    if (excess > 0) await Promise.all(entries.slice(0, excess).map((entry) => cache.delete(entry)));
  }
}

function matchCache(cacheName, request) {
  return caches.match(request, { cacheName }).catch(() => undefined);
}

function offlineRequest() {
  return new Request(new URL(OFFLINE_URL, self.location.origin), {
    credentials: 'omit',
    headers: { Accept: 'text/html' },
  });
}

async function offlineFallback() {
  const cached = await matchCache(CACHE_PUBLIC, offlineRequest());
  return cached || new Response(
    '<!doctype html><html lang="id"><meta charset="utf-8"><title>Offline | LMH</title>' +
    '<h1>Anda Sedang Offline</h1><p>Periksa koneksi internet, lalu coba lagi.</p>' +
    '<a href="/">Kembali ke Beranda</a></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

self.addEventListener('install', (event) => {
  const requests = [
    offlineRequest(),
    ...Array.from(PUBLIC_ASSETS, (path) => new Request(new URL(path, self.location.origin), { credentials: 'omit' })),
  ];
  // Kegagalan cache atau jaringan tetap memberi fallback HTML dan menjaga push/sync aktif.
  event.waitUntil(Promise.allSettled(requests.map(async (request) => {
    const response = await fetch(request);
    await saveResponse(CACHE_PUBLIC, request, response);
  })).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('lmh-') && key !== CACHE_PUBLIC && key !== CACHE_STATIC)
      .map((key) => caches.delete(key)),
  )).catch(() => undefined).then(() => self.clients.claim()));
});

function respondWithCache(event, cacheName) {
  const request = event.request;
  const isStatic = cacheName === CACHE_STATIC;
  const result = (async () => {
    if (isStatic) {
      const cached = await matchCache(cacheName, request);
      if (cached) return { response: cached };
    }
    const response = await fetch(request);
    const write = saveResponse(cacheName, request, response);
    return { response, write };
  })();

  event.waitUntil(result.then(({ write }) => write).catch(() => undefined));
  event.respondWith(result.then(({ response }) => response).catch(async (error) => {
    if (isStatic) throw error;
    const cached = await matchCache(cacheName, request);
    const age = Date.now() - Date.parse(cached?.headers.get('date') || '');
    if (cached && age <= MAX_PUBLIC_AGE_MS) return cached;
    if (request.mode === 'navigate') return offlineFallback();
    throw error;
  }));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // API (termasuk health) dan navigasi RSC selalu melewati cache worker.
  if (url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (
    request.headers.has('rsc') ||
    request.headers.has('next-router-state-tree') ||
    request.headers.has('next-router-prefetch') ||
    request.headers.has('next-router-segment-prefetch') ||
    url.searchParams.has('_rsc') ||
    url.pathname.startsWith('/_next/data/')
  ) return;

  if (!request.headers.has('authorization')) {
    if (url.pathname.startsWith('/_next/static/')) {
      respondWithCache(event, CACHE_STATIC);
      return;
    }
    if (!url.search && (PUBLIC_ASSETS.has(url.pathname) ||
        (request.mode === 'navigate' && PUBLIC_PAGES.has(url.pathname)))) {
      respondWithCache(event, CACHE_PUBLIC);
      return;
    }
  }

  // Halaman akun, staf, dan rute lain hanya mendapat fallback umum saat jaringan putus.
  if (request.mode === 'navigate') {
    const protectedRoute = /^\/(admin|petugas|me)(\/|$)/.test(url.pathname);
    const network = protectedRoute ? fetch(request, { cache: 'no-store' }) : fetch(request);
    event.respondWith(network.catch(offlineFallback));
  }
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
