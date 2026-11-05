// Wizard FO "Catat Hadir Petugas": layanan -> foto (terkompresi) -> nama diketik manual -> R2 + RPC fo_catat_hadir_layanan.
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';

const rpc = vi.fn();
const layananQuery = vi.fn();
const eqSaring = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: (kolom: string, nilai: unknown) => {
          eqSaring(kolom, nilai);
          return { order: () => layananQuery() };
        },
      }),
    }),
    rpc,
  }),
}));
const unggah = vi.fn();
vi.mock('@/lib/storage/unggah', () => ({ unggahKeR2: (...a: unknown[]) => unggah(...a) }));
vi.mock('@/lib/foto/kompres', () => ({
  kompresBerkas: async () => new Blob(['x'], { type: 'image/jpeg' }),
  kompresKeJpeg: async () => new Blob(['x'], { type: 'image/jpeg' }),
}));
const toast = vi.fn();
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/time', () => ({ todayWIB: () => '2026-11-02' }));

import AbsensiWizardModal from './AbsensiWizardModal';

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  layananQuery.mockResolvedValue({
    data: [{ id: 'L1', nama: 'Layanan OSS' }, { id: 'L2', nama: 'Layanan Lain' }],
    error: null,
  });
  rpc.mockResolvedValue({ error: null });
  unggah.mockResolvedValue({ kunci: 'k' });
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

const klik = (el: Element) => fireEvent.click(el);
const ketik = (el: Element, v: string) => fireEvent.change(el, { target: { value: v } });

async function sampaiNama() {
  klik(await screen.findByRole('button', { name: 'Layanan OSS' }));
  klik(screen.getByRole('button', { name: /Lanjut/ }));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['a'], 'a.jpg', { type: 'image/jpeg' })] } });
  await waitFor(() => expect(screen.getByRole('button', { name: /Lanjut/ })).toBeEnabled());
  klik(screen.getByRole('button', { name: /Lanjut/ }));
}

describe('AbsensiWizardModal', () => {
  it('nama diketik manual (bukan daftar pilihan) dan Selesai nonaktif sampai nama terisi', async () => {
    render(<AbsensiWizardModal isOpen onClose={() => {}} onSuccess={() => {}} />);
    await sampaiNama();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: /Selesai/ })).toBeDisabled();
    ketik(screen.getByPlaceholderText(/nama lengkap petugas/i), 'Budi Santoso');
    expect(screen.getByRole('button', { name: /Selesai/ })).toBeEnabled();
  });

  it('mengunggah foto ke R2 lalu mencatat lewat RPC dengan nama yang dirapikan', async () => {
    const onSuccess = vi.fn();
    render(<AbsensiWizardModal isOpen onClose={() => {}} onSuccess={onSuccess} />);
    await sampaiNama();
    ketik(screen.getByPlaceholderText(/nama lengkap petugas/i), '  Budi   Santoso ');
    klik(screen.getByRole('button', { name: /Selesai/ }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(unggah).toHaveBeenCalledWith('absensi-foto', expect.stringMatching(/^2026-11-02\/L1_\d+\.jpg$/), expect.any(Blob));
    expect(rpc).toHaveBeenCalledWith('fo_catat_hadir_layanan', {
      p_layanan_id: 'L1',
      p_nama: 'Budi Santoso',
      p_foto_path: expect.stringMatching(/^2026-11-02\/L1_\d+\.jpg$/),
    });
  });

  it('unggah gagal -> RPC tidak dipanggil', async () => {
    unggah.mockRejectedValue(new Error('R2 mati'));
    render(<AbsensiWizardModal isOpen onClose={() => {}} onSuccess={() => {}} />);
    await sampaiNama();
    ketik(screen.getByPlaceholderText(/nama lengkap petugas/i), 'Budi');
    klik(screen.getByRole('button', { name: /Selesai/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('Upload foto gagal'), 'error'));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('nama sudah tercatat (23505) -> pesan jelas', async () => {
    rpc.mockResolvedValue({ error: { code: '23505', message: 'x' } });
    render(<AbsensiWizardModal isOpen onClose={() => {}} onSuccess={() => {}} />);
    await sampaiNama();
    ketik(screen.getByPlaceholderText(/nama lengkap petugas/i), 'Budi');
    klik(screen.getByRole('button', { name: /Selesai/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Petugas ini sudah tercatat hadir hari ini', 'error'));
  });

  it('B-24: daftar layanan disaring aktif = true (sumber kebenaran arsip), bukan diarsipkan_at', async () => {
    render(<AbsensiWizardModal isOpen onClose={() => {}} onSuccess={() => {}} />);
    await screen.findByRole('button', { name: 'Layanan OSS' });
    expect(eqSaring).toHaveBeenCalledWith('aktif', true);
  });

  describe('C-08: status muat daftar layanan', () => {
    it('memuat: tampil keterangan memuat sebelum daftar siap', async () => {
      layananQuery.mockReturnValue(new Promise(() => {}));
      render(<AbsensiWizardModal isOpen onClose={() => {}} onSuccess={() => {}} />);
      expect(await screen.findByText(/Memuat daftar layanan/i)).toBeInTheDocument();
    });

    it('galat: pesan jelas (bukan daftar kosong) dan Coba lagi memuat ulang', async () => {
      layananQuery.mockResolvedValueOnce({ data: null, error: { code: '500', message: 'boom' } });
      render(<AbsensiWizardModal isOpen onClose={() => {}} onSuccess={() => {}} />);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/gagal dimuat/i);
      expect(screen.queryByText(/belum ada layanan/i)).toBeNull();
      klik(screen.getByRole('button', { name: /Coba lagi/ }));
      expect(await screen.findByRole('button', { name: 'Layanan OSS' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('migrasi belum diterapkan dibedakan dari galat jaringan', async () => {
      layananQuery.mockResolvedValueOnce({ data: null, error: { code: '42703', message: 'kolom tidak ada' } });
      render(<AbsensiWizardModal isOpen onClose={() => {}} onSuccess={() => {}} />);
      expect(await screen.findByRole('alert')).toHaveTextContent(/migrasi/i);
    });

    it('kosong: pesan belum ada layanan aktif, tanpa tombol Lanjut aktif', async () => {
      layananQuery.mockResolvedValueOnce({ data: [], error: null });
      render(<AbsensiWizardModal isOpen onClose={() => {}} onSuccess={() => {}} />);
      expect(await screen.findByText(/belum ada layanan aktif/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Lanjut/ })).toBeDisabled();
    });
  });

  describe('C-03 / C-04: kirim', () => {
    it('Enter dua kali berturut-turut hanya mengunggah dan mencatat sekali', async () => {
      let selesaiUnggah: (v: unknown) => void = () => {};
      unggah.mockReturnValue(new Promise((r) => { selesaiUnggah = r; }));
      render(<AbsensiWizardModal isOpen onClose={() => {}} onSuccess={() => {}} />);
      await sampaiNama();
      const input = screen.getByPlaceholderText(/nama lengkap petugas/i);
      ketik(input, 'Budi');
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.keyDown(input, { key: 'Enter' });
      selesaiUnggah({ kunci: 'k' });
      await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
      expect(unggah).toHaveBeenCalledTimes(1);
    });

    it('selama mengirim tombol Tutup dan Kembali nonaktif; setelah galat aktif lagi', async () => {
      let tolakUnggah: (e: unknown) => void = () => {};
      unggah.mockReturnValue(new Promise((_, rej) => { tolakUnggah = rej; }));
      render(<AbsensiWizardModal isOpen onClose={() => {}} onSuccess={() => {}} />);
      await sampaiNama();
      ketik(screen.getByPlaceholderText(/nama lengkap petugas/i), 'Budi');
      klik(screen.getByRole('button', { name: /Selesai/ }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Tutup dialog' })).toBeDisabled());
      expect(screen.getByRole('button', { name: /Kembali/ })).toBeDisabled();
      tolakUnggah(new Error('R2 mati'));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Tutup dialog' })).toBeEnabled());
    });
  });
});
