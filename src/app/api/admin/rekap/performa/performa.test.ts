// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { buatHRekap, buatKlienRekap, type Baris } from '@/test/rekap-supabase-mock';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { createClient } from '@/lib/supabase/server';

function r(id: string, s: Baris = {}): Baris {
  return {
    id, kunjungan_id: `k-${id}`, peran_tahap: 'fo', layanan_id: null, penangan_id: 'fo-1', status: 'selesai',
    hasil: 'selesai', mulai_at: '2026-10-12T02:00:00Z', selesai_at: '2026-10-12T02:10:00Z',
    created_at: '2026-10-12T02:00:00Z', ...s,
  };
}

const get = (qs = 'dari=2026-10-12&sampai=2026-10-12') => GET(new NextRequest(`http://localhost/api/admin/rekap/performa?${qs}`));

describe('GET /api/admin/rekap/performa', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 tanpa sesi; 403 untuk selain Admin', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(buatKlienRekap(buatHRekap({ user: null })));
    expect((await get()).status).toBe(401);
    for (const role of ['front_office', 'petugas']) {
      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(buatKlienRekap(buatHRekap({ role, layananId: 'l1' })));
      expect((await get()).status).toBe(403);
    }
  });

  it('Admin: menghitung tingkat eskalasi/pengembalian, nama orang dan layanan', async () => {
    const h = buatHRekap({
      role: 'admin',
      petugas: [{ id: 'fo-1', nama: 'Sari' }, { id: 'p-1', nama: 'Rina' }],
      layanan: [{ id: 'l1', nama: 'Helpdesk OSS' }],
      penanganan: [
        r('1', { hasil: 'dieskalasi' }),
        r('2'),
        r('3', { peran_tahap: 'layanan', layanan_id: 'l1', penangan_id: 'p-1', hasil: 'dikembalikan', created_at: '2026-10-12T02:05:00Z', mulai_at: '2026-10-12T02:10:00Z', selesai_at: '2026-10-12T02:30:00Z' }),
      ],
    });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(buatKlienRekap(h));
    const res = await get();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ringkasan.pengunjung_dilayani).toBe(3);
    expect(body.ringkasan.fo.tingkat_eskalasi).toBe(0.5);
    expect(body.ringkasan.layanan.tingkat_pengembalian).toBe(1);
    expect(body.ringkasan.layanan.rata_tunggu_menit).toBe(5);
    expect(body.per_orang.map((o: { nama: string }) => o.nama).sort()).toEqual(['Rina', 'Sari']);
    expect(body.per_layanan[0].nama).toBe('Helpdesk OSS');
    expect(body.truncated).toBe(false);
  });

  it('paginasi penuh melampaui batas baris server dan rentang kosong tidak membagi nol', async () => {
    const banyak = Array.from({ length: 1800 }, (_, i) => r(`z${String(i).padStart(4, '0')}`, { mulai_at: `2026-10-12T03:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` }));
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(buatKlienRekap(buatHRekap({ penanganan: banyak, serverCap: 1000 })));
    const penuh = await (await get()).json();
    expect(penuh.ringkasan.fo.tahap_selesai).toBe(1800);

    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(buatKlienRekap(buatHRekap()));
    const kosong = await (await get()).json();
    expect(kosong.ringkasan.fo.tingkat_eskalasi).toBeNull();
    expect(kosong.ringkasan.layanan.tingkat_pengembalian).toBeNull();
    expect(kosong.per_hari).toEqual([]);
  });

  it('422 untuk rentang tidak valid; 500 saat DB gagal', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(buatKlienRekap(buatHRekap()));
    expect((await get('dari=2026-10-13&sampai=2026-10-12')).status).toBe(422);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(buatKlienRekap(buatHRekap({ galatPenanganan: true })));
    expect((await get()).status).toBe(500);
    spy.mockRestore();
  });
});
