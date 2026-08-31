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
