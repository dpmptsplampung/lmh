// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import PelayananWizardModal from './PelayananWizardModal';

// toastMock harus stabil antar-render: jika vi.fn() dibuat baru di dalam
// factory setiap render, loadData (useCallback dep toast) berubah identitas
// terus-menerus dan memicu infinite re-render (test hang).
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

describe('PelayananWizardModal component', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
    toastMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('renders loading state and then populates initial data for Helpdesk OSS with 3 optional fields', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tiket_id: 't-101',
        legacy_visit_id: 'v-101',
        nomor_display: 'A-001',
        layanan_id: 'l-oss',
        layanan_nama: 'Helpdesk OSS',
        form_type: 'oss',
        nama_pemohon: 'Budi Hartono',
        alamat_pemohon: 'Bandar Lampung',
        no_hp: '081234567890',
        email: 'budi@example.com',
        keperluan_awal: 'Konsultasi OSS',
        status_tiket: 'dilayani',
        is_locked: false,
        status_draft: 'belum_diisi',
      }),
    });

    render(
      <PelayananWizardModal
        isOpen={true}
        tiketId="t-101"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Memuat formulir pendataan/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Pendataan Pelayanan — Helpdesk OSS/i)).toBeInTheDocument();
      expect(screen.getByDisplayValue('Budi Hartono')).toBeInTheDocument();
      expect(screen.getByDisplayValue('081234567890')).toBeInTheDocument();
    });

    // Step 2: Data Usaha & Lokasi (menampilkan tipe pelaku usaha, status penanaman modal, lokasi usaha)
    // getAllByText: teks label juga muncul di <option> placeholder select, jadi ada >1 match.
    fireEvent.click(screen.getByRole('button', { name: /2\. Data Usaha & Lokasi/i }));
    expect(screen.getByText(/Nama Usaha \/ Merk Usaha/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Tipe Pelaku Usaha \(Opsional\)/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Status Penanaman Modal \(Opsional\)/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Lokasi Usaha \(Opsional\)/i).length).toBeGreaterThanOrEqual(1);
  });

  it('form Perizinan mengirim lokasi_usaha pada payload autosave', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tiket_id: 't-202',
        legacy_visit_id: 'v-202',
        nomor_display: 'B-002',
        layanan_id: 'l-perizinan',
        layanan_nama: 'Non OSS (SiCantik Lampung)',
        form_type: 'perizinan',
        nama_pemohon: 'Siti Rahma',
        alamat_pemohon: null,
        no_hp: null,
        email: null,
        keperluan_awal: null,
        status_tiket: 'dilayani',
        is_locked: false,
        status_draft: 'belum_diisi',
        data_perizinan: {
          nama_perusahaan: 'PT Sinar Lampung',
          opd_teknis: 'Dinas ESDM',
          uraian_permohonan: 'Izin galian C',
          tindak_lanjut: '',
          catatan_petugas: '',
        },
      }),
    });
    // PATCH autosave mengembalikan ok.
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    render(<PelayananWizardModal isOpen={true} tiketId="t-202" onClose={vi.fn()} />);

    await screen.findByDisplayValue('Siti Rahma');

    // Step 2: form perizinan punya input Lokasi Usaha.
    fireEvent.click(screen.getByRole('button', { name: /2\. Data Usaha & Lokasi/i }));
    const lokasiInput = screen.getByPlaceholderText(/kabupaten\/kota/i);
    fireEvent.change(lokasiInput, { target: { value: 'Bandar Lampung' } });
    // Debounce autosave memakai closure render sebelumnya, jadi PATCH pertama
    // membawa nilai pra-commit. Perubahan kedua memicu PATCH berikutnya yang
    // membawa lokasi_usaha yang sudah ter-commit (perilaku yang sama berlaku
    // untuk field OSS lokasiUsaha).
    fireEvent.change(screen.getByDisplayValue('PT Sinar Lampung'), {
      target: { value: 'PT Sinar Lampung Jaya' },
    });

    // Tunggu autosave lalu pastikan ada PATCH yang mengirim lokasi_usaha.
    await waitFor(
      () => {
        const patchBodies = mockFetch.mock.calls
          .filter((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')
          .map((c) => JSON.parse((c[1] as RequestInit).body as string));
        expect(patchBodies.some((b) => b.lokasi_usaha === 'Bandar Lampung')).toBe(true);
      },
      { timeout: 3000 }
    );
  });

  it('clears pending autosave on unmount so no PATCH fires after the modal is gone', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tiket_id: 't-101',
        legacy_visit_id: 'v-101',
        nomor_display: 'A-001',
        layanan_id: 'l-oss',
        layanan_nama: 'Helpdesk OSS',
        form_type: 'oss',
        nama_pemohon: 'Budi Hartono',
        alamat_pemohon: null,
        no_hp: null,
        email: null,
        keperluan_awal: null,
        status_tiket: 'dilayani',
        is_locked: false,
        status_draft: 'belum_diisi',
      }),
    });

    const { unmount } = render(
      <PelayananWizardModal isOpen={true} tiketId="t-101" onClose={vi.fn()} />
    );

    // Tunggu data terpopulasi
    await screen.findByDisplayValue('Budi Hartono');

    // Ubah field → menjadwalkan autosave (debounce 1 detik)
    fireEvent.change(screen.getByDisplayValue('Budi Hartono'), {
      target: { value: 'Budi Hartono S' },
    });

    // Unmount sebelum debounce selesai — timer harus dibersihkan
    unmount();

    // Tunggu melewati jendela debounce: tidak boleh ada PATCH terpicu
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(mockFetch).toHaveBeenCalledTimes(1); // hanya GET awal, tanpa PATCH
  });
});
