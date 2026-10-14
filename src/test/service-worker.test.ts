// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

describe('service worker runtime cache safety', () => {
  it('bypasses every health endpoint before any response interception', () => {
    const bypass = source.indexOf("url.pathname.startsWith('/api/health/')");
    const firstRespondWith = source.indexOf('event.respondWith', source.indexOf("self.addEventListener('fetch'"));
    expect(bypass).toBeGreaterThan(-1);
    expect(bypass).toBeLessThan(firstRespondWith);
    expect(source.slice(bypass, firstRespondWith)).toMatch(/return\s*;/);
  });

  it('guards every runtime cache write against Cache-Control no-store', () => {
    expect(source).toMatch(/function isCacheableResponse[\s\S]*cache-control[\s\S]*no-store/);
    const cacheWrites = source.match(/cache\.put\(/g) ?? [];
    const guardedWrites = source.match(/isCacheableResponse\(fresh\)[\s\S]{0,80}cache\.put\(/g) ?? [];
    expect(cacheWrites.length).toBeGreaterThan(0);
    expect(guardedWrites).toHaveLength(cacheWrites.length);
  });
});

// ---------------------------------------------------------------------------
// Background Sync (audit T3a): listener nyata yang MENUNGGU konfirmasi halaman; tanpa halaman/konfirmasi,
// sync ditolak sehingga browser menjadwalkan ulang (dulu: pesan dilempar lalu sync dianggap sukses -> data hilang).
// ---------------------------------------------------------------------------
import { runInNewContext } from 'node:vm';
import { SYNC_TAG_FO_WALKIN } from '../lib/offline/sync';

type Handler = (event: unknown) => void;

function muatSw(clients: { postMessage: (msg: unknown, transfer: unknown[]) => void }[]) {
  const handlers: Record<string, Handler> = {};
  const timers: (() => void)[] = [];
  class FakeChannel {
    port1: { onmessage: ((e: { data: unknown }) => void) | null } = { onmessage: null };
    port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }) };
  }
  const sandbox = {
    self: {
      addEventListener: (nama: string, fn: Handler) => {
        handlers[nama] = fn;
      },
      location: { origin: 'https://lmh.test' },
      clients: { matchAll: async () => clients, claim: async () => undefined },
      skipWaiting: async () => undefined,
      registration: {},
    },
    caches: {},
    MessageChannel: FakeChannel,
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => undefined,
    URL,
    Promise,
  };
  runInNewContext(source, sandbox);
  const jalankanSync = (tag: string) => {
    let janji: Promise<unknown> | null = null;
    handlers.sync({ tag, waitUntil: (p: Promise<unknown>) => (janji = p) });
    return janji as Promise<unknown> | null;
  };
  return { jalankanSync, timers };
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
