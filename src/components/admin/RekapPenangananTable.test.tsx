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
    pengunjung_instansi: 'CV Maju', tiket: null, fo_nama: 'Sari Wulandari', ...s,
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

  // Keputusan CEO 2026-10-14 (keterbukaan data antar FO): FO melihat semua FO dan punya filter FO seperti Admin.
  it('FO: menampilkan baris semua FO, catatan keterbukaan, dan filter FO (mengirim petugas_id FO lain)', async () => {
    hOpsi.petugas = [{ id: 'fo-1', nama: 'Sari Wulandari', aktif: true }, { id: 'fo-2', nama: 'Bayu', aktif: true }];
    jawab({
      total: 2, truncated: false, peran_saya: 'front_office', ringkasan,
      rows: [baris('1'), baris('2', { hasil: 'dieskalasi', topik: 'Perizinan', penangan_id: 'fo-2', penangan_nama: 'Bayu', fo_nama: 'Bayu' })],
    });
    render(<RekapPenangananTable peran="fo" />);
    expect((await screen.findAllByText('Sudah dijelaskan')).length).toBe(2);
    expect(screen.getByText(/memuat penanganan semua Front Office/i)).toBeInTheDocument();
    expect(screen.queryByText(/hanya melihat penanganan Anda sendiri/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('Bayu').length).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: /daftar penanganan/i })).toBeInTheDocument();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/admin/rekap/penanganan?');
    expect(url).toContain('peran=fo');
    expect(url).not.toContain('petugas_id');
    const pilih = await screen.findByLabelText('Front Office');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bayu' })).toBeInTheDocument());
    fireEvent.change(pilih, { target: { value: 'fo-2' } });
    await waitFor(() => expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('petugas_id=fo-2'))).toBe(true));
  });

  it('Admin: ada filter FO berisi opsi dan mengirim petugas_id saat dipilih', async () => {
    hOpsi.petugas = [{ id: 'fo-1', nama: 'Sari Wulandari', aktif: true }, { id: 'fo-9', nama: 'Dewi', aktif: false }];
    jawab({ total: 1, truncated: false, peran_saya: 'admin', ringkasan, rows: [baris('1')] });
    render(<RekapPenangananTable peran="fo" />);
    const pilih = await screen.findByLabelText('Front Office');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Dewi (nonaktif)' })).toBeInTheDocument());
    fireEvent.change(pilih, { target: { value: 'fo-1' } });
    await waitFor(() => expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('petugas_id=fo-1'))).toBe(true));
  });

  it('rekap kosong: pesan kosong dan tombol unduh nonaktif', async () => {
    jawab({ total: 0, truncated: false, peran_saya: 'admin', ringkasan: { ...ringkasan, total: 0, per_topik: [], per_penangan_hari: [] }, rows: [] });
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
      total: 1, truncated: false, peran_saya: 'admin', ringkasan,
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
    jawab({ total: 0, truncated: false, peran_saya: 'petugas', ringkasan: { ...ringkasan, total: 0, per_topik: [], per_penangan_hari: [] }, rows: [] });
    render(<RekapPenangananTable peran="layanan" isPetugas initialLayananId="l1" layananOptions={[{ id: 'l1', nama: 'Helpdesk OSS' }]} />);
    expect(await screen.findByText(/hanya untuk layanan Helpdesk OSS/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Layanan')).not.toBeInTheDocument();
  });

  it('FO pada rekap layanan: tanpa catatan keterbatasan lama; kolom Front Office, filter Petugas dan Layanan tampil', async () => {
    jawab({
      total: 1, truncated: false, peran_saya: 'front_office', ringkasan,
      rows: [baris('9', {
        peran_tahap: 'layanan', layanan_id: 'l1', layanan_nama: 'Helpdesk OSS', penangan_id: 'p-1', penangan_nama: 'Rina',
        fo_nama: 'Bayu (FO lain)', tiket: null,
      })],
    });
    render(<RekapPenangananTable peran="layanan" layananOptions={[{ id: 'l1', nama: 'Helpdesk OSS' }]} />);
    expect(await screen.findByText('Bayu (FO lain)')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Front Office' })).toBeInTheDocument();
    expect(screen.queryByText(/tidak lengkap untuk seluruh layanan/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pernah Anda tangani di Front Office/i)).not.toBeInTheDocument();
    expect(screen.getByText(/semua Front Office dan semua petugas layanan/i)).toBeInTheDocument();
    expect(await screen.findByLabelText('Petugas')).toBeInTheDocument();
    expect(screen.getByLabelText('Layanan')).toBeInTheDocument();
  });

  // Keputusan CEO 2026-10-14: filter "Front Office yang mengeskalasi" untuk semua role yang melihat rekap layanan.
  it.each(['admin', 'front_office', 'petugas'])('peran layanan (%s): filter FO yang mengeskalasi dari opsi_fo respons; memilih mengirim fo_id', async (role) => {
    jawab({
      total: 1, truncated: false, peran_saya: role, ringkasan, rows: [baris('9', { peran_tahap: 'layanan', layanan_id: 'l1', fo_nama: 'Ani', fo_id: 'fo-a' })],
      opsi_fo: [{ id: 'fo-a', nama: 'Ani' }, { id: 'fo-b', nama: 'Bayu' }],
    });
    render(<RekapPenangananTable peran="layanan" isPetugas={role === 'petugas'} initialLayananId={role === 'petugas' ? 'l1' : null}
      layananOptions={[{ id: 'l1', nama: 'Helpdesk OSS' }]} />);
    const pilih = await screen.findByLabelText('Front Office yang mengeskalasi');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bayu' })).toBeInTheDocument());
    expect(String(mockFetch.mock.calls[0][0])).not.toContain('fo_id');
    fireEvent.change(pilih, { target: { value: 'fo-b' } });
    await waitFor(() => expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('fo_id=fo-b'))).toBe(true));
    expect(String(mockFetch.mock.calls.at(-1)?.[0])).toContain('page=0');
  });

  it('ekspor ikut meneruskan fo_id terpilih', async () => {
    jawab({
      total: 1, truncated: false, peran_saya: 'admin', ringkasan, rows: [baris('9', { peran_tahap: 'layanan', fo_id: 'fo-a' })],
      opsi_fo: [{ id: 'fo-a', nama: 'Ani' }],
    });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    render(<RekapPenangananTable peran="layanan" layananOptions={[]} />);
    const pilih = await screen.findByLabelText('Front Office yang mengeskalasi');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ani' })).toBeInTheDocument());
    fireEvent.change(pilih, { target: { value: 'fo-a' } });
    await waitFor(() => expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('fo_id=fo-a'))).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: /download excel/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /download excel/i }));
    await waitFor(() => expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/penanganan/export?') && String(c[0]).includes('fo_id=fo-a'))).toBe(true));
  });

  it('filter FO yang mengeskalasi: awal Semua; rekap FO tidak punya filter ini', async () => {
    jawab({ total: 0, truncated: false, peran_saya: 'admin', ringkasan: { ...ringkasan, total: 0, per_topik: [], per_penangan_hari: [] }, rows: [], opsi_fo: [] });
    render(<RekapPenangananTable peran="layanan" layananOptions={[]} />);
    const pilih = await screen.findByLabelText('Front Office yang mengeskalasi') as HTMLSelectElement;
    expect(pilih.value).toBe('');
    cleanup();
    jawab({ total: 0, truncated: false, peran_saya: 'admin', ringkasan, rows: [] });
    render(<RekapPenangananTable peran="fo" />);
    await screen.findByText(/tidak ada penanganan/i);
    expect(screen.queryByLabelText('Front Office yang mengeskalasi')).not.toBeInTheDocument();
  });

  it('peringatan bila data terpotong 50.000 baris', async () => {
    jawab({ total: 1, truncated: true, peran_saya: 'admin', ringkasan, rows: [baris('1')] });
    render(<RekapPenangananTable peran="fo" />);
    expect(await screen.findByText(/dipotong/i)).toBeInTheDocument();
  });
});
