// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LaporanUmkm from './LaporanUmkm';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: null } }) },
}) }));
const dasar = {
  telemetri_opsional_aktif: false, versi_naskah: null, aktif_pada: null,
  profil: { diajukan: 0, terbit: 2, disembunyikan: 0, ditolak: 0 }, suka: 0, dilihat: null, tanpa_hasil: null,
  pesan: { baru: 0, ditangani: 0 }, laporan: { baru: 0, ditangani: 0 }, kelompok_tanpa_hasil: [], next_cursor: null,
  profil_statistik: [{ id: 'a', nama: 'Kopi Lampung', suka: 5, dilihat: null, klik_formulir: null, permintaan: 6 }],
};
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data })));
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => ok({ ...dasar,
  permintaan: { diajukan: 3, menunggu_izin: 1, nomor_dibuka: 9, ditolak: 2, dibatalkan: 1 },
  rata_keputusan_detik: 7200, hasil: { belum_diketahui: 5, kerja_sama: 3, tidak_berlanjut: 1 },
}))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('laporan permintaan (butir 6)', () => {
  it('menampilkan permintaan per status, lama tunggu, hasil, dan permintaan per UMKM', async () => {
    render(<LaporanUmkm />);
    const kartu = await screen.findByRole('region', { name: 'Permintaan kontak' });
    expect(kartu).toHaveTextContent('Diajukan3');
    expect(kartu).toHaveTextContent('Nomor dibuka9');
    expect(kartu).toHaveTextContent('Rata-rata lama tunggu sampai keputusan2 jam');
    expect(kartu).toHaveTextContent('Hasil: Kerja sama3');
    const tabel = screen.getByRole('table', { name: /Suka, dilihat/ });
    expect(within(tabel).getByRole('columnheader', { name: 'Permintaan kontak' })).toBeTruthy();
    expect(within(tabel).getByRole('cell', { name: '6' })).toBeTruthy();
  });

  it('tanpa data permintaan dari server, laporan lama tetap tampil tanpa kartu baru', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok({ ...dasar, profil_statistik: [] })));
    render(<LaporanUmkm />);
    await screen.findByRole('heading', { name: 'Ringkasan' });
    expect(screen.queryByRole('region', { name: 'Permintaan kontak' })).toBeNull();
  });
});
