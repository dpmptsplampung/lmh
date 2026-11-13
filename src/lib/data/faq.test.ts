// @vitest-environment node
// Kontrak lapisan data Kelola FAQ (tugas 8.1): kolom eksplisit, lingkup per peran, muat bertahap bertembok, mutasi tercek
// (RLS yang menolak = 0 baris -> galat, bukan sukses), hasil bertipe tanpa lemparan, dan pemanggil route.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BATAS_MUAT,
  KOLOM_FAQ,
  TAG_FAQ_PUBLIK,
  UKURAN_MUAT,
  buangCacheFaqPublik,
  hapusFaq,
  muatDaftarFaq,
  muatLayananFaq,
  muatProfilFaq,
  prosesEmbedFaq,
  prosesEmbedMassal,
  tambahFaq,
  ubahBotLayanan,
  ubahFaq,
  ubahStatusFaq,
} from './faq';

type Hasil = { data: unknown; error: { message: string; code?: string } | null; status?: number };
interface Catatan {
  tabel: string;
  langkah: Array<[string, ...unknown[]]>;
}

/** Klien tiruan: tiap tabel dijawab fungsi `jawab` (menerima catatan langkah). Builder thenable seperti supabase-js. */
function klien(jawab: (c: Catatan) => Hasil | Promise<Hasil>, user: { id: string } | null = { id: 'u1' }, authError: { name: string } | null = null) {
  const catatan: Catatan[] = [];
  const sb = {
    auth: { getUser: () => Promise.resolve({ data: { user }, error: authError }) },
    from: (tabel: string) => {
      const c: Catatan = { tabel, langkah: [] };
      catatan.push(c);
      const b: Record<string, unknown> = {};
      for (const nama of ['select', 'eq', 'is', 'or', 'order', 'range', 'update', 'insert', 'delete']) {
        b[nama] = (...a: unknown[]) => {
          c.langkah.push([nama, ...a]);
          return b;
        };
      }
      b.maybeSingle = () => Promise.resolve(jawab(c));
      b.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => Promise.resolve(jawab(c)).then(r, j);
      return b;
    },
  };
  return { sb: sb as unknown as SupabaseClient, catatan };
}
const langkah = (c: Catatan, nama: string) => c.langkah.filter((l) => l[0] === nama);
const baris = (n: number, awal = 0) => Array.from({ length: n }, (_, i) => ({ id: `f${awal + i}` }));

describe('muatProfilFaq', () => {
  it('membaca peran dan layanan petugas dengan kolom eksplisit', async () => {
    const { sb, catatan } = klien(() => ({ data: { role: 'petugas', layanan_id: 'l1' }, error: null }));
    const h = await muatProfilFaq(sb);
    expect(h).toEqual({ data: { role: 'petugas', layananId: 'l1' }, error: null });
    expect(langkah(catatan[0], 'select')[0][1]).toBe('role, layanan_id');
    expect(langkah(catatan[0], 'eq')[0]).toEqual(['eq', 'auth_user_id', 'u1']);
  });

  it('tanpa sesi atau tanpa baris petugas = sukses "unknown", bukan galat', async () => {
    expect((await muatProfilFaq(klien(() => ({ data: null, error: null }), null).sb)).data).toEqual({ role: 'unknown', layananId: null });
    expect((await muatProfilFaq(klien(() => ({ data: null, error: null })).sb)).data).toEqual({ role: 'unknown', layananId: null });
  });

  it('galat sesi selain AuthSessionMissingError dan galat DB = error (bukan tanpa akses)', async () => {
    const a = await muatProfilFaq(klien(() => ({ data: null, error: null }), null, { name: 'AuthRetryableFetchError' }).sb);
    expect(a.error).not.toBeNull();
    const b = await muatProfilFaq(klien(() => ({ data: null, error: { message: 'Failed to fetch' } })).sb);
    expect(b.error).not.toBeNull();
    const c = await muatProfilFaq(klien(() => ({ data: null, error: null }), null, { name: 'AuthSessionMissingError' }).sb);
    expect(c.error).toBeNull();
  });

  it('penolakan promise tidak dilempar', async () => {
    const sb = { auth: { getUser: () => Promise.reject(new TypeError('Failed to fetch')) } } as unknown as SupabaseClient;
    expect((await muatProfilFaq(sb)).error?.pesan).toBe('Gagal memuat hak akses.');
  });
});

describe('muatLayananFaq', () => {
  it('urut nama, kolom eksplisit; galat jadi error', async () => {
    const { sb, catatan } = klien(() => ({ data: [{ id: 'l1', nama: 'A', chatbot_aktif: true }], error: null }));
    expect((await muatLayananFaq(sb)).data).toHaveLength(1);
    expect(langkah(catatan[0], 'select')[0][1]).toBe('id, nama, chatbot_aktif');
    expect(langkah(catatan[0], 'order')[0][1]).toBe('nama');
    expect((await muatLayananFaq(klien(() => ({ data: null, error: { message: 'x' } })).sb)).error).not.toBeNull();
  });
});

describe('muatDaftarFaq', () => {
  const lingkupDi = (c: Catatan) => langkah(c, 'eq').concat(langkah(c, 'is'));

  it('admin: tanpa filter lingkup; urut terbaru diubah lalu id; kolom eksplisit; kueri kedua memuat id yang menunggu', async () => {
    const { sb, catatan } = klien((c) => ({ data: langkah(c, 'or').length ? [{ id: 'f1' }] : [{ id: 'f1' }, { id: 'f2' }], error: null }));
    const h = await muatDaftarFaq(sb, { jenis: 'semua' });
    expect(h.data).toEqual({ faq: [{ id: 'f1' }, { id: 'f2' }], menungguIds: ['f1'] });
    const utama = catatan.find((c) => !langkah(c, 'or').length)!;
    expect(langkah(utama, 'select')[0][1]).toBe(KOLOM_FAQ);
    expect(langkah(utama, 'order')).toEqual([['order', 'updated_at', { ascending: false }], ['order', 'id', { ascending: true }]]);
    expect(lingkupDi(utama)).toEqual([]);
    const menunggu = catatan.find((c) => langkah(c, 'or').length)!;
    expect(langkah(menunggu, 'select')[0][1]).toBe('id');
    expect(langkah(menunggu, 'or')[0][1]).toBe('embedding.is.null,perlu_embed_ulang.eq.true');
  });

  it('petugas: eq layanan_id; Front Office: IS NULL (bukan eq)', async () => {
    const a = klien(() => ({ data: [], error: null }));
    await muatDaftarFaq(a.sb, { jenis: 'layanan', layananId: 'l1' });
    expect(a.catatan.every((c) => lingkupDi(c)[0]?.join() === 'eq,layanan_id,l1')).toBe(true);
    const b = klien(() => ({ data: [], error: null }));
    await muatDaftarFaq(b.sb, { jenis: 'umum' });
    expect(b.catatan.every((c) => lingkupDi(c)[0]?.join() === 'is,layanan_id,')).toBe(true);
  });

  it('memuat bertahap per UKURAN_MUAT sampai batch tidak penuh', async () => {
    const rentang: Array<[number, number]> = [];
    const { sb } = klien((c) => {
      if (langkah(c, 'or').length) return { data: [], error: null };
      const r = langkah(c, 'range')[0] as [string, number, number];
      rentang.push([r[1], r[2]]);
      return { data: r[1] === 0 ? baris(UKURAN_MUAT) : baris(3, UKURAN_MUAT), error: null };
    });
    const h = await muatDaftarFaq(sb, { jenis: 'semua' });
    expect(h.data?.faq).toHaveLength(UKURAN_MUAT + 3);
    expect(rentang).toEqual([[0, UKURAN_MUAT - 1], [UKURAN_MUAT, 2 * UKURAN_MUAT - 1]]);
  });

  it('galat batch lanjutan atau melampaui batas = error (tidak ada hasil parsial)', async () => {
    const a = klien((c) => {
      if (langkah(c, 'or').length) return { data: [], error: null };
      return (langkah(c, 'range')[0] as [string, number])[1] === 0 ? { data: baris(UKURAN_MUAT), error: null } : { data: null, error: { message: 'gagal' } };
    });
    expect((await muatDaftarFaq(a.sb, { jenis: 'semua' })).error).not.toBeNull();
    const b = klien((c) => (langkah(c, 'or').length ? { data: [], error: null } : { data: baris(UKURAN_MUAT), error: null }));
    const hasil = await muatDaftarFaq(b.sb, { jenis: 'semua' });
    expect(hasil.error).not.toBeNull();
    expect(BATAS_MUAT).toBe(10_000);
  });

  it('kueri "menunggu" yang gagal hanya mengosongkan lencana; daftar tetap sah', async () => {
    const { sb } = klien((c) => (langkah(c, 'or').length ? { data: null, error: { message: 'kolom tidak ada', code: '42703' } } : { data: [{ id: 'f1' }], error: null }));
    expect((await muatDaftarFaq(sb, { jenis: 'semua' })).data).toEqual({ faq: [{ id: 'f1' }], menungguIds: [] });
  });
});

describe('mutasi FAQ', () => {
  const isian = { pertanyaan: 'P', jawaban: 'J', dasarHukum: null, urutan: 3 };

  it('tambahFaq: insert aktif + select id; mengembalikan id baru', async () => {
    const { sb, catatan } = klien(() => ({ data: [{ id: 'baru' }], error: null }));
    const h = await tambahFaq(sb, { ...isian, layananId: null });
    expect(h.data).toEqual({ id: 'baru' });
    expect(langkah(catatan[0], 'insert')[0][1]).toEqual({ layanan_id: null, pertanyaan: 'P', jawaban: 'J', dasar_hukum: null, urutan: 3, aktif: true });
    expect(langkah(catatan[0], 'select')[0][1]).toBe('id');
  });

  it('tambahFaq ditolak RLS = galat ditolak dan perluMuatUlang', async () => {
    const { sb } = klien(() => ({ data: null, error: { message: 'new row violates row-level security policy', code: '42501' } }));
    const h = await tambahFaq(sb, { ...isian, layananId: 'l1' });
    expect(h.error).toMatchObject({ jenis: 'ditolak', perluMuatUlang: true });
  });

  it('ubahFaq: embedding dikosongkan hanya bila diminta; 0 baris = tidak_ada_baris (bukan sukses palsu)', async () => {
    const a = klien(() => ({ data: [{ id: 'f1' }], error: null }));
    expect((await ubahFaq(a.sb, { ...isian, id: 'f1', hapusEmbedding: true })).error).toBeNull();
    expect(langkah(a.catatan[0], 'update')[0][1]).toMatchObject({ pertanyaan: 'P', embedding: null });
    const b = klien(() => ({ data: [{ id: 'f1' }], error: null }));
    await ubahFaq(b.sb, { ...isian, id: 'f1', hapusEmbedding: false });
    expect(langkah(b.catatan[0], 'update')[0][1]).not.toHaveProperty('embedding');
    const c = klien(() => ({ data: [], error: null }));
    expect((await ubahFaq(c.sb, { ...isian, id: 'f1', hapusEmbedding: false })).error).toMatchObject({ jenis: 'tidak_ada_baris', perluMuatUlang: true });
  });

  it('ubahStatusFaq, hapusFaq, ubahBotLayanan: wajib ada baris terdampak; galat jaringan tidak minta muat ulang', async () => {
    const a = klien(() => ({ data: [{ id: 'f1' }], error: null }));
    expect((await ubahStatusFaq(a.sb, 'f1', false)).error).toBeNull();
    expect(langkah(a.catatan[0], 'update')[0][1]).toMatchObject({ aktif: false });
    expect((await hapusFaq(klien(() => ({ data: [], error: null })).sb, 'f1')).error?.jenis).toBe('tidak_ada_baris');
    const bot = klien(() => ({ data: [{ id: 'l1' }], error: null }));
    expect((await ubahBotLayanan(bot.sb, 'l1', true)).error).toBeNull();
    expect(langkah(bot.catatan[0], 'update')[0][1]).toEqual({ chatbot_aktif: true });
    const jar = await hapusFaq(klien(() => ({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 })).sb, 'f1');
    expect(jar.error).toMatchObject({ jenis: 'jaringan', perluMuatUlang: false, pesan: 'Koneksi bermasalah, periksa jaringan Anda lalu coba lagi' });
  });

  it('pesan cadangan dipakai untuk galat non-mutasi', async () => {
    const h = await ubahStatusFaq(klien(() => ({ data: null, error: { message: 'x', code: '23505' } })).sb, 'f1', true);
    expect(h.error?.pesan).toBe('Terjadi kesalahan saat menyimpan data, coba lagi');
    expect(h.error?.jenis).toBe('database');
  });
});

describe('pemanggil route', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  const balas = (status: number, json: unknown) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(json) });

  it('prosesEmbedFaq: 200 diproses, 409 sudah diproses (sukses), 429 memakai pesan server, lainnya pesan tetap', async () => {
    fetchMock.mockResolvedValueOnce(balas(200, {}));
    expect((await prosesEmbedFaq('f1', 'G')).data).toBe('diproses');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/faq/embed', expect.objectContaining({ method: 'POST', body: JSON.stringify({ faqId: 'f1' }) }));
    fetchMock.mockResolvedValueOnce(balas(409, { error: 'sudah' }));
    expect((await prosesEmbedFaq('f1', 'G')).data).toBe('sudah_diproses');
    fetchMock.mockResolvedValueOnce(balas(429, { error: 'Terlalu banyak.' }));
    expect((await prosesEmbedFaq('f1', 'G')).error?.pesan).toBe('Terlalu banyak.');
    fetchMock.mockResolvedValueOnce(balas(502, { error: 'x' }));
    expect((await prosesEmbedFaq('f1', 'G')).error?.pesan).toBe('G');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect((await prosesEmbedFaq('f1', 'G')).error?.pesan).toBe('G');
  });

  it('prosesEmbedMassal: POST tanpa badan; hitung diproses/gagal/sisa; pesan server dipakai saat galat', async () => {
    fetchMock.mockResolvedValueOnce(balas(200, { embedded: 3, failed: 1, remaining: 5 }));
    expect((await prosesEmbedMassal()).data).toEqual({ diproses: 3, gagal: 1, sisa: 5 });
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/faq/embed', { method: 'POST' });
    fetchMock.mockResolvedValueOnce(balas(200, {}));
    expect((await prosesEmbedMassal()).data).toEqual({ diproses: 0, gagal: 0, sisa: 0 });
    fetchMock.mockResolvedValueOnce(balas(500, { error: 'Server misconfigured' }));
    expect((await prosesEmbedMassal()).error?.pesan).toBe('Server misconfigured');
    fetchMock.mockResolvedValueOnce(balas(500, null));
    expect((await prosesEmbedMassal()).error?.pesan).toBe('Gagal memproses FAQ. Coba lagi beberapa saat lagi.');
    fetchMock.mockRejectedValueOnce(new Error('putus'));
    expect((await prosesEmbedMassal()).error?.pesan).toBe('Gagal memproses FAQ. Coba lagi beberapa saat lagi.');
  });

  it('buangCacheFaqPublik: POST /api/admin/revalidasi dengan tag publik-faq; 403 dan jaringan putus tidak dilempar', async () => {
    fetchMock.mockResolvedValueOnce(balas(200, { ok: true }));
    expect((await buangCacheFaqPublik()).error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/revalidasi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: 'publik-faq' }),
    });
    fetchMock.mockResolvedValueOnce(balas(403, { error: 'Forbidden' }));
    expect((await buangCacheFaqPublik()).error?.jenis).toBe('http');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect((await buangCacheFaqPublik()).error?.jenis).toBe('http');
  });

  it('TAG_FAQ_PUBLIK sama dengan TAG_PUBLIK.faq di publik-server (daftar izin route revalidasi)', () => {
    const sumber = readFileSync(join(process.cwd(), 'src/lib/data/publik-server.ts'), 'utf8');
    expect(sumber).toMatch(new RegExp(`faq:\\s*'${TAG_FAQ_PUBLIK}'`));
  });
});
