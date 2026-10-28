// Laporan cetak Pesan Perilaku: semua keluaran berupa angka (IKM, SPAK, response rate, saran, pengaduan).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const DATA: Record<string, unknown[]> = {
  ringkasan_ikm: [{ layanan_id: 'a', unit: 'layanan', nama: 'Layanan OSS', ikm: '80', responden: 10 }, { layanan_id: null, unit: 'fo', nama: 'Front Office', ikm: '90', responden: 30 }],
  ringkasan_spak: [{ layanan_id: 'a', unit: 'layanan', nama: 'Layanan OSS', responden: 10, p1: '6', p2: '6', p3: '6', p4: '6', p5: '3' }],
  ringkasan_response_rate: [{ layanan_id: 'a', unit: 'layanan', nama: 'Layanan OSS', diundang: 20, mengisi: 10 }],
  ringkasan_pengaduan: [{ jalur: 'layanan', sumber: 'wizard', status: 'baru', jumlah: 2 }],
  ringkasan_saran: [{ layanan_id: 'a', unit: 'layanan', nama: 'Layanan OSS', jumlah: 1 }],
};
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

afterEach(cleanup);

describe('CetakPesanPerilakuPage', () => {
  it('menampilkan angka IKM gabungan (dibobot), SPAK, response rate, saran, dan pengaduan', async () => {
    render(<CetakPesanPerilakuPage />);
    await waitFor(() => expect(screen.getByText('Laporan Pesan Perilaku', { selector: 'h2' })).toBeInTheDocument());
    // (80*10 + 90*30) / 40 = 87.5
    expect(screen.getAllByText('87.5').length).toBeGreaterThan(0);
    // SPAK rata-rata (6+6+6+6+3)/5 = 5.40
    expect(screen.getAllByText('5.40').length).toBeGreaterThan(0);
    expect(screen.getAllByText('50.0%').length).toBeGreaterThan(0);
    expect(screen.getByText('Tambah kursi tunggu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cetak/ })).toBeEnabled();
  });
});
