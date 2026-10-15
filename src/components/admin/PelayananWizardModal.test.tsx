// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import PelayananWizardModal from './PelayananWizardModal';

// toastMock harus stabil antar-render: jika vi.fn() dibuat baru di dalam
// factory setiap render, loadData (useCallback dep toast) berubah identitas
// terus-menerus dan memicu infinite re-render (test hang).
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

// Pendataan (keputusan CEO G.5): menyelesaikan layanan butuh SEMUA field terisi. Fixture lengkap; tes yang memeriksa
// galat sengaja mengosongkan satu/lebih field.
const PROFIL_LENGKAP = {
  alamat_pemohon: 'Bandar Lampung',
  no_hp: '081234567890',
  email: 'rina@example.com',
  keperluan_awal: 'Mengurus NIB',
};
const DATA_OSS_LENGKAP = {
  nama_usaha: 'Toko Rina',
  tipe_pelaku_usaha: 'perseorangan',
  status_penanaman_modal: 'tidak_ada',
  lokasi_usaha: 'Bandar Lampung',
  skala_usaha: 'Mikro',
  sektor_usaha_kbli: '47111',
  tindak_lanjut: 'Selesai di Loket (Tuntas)',
  uraian_solusi: 'NIB dibantu terbit.',
  catatan_internal: '-',
};
const DATA_PERIZINAN_LENGKAP = {
  nama_perusahaan: 'PT Maju',
  lokasi_usaha: 'Lampung Selatan',
  opd_teknis: 'DPMPTSP',
  uraian_permohonan: 'Izin',
  tindak_lanjut: 'Diproses',
  catatan_petugas: '-',
};

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

  it('renders loading state and then populates initial data for Helpdesk OSS (semua field wajib)', async () => {
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
        dilayani_oleh: 'p1',
        dilayani_oleh_nama: null,
        boleh_ubah: true,
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
    expect(screen.getAllByText(/Tipe Pelaku Usaha/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Status Penanaman Modal/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Lokasi Usaha/i).length).toBeGreaterThanOrEqual(1);
    // tidak ada lagi field bertanda "(Opsional)": semua wajib
    expect(screen.queryByText(/\(Opsional\)/i)).not.toBeInTheDocument();
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
        dilayani_oleh: 'p1',
        dilayani_oleh_nama: null,
        boleh_ubah: true,
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
        dilayani_oleh: 'p1',
        dilayani_oleh_nama: null,
        boleh_ubah: true,
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

  // Migrasi 202610140002: hanya pemilik tiket yang boleh menulis draf / menyelesaikan.
  describe('kepemilikan tiket', () => {
    const dataOss = (over: Record<string, unknown> = {}) => ({
      tiket_id: 't-301',
      legacy_visit_id: 'v-301',
      nomor_display: 'A-003',
      layanan_id: 'l-oss',
      layanan_nama: 'Helpdesk OSS',
      form_type: 'oss',
      nama_pemohon: 'Rina',
      ...PROFIL_LENGKAP,
      status_tiket: 'dilayani',
      dilayani_oleh: 'p-lain',
      dilayani_oleh_nama: 'Petugas Dua',
      boleh_ubah: false,
      is_locked: false,
      status_draft: 'draft',
      data_oss: { ...DATA_OSS_LENGKAP },
      ...over,
    });

    it('bukan pemilik: baca-saja (input nonaktif, tanpa Simpan/Selesaikan, tanpa PATCH) dan menyebut pemilik', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => dataOss() });
      render(<PelayananWizardModal isOpen={true} tiketId="t-301" onClose={vi.fn()} />);

      const input = await screen.findByDisplayValue('Rina');
      expect(input).toBeDisabled();
      expect(screen.getByText(/Baca saja/i)).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/sedang dilayani Petugas Dua/i);
      expect(screen.queryByRole('button', { name: /^Simpan$/i })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /3\. Tindakan & Solusi/i }));
      expect(screen.queryByRole('button', { name: /Selesaikan Antrian/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^Tutup$/i }));
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFetch.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')).toHaveLength(0);
    });

    it('tiket belum dimulai (menunggu): baca-saja dengan pesan mulai layanan dulu', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => dataOss({ status_tiket: 'menunggu', dilayani_oleh: null, dilayani_oleh_nama: null }),
      });
      render(<PelayananWizardModal isOpen={true} tiketId="t-301" onClose={vi.fn()} />);
      expect(await screen.findByDisplayValue('Rina')).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent(/setelah layanan dimulai/i);
    });

    it('pemilik: Selesaikan ditolak 403 (BUKAN_PEMILIK, mis. diambil alih Admin) -> toast pesan, formulir terkunci, daftar dimuat ulang', async () => {
      const onDataBasi = vi.fn();
      const onSuccess = vi.fn();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => dataOss({ dilayani_oleh: 'p1', boleh_ubah: true }) });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Tiket ini sedang dilayani petugas lain.', kode: 'BUKAN_PEMILIK' }),
      });
      render(
        <PelayananWizardModal isOpen={true} tiketId="t-301" onClose={vi.fn()} onSuccess={onSuccess} onDataBasi={onDataBasi} />,
      );
      expect(await screen.findByDisplayValue('Rina')).not.toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: /3\. Tindakan & Solusi/i }));
      fireEvent.click(screen.getByRole('button', { name: /Selesaikan Antrian/i }));

      await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Tiket ini sedang dilayani petugas lain.', 'error'));
      expect(onDataBasi).toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /Selesaikan Antrian/i })).not.toBeInTheDocument();
      expect(screen.getByText(/Baca saja/i)).toBeInTheDocument();
    });

    it('pemilik: Selesaikan 409 (status berubah) juga ditangani tanpa toast sukses', async () => {
      const onDataBasi = vi.fn();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => dataOss({ dilayani_oleh: 'p1', boleh_ubah: true }) });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'Tiket tidak sedang dilayani sehingga tidak dapat diselesaikan', kode: 'INVALID_STATUS' }),
      });
      render(<PelayananWizardModal isOpen={true} tiketId="t-301" onClose={vi.fn()} onDataBasi={onDataBasi} />);
      await screen.findByDisplayValue('Rina');
      fireEvent.click(screen.getByRole('button', { name: /3\. Tindakan & Solusi/i }));
      fireEvent.click(screen.getByRole('button', { name: /Selesaikan Antrian/i }));
      await waitFor(() => expect(onDataBasi).toHaveBeenCalled());
      expect(toastMock).not.toHaveBeenCalledWith(expect.stringContaining('Pelayanan selesai'), 'success');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Audit T8: aksesibilitas wizard (label terhubung, dialog modal, Escape + konfirmasi, focus trap, role=alert)
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const dataDasar = (over: Record<string, unknown> = {}) => ({
    tiket_id: 't-401',
    legacy_visit_id: null,
    nomor_display: 'OS-001',
    layanan_id: 'l-oss',
    layanan_nama: 'Helpdesk OSS',
    form_type: 'oss',
    nama_pemohon: 'Rina',
    ...PROFIL_LENGKAP,
    status_tiket: 'dilayani',
    dilayani_oleh: 'p1',
    dilayani_oleh_nama: null,
    boleh_ubah: true,
    is_locked: false,
    status_draft: 'belum_diisi',
    data_oss: { ...DATA_OSS_LENGKAP },
    ...over,
  });
  const muat = (over: Record<string, unknown> = {}) =>
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => dataDasar(over) });
  const langkah = (n: 1 | 2 | 3) =>
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${n}\\.`) }));

  describe('aksesibilitas dialog (T8)', () => {
    it('role=dialog, aria-modal, dan nama dialog dari judul', async () => {
      muat();
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={vi.fn()} />);
      await screen.findByDisplayValue('Rina');
      const dialog = screen.getByRole('dialog', { name: /Pendataan Pelayanan — Helpdesk OSS/ });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it.each([
      ['oss', undefined],
      ['perizinan', 'Non OSS (SiCantik Lampung)'],
    ])('setiap field form %s (semua langkah) punya label terhubung dan nama aksesibel', async (formType, layananNama) => {
      muat({ form_type: formType, ...(layananNama ? { layanan_nama: layananNama } : {}) });
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={vi.fn()} />);
      await screen.findByDisplayValue('Rina');
      for (const n of [1, 2, 3] as const) {
        langkah(n);
        const dialog = screen.getByRole('dialog');
        const kontrol = Array.from(dialog.querySelectorAll('input, select, textarea')) as HTMLInputElement[];
        expect(kontrol.length).toBeGreaterThan(0);
        for (const k of kontrol) {
          expect(k.labels?.length, `langkah ${n}: ${k.outerHTML.slice(0, 80)}`).toBeGreaterThan(0);
          expect(k.id).not.toBe('');
        }
      }
    });

    it('label terhubung ke field yang tepat (getByLabelText)', async () => {
      muat();
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={vi.fn()} />);
      expect(await screen.findByLabelText('Nama Pemohon')).toHaveValue('Rina');
      expect(screen.getByLabelText(/Alamat Email/)).toHaveAttribute('type', 'email');
      langkah(2);
      expect(screen.getByLabelText('Nama Usaha / Merk Usaha')).toBeInTheDocument();
      expect(screen.getByLabelText(/Tipe Pelaku Usaha/).tagName).toBe('SELECT');
      langkah(3);
      expect(screen.getByLabelText('Uraian Solusi / Konsultasi')).toBeInTheDocument();
    });

    it('fokus awal masuk ke dalam dialog dan kembali ke tombol pemicu saat ditutup', async () => {
      muat();
      const { rerender } = render(
        <>
          <button type="button">Buka wizard</button>
          <PelayananWizardModal isOpen={false} tiketId={null} onClose={vi.fn()} />
        </>,
      );
      const pemicu = screen.getByRole('button', { name: 'Buka wizard' });
      pemicu.focus();
      rerender(
        <>
          <button type="button">Buka wizard</button>
          <PelayananWizardModal isOpen tiketId="t-401" onClose={vi.fn()} />
        </>,
      );
      const dialog = await screen.findByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);
      await screen.findByDisplayValue('Rina');
      rerender(
        <>
          <button type="button">Buka wizard</button>
          <PelayananWizardModal isOpen={false} tiketId={null} onClose={vi.fn()} />
        </>,
      );
      expect(pemicu).toHaveFocus();
    });

    it('focus trap: Tab dari elemen terakhir kembali ke pertama dan Shift+Tab dari pertama ke terakhir', async () => {
      muat();
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={vi.fn()} />);
      await screen.findByDisplayValue('Rina');
      const dialog = screen.getByRole('dialog');
      const fokusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'),
      );
      const pertama = fokusable[0];
      const terakhir = fokusable[fokusable.length - 1];
      terakhir.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(pertama).toHaveFocus();
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(terakhir).toHaveFocus();
    });
  });

  describe('Escape menutup dengan konfirmasi bila ada perubahan (T8)', () => {
    it('tanpa perubahan: Escape langsung menutup', async () => {
      muat();
      const onClose = vi.fn();
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={onClose} />);
      await screen.findByDisplayValue('Rina');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('ada perubahan belum tersimpan: Escape meminta konfirmasi (fokus ke "Lanjut mengisi"), tidak menutup', async () => {
      muat();
      const onClose = vi.fn();
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={onClose} />);
      fireEvent.change(await screen.findByLabelText('Nama Pemohon'), { target: { value: 'Rina S' } });
      fireEvent.keyDown(document, { key: 'Escape' });
      const konfirmasi = await screen.findByRole('alertdialog');
      expect(konfirmasi).toHaveAccessibleName('Tutup formulir?');
      expect(within(konfirmasi).getByRole('button', { name: 'Lanjut mengisi' })).toHaveFocus();
      expect(onClose).not.toHaveBeenCalled();

      // Escape lagi = kembali ke formulir (bukan menutup)
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Nama Pemohon')).toHaveValue('Rina S');
    });

    it('"Tutup tanpa menyimpan" menutup tanpa PATCH (autosave tertunda dibatalkan)', async () => {
      muat();
      const onClose = vi.fn();
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={onClose} />);
      fireEvent.change(await screen.findByLabelText('Nama Pemohon'), { target: { value: 'Rina S' } });
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.click(await screen.findByRole('button', { name: 'Tutup tanpa menyimpan' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      await new Promise((r) => setTimeout(r, 1200));
      expect(mockFetch.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')).toHaveLength(0);
    });

    it('"Simpan draf & tutup" menyimpan (PATCH) lalu menutup', async () => {
      muat();
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const onClose = vi.fn();
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={onClose} />);
      fireEvent.change(await screen.findByLabelText('Nama Pemohon'), { target: { value: 'Rina S' } });
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.click(await screen.findByRole('button', { name: /Simpan draf/ }));
      expect(onClose).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(mockFetch.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')).toBe(true),
      );
    });

    it('mode baca-saja: Escape langsung menutup', async () => {
      muat({ boleh_ubah: false, dilayani_oleh: 'p-lain', dilayani_oleh_nama: 'Petugas Dua' });
      const onClose = vi.fn();
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={onClose} />);
      await screen.findByDisplayValue('Rina');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('galat validasi role=alert dan terhubung ke field (T8)', () => {
    it('Selesaikan dengan field wajib kosong: galat role=alert, aria-invalid + aria-describedby, pindah ke langkah galat', async () => {
      muat({ nama_pemohon: '' });
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={vi.fn()} />);
      await screen.findByLabelText('Nama Pemohon');
      langkah(3);
      fireEvent.click(screen.getByRole('button', { name: /Selesaikan Antrian/i }));
      // Galat pertama ada di langkah 1 (nama pemohon): wizard pindah ke sana.
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Nama pemohon wajib diisi');
      const input = screen.getByLabelText('Nama Pemohon');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input.getAttribute('aria-describedby')).toBe(alert.id);
      expect(mockFetch).toHaveBeenCalledTimes(1); // hanya GET awal, tidak ada POST
    });
  });

  describe('Pendataan semua field wajib (C3, keputusan CEO G.5)', () => {
    const posts = () => mockFetch.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');

    it('semua field bertanda wajib (aria-required) di ketiga langkah OSS; tak ada "(Opsional)"', async () => {
      muat();
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={vi.fn()} />);
      await screen.findByLabelText('Nama Pemohon');
      for (const n of [1, 2, 3] as const) {
        langkah(n);
        const dialog = screen.getByRole('dialog');
        const kontrol = dialog.querySelectorAll('input:not([type=hidden]), select, textarea');
        expect(kontrol.length).toBeGreaterThan(0);
        kontrol.forEach((k) => expect(k).toHaveAttribute('aria-required', 'true'));
        expect(within(dialog).queryByText(/\(Opsional\)/i)).not.toBeInTheDocument();
      }
    });

    it('semua field wajib di langkah Perizinan juga', async () => {
      muat({ form_type: 'perizinan', layanan_nama: 'Non OSS (SiCantik Lampung)', data_oss: undefined, data_perizinan: { ...DATA_PERIZINAN_LENGKAP } });
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={vi.fn()} />);
      await screen.findByLabelText('Nama Pemohon');
      for (const n of [1, 2, 3] as const) {
        langkah(n);
        const dialog = screen.getByRole('dialog');
        dialog.querySelectorAll('input:not([type=hidden]), select, textarea').forEach((k) =>
          expect(k).toHaveAttribute('aria-required', 'true'),
        );
      }
    });

    it('field kosong di langkah 2 dan 3 ditolak: POST tidak dikirim, wizard pindah ke langkah galat pertama, pesan jelas', async () => {
      muat({ data_oss: { ...DATA_OSS_LENGKAP, lokasi_usaha: '', skala_usaha: '', catatan_internal: '' } });
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={vi.fn()} />);
      await screen.findByLabelText('Nama Pemohon');
      langkah(3);
      fireEvent.click(screen.getByRole('button', { name: /Selesaikan Antrian/i }));
      // galat pertama: lokasi usaha / skala usaha (langkah 2)
      const alerts = await screen.findAllByRole('alert');
      expect(alerts.map((a) => a.textContent).join(' ')).toMatch(/Lokasi usaha wajib diisi/);
      expect(alerts.map((a) => a.textContent).join(' ')).toMatch(/Skala usaha wajib dipilih/);
      expect(screen.getByLabelText(/Lokasi Usaha/)).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByLabelText(/Skala Usaha/)).toHaveAttribute('aria-invalid', 'true');
      expect(posts()).toHaveLength(0);
      // catatan internal (langkah 3) ikut ditandai
      langkah(3);
      expect(screen.getByRole('alert')).toHaveTextContent(/Catatan internal wajib diisi/);
      expect(posts()).toHaveLength(0);
    });

    it('tombol isian cepat mengisi "Belum ada" / "Tidak berlaku" / "-" sehingga field usaha yang tak ada dapat diselesaikan', async () => {
      muat({
        alamat_pemohon: '', no_hp: '', email: '', keperluan_awal: '',
        data_oss: { ...DATA_OSS_LENGKAP, nama_usaha: '', lokasi_usaha: '', sektor_usaha_kbli: '', tipe_pelaku_usaha: '', skala_usaha: '', catatan_internal: '' },
      });
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
      const onSuccess = vi.fn();
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={vi.fn()} onSuccess={onSuccess} />);
      await screen.findByLabelText('Nama Pemohon');

      // Langkah 1: Tidak berlaku untuk alamat, HP, email, keperluan
      langkah(1);
      for (const tombol of screen.getAllByRole('button', { name: 'Tidak berlaku' })) fireEvent.click(tombol);
      expect(screen.getByLabelText(/Alamat Email/)).toHaveValue('Tidak berlaku');
      expect(screen.getByLabelText('Asal Instansi / Alamat Domisili')).toHaveValue('Tidak berlaku');

      // Langkah 2: usaha belum ada; pilihan eksplisit "Tidak berlaku"
      langkah(2);
      fireEvent.click(within(screen.getByLabelText('Nama Usaha / Merk Usaha').closest('.form-group') as HTMLElement).getByRole('button', { name: 'Belum ada' }));
      fireEvent.click(within(screen.getByLabelText(/Lokasi Usaha/).closest('.form-group') as HTMLElement).getByRole('button', { name: 'Belum ada' }));
      fireEvent.click(within(screen.getByLabelText(/KBLI/).closest('.form-group') as HTMLElement).getByRole('button', { name: 'Tidak berlaku' }));
      fireEvent.change(screen.getByLabelText(/Tipe Pelaku Usaha/), { target: { value: 'tidak_berlaku' } });
      fireEvent.change(screen.getByLabelText(/Skala Usaha/), { target: { value: 'Tidak berlaku' } });
      expect(within(screen.getByLabelText(/Skala Usaha/)).getByRole('option', { name: 'Tidak berlaku' })).toBeInTheDocument();

      // Langkah 3: catatan "-"
      langkah(3);
      fireEvent.click(screen.getByRole('button', { name: 'Tidak ada catatan' }));
      expect(screen.getByLabelText(/Catatan Tambahan Internal/)).toHaveValue('-');
      fireEvent.click(screen.getByRole('button', { name: /Selesaikan Antrian/i }));

      await waitFor(() => expect(posts()).toHaveLength(1));
      const body = JSON.parse((posts()[0][1] as RequestInit).body as string);
      expect(body).toMatchObject({
        alamat_pemohon: 'Tidak berlaku', no_hp: 'Tidak berlaku', email: 'Tidak berlaku', keperluan_awal: 'Tidak berlaku',
        nama_usaha: 'Belum ada', lokasi_usaha: 'Belum ada', sektor_usaha_kbli: 'Tidak berlaku',
        tipe_pelaku_usaha: 'tidak_berlaku', skala_usaha: 'Tidak berlaku', catatan_internal: '-',
      });
      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    });

    it('tanpa isian cepat saat baca-saja (tidak ada tombol, tidak ada petunjuk wajib)', async () => {
      muat({ boleh_ubah: false });
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={vi.fn()} />);
      await screen.findByLabelText('Nama Pemohon');
      expect(screen.queryByRole('button', { name: 'Tidak berlaku' })).not.toBeInTheDocument();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Tiket hasil eskalasi FO: cukup Pendataan (keputusan CEO 2026-10-15, migrasi 202610140015). Tidak ada lagi isian
  // topik / catatan penanganan; DB mengisi topik NULL dan menurunkan catatan dari Pendataan.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  describe('tiket hasil eskalasi FO (tanpa topik/catatan)', () => {
    const dataEskalasi = (over: Record<string, unknown> = {}) => ({
      dari_eskalasi: true,
      data_oss: { ...DATA_OSS_LENGKAP },
      ...over,
    });
    const posts = () => mockFetch.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');

    it('langkah 3 tanpa topik/catatan penanganan; POST hanya isi Pendataan; sukses menutup dan memanggil onSuccess', async () => {
      muat(dataEskalasi());
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
      const onSuccess = vi.fn();
      const onClose = vi.fn();
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={onClose} onSuccess={onSuccess} />);
      await screen.findByDisplayValue('Rina');
      langkah(3);
      expect(screen.queryByRole('group', { name: /eskalasi/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Topik penanganan/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Catatan penanganan/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Selesaikan Antrian/i }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      const body = JSON.parse((posts()[0][1] as RequestInit).body as string);
      expect(body).toMatchObject({ nama_usaha: 'Toko Rina', uraian_solusi: 'NIB dibantu terbit.' });
      expect(body).not.toHaveProperty('topik_id');
      expect(body).not.toHaveProperty('catatan_penanganan');
      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
      expect(onClose).toHaveBeenCalled();
    });

    it('tombol Selesaikan dikunci selama request (tidak ada POST ganda)', async () => {
      muat(dataEskalasi());
      let selesai: (v: unknown) => void = () => {};
      mockFetch.mockReturnValueOnce(new Promise((r) => { selesai = r; }));
      render(<PelayananWizardModal isOpen tiketId="t-401" onClose={vi.fn()} />);
      await screen.findByDisplayValue('Rina');
      langkah(3);
      const tombol = screen.getByRole('button', { name: /Selesaikan Antrian/i });
      fireEvent.click(tombol);
      const sibuk = await screen.findByRole('button', { name: /Menyelesaikan/i });
      expect(sibuk).toBeDisabled();
      expect(sibuk).toHaveAttribute('aria-busy', 'true');
      fireEvent.click(sibuk);
      expect(posts()).toHaveLength(1);
      selesai({ ok: true, status: 200, json: async () => ({ ok: true }) });
      await waitFor(() => expect(screen.queryByRole('button', { name: /Menyelesaikan/i })).not.toBeInTheDocument());
    });
  });
});
