// @vitest-environment node
// POST /api/admin/revalidasi (rencana refaktor 4.5): hanya Admin aktif, tag harus ada di daftar izin tag publik,
// lalu `revalidateTag(tag, { expire: 0 })` (bentuk dua argumen Next 16). Tag di luar daftar tidak pernah sampai ke Next.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  revalidateTag: h.revalidateTag,
  // publik-server membungkus pemuat dengan unstable_cache saat modul dimuat; di sini tidak dijalankan.
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }));

import { TAG_PUBLIK } from '@/lib/data/publik-server';
import { TAG_PUBLIK_KLIEN } from '@/lib/data/klien/segarkanPublik';
import * as rute from './route';

type Petugas = { id: string; role: string; aktif: boolean } | null;

/** Klien sesi tiruan: `from('petugas').select().eq().maybeSingle()` = pola `requireAdmin` (lib/akun/server). */
function pasangSesi(o: { user?: boolean; petugas?: Petugas } = {}) {
  const user = o.user ?? true;
  const petugas = o.petugas === undefined ? { id: 'p1', role: 'admin', aktif: true } : o.petugas;
  h.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: user ? { id: 'auth-1' } : null } }) },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: petugas, error: null }) }) }),
    })),
  });
}

const req = (body?: unknown, mentah?: string) =>
  new Request('http://localhost/api/admin/revalidasi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: mentah ?? (body === undefined ? undefined : JSON.stringify(body)),
  }) as unknown as NextRequest;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  h.revalidateTag.mockReset();
  h.createClient.mockReset();
  pasangSesi();
});

describe('POST /api/admin/revalidasi', () => {
  it('konfigurasi segmen: force-dynamic dan hanya POST (tanpa GET yang bisa dipicu tautan)', () => {
    expect(rute.dynamic).toBe('force-dynamic');
    expect(rute).toHaveProperty('POST');
    expect(rute).not.toHaveProperty('GET');
  });

  describe('otorisasi', () => {
    it('tanpa sesi -> 401, revalidateTag tidak dipanggil', async () => {
      pasangSesi({ user: false });
      const res = await rute.POST(req({ tag: 'publik-beranda' }));
      expect(res.status).toBe(401);
      expect(h.revalidateTag).not.toHaveBeenCalled();
    });

    it('akun tanpa baris petugas -> 401', async () => {
      pasangSesi({ petugas: null });
      const res = await rute.POST(req({ tag: 'publik-beranda' }));
      expect(res.status).toBe(401);
      expect(h.revalidateTag).not.toHaveBeenCalled();
    });

    it('petugas nonaktif -> 401', async () => {
      pasangSesi({ petugas: { id: 'p1', role: 'admin', aktif: false } });
      const res = await rute.POST(req({ tag: 'publik-beranda' }));
      expect(res.status).toBe(401);
      expect(h.revalidateTag).not.toHaveBeenCalled();
    });

    it.each(['petugas', 'front_office'])('role %s -> 403, revalidateTag tidak dipanggil', async (role) => {
      pasangSesi({ petugas: { id: 'p1', role, aktif: true } });
      const res = await rute.POST(req({ tag: 'publik-beranda' }));
      expect(res.status).toBe(403);
      expect(h.revalidateTag).not.toHaveBeenCalled();
    });

    it('otorisasi dicek SEBELUM badan: bukan admin + tag ngawur tetap 403 (tidak membocorkan validasi)', async () => {
      pasangSesi({ petugas: { id: 'p1', role: 'petugas', aktif: true } });
      expect((await rute.POST(req({ tag: 'apa-saja' }))).status).toBe(403);
      expect((await rute.POST(req(undefined, 'bukan json'))).status).toBe(403);
    });
  });

  describe('validasi badan', () => {
    it.each([
      ['badan bukan JSON', undefined, '{bukan json'],
      ['badan kosong', undefined, ''],
      ['tanpa tag', {}, undefined],
      ['tag kosong', { tag: '' }, undefined],
      ['tag bukan string', { tag: 42 }, undefined],
      ['tag berupa daftar', { tag: ['publik-beranda'] }, undefined],
      ['tag di luar daftar izin', { tag: 'publik-lainnya' }, undefined],
      ['tag milik cache lain (user)', { tag: 'user' }, undefined],
      ['tag UMKM', { tag: 'umkm-katalog' }, undefined],
      ['beda huruf besar/kecil', { tag: 'PUBLIK-BERANDA' }, undefined],
      ['ada spasi di ujung', { tag: 'publik-beranda ' }, undefined],
      ['badan berupa string', 'publik-beranda', undefined],
      ['badan null', null, undefined],
    ])('%s -> 400, revalidateTag tidak dipanggil', async (_nama, body, mentah) => {
      const res = await rute.POST(req(body, mentah));
      expect(res.status).toBe(400);
      expect(h.revalidateTag).not.toHaveBeenCalled();
    });

    it('respons 400 memuat pesan galat dan Cache-Control private, no-store', async () => {
      const res = await rute.POST(req({ tag: 'publik-lainnya' }));
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(await res.json()).toEqual({ error: expect.any(String) });
    });
  });

  describe('sukses', () => {
    it.each(['publik-beranda', 'publik-layanan', 'publik-faq'])(
      'tag %s diterima: revalidateTag(tag, { expire: 0 }) tepat sekali, respons { ok: true }',
      async (tag) => {
        const res = await rute.POST(req({ tag }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        expect(res.headers.get('Cache-Control')).toBe('private, no-store');
        expect(h.revalidateTag).toHaveBeenCalledTimes(1);
        expect(h.revalidateTag).toHaveBeenCalledWith(tag, { expire: 0 });
        expect(h.revalidateTag.mock.calls[0]).toHaveLength(2); // bentuk satu argumen sudah usang di Next 16
      },
    );

    it('daftar izin diturunkan dari TAG_PUBLIK: setiap nilainya diterima (tag publik baru ikut otomatis)', async () => {
      for (const tag of Object.values(TAG_PUBLIK)) {
        h.revalidateTag.mockClear();
        const res = await rute.POST(req({ tag }));
        expect(res.status, `tag ${tag}`).toBe(200);
        expect(h.revalidateTag).toHaveBeenCalledWith(tag, { expire: 0 });
      }
    });

    it('tiga tag inti selalu ada di TAG_PUBLIK (penjaga bila konstanta server berubah)', () => {
      expect(Object.values(TAG_PUBLIK)).toEqual(expect.arrayContaining(['publik-beranda', 'publik-layanan', 'publik-faq']));
    });

    it('badan dengan kunci tambahan tetap hanya memakai tag (tidak ada tag kedua yang diteruskan)', async () => {
      const res = await rute.POST(req({ tag: 'publik-faq', tag2: 'user', path: '/' }));
      expect(res.status).toBe(200);
      expect(h.revalidateTag).toHaveBeenCalledTimes(1);
      expect(h.revalidateTag).toHaveBeenCalledWith('publik-faq', { expire: 0 });
    });
  });

  it('tag yang dikirim helper klien semuanya diterima rute (daftar klien tidak melampaui daftar server)', () => {
    const server = new Set<string>(Object.values(TAG_PUBLIK));
    for (const tag of Object.values(TAG_PUBLIK_KLIEN)) expect(server.has(tag), `tag klien ${tag}`).toBe(true);
  });
});
