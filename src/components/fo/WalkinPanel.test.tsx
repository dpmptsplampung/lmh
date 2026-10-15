// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { pushMock, enqueueMock, syncMock, rpcMock, createClientMock, kunjunganMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  enqueueMock: vi.fn(),
  syncMock: vi.fn(),
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
  kunjunganMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, replace: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: createClientMock }));
vi.mock('@/lib/offline/queue', () => ({ enqueueAction: enqueueMock }));
vi.mock('@/lib/offline/sync', () => ({ daftarkanSyncOffline: syncMock }));

import WalkinPanel from './WalkinPanel';

const UUID_LAYANAN = '33333333-3333-4333-8333-333333333333';
const sukses = {
  data: { ok: true, sudah_ada: false, kunjungan_id: 'k-1', penanganan_id: 'p-1', qr_token: 'qr', mulai_at: '2026-10-13T01:00:00Z' },
  error: null,
};
const galat = (kode: string, code = 'P0001') => ({ data: null, error: { message: `${kode}: detail`, code } });

function setOnline(nilai: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value: nilai, configurable: true });
}

/** Rantai query `kunjungan`: mencatat `select` lalu menyerahkan hasil ke kunjunganMock(kolom, panggilan). */
function rantaiKunjungan() {
  const panggilan: Array<[string, unknown[]]> = [];
  const r: Record<string, unknown> = {};
  for (const m of ['select', 'in', 'eq', 'not', 'order', 'limit']) {
    r[m] = (...args: unknown[]) => {
      panggilan.push([m, args]);
      return r;
    };
  }
  r.then = (ok: (v: unknown) => unknown, tolak: (e: unknown) => unknown) => {
    try {
      const kolom = String(panggilan.find(([m]) => m === 'select')?.[1][0] ?? '');
      return Promise.resolve(kunjunganMock(kolom, panggilan)).then(ok, tolak);
    } catch (e) {
      return Promise.reject(e).then(ok, tolak);
    }
  };
  return r;
}

async function renderHalaman() {
  render(<WalkinPanel />);
  await screen.findByLabelText(/Nama Lengkap/);
  // tunggu daftar layanan dimuat
  await screen.findByRole('option', { name: 'Helpdesk OSS' });
}

const field = (label: RegExp | string) => screen.getByLabelText(label);
const isi = (label: RegExp | string, nilai: string) => fireEvent.change(field(label), { target: { value: nilai } });
const blur = (label: RegExp | string) => fireEvent.blur(field(label));
const kirim = () => fireEvent.click(screen.getByRole('button', { name: /Daftarkan & Mulai Layani/ }));
const isiLengkap = (ubah: Partial<Record<string, string>> = {}) => {
  const nilai = {
    nama: 'Budi Santoso',
    asal: 'PT Maju',
    kategori: 'UMKM',
    hp: '0812 3456-7890',
    email: 'budi@gmail.com',
    layanan: 'belum_tahu',
    keperluan: 'Mengurus NIB usaha kuliner',
    ...ubah,
  };
  isi(/Nama Lengkap/, nilai.nama);
  isi(/Asal \/ Instansi/, nilai.asal);
  isi(/Kategori Pengunjung/, nilai.kategori);
  isi(/Nomor HP/, nilai.hp);
  isi(/^Email/, nilai.email);
  isi(/Layanan Saran/, nilai.layanan);
  isi('Keperluan', nilai.keperluan);
};

describe('Panel Walk-in (/admin/fo/registrasi?tab=walkin, pendaftaran walk-in oleh FO)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOnline(true);
    rpcMock.mockResolvedValue(sukses);
    enqueueMock.mockResolvedValue('q-1');
    syncMock.mockResolvedValue(true);
    kunjunganMock.mockResolvedValue({ data: [], error: null });
    Element.prototype.scrollIntoView = vi.fn();
    const layanan = {
      select: vi.fn(() => layanan),
      eq: vi.fn(() => layanan),
      order: vi.fn(async () => ({ data: [{ id: UUID_LAYANAN, nama: 'Helpdesk OSS' }], error: null })),
    };
    createClientMock.mockReturnValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'fo-user-1' } } } }) },
      from: vi.fn((tabel: string) => (tabel === 'layanan' ? layanan : rantaiKunjungan())),
      rpc: rpcMock,
    });
  });

  afterEach(() => {
    cleanup();
    setOnline(true);
  });

  describe('struktur dan kemudahan', () => {
    it('semua kolom berlabel, dikelompokkan dalam bagian bernama, dan fokus awal di Nama', async () => {
      await renderHalaman();
      for (const label of [/Nama Lengkap/, /Asal \/ Instansi/, /Kategori Pengunjung/, /Nomor HP/, /Layanan Saran/, 'Keperluan']) {
        expect(field(label)).toBeRequired();
      }
      // email opsional sejak 202610140015
      expect(field(/^Email/)).not.toBeRequired();
      for (const nama of ['Data Pengunjung', 'Kontak', /Keperluan & Tujuan/]) {
        expect(screen.getByRole('region', { name: nama })).toBeInTheDocument();
      }
      expect(field(/Nama Lengkap/)).toHaveFocus();
      expect(screen.getByRole('button', { name: /Daftarkan & Mulai Layani/ })).toBeEnabled();
    });

    it('layanan saran memuat opsi eksplisit "Belum tahu" selain daftar layanan', async () => {
      await renderHalaman();
      const select = field(/Layanan Saran/) as HTMLSelectElement;
      const opsi = within(select).getAllByRole('option').map((o) => o.textContent);
      expect(opsi).toContain('Belum tahu — ditentukan saat eskalasi');
      expect(opsi).toContain('Helpdesk OSS');
      expect(select.value).toBe(''); // belum memilih = belum valid
    });

    it('datalist asal/instansi diisi dari kunjungan terdahulu', async () => {
      kunjunganMock.mockImplementation(async (kolom: string) =>
        kolom === 'asal_instansi' ? { data: [{ asal_instansi: 'PT Maju' }, { asal_instansi: 'Dinas Kominfo' }], error: null } : { data: [], error: null },
      );
      await renderHalaman();
      await waitFor(() => expect(document.querySelectorAll('#fo-asal-saran option')).toHaveLength(2));
      expect(field(/Asal \/ Instansi/)).toHaveAttribute('list', 'fo-asal-saran');
    });

    it('Enter di isian teks pindah ke isian berikutnya (tidak mengirim formulir)', async () => {
      await renderHalaman();
      fireEvent.keyDown(field(/Nama Lengkap/), { key: 'Enter' });
      expect(field(/Asal \/ Instansi/)).toHaveFocus();
      fireEvent.keyDown(field(/Nomor HP/), { key: 'Enter' });
      expect(field(/^Email/)).toHaveFocus();
      expect(rpcMock).not.toHaveBeenCalled();
    });
  });

  describe('validasi per isian (saat blur, bukan sebelum disentuh)', () => {
    it('belum disentuh: tanpa galat; setelah blur kosong: galat + aria-invalid + terhubung aria-describedby', async () => {
      await renderHalaman();
      expect(field(/Nama Lengkap/)).not.toHaveAttribute('aria-invalid');
      expect(screen.queryByText(/Nama wajib diisi/)).toBeNull();

      blur(/Nama Lengkap/);
      expect(await screen.findByText('Nama wajib diisi.')).toBeInTheDocument();
      expect(field(/Nama Lengkap/)).toHaveAttribute('aria-invalid', 'true');
      expect(field(/Nama Lengkap/).getAttribute('aria-describedby')).toContain('fo-nama-galat');
      // isian lain tetap bersih
      expect(field(/Asal \/ Instansi/)).not.toHaveAttribute('aria-invalid');
    });

    it('nama: tidak boleh berisi angka; semua kapital/kecil dirapikan saat blur', async () => {
      await renderHalaman();
      isi(/Nama Lengkap/, 'Budi 2');
      blur(/Nama Lengkap/);
      expect(await screen.findByText('Nama tidak boleh berisi angka.')).toBeInTheDocument();

      isi(/Nama Lengkap/, '  BUDI   SANTOSO ');
      blur(/Nama Lengkap/);
      expect(field(/Nama Lengkap/)).toHaveValue('Budi Santoso');
      expect(screen.queryByText(/tidak boleh berisi angka/)).toBeNull();
    });

    it('nama campuran (gelar) tidak dirusak', async () => {
      await renderHalaman();
      isi(/Nama Lengkap/, 'Dr. Ir. Budi, M.Si');
      blur(/Nama Lengkap/);
      expect(field(/Nama Lengkap/)).toHaveValue('Dr. Ir. Budi, M.Si');
    });

    it('HP: dinormalkan lalu ditampilkan rapi; nomor telepon rumah ditolak dengan pesan jelas', async () => {
      await renderHalaman();
      isi(/Nomor HP/, '+62 812-3456-7890');
      blur(/Nomor HP/);
      expect(field(/Nomor HP/)).toHaveValue('0812-3456-7890');
      expect(field(/Nomor HP/)).not.toHaveAttribute('aria-invalid');

      isi(/Nomor HP/, '(0721) 481-234');
      blur(/Nomor HP/);
      expect(await screen.findByText(/telepon rumah/)).toBeInTheDocument();
      expect(field(/Nomor HP/)).toHaveAttribute('aria-invalid', 'true');
      expect(field(/Nomor HP/)).toHaveValue('(0721) 481-234'); // tidak diubah paksa

      isi(/Nomor HP/, '12345');
      expect(await screen.findByText(/diawali 08 atau \+62 8/)).toBeInTheDocument();
    });

    it('email: saran koreksi salah ketik domain ("Maksud Anda ...?") dengan tombol terima, tanpa memblokir', async () => {
      await renderHalaman();
      isi(/^Email/, 'Budi@Gmial.com');
      blur(/^Email/);
      expect(field(/^Email/)).toHaveValue('budi@gmial.com'); // dinormalkan huruf kecil
      expect(field(/^Email/)).not.toHaveAttribute('aria-invalid'); // domain berbentuk sah: tidak diblokir
      expect(await screen.findByText(/Maksud Anda/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Pakai budi@gmail.com' }));
      expect(field(/^Email/)).toHaveValue('budi@gmail.com');
      expect(screen.queryByText(/Maksud Anda/)).toBeNull();
    });

    it('email: format salah dan domain placeholder ditolak', async () => {
      await renderHalaman();
      isi(/^Email/, 'bukan-email');
      blur(/^Email/);
      expect(await screen.findByText(/satu tanda @/)).toBeInTheDocument();
      isi(/^Email/, 'budi@contoh.com');
      expect(await screen.findByText(/placeholder/)).toBeInTheDocument();
    });

    it('keperluan: penghitung karakter dan minimal 10 karakter', async () => {
      await renderHalaman();
      isi('Keperluan', 'Urus NIB');
      expect(screen.getByText(/8\/500/)).toHaveTextContent('kurang 2 karakter');
      blur('Keperluan');
      expect(await screen.findByText(/terlalu singkat/)).toBeInTheDocument();
      isi('Keperluan', 'Urus NIB usaha');
      expect(screen.queryByText(/terlalu singkat/)).toBeNull();
    });
  });

  describe('kirim: ringkasan galat dan fokus', () => {
    it('semua kosong: ringkasan 6 isian (email opsional), fokus ke galat pertama, rpc tidak dipanggil', async () => {
      await renderHalaman();
      fireEvent.change(field(/Nama Lengkap/), { target: { value: '' } });
      screen.getByLabelText(/Kategori Pengunjung/).focus(); // pindahkan fokus agar terlihat berpindah kembali
      kirim();

      expect(await screen.findByRole('alert')).toHaveTextContent(/Lengkapi 6 isian/);
      expect(field(/Nama Lengkap/)).toHaveAttribute('aria-invalid', 'true');
      expect(field(/Asal \/ Instansi/)).toHaveAttribute('aria-invalid', 'true');
      expect(field(/Nomor HP/)).toHaveAttribute('aria-invalid', 'true');
      expect(field(/Layanan Saran/)).toHaveAttribute('aria-invalid', 'true');
      expect(field(/Nama Lengkap/)).toHaveFocus();
      expect(rpcMock).not.toHaveBeenCalled();
      // daftar ringkasan memuat tautan per isian yang memindahkan fokus
      fireEvent.click(screen.getByRole('button', { name: 'Nomor HP' }));
      expect(field(/Nomor HP/)).toHaveFocus();
    });

    it('hanya satu isian salah: fokus ke isian itu', async () => {
      await renderHalaman();
      isiLengkap({ hp: '0721481234' });
      kirim();
      expect(await screen.findByRole('alert')).toHaveTextContent(/Lengkapi 1 isian/);
      expect(field(/Nomor HP/)).toHaveFocus();
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it('layanan saran wajib: tanpa pilihan tidak terkirim', async () => {
      await renderHalaman();
      isiLengkap({ layanan: '' });
      kirim();
      expect(await screen.findAllByText(/Pilih layanan saran, atau/)).not.toHaveLength(0);
      expect(field(/Layanan Saran/)).toHaveFocus();
      expect(rpcMock).not.toHaveBeenCalled();
    });
  });

  describe('pengunjung yang pernah datang', () => {
    const lama = {
      nama: 'Siti Aminah',
      asal_instansi: 'CV Sentosa',
      kategori: 'Investor',
      email: 'siti@yahoo.com',
      kontak_hp: '081234567890',
      tanggal: '2026-09-01',
    };

    it('banner muncul setelah HP valid (debounce) dan "Isi otomatis" mengisi nama, asal, kategori, email', async () => {
      kunjunganMock.mockImplementation(async (kolom: string) =>
        kolom.includes('kontak_hp') ? { data: [lama], error: null } : { data: [], error: null },
      );
      await renderHalaman();
      isi(/Nomor HP/, '0812-3456-7890');

      expect(await screen.findByText(/Pernah berkunjung sebagai/, {}, { timeout: 3000 })).toHaveTextContent('Siti Aminah');
      expect(screen.getByText(/Pernah berkunjung sebagai/)).toHaveTextContent('CV Sentosa');
      // pencarian memakai HP kanonik
      const pencarian = kunjunganMock.mock.calls.find(([kolom]) => String(kolom).includes('kontak_hp'));
      expect(pencarian?.[1]).toContainEqual(['in', ['kontak_hp', ['081234567890', '6281234567890', '+6281234567890']]]);

      fireEvent.click(screen.getByRole('button', { name: 'Isi otomatis' }));
      expect(field(/Nama Lengkap/)).toHaveValue('Siti Aminah');
      expect(field(/Asal \/ Instansi/)).toHaveValue('CV Sentosa');
      expect(field(/Kategori Pengunjung/)).toHaveValue('Investor');
      expect(field(/^Email/)).toHaveValue('siti@yahoo.com');
      expect(screen.queryByText(/Pernah berkunjung sebagai/)).toBeNull();
      // FO tetap bisa mengubah
      isi(/Asal \/ Instansi/, 'CV Sentosa Abadi');
      expect(field(/Asal \/ Instansi/)).toHaveValue('CV Sentosa Abadi');
    });

    it('"Abaikan" menutup banner dan tidak mengubah isian', async () => {
      kunjunganMock.mockResolvedValue({ data: [lama], error: null });
      await renderHalaman();
      isi(/^Email/, 'siti@yahoo.com');
      await screen.findByText(/Pernah berkunjung sebagai/, {}, { timeout: 3000 });
      fireEvent.click(screen.getByRole('button', { name: 'Abaikan' }));
      expect(screen.queryByText(/Pernah berkunjung sebagai/)).toBeNull();
      expect(field(/Nama Lengkap/)).toHaveValue('');
    });

    it('kunjungan hari ini memberi peringatan pendaftaran ganda', async () => {
      const hariIni = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      kunjunganMock.mockResolvedValue({ data: [{ ...lama, tanggal: hariIni }], error: null });
      await renderHalaman();
      isi(/Nomor HP/, '081234567890');
      expect(await screen.findByText(/pendaftaran ganda/, {}, { timeout: 3000 })).toBeInTheDocument();
    });

    it('pencarian gagal: diam-diam, tanpa banner dan tanpa galat', async () => {
      kunjunganMock.mockRejectedValue(new Error('jaringan'));
      await renderHalaman();
      isi(/Nomor HP/, '081234567890');
      await waitFor(() => expect(kunjunganMock.mock.calls.some(([k]) => String(k).includes('kontak_hp'))).toBe(true), { timeout: 3000 });
      expect(screen.queryByText(/Pernah berkunjung sebagai/)).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('HP belum valid: tidak mencari', async () => {
      await renderHalaman();
      isi(/Nomor HP/, '0812');
      await new Promise((r) => setTimeout(r, 500));
      expect(kunjunganMock.mock.calls.some(([k]) => String(k).includes('kontak_hp'))).toBe(false);
    });
  });

  describe('kirim', () => {
    it('sukses: memanggil rpc fo_mulai_kunjungan dengan nilai kanonik lalu menuju /admin/fo/penanganan', async () => {
      await renderHalaman();
      isiLengkap({ nama: 'BUDI SANTOSO', hp: '+62 812-3456-7890', email: ' Budi@Gmail.com ', layanan: UUID_LAYANAN, keperluan: '  Urus NIB usaha  ' });
      kirim();

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/fo/penanganan'));
      expect(rpcMock).toHaveBeenCalledTimes(1);
      const [nama, args] = rpcMock.mock.calls[0];
      expect(nama).toBe('fo_mulai_kunjungan');
      expect(args).toMatchObject({
        p_nama: 'Budi Santoso',
        p_asal_instansi: 'PT Maju',
        p_kontak_hp: '081234567890',
        p_kategori: 'UMKM',
        p_email: 'budi@gmail.com',
        p_keperluan: 'Urus NIB usaha',
        p_layanan_saran_id: UUID_LAYANAN,
      });
      expect(args.p_client_request_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(enqueueMock).not.toHaveBeenCalled();
    });

    it('"Belum tahu" dikirim sebagai p_layanan_saran_id null', async () => {
      await renderHalaman();
      isiLengkap({ layanan: 'belum_tahu' });
      kirim();
      await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
      expect(rpcMock.mock.calls[0][1].p_layanan_saran_id).toBeNull();
    });

    it('tombol dikunci selama request dan klik ganda hanya mengirim sekali', async () => {
      let selesai!: (v: unknown) => void;
      rpcMock.mockReturnValue(new Promise((r) => { selesai = r; }));
      await renderHalaman();
      isiLengkap();
      const tombol = screen.getByRole('button', { name: /Daftarkan & Mulai Layani/ });
      fireEvent.click(tombol);
      fireEvent.click(tombol);

      await waitFor(() => expect(screen.getByRole('button', { name: /Menyimpan/ })).toBeDisabled());
      expect(rpcMock).toHaveBeenCalledTimes(1);

      selesai(sukses);
      await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    });

    describe('idempotensi client_request_id', () => {
      it('retry dengan data SAMA memakai id yang sama; data diubah -> id baru; sukses -> id baru untuk kunjungan berikutnya', async () => {
        rpcMock.mockResolvedValueOnce(galat('ANEH', 'XX000')).mockResolvedValueOnce(galat('ANEH', 'XX000'));
        await renderHalaman();
        isiLengkap();
        kirim();
        await screen.findByText(/Gagal menyimpan kunjungan/);
        kirim();
        await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(2));
        await screen.findByText(/Gagal menyimpan kunjungan/);
        const id1 = rpcMock.mock.calls[0][1].p_client_request_id;
        expect(rpcMock.mock.calls[1][1].p_client_request_id).toBe(id1);

        isi(/Asal \/ Instansi/, 'PT Berubah');
        kirim();
        await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
        const id3 = rpcMock.mock.calls[2][1].p_client_request_id;
        expect(id3).not.toBe(id1);

        // Kunjungan berikutnya (form direset setelah sukses) = id lagi berbeda
        isiLengkap();
        kirim();
        await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(4));
        expect(rpcMock.mock.calls[3][1].p_client_request_id).not.toBe(id3);
      });

      it("'sudah_ada: true' dari server dianggap sukses", async () => {
        rpcMock.mockResolvedValue({ data: { ...sukses.data, sudah_ada: true }, error: null });
        await renderHalaman();
        isiLengkap();
        kirim();
        await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/fo/penanganan'));
      });
    });

    describe('pemetaan galat server (tidak pernah sukses palsu)', () => {
      it.each([
        ['LAYANAN_TUTUP', /sudah tutup/],
        ['DATA_TIDAK_VALID', /Data ditolak server/],
        ['LAYANAN_TIDAK_VALID', /Layanan saran tidak valid/],
        ['IDEMPOTENSI_BENTROK', /bentrok/],
        ['FORBIDDEN', /tidak berwenang/],
      ])('%s', async (kode, pola) => {
        rpcMock.mockResolvedValue(galat(kode));
        await renderHalaman();
        isiLengkap();
        kirim();

        expect(await screen.findByRole('alert')).toHaveTextContent(pola);
        expect(pushMock).not.toHaveBeenCalled();
        expect(enqueueMock).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /Daftarkan & Mulai Layani/ })).toBeEnabled();
        // Isian dipertahankan agar FO tidak mengetik ulang
        expect(field(/Nama Lengkap/)).toHaveValue('Budi Santoso');
      });

      it('galat server tampil di dekat tombol kirim, di-scroll ke layar, dan difokuskan', async () => {
        rpcMock.mockResolvedValue(galat('LAYANAN_TUTUP'));
        await renderHalaman();
        isiLengkap();
        kirim();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveFocus();
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
        // di dalam formulir, SEBELUM tombol kirim (bukan di atas halaman)
        const tombol = screen.getByRole('button', { name: /Daftarkan & Mulai Layani/ });
        expect(alert.compareDocumentPosition(tombol) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(alert.closest('form')).not.toBeNull();
      });

      it('galat per isian dari server (error.details): isian ditandai, diberi pesan, dan difokuskan; alert tetap di dekat tombol', async () => {
        rpcMock.mockResolvedValue({
          data: null,
          error: { message: 'DATA_TIDAK_VALID: email wajib dengan format valid', details: 'email', code: '22023' },
        });
        await renderHalaman();
        isiLengkap();
        kirim();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/Isian Email ditolak server/);
        expect(field(/^Email/)).toHaveAttribute('aria-invalid', 'true');
        expect(field(/^Email/)).toHaveFocus();
        expect(screen.getAllByText(/Ditolak server: Email wajib/).length).toBeGreaterThan(0);
        expect(field(/Nama Lengkap/)).not.toHaveAttribute('aria-invalid');
        // tanda hilang saat isian itu diubah
        isi(/^Email/, 'budi2@gmail.com');
        expect(field(/^Email/)).not.toHaveAttribute('aria-invalid');
      });

      it('SESI_TIDAK_SAH menampilkan tautan masuk kembali', async () => {
        rpcMock.mockResolvedValue(galat('SESI_TIDAK_SAH', '42501'));
        await renderHalaman();
        isiLengkap();
        kirim();
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/Sesi Anda sudah berakhir/);
        expect(screen.getByRole('link', { name: /Masuk kembali/ })).toHaveAttribute('href', expect.stringContaining('/login'));
      });
    });

    describe('offline (antrean khusus FO, idempoten)', () => {
      it('saat offline: disimpan ke antrean dengan owner = FO yang masuk, rpc tidak dipanggil, FO diberi tahu', async () => {
        setOnline(false);
        await renderHalaman();
        isiLengkap();
        kirim();

        expect(await screen.findByText(/disimpan di perangkat ini/)).toBeInTheDocument();
        expect(rpcMock).not.toHaveBeenCalled();
        expect(enqueueMock).toHaveBeenCalledTimes(1);
        const aksi = enqueueMock.mock.calls[0][0];
        expect(aksi.type).toBe('fo_walkin');
        expect(aksi.owner_user_id).toBe('fo-user-1');
        expect(aksi.payload).toMatchObject({
          p_nama: 'Budi Santoso',
          p_asal_instansi: 'PT Maju',
          p_kontak_hp: '081234567890',
          p_email: 'budi@gmail.com',
          p_kategori: 'UMKM',
          p_keperluan: 'Mengurus NIB usaha kuliner',
          p_layanan_saran_id: null,
        });
        expect(aksi.payload.p_client_request_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(syncMock).toHaveBeenCalled();
        expect(pushMock).not.toHaveBeenCalled();
        expect(field(/Nama Lengkap/)).toHaveValue(''); // siap pengunjung berikutnya
      });

      it('validasi yang sama berlaku sebelum mengantre: data tidak lengkap tidak masuk antrean', async () => {
        setOnline(false);
        await renderHalaman();
        isiLengkap({ hp: '0721481234' });
        kirim();
        expect(await screen.findByRole('alert')).toHaveTextContent(/Lengkapi 1 isian/);
        expect(enqueueMock).not.toHaveBeenCalled();
        expect(rpcMock).not.toHaveBeenCalled();
      });

      it('koneksi putus saat mengirim: antrean memakai client_request_id YANG SAMA dengan percobaan online', async () => {
        rpcMock.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
        await renderHalaman();
        isiLengkap();
        kirim();

        expect(await screen.findByText(/disimpan di perangkat ini/)).toBeInTheDocument();
        expect(enqueueMock.mock.calls[0][0].payload.p_client_request_id).toBe(rpcMock.mock.calls[0][1].p_client_request_id);
      });

      it('antrean gagal disimpan (mis. IndexedDB tidak tersedia): pesan koneksi, tidak diam-diam hilang', async () => {
        setOnline(false);
        enqueueMock.mockRejectedValue(new Error('IndexedDB unavailable'));
        await renderHalaman();
        isiLengkap();
        kirim();
        expect(await screen.findByRole('alert')).toHaveTextContent(/Koneksi bermasalah/);
        expect(screen.queryByText(/disimpan di perangkat ini/)).toBeNull();
        expect(field(/Nama Lengkap/)).toHaveValue('Budi Santoso');
      });
    });
  });
});
