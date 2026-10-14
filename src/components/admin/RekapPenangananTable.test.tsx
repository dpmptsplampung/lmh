// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import RekapPenangananTable from './RekapPenangananTable';

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const hOpsi = vi.hoisted(() => ({ petugas: [] as { id: string; nama: string; aktif: boolean }[] }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.in = () => b;
      b.order = () => Promise.resolve({ data: hOpsi.petugas, error: null });
      return b;
    },
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const ringkasan = {
  total: 2,
  per_hasil: [
    { kunci: 'selesai', label: 'Selesai', jumlah: 1 },
    { kunci: 'dieskalasi', label: 'Dieskalasi ke layanan', jumlah: 1 },
    { kunci: 'dikembalikan', label: 'Dikembalikan ke Front Office', jumlah: 0 },
    { kunci: 'belum_ditutup', label: 'Belum ditutup', jumlah: 0 },
    { kunci: 'batal', label: 'Dibatalkan', jumlah: 0 },
  ],
  per_topik: [{ topik: 'Informasi umum', jumlah: 1 }, { topik: 'Perizinan', jumlah: 1 }],
  per_penangan_hari: [
    { tanggal: '2026-10-12', penangan_id: 'fo-1', nama: 'Sari Wulandari', total: 2, selesai: 1, dieskalasi: 1, dikembalikan: 0, belum_ditutup: 0, batal: 0, rata_durasi_menit: 12.5 },
  ],
};

function baris(id: string, s: Record<string, unknown> = {}) {
  return {
    id, kunjungan_id: 'k', tahap_ke: 1, peran_tahap: 'fo', layanan_id: null, layanan_nama: null, saluran: 'walk_in',
    penangan_id: 'fo-1', penangan_nama: 'Sari Wulandari', status: 'selesai', hasil: 'selesai', topik: 'Informasi umum',
    catatan: 'Sudah dijelaskan', batal_karena: null, mulai_at: '2026-10-12T02:00:00Z', selesai_at: '2026-10-12T02:10:00Z',
    created_at: '2026-10-12T02:00:00Z', tanggal: '2026-10-12', durasi_menit: 10, pengunjung_nama: 'Budi',
    pengunjung_instansi: 'CV Maju', tiket: null, ...s,
  };
}

function jawab(body: Record<string, unknown>, ok = true, status = 200) {
  mockFetch.mockResolvedValue({ ok, status, json: async () => body, headers: new Headers(), blob: async () => new Blob() });
}

describe('RekapPenangananTable', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    hOpsi.petugas = [];
  });
  afterEach(() => cleanup());

  it('FO: menampilkan baris, ringkasan, catatan terkunci, dan TANPA filter FO', async () => {
    jawab({ total: 2, truncated: false, peran_saya: 'front_office', terkunci_ke_saya: true, ringkasan, rows: [baris('1'), baris('2', { hasil: 'dieskalasi', topik: 'Perizinan' })] });
    render(<RekapPenangananTable peran="fo" />);
    expect((await screen.findAllByText('Sudah dijelaskan')).length).toBe(2);
    expect(screen.getByText(/hanya melihat penanganan Anda sendiri/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Front Office')).not.toBeInTheDocument();
    expect(screen.getAllByText('Sari Wulandari').length).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: /daftar penanganan/i })).toBeInTheDocument();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/admin/rekap/penanganan?');
    expect(url).toContain('peran=fo');
    expect(url).not.toContain('petugas_id');
  });

  it('Admin: ada filter FO berisi opsi dan mengirim petugas_id saat dipilih', async () => {
    hOpsi.petugas = [{ id: 'fo-1', nama: 'Sari Wulandari', aktif: true }, { id: 'fo-9', nama: 'Dewi', aktif: false }];
    jawab({ total: 1, truncated: false, peran_saya: 'admin', terkunci_ke_saya: false, ringkasan, rows: [baris('1')] });
    render(<RekapPenangananTable peran="fo" />);
    const pilih = await screen.findByLabelText('Front Office');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Dewi (nonaktif)' })).toBeInTheDocument());
    fireEvent.change(pilih, { target: { value: 'fo-1' } });
    await waitFor(() => expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('petugas_id=fo-1'))).toBe(true));
  });

  it('rekap kosong: pesan kosong dan tombol unduh nonaktif', async () => {
    jawab({ total: 0, truncated: false, peran_saya: 'admin', terkunci_ke_saya: false, ringkasan: { ...ringkasan, total: 0, per_topik: [], per_penangan_hari: [] }, rows: [] });
    render(<RekapPenangananTable peran="fo" />);
    expect(await screen.findByText(/tidak ada penanganan pada rentang/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download excel/i })).toBeDisabled();
  });

  it('403 menampilkan pesan tidak berwenang; galat jaringan menampilkan Coba Lagi', async () => {
    jawab({ error: 'Forbidden' }, false, 403);
    render(<RekapPenangananTable peran="fo" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/tidak berwenang/i);
    cleanup();
    mockFetch.mockRejectedValue(new Error('net'));
    render(<RekapPenangananTable peran="fo" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/tidak ada koneksi/i);
    expect(screen.getByRole('button', { name: /coba lagi/i })).toBeInTheDocument();
  });

  it('peran layanan: kolom Layanan/Tiket dan Pendataan, label status baru; filter layanan untuk non-petugas', async () => {
    jawab({
      total: 1, truncated: false, peran_saya: 'admin', terkunci_ke_saya: false, ringkasan,
      rows: [baris('9', {
        peran_tahap: 'layanan', layanan_id: 'l1', layanan_nama: 'Helpdesk OSS', hasil: 'dikembalikan', topik: null,
        tiket: { nomor_display: 'OS-007', tanggal: '2026-10-12', status: 'dikembalikan', form_type: 'oss',
          pelayanan_oss: { nama_pemohon: 'Andi', nama_usaha: 'Warung A' }, pelayanan_perizinan: null },
      })],
    });
    render(<RekapPenangananTable peran="layanan" layananOptions={[{ id: 'l1', nama: 'Helpdesk OSS' }]} />);
    expect(await screen.findByText('OS-007')).toBeInTheDocument();
    expect(screen.getByText('Dikembalikan ke Front Office', { selector: 'span.badge--draft' })).toBeInTheDocument();
    expect(screen.getByText(/OSS: Andi \/ Warung A/)).toBeInTheDocument();
    expect(screen.getByLabelText('Layanan')).toBeInTheDocument();
    expect(String(mockFetch.mock.calls[0][0])).toContain('peran=layanan');
  });

  it('petugas layanan: filter layanan disembunyikan, catatan layanan sendiri tampil', async () => {
    jawab({ total: 0, truncated: false, peran_saya: 'petugas', terkunci_ke_saya: false, ringkasan: { ...ringkasan, total: 0, per_topik: [], per_penangan_hari: [] }, rows: [] });
    render(<RekapPenangananTable peran="layanan" isPetugas initialLayananId="l1" layananOptions={[{ id: 'l1', nama: 'Helpdesk OSS' }]} />);
    expect(await screen.findByText(/hanya untuk layanan Helpdesk OSS/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Layanan')).not.toBeInTheDocument();
  });

  it('FO pada rekap layanan: catatan keterbatasan eskalasi tampil, bukan catatan "penanganan Anda sendiri"', async () => {
    jawab({
      total: 0, truncated: false, peran_saya: 'front_office', terkunci_ke_saya: false, cakupan_eskalasi_fo: true,
      ringkasan: { ...ringkasan, total: 0, per_topik: [], per_penangan_hari: [] }, rows: [],
    });
    render(<RekapPenangananTable peran="layanan" layananOptions={[{ id: 'l1', nama: 'Helpdesk OSS' }]} />);
    expect(await screen.findByText(/pernah Anda tangani di Front Office/i)).toBeInTheDocument();
    expect(screen.getByText(/tidak lengkap untuk seluruh layanan/i)).toBeInTheDocument();
    expect(screen.queryByText(/hanya melihat penanganan Anda sendiri/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Petugas')).not.toBeInTheDocument();
  });

  it('peringatan bila data terpotong 50.000 baris', async () => {
    jawab({ total: 1, truncated: true, peran_saya: 'admin', terkunci_ke_saya: false, ringkasan, rows: [baris('1')] });
    render(<RekapPenangananTable peran="fo" />);
    expect(await screen.findByText(/dipotong/i)).toBeInTheDocument();
  });
});
