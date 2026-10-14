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

  it('FO hanya melihat penanganan miliknya (baris FO lain tidak ikut, filter dipaksa di kueri)', async () => {
    const h = buatHRekap({
      role: 'front_office', meId: 'p-saya',
      penanganan: [
        tahap('a'), tahap('b'),
        tahap('c', { penangan_id: 'p-lain' }),
        tahap('d', { penangan_id: 'p-lain' }),
      ],
    });
    pasang(h);
    const res = await get();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(['a', 'b']);
    expect(body.terkunci_ke_saya).toBe(true);
    expect(h.log[0].ops).toContainEqual(['eq', ['penangan_id', 'p-saya']]);
  });

  it('FO yang meminta FO lain lewat petugas_id -> 403 dan tidak menyentuh DB', async () => {
    const h = buatHRekap({ role: 'front_office', penanganan: [tahap('a', { penangan_id: UUID_FO2 })] });
    pasang(h);
    const res = await get(`&petugas_id=${UUID_FO2}`);
    expect(res.status).toBe(403);
    expect(h.log).toHaveLength(0);
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

  it('Front Office boleh rekap layanan, HANYA tahap layanan dari kunjungan yang punya tahap FO miliknya', async () => {
    const lyn = (id: string, foAsal: Baris[]): Baris =>
      tahap(id, {
        peran_tahap: 'layanan', layanan_id: 'lyn-oss', penangan_id: 'ptg-1', tiket: null,
        kunjungan: { nama: 'Budi', asal_instansi: 'CV', fo_asal: foAsal },
      });
    const h = buatHRekap({
      role: 'front_office', meId: 'p-saya',
      penanganan: [
        lyn('milik', [{ penangan_id: 'p-saya', peran_tahap: 'fo' }]),
        lyn('fo-lain', [{ penangan_id: 'p-lain', peran_tahap: 'fo' }]),
        lyn('tanpa-fo', []),
        // Satu elemen embed yang sama harus memenuhi kedua syarat (bukan campuran dua elemen).
        lyn('campur', [{ penangan_id: 'p-lain', peran_tahap: 'fo' }, { penangan_id: 'p-saya', peran_tahap: 'layanan' }]),
        tahap('tahap-fo-saya'), // peran fo: tidak ikut rekap layanan
      ],
    });
    pasang(h);
    const res = await get('&peran=layanan');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(['milik']);
    expect(body.ringkasan.total).toBe(1);
    expect(body.cakupan_eskalasi_fo).toBe(true);
    expect(body.terkunci_ke_saya).toBe(false);
    expect(body.rows[0]).not.toHaveProperty('kunjungan');
    const ops = h.log[0].ops;
    expect(ops).toContainEqual(['eq', ['kunjungan.fo_asal.penangan_id', 'p-saya']]);
    expect(ops).toContainEqual(['eq', ['kunjungan.fo_asal.peran_tahap', 'fo']]);
  });

  it('Front Office: id FO cakupan selalu dari sesi; petugas_id/layanan_id hanya menyempitkan', async () => {
    const h = buatHRekap({ role: 'front_office', meId: 'p-saya' });
    pasang(h);
    const res = await get(`&peran=layanan&petugas_id=${UUID_FO2}`);
    expect(res.status).toBe(200);
    const ops = h.log[0].ops;
    expect(ops).toContainEqual(['eq', ['kunjungan.fo_asal.penangan_id', 'p-saya']]);
    expect(ops).toContainEqual(['eq', ['penangan_id', UUID_FO2]]);
    expect(ops).not.toContainEqual(['eq', ['kunjungan.fo_asal.penangan_id', UUID_FO2]]);
  });

  it('Admin dan Petugas: rekap layanan tanpa batas eskalasi FO (perilaku lama)', async () => {
    for (const role of ['admin', 'petugas']) {
      const h = buatHRekap({ role, layananId: role === 'petugas' ? 'lyn-oss' : null });
      pasang(h);
      const body = await (await get('&peran=layanan')).json();
      expect(body.cakupan_eskalasi_fo).toBe(false);
      expect(h.log[0].ops.some(([, a]) => String(a[0]).startsWith('kunjungan.'))).toBe(false);
    }
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
