// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { buatHRekap, buatKlienRekap, type Baris, type HRekap } from '@/test/rekap-supabase-mock';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { createClient } from '@/lib/supabase/server';

const UUID_FO2 = '550e8400-e29b-41d4-a716-446655440001';

function pasang(h: HRekap) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(buatKlienRekap(h));
}

function tahap(id: string, s: Baris = {}): Baris {
  return {
    id, kunjungan_id: `k-${id}`, tahap_ke: 1, peran_tahap: 'fo', layanan_id: null, saluran: 'walk_in',
    penangan_id: 'p-saya', status: 'selesai', hasil: 'selesai', topik: 'Informasi umum', catatan: 'ok',
    batal_karena: null, mulai_at: '2026-10-12T02:00:00Z', selesai_at: '2026-10-12T02:10:00Z',
    created_at: '2026-10-12T02:00:00Z',
    kunjungan: { nama: 'Budi', asal_instansi: 'CV' }, petugas: { nama: 'Sari' }, layanan: null,
    ...s,
  };
}

const get = (qs = '') => GET(new NextRequest(`http://localhost/api/admin/rekap/penanganan?dari=2026-10-12&sampai=2026-10-12${qs}`));

describe('GET /api/admin/rekap/penanganan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 bila belum masuk atau akun tidak aktif', async () => {
    pasang(buatHRekap({ user: null }));
    expect((await get()).status).toBe(401);
    pasang(buatHRekap({ aktif: false }));
    expect((await get()).status).toBe(401);
  });

  // Keputusan CEO 2026-10-14 (keterbukaan data antar FO): FO membaca semua FO, filter FO opsional seperti Admin.
  it('Front Office melihat penanganan SEMUA FO (tanpa filter penangan dipaksa) dan nama FO tiap baris', async () => {
    const h = buatHRekap({
      role: 'front_office', meId: 'p-saya',
      penanganan: [
        tahap('a'), tahap('b'),
        tahap('c', { penangan_id: 'p-lain', petugas: { nama: 'Bayu' } }),
        tahap('d', { penangan_id: 'p-lain', petugas: { nama: 'Bayu' } }),
      ],
    });
    pasang(h);
    const res = await get();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(4);
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(body.rows.map((r: { fo_nama: string }) => r.fo_nama)).toEqual(['Sari', 'Sari', 'Bayu', 'Bayu']);
    expect(body.peran_saya).toBe('front_office');
    expect(body).not.toHaveProperty('terkunci_ke_saya');
    expect(body).not.toHaveProperty('cakupan_eskalasi_fo');
    expect(h.log[0].ops.filter(([m]) => m === 'eq').map(([, a]) => a[0])).toEqual(['peran_tahap']);
  });

  it('Front Office boleh memfilter FO lain lewat petugas_id (dulu 403)', async () => {
    const h = buatHRekap({
      role: 'front_office', meId: 'p-saya',
      penanganan: [tahap('a'), tahap('c', { penangan_id: UUID_FO2 })],
    });
    pasang(h);
    const res = await get(`&petugas_id=${UUID_FO2}`);
    expect(res.status).toBe(200);
    expect((await res.json()).rows.map((r: { id: string }) => r.id)).toEqual(['c']);
    expect(h.log[0].ops).toContainEqual(['eq', ['penangan_id', UUID_FO2]]);
  });

  it('Admin melihat semua FO dan memfilter satu FO', async () => {
    const h = buatHRekap({
      role: 'admin',
      penanganan: [tahap('a'), tahap('c', { penangan_id: UUID_FO2 })],
    });
    pasang(h);
    expect((await (await get()).json()).total).toBe(2);
    const terfilter = await (await get(`&petugas_id=${UUID_FO2}`)).json();
    expect(terfilter.rows.map((r: { id: string }) => r.id)).toEqual(['c']);
  });

  it('Petugas: 403 untuk peran fo; rekap layanan dikunci ke layanannya sendiri', async () => {
    const h = buatHRekap({
      role: 'petugas', layananId: 'lyn-oss',
      penanganan: [
        tahap('x', { peran_tahap: 'layanan', layanan_id: 'lyn-oss', penangan_id: 'p-saya', tiket: null }),
        tahap('y', { peran_tahap: 'layanan', layanan_id: 'lyn-lain', penangan_id: 'p-lain' }),
      ],
    });
    pasang(h);
    expect((await get('&peran=fo')).status).toBe(403);
    const res = await get('&peran=layanan');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(['x']);
    expect((await get('&peran=layanan&layanan_id=550e8400-e29b-41d4-a716-446655440009')).status).toBe(403);
  });

  it('Front Office: rekap layanan memuat SEMUA tahap layanan (bukan hanya eskalasi asal dirinya) + kolom FO', async () => {
    const lyn = (id: string, tahapFo: Baris[]): Baris =>
      tahap(id, {
        peran_tahap: 'layanan', tahap_ke: 2, layanan_id: 'lyn-oss', penangan_id: 'ptg-1', tiket: null,
        petugas: { nama: 'Rina' },
        kunjungan: { nama: 'Budi', asal_instansi: 'CV', tahap_fo: tahapFo },
      });
    const h = buatHRekap({
      role: 'front_office', meId: 'p-saya',
      penanganan: [
        lyn('milik', [{ tahap_ke: 1, peran_tahap: 'fo', penangan_id: 'p-saya', petugas: { nama: 'Sari' } }]),
        lyn('fo-lain', [{ tahap_ke: 1, peran_tahap: 'fo', penangan_id: 'p-lain', petugas: { nama: 'Bayu' } }]),
        lyn('tanpa-fo', []),
        tahap('tahap-fo-saya'), // peran fo: tidak ikut rekap layanan
      ],
    });
    pasang(h);
    const res = await get('&peran=layanan');
    const body = await res.json();
    expect(res.status).toBe(200);
    // Urutan deterministik (mulai_at, id).
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(['fo-lain', 'milik', 'tanpa-fo']);
    expect(body.rows.map((r: { fo_nama: string | null }) => r.fo_nama)).toEqual(['Bayu', 'Sari', null]);
    expect(body.rows.map((r: { penangan_nama: string }) => r.penangan_nama)).toEqual(['Rina', 'Rina', 'Rina']);
    expect(body.ringkasan.total).toBe(3);
    expect(body.rows[0]).not.toHaveProperty('kunjungan');
    expect(h.log[0].ops.some(([, a]) => String(a[0]).startsWith('kunjungan.'))).toBe(false);
  });

  it('Front Office: filter petugas/layanan opsional diteruskan apa adanya', async () => {
    const h = buatHRekap({ role: 'front_office', meId: 'p-saya' });
    pasang(h);
    const res = await get(`&peran=layanan&petugas_id=${UUID_FO2}&layanan_id=550e8400-e29b-41d4-a716-446655440009`);
    expect(res.status).toBe(200);
    const ops = h.log[0].ops;
    expect(ops).toContainEqual(['eq', ['penangan_id', UUID_FO2]]);
    expect(ops).toContainEqual(['eq', ['layanan_id', '550e8400-e29b-41d4-a716-446655440009']]);
  });

  it('data > batas baris server (2.500 baris, cap 1.000): total dan ringkasan lengkap, daftar dipaginasi', async () => {
    const banyak = Array.from({ length: 2500 }, (_, i) =>
      tahap(`r${String(i).padStart(4, '0')}`, { mulai_at: `2026-10-12T03:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` }));
    const h = buatHRekap({ role: 'admin', penanganan: banyak, serverCap: 1000 });
    pasang(h);
    const res = await get('&page=2&page_size=100');
    const body = await res.json();
    expect(body.total).toBe(2500);
    expect(body.truncated).toBe(false);
    expect(body.ringkasan.total).toBe(2500);
    expect(body.rows).toHaveLength(100);
    expect(h.log.length).toBeGreaterThanOrEqual(3);
  });

  it('batas hari WIB: 23:59 masuk hari itu, 00:00 hari berikutnya tidak', async () => {
    const h = buatHRekap({
      role: 'admin',
      penanganan: [
        tahap('malam', { mulai_at: '2026-10-12T16:59:59Z', selesai_at: '2026-10-12T17:10:00Z' }),
        tahap('tengah', { mulai_at: '2026-10-12T17:00:00Z', selesai_at: '2026-10-12T17:10:00Z' }),
        tahap('sebelum', { mulai_at: '2026-10-11T16:59:59Z', selesai_at: '2026-10-11T17:10:00Z' }),
      ],
    });
    pasang(h);
    const hariIni = await (await get()).json();
    expect(hariIni.rows.map((r: { id: string }) => r.id)).toEqual(['malam']);
    expect(hariIni.rows[0].tanggal).toBe('2026-10-12');
    const besok = await (await GET(new NextRequest('http://localhost/api/admin/rekap/penanganan?dari=2026-10-13&sampai=2026-10-13'))).json();
    expect(besok.rows.map((r: { id: string }) => r.id)).toEqual(['tengah']);
    expect(besok.rows[0].tanggal).toBe('2026-10-13');
  });

  it('422 untuk rentang terbalik dan parameter tidak valid', async () => {
    pasang(buatHRekap());
    const a = await GET(new NextRequest('http://localhost/api/admin/rekap/penanganan?dari=2026-10-13&sampai=2026-10-12'));
    expect(a.status).toBe(422);
    expect((await get('&peran=semua')).status).toBe(422);
    expect((await get('&page_size=500')).status).toBe(422);
  });

  it('500 (tanpa bocor pesan DB) bila kueri gagal', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    pasang(buatHRekap({ galatPenanganan: true }));
    const res = await get();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('boom');
    spy.mockRestore();
  });
});
