// Laporan cetak Pesan Perilaku: angka global (IKM per unsur, SPAK per pernyataan dengan persen, tingkat pengisian, saran, pengaduan).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { hitungIkmGlobal, hitungSpakGlobal, type BarisMentah } from '@/lib/survei/ringkasan-global';

const PERIODE = { dari: '2026-10-01', sampai: '2026-10-31' };
const spak = (p: number[]): BarisMentah => ({
  created_at: '2026-10-05T03:00:00Z', p1_tanpa_diskriminasi: p[0], p2_tanpa_kecurangan: p[1], p3_tanpa_imbalan: p[2], p4_tanpa_pungli: p[3], p5_tanpa_percaloan: p[4],
});
const skm = (n: number): BarisMentah => ({
  created_at: '2026-10-05T03:00:00Z',
  u1_persyaratan: n, u2_prosedur: n, u3_waktu: n, u4_biaya: n, u5_produk: n, u6_kompetensi: n, u7_perilaku: n, u8_sarana: n, u9_pengaduan: n,
  u10_transparansi: null, u11_integritas: null,
});
const GLOBAL = {
  spak: hitungSpakGlobal([spak([6, 6, 6, 6, 3]), spak([6, 6, 6, 6, 3])], PERIODE),
  ikm: hitungIkmGlobal([skm(4), skm(3)], PERIODE), // (100 + 75) / 2 = 87.5
  responseRate: { diundang: 20, mengisi: 10, persen: 50 },
  terpotong: false,
};

const DATA: Record<string, unknown[]> = {
  ringkasan_pengaduan: [{ jalur: 'layanan', sumber: 'wizard', status: 'baru', jumlah: 2 }, { jalur: 'layanan', sumber: 'publik', status: 'baru', jumlah: 1 }],
  ringkasan_saran: [{ layanan_id: 'a', unit: 'layanan', nama: 'Layanan OSS', jumlah: 1 }],
};
const params = new URLSearchParams();
vi.mock('next/navigation', () => ({ useSearchParams: () => params }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: async (nama: string) => ({ data: DATA[nama] ?? [], error: null }),
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'gte', 'lt', 'order']) q[m] = () => q;
      q.limit = async () => ({ data: [{ id: 's1', isi: 'Tambah kursi tunggu', created_at: '2026-10-28T03:00:00Z', pelapor_nama: null, unit: 'layanan', layanan: { nama: 'Layanan OSS' } }], error: null });
      return q;
    },
  }),
}));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import CetakPesanPerilakuPage from './page';

const fetchMock = vi.fn();
beforeEach(() => {
  [...params.keys()].forEach((k) => params.delete(k));
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify(GLOBAL), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CetakPesanPerilakuPage', () => {
  it('menampilkan angka IKM, SPAK + persen, tingkat pengisian, saran, dan pengaduan secara GLOBAL', async () => {
    render(<CetakPesanPerilakuPage />);
    await waitFor(() => expect(screen.getByText('Laporan Pesan Perilaku', { selector: 'h2' })).toBeInTheDocument());
    await screen.findByText(/gabungan seluruh pelayanan/);

    expect(screen.getAllByText('87.5').length).toBeGreaterThan(0); // IKM
    // SPAK: (6x4 + 3) / 5 = 5.40 ; indeks 90.0 ; setuju 100%
    expect(screen.getAllByText('5.40').length).toBeGreaterThan(0);
    expect(screen.getAllByText('90.0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('80.0%').length).toBeGreaterThan(0); // 4 dari 5 butir bernilai 6; butir 5 bernilai 3 -> setuju 80%
    expect(screen.getAllByText('50.0%').length).toBeGreaterThan(0); // tingkat pengisian
    expect(screen.getByText('Tambah kursi tunggu')).toBeInTheDocument();
    expect(screen.getByText('Tautan publik')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cetak/ })).toBeEnabled();
    // Tanpa pemecahan per unit.
    expect(screen.queryByText(/per Unit/)).toBeNull();
    expect(screen.queryByText('Front Office')).toBeNull();
  });

  it('periode diambil dari query ?dari=&sampai= (dikirim dari halaman Hasil Survei)', async () => {
    params.set('dari', '2026-09-01');
    params.set('sampai', '2026-09-30');
    render(<CetakPesanPerilakuPage />);
    await screen.findByText(/gabungan seluruh pelayanan/);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/survei/ringkasan?dari=2026-09-01&sampai=2026-09-30');
    expect(screen.getByText(/Periode 1 September 2026 s\.d\. 30 September 2026/)).toBeInTheDocument();
  });

  it('query tidak sah diabaikan (jatuh ke bulan ini)', async () => {
    params.set('dari', 'bukan-tanggal');
    params.set('sampai', '2026-09-30');
    render(<CetakPesanPerilakuPage />);
    await screen.findByText(/gabungan seluruh pelayanan/);
    expect(fetchMock.mock.calls[0][0]).not.toContain('bukan-tanggal');
  });
});
