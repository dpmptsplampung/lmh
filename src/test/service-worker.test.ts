// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { SYNC_TAG_FO_WALKIN } from '../lib/offline/sync';

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const pushSource = readFileSync(new URL('../../public/sw-push.js', import.meta.url), 'utf8');
const origin = 'https://lmh.test';
const staticAsset = '/_next/static/chunks/abc.js?dpl=new';

type Handler = (event: unknown) => void;
type FakeClient = { url: string; focus: () => void } | { postMessage: (msg: unknown, transfer: unknown[]) => void };

function response(body: string, control = 'public, max-age=60', optIn = true) {
  const headers = new Headers({ 'cache-control': control, 'content-type': 'text/html', date: new Date().toUTCString() });
  if (optIn) headers.set('x-lmh-offline-cache', 'public');
  const result = new Response(body, { headers });
  Object.defineProperty(result, 'type', { value: 'basic' });
  return result;
}

function setupWorker(entry = '/sw.js', clients: FakeClient[] = []) {
  const handlers = new Map<string, Handler>();
  const storage = new Map<string, Map<string, Response>>();
  const key = (request: Request | string) =>
    new URL(typeof request === 'string' ? request : request.url, origin).href;
  const put = vi.fn(async (entries: Map<string, Response>, request: Request | string, res: Response) => {
    entries.set(key(request), res);
  });
  const open = async (name: string) => {
    if (!storage.has(name)) storage.set(name, new Map());
    const entries = storage.get(name)!;
    return {
      put: (request: Request, res: Response) => put(entries, request, res),
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
      delete: async (request: Request) => entries.delete(key(request)),
    };
  };
  const fetch = vi.fn<(request: Request, options?: RequestInit) => Promise<Response>>(async () => response('offline'));
  const openWindow = vi.fn();
  const showNotification = vi.fn();
  const claim = vi.fn();
  const scope = {
    location: new URL(entry, origin),
    addEventListener: (name: string, handler: Handler) => {
      if (handlers.has(name)) throw new Error('Listener ganda: ' + name);
      handlers.set(name, handler);
    },
    registration: { showNotification },
    clients: { matchAll: async () => clients, openWindow, claim },
    skipWaiting: vi.fn(),
  };
  const timers: (() => void)[] = [];
  class FakeChannel {
    port1: { onmessage: ((event: { data: unknown }) => void) | null } = { onmessage: null };
    port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }) };
  }
  const load = (script: string) => runInContext(script === '/sw-push.js' ? pushSource : source, context);
  const context = createContext({
    self: scope,
    URL, Request, Response, fetch,
    MessageChannel: FakeChannel,
    setTimeout: (task: () => void) => timers.push(task),
    clearTimeout: () => undefined,
    caches: {
      open,
      match: async (request: Request | string, options: { cacheName: string }) =>
        storage.get(options.cacheName)?.get(key(request))?.clone(),
      keys: async () => [...storage.keys()],
      delete: async (name: string) => storage.delete(name),
    },
    importScripts: load,
  });
  load(scope.location.pathname);

  function dispatch(name: string, event: Record<string, unknown> = {}) {
    const lifetime: Promise<unknown>[] = [];
    let reply: Promise<Response> | undefined;
    handlers.get(name)?.({
      ...event,
      waitUntil: (task: Promise<unknown>) => lifetime.push(task),
      respondWith: (task: Promise<Response>) => { reply = task; },
    });
    return { lifetime, reply };
  }

  function get(path: string, mode = 'navigate', headers?: HeadersInit) {
    const request = new Request(new URL(path, origin), { headers });
    Object.defineProperty(request, 'mode', { value: mode });
    return dispatch('fetch', { request });
  }
  return { dispatch, get, storage, open, put, fetch, openWindow, showNotification, claim, scope, handlers, timers };
}

describe('service worker runtime cache safety', () => {
  it.each(['/sw.js', '/sw.js?v=old-build', '/sw-push.js'])('menjaga push, sync, dan halaman offline lewat %s', async (entry) => {
    const worker = setupWorker(entry);
    await worker.open('lmh-old-build');
    await worker.open('lmh-v3');
    await worker.open('cache-aplikasi-lain');
    await Promise.all(worker.dispatch('install').lifetime);
    await Promise.all(worker.dispatch('activate').lifetime);
    expect(worker.storage.has('lmh-old-build')).toBe(false);
    expect(worker.storage.has('lmh-v3')).toBe(false);
    expect(worker.storage.has('cache-aplikasi-lain')).toBe(true);
    expect(worker.scope.skipWaiting).toHaveBeenCalledOnce();
    expect(worker.claim).toHaveBeenCalledOnce();
    expect(worker.handlers.has('sync')).toBe(true);
    expect(worker.fetch.mock.calls.some(([req]) => req.url.endsWith('/offline') && req.credentials === 'omit')).toBe(true);

    worker.fetch.mockRejectedValue(new Error('jaringan putus'));
    const fallback = worker.get('/admin/fo/registrasi');
    expect(await (await fallback.reply)?.text()).toBe('offline');
    await Promise.all(fallback.lifetime);
    await Promise.all(worker.dispatch('push', { data: { json: () => ({ title: 'Antrean' }) } }).lifetime);
    expect(worker.showNotification).toHaveBeenCalledWith('Antrean', expect.anything());
  });

  it.each([
    ['/api/health/live', 'cors'],
    ['/api', 'navigate'],
    ['/api/admin/antrean', 'cors'],
    ['/_next/data/stale/index.json', 'cors'],
    ['/?_rsc=old', 'cors'],
    ['/', 'cors', { RSC: '1' }],
    ['/assets/baru.png', 'cors'],
    ['https://cdn.example/image.png', 'cors'],
  ] as const)('melewatkan %s tanpa memakai Cache Storage', (path, mode, headers?: HeadersInit) => {
    const worker = setupWorker();
    expect(worker.get(path, mode, headers).reply).toBeUndefined();
    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.storage.size).toBe(0);
  });

  it.each([
    ['/admin/fo/registrasi', { cache: 'no-store' }],
    ['/petugas', { cache: 'no-store' }],
    ['/me/notifications', { cache: 'no-store' }],
    ['/rute-baru', undefined],
    ['/?layanan=oss', undefined],
  ] as const)(
    'pergantian sesi tidak menyajikan dokumen yang pernah dilihat di %s',
    async (path, options) => {
      const worker = setupWorker();
      await Promise.all(worker.dispatch('install').lifetime);
      worker.put.mockClear();
      worker.fetch.mockResolvedValueOnce(response('sesi pertama'));
      const online = worker.get(path);
      expect(await (await online.reply)?.text()).toBe('sesi pertama');
      await Promise.all(online.lifetime);
      expect(worker.put).not.toHaveBeenCalled();
      expect(worker.fetch.mock.lastCall?.[1]).toEqual(options);
      worker.fetch.mockRejectedValueOnce(new Error('sesi baru sedang offline'));
      expect(await (await worker.get(path).reply)?.text()).toBe('offline');
    },
  );

  it.each(['public, no-store', 'public, No-Cache="Set-Cookie"', 'private, max-age=60'])(
    'menghormati Cache-Control %s pada precache dan navigasi publik',
    async (control) => {
      const worker = setupWorker();
      worker.fetch.mockImplementation(async () => response('jangan simpan', control));
      await Promise.all(worker.dispatch('install').lifetime);
      const online = worker.get('/');
      expect(await (await online.reply)?.text()).toBe('jangan simpan');
      await Promise.all(online.lifetime);
      expect(worker.put).not.toHaveBeenCalled();
    },
  );

  it('mensyaratkan opt-in server dan membatasi umur beranda publik', async () => {
    const worker = setupWorker();
    worker.fetch.mockResolvedValueOnce(response('tanpa opt-in', 'public, max-age=60', false));
    await Promise.all(worker.get('/').lifetime);
    expect(worker.put).not.toHaveBeenCalled();

    worker.fetch.mockResolvedValueOnce(response('beranda publik'));
    await Promise.all(worker.get('/').lifetime);
    worker.fetch.mockRejectedValue(new Error('jaringan putus'));
    expect(await (await worker.get('/').reply)?.text()).toBe('beranda publik');

    const stale = response('beranda lama');
    stale.headers.set('date', new Date(Date.now() - 2 * 86400000).toUTCString());
    worker.fetch.mockResolvedValueOnce(stale);
    await Promise.all(worker.get('/').lifetime);
    expect(await (await worker.get('/').reply)?.text()).toContain('Anda Sedang Offline');
  });

  it('mengikat penulisan cache miss ke fetch event tanpa menahan respons dan menggunakan cache pada hit', async () => {
    const worker = setupWorker();
    const originalPut = worker.put.getMockImplementation()!;
    let finishWrite!: () => void;
    const pendingWrite = new Promise<void>((resolve) => { finishWrite = resolve; });
    worker.put.mockImplementationOnce(async (...args) => {
      await pendingWrite;
      await originalPut(...args);
    });
    worker.fetch.mockResolvedValueOnce(response('chunk', 'public, max-age=31536000, immutable', false));
    const { reply, lifetime } = worker.get(staticAsset, 'cors');
    expect(lifetime).toHaveLength(1);
    expect(await (await reply)?.text()).toBe('chunk');
    const finished = vi.fn();
    void lifetime[0].then(finished);
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    finishWrite();
    await lifetime[0];

    const hit = worker.get(staticAsset, 'cors');
    expect(await (await hit.reply)?.text()).toBe('chunk');
    await Promise.all(hit.lifetime);
    expect(worker.fetch).toHaveBeenCalledOnce();
  });

  it('menyajikan jaringan meski cache.put menolak karena kuota', async () => {
    const worker = setupWorker();
    worker.put.mockRejectedValueOnce(new Error('quota exceeded'));
    worker.fetch.mockResolvedValueOnce(response('chunk', 'public, max-age=31536000, immutable', false));
    const { reply, lifetime } = worker.get(staticAsset, 'cors');
    expect(await (await reply)?.text()).toBe('chunk');
    await expect(Promise.all(lifetime)).resolves.toBeDefined();
    expect(worker.put).toHaveBeenCalledOnce();
    expect(worker.fetch).toHaveBeenCalledOnce();
  });

  it('membuang entri chunk terlama saat cache aset melewati batas', async () => {
    const worker = setupWorker();
    worker.fetch.mockResolvedValueOnce(response('chunk', 'public, immutable', false));
    await Promise.all(worker.get(staticAsset, 'cors').lifetime);
    const [cacheName] = worker.storage.keys();
    const cache = await worker.open(cacheName);
    for (let i = 0; i < 256; i++) {
      await cache.put(new Request(origin + '/_next/static/' + i + '.js'), response('chunk'));
    }
    worker.fetch.mockResolvedValueOnce(response('baru', 'public, immutable', false));
    await Promise.all(worker.get('/_next/static/baru.js', 'cors').lifetime);
    const entries = await cache.keys();
    expect(entries).toHaveLength(256);
    expect(entries.map((request) => request.url)).not.toContain(origin + staticAsset);
    expect(entries.map((request) => request.url)).toContain(origin + '/_next/static/baru.js');
  });
});

describe('aset pemasangan PWA', () => {
  it('mencocokkan ukuran ikon manifest dengan dimensi PNG yang disajikan', () => {
    const dir = new URL('../../public/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8')) as {
      icons: { src: string; sizes: string; purpose: string; type: string }[];
    };
    expect(manifest.icons.map(({ sizes, purpose }) => [sizes, purpose])).toEqual([
      ['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable'],
    ]);
    expect(new Set(manifest.icons.map(({ src }) => src)).size).toBe(manifest.icons.length);
    for (const { src, sizes, type } of manifest.icons) {
      const png = readFileSync(new URL(src.slice(1), dir));
      expect(type).toBe('image/png');
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.readUInt32BE(16) + 'x' + png.readUInt32BE(20)).toBe(sizes);
    }
  });

  it('memberi opt-in cache hanya pada dua dokumen publik dan merevalidasi kedua skrip worker', async () => {
    const { default: config } = await import('../../next.config');
    const rules = await config.headers?.();
    expect(rules?.filter((rule) => rule.headers.some(({ key }) => key === 'X-LMH-Offline-Cache'))
      .map(({ source }) => source)).toEqual(['/', '/offline']);
    for (const source of ['/sw.js', '/sw-push.js']) {
      expect(rules?.find((rule) => rule.source === source)?.headers).toContainEqual({
        key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate',
      });
    }
  });
});

describe('service worker notificationclick', () => {
  it('memfokuskan hanya tab yang cocok persis, termasuk query dan hash', async () => {
    const target = origin + '/me/reservasi?id=123#status';
    const wrong = { url: origin + '/me?next=' + target, focus: vi.fn() };
    const right = { url: target, focus: vi.fn() };
    const worker = setupWorker('/sw.js', [wrong, right]);
    const close = vi.fn();
    await Promise.all(worker.dispatch('notificationclick', { notification: { close, data: { url: target } } }).lifetime);
    expect(close).toHaveBeenCalledOnce();
    expect(wrong.focus).not.toHaveBeenCalled();
    expect(right.focus).toHaveBeenCalledOnce();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it.each([
    ['/me/reservasi?id=123#status', '/me/reservasi?id=123#status'],
    ['https://lmh.test.evil.example/me', '/me'],
    ['//evil.example/me', '/me'],
    ['blob:https://lmh.test/123', '/me'],
    ['http://lmh.test/me', '/me'],
    ['http://[', '/me'],
    [undefined, '/me'],
  ])('membuka tujuan tervalidasi untuk %s melalui skrip lama', async (url, path) => {
    const worker = setupWorker('/sw-push.js');
    await Promise.all(worker.dispatch('notificationclick', { notification: { close: vi.fn(), data: { url } } }).lifetime);
    expect(worker.openWindow).toHaveBeenCalledExactlyOnceWith(origin + path);
  });
});

// ---------------------------------------------------------------------------
// Background Sync (audit T3a): listener nyata yang MENUNGGU konfirmasi halaman; tanpa halaman/konfirmasi,
// sync ditolak sehingga browser menjadwalkan ulang (dulu: pesan dilempar lalu sync dianggap sukses -> data hilang).
// ---------------------------------------------------------------------------
function muatSw(clients: FakeClient[]) {
  const { dispatch, timers } = setupWorker('/sw.js', clients);
  return {
    jalankanSync: (tag: string) => dispatch('sync', { tag }).lifetime[0] ?? null,
    timers,
  };
}

describe('service worker Background Sync (T3a)', () => {
  it('tag sync di SW = tag yang didaftarkan klien (src/lib/offline/sync.ts)', () => {
    expect(SYNC_TAG_FO_WALKIN).toBe('fo-walkin-sync');
    expect(source).toContain(`'${SYNC_TAG_FO_WALKIN}'`);
  });

  it('tag tak dikenal diabaikan (tidak memanggil waitUntil)', () => {
    const { jalankanSync } = muatSw([]);
    expect(jalankanSync('tag-lain')).toBeNull();
  });

  it('tanpa halaman terbuka: sync DITOLAK (bukan dianggap sukses) agar dijadwalkan ulang', async () => {
    const { jalankanSync } = muatSw([]);
    await expect(jalankanSync('fo-walkin-sync')).rejects.toThrow(/tidak ada halaman terbuka/);
  });

  it('halaman mengonfirmasi ok -> sync sukses; pesan REPLAY_QUEUE dikirim dengan port balasan', async () => {
    const terima: { msg: unknown; port: unknown }[] = [];
    const klien = {
      postMessage: (msg: unknown, transfer: unknown[]) => {
        terima.push({ msg, port: transfer[0] });
        (transfer[0] as { postMessage: (d: unknown) => void }).postMessage({ ok: true });
      },
    };
    const { jalankanSync } = muatSw([klien]);
    await expect(jalankanSync('fo-walkin-sync')).resolves.toBeUndefined();
    expect(terima).toHaveLength(1);
    expect(terima[0].msg).toEqual({ type: 'REPLAY_QUEUE' });
    expect(terima[0].port).toBeDefined();
  });

  it('tag lama checkin-sync tetap dilayani', async () => {
    const klien = { postMessage: (_m: unknown, t: unknown[]) => (t[0] as { postMessage: (d: unknown) => void }).postMessage({ ok: true }) };
    const { jalankanSync } = muatSw([klien]);
    await expect(jalankanSync('checkin-sync')).resolves.toBeUndefined();
  });

  it('halaman membalas ok:false (masih ada item gagal) -> sync ditolak agar diulang', async () => {
    const klien = { postMessage: (_m: unknown, t: unknown[]) => (t[0] as { postMessage: (d: unknown) => void }).postMessage({ ok: false }) };
    const { jalankanSync } = muatSw([klien]);
    await expect(jalankanSync('fo-walkin-sync')).rejects.toThrow(/tidak ada konfirmasi/);
  });

  it('halaman tidak membalas sampai batas waktu -> sync ditolak', async () => {
    const klien = { postMessage: () => undefined };
    const { jalankanSync, timers } = muatSw([klien]);
    const janji = jalankanSync('fo-walkin-sync');
    await new Promise((r) => setImmediate(r));
    timers.forEach((t) => t()); // pewaktu batas konfirmasi habis
    await expect(janji).rejects.toThrow(/tidak ada konfirmasi/);
  });

  it('salah satu dari beberapa halaman cukup mengonfirmasi', async () => {
    const diam = { postMessage: () => undefined };
    const ok = { postMessage: (_m: unknown, t: unknown[]) => (t[0] as { postMessage: (d: unknown) => void }).postMessage({ ok: true }) };
    const { jalankanSync, timers } = muatSw([diam, ok]);
    const janji = jalankanSync('fo-walkin-sync');
    await new Promise((r) => setImmediate(r));
    timers.forEach((t) => t());
    await expect(janji).resolves.toBeUndefined();
  });
});
