// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div><h1>{title}</h1>{children}</div>
  ),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import PerformaPage from './page';

const metrikKosong = {
  tahap_selesai: 0, pengunjung: 0, selesai_langsung: 0, dieskalasi: 0, dikembalikan: 0, batal: 0, berjalan: 0,
  rata_durasi_menit: null, rata_tunggu_menit: null, tingkat_eskalasi: null, tingkat_pengembalian: null,
};

function data(s: Record<string, unknown> = {}) {
  return {
    dari: '2026-09-15', sampai: '2026-10-14', truncated: false,
    ringkasan: {
      pengunjung_dilayani: 7, total_baris: 12,
      fo: { ...metrikKosong, tahap_selesai: 8, dieskalasi: 2, tingkat_eskalasi: 0.25, rata_durasi_menit: 6.5 },
      layanan: { ...metrikKosong, tahap_selesai: 4, dikembalikan: 1, tingkat_pengembalian: 0.25, rata_durasi_menit: 20, rata_tunggu_menit: 3 },
    },
    per_orang: [
      { ...metrikKosong, penangan_id: 'fo-1', nama: 'Sari Wulandari', peran: 'fo', tahap_selesai: 8, pengunjung: 8, tingkat_eskalasi: 0.25 },
      { ...metrikKosong, penangan_id: 'p-1', nama: 'Rina', peran: 'layanan', tahap_selesai: 4, pengunjung: 4, tingkat_pengembalian: 0.25 },
    ],
    per_layanan: [{ ...metrikKosong, layanan_id: 'l1', nama: 'Helpdesk OSS', tahap_selesai: 4, pengunjung: 4, dikembalikan: 1, tingkat_pengembalian: 0.25 }],
    per_hari: [
      { tanggal: '2026-10-12', pengunjung: 3, fo: { ...metrikKosong, tahap_selesai: 3 }, layanan: metrikKosong },
      { tanggal: '2026-10-13', pengunjung: 4, fo: { ...metrikKosong, tahap_selesai: 5, tingkat_eskalasi: 0 }, layanan: metrikKosong },
    ],
    ...s,
  };
}

describe('/admin/performa', () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => cleanup());

  it('menampilkan angka ringkasan, tabel per orang/layanan/hari, dan keterangan waktu tunggu FO', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => data() });
    render(<PerformaPage />);
    expect(await screen.findByText('Tingkat eskalasi FO ke layanan')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText(/tidak terukur/i)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /per orang/i })).toBeInTheDocument();
    expect(screen.getByText('Sari Wulandari')).toBeInTheDocument();
    expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    expect(screen.getAllByText('25%').length).toBeGreaterThan(0);
    // Tingkat 0% yang NYATA ditampilkan sebagai 0%, bukan em dash
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(String(mockFetch.mock.calls[0][0])).toContain('/api/admin/rekap/performa?');
  });

  it('tanpa data pembanding: tingkat tampil "—" (bukan 0% / NaN)', async () => {
    const kosong = data({
      ringkasan: { pengunjung_dilayani: 0, total_baris: 0, fo: metrikKosong, layanan: metrikKosong },
      per_orang: [], per_layanan: [], per_hari: [],
    });
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => kosong });
    render(<PerformaPage />);
    expect(await screen.findByText('Tingkat eskalasi FO ke layanan')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Belum ada data pada rentang ini/).length).toBe(3);
  });

  it('403 (bukan Admin) menampilkan pesan dan tanpa tabel', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) });
    render(<PerformaPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/hanya admin/i);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
