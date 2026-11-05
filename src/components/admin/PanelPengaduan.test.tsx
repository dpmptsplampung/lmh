// @vitest-environment jsdom
// Panel rincian pengaduan: penangan (Tangani, Ambil alih dengan alasan), linimasa, dan SATU formulir tanggapan + status.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import PanelPengaduan from './PanelPengaduan';
import type { PengaduanKerja } from '@/lib/pengaduan/tampilan';

vi.mock('@/lib/storage/unggah', () => ({ unggahKeR2: vi.fn() }));

const dasar: PengaduanKerja = {
  id: 'p-1', nomor_tiket: 'PGD-001', jalur: 'layanan', layanan_id: 'l1', layanan_nama: 'Helpdesk OSS', status: 'baru', anonim: false,
  created_at: '2026-10-01T05:30:00Z', isi: 'Loket lambat', pelapor_nama: 'Sari', bisa_dihubungi: true, batas_aktif: '2026-10-05',
  sisa_hari_kerja: 1, sla_status: 'mendekati', terbuka: true, penangan_id: null, penangan_nama: null, penangan_sejak: null,
};

type Balas = { status: number; body: unknown };
function pasangFetch(peta: Record<string, Balas | ((init?: RequestInit) => Balas)> = {}) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const kunci = `${init?.method ?? 'GET'} ${url}`;
    const b = peta[kunci];
    const hasil: Balas = typeof b === 'function' ? b(init) : b ?? (url.endsWith('/linimasa') ? { status: 200, body: { entri: [] } } : { status: 200, body: { ok: true } });
    return Promise.resolve({ ok: hasil.status < 400, status: hasil.status, json: () => Promise.resolve(hasil.body) });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const kirimKe = (fn: ReturnType<typeof vi.fn>, kunci: string) =>
  fn.mock.calls.filter((c) => `${c[1]?.method ?? 'GET'} ${c[0]}` === kunci);

function tampil(row: Partial<PengaduanKerja> = {}, o: { mode?: 'tinjau' | 'baca'; saya?: string | null; fitur?: boolean } = {}) {
  const onBerubah = vi.fn();
  const onToast = vi.fn();
  render(
    <PanelPengaduan row={{ ...dasar, ...row }} mode={o.mode ?? 'tinjau'} sayaId={o.saya === undefined ? 'saya' : o.saya} fiturKerja={o.fitur !== false} onClose={vi.fn()} onBerubah={onBerubah} onToast={onToast} />,
  );
  return { onBerubah, onToast };
}

describe('PanelPengaduan', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(cleanup);

  describe('penangan', () => {
    it('belum ada penangan: Tangani memanggil rute dan memuat ulang', async () => {
      const f = pasangFetch();
      const { onBerubah, onToast } = tampil();
      fireEvent.click(await screen.findByRole('button', { name: 'Tangani' }));
      await waitFor(() => expect(kirimKe(f, 'POST /api/admin/pengaduan/p-1/tangani')).toHaveLength(1));
      await waitFor(() => expect(onBerubah).toHaveBeenCalled());
      expect(onToast).toHaveBeenCalledWith('Anda sekarang menangani pengaduan ini', 'success');
    });

    it('ditangani orang lain: tombol Ambil alih meminta alasan minimal 5 karakter, lalu mengirim alasan', async () => {
      const f = pasangFetch();
      const { onBerubah } = tampil({ penangan_id: 'lain', penangan_nama: 'Budi', penangan_sejak: '2026-10-02T01:00:00Z' });
      expect(screen.getByText(/Ditangani Budi/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Ambil alih/ }));
      const alasan = screen.getByLabelText('Alasan mengambil alih');
      fireEvent.change(alasan, { target: { value: 'abc' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Ambil alih' }).at(-1) as HTMLElement);
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(kirimKe(f, 'POST /api/admin/pengaduan/p-1/ambil-alih')).toHaveLength(0);
      fireEvent.change(alasan, { target: { value: ' Budi sedang cuti ' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Ambil alih' }).at(-1) as HTMLElement);
      await waitFor(() => expect(kirimKe(f, 'POST /api/admin/pengaduan/p-1/ambil-alih')).toHaveLength(1));
      expect(JSON.parse(String(kirimKe(f, 'POST /api/admin/pengaduan/p-1/ambil-alih')[0][1]?.body))).toEqual({ alasan: 'Budi sedang cuti' });
      await waitFor(() => expect(onBerubah).toHaveBeenCalled());
    });

    it('penangan adalah saya: tanpa tombol Ambil alih dan Tangani', async () => {
      pasangFetch();
      tampil({ penangan_id: 'saya', penangan_nama: 'Sari' });
      expect(screen.getByText(/Anda yang menangani/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Ambil alih/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Tangani' })).toBeNull();
    });

    it('pengaduan sudah ditutup: tanpa Tangani dan Ambil alih', async () => {
      pasangFetch();
      tampil({ status: 'selesai', terbuka: false, batas_aktif: null, sla_status: null, sisa_hari_kerja: null, penangan_id: 'lain', penangan_nama: 'Budi' });
      expect(screen.queryByRole('button', { name: /Ambil alih/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Tangani' })).toBeNull();
    });

    it('fitur kerja belum aktif: bagian penangan tidak tampil', async () => {
      pasangFetch();
      tampil({}, { fitur: false });
      expect(screen.queryByRole('region', { name: 'Penangan' })).toBeNull();
    });

    it('ambil alih gagal karena 403: pesan galat lewat toast', async () => {
      pasangFetch({ 'POST /api/admin/pengaduan/p-1/ambil-alih': { status: 403, body: { error: 'Forbidden' } } });
      const { onToast } = tampil({ penangan_id: 'lain', penangan_nama: 'Budi' });
      fireEvent.click(screen.getByRole('button', { name: /Ambil alih/ }));
      fireEvent.change(screen.getByLabelText('Alasan mengambil alih'), { target: { value: 'alasan sah' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Ambil alih' }).at(-1) as HTMLElement);
      await waitFor(() => expect(onToast).toHaveBeenCalledWith('Forbidden', 'error'));
    });
  });

  describe('linimasa', () => {
    it('menampilkan status, tanggapan, dan penangan berurutan', async () => {
      pasangFetch({ 'GET /api/admin/pengaduan/p-1/linimasa': { status: 200, body: { entri: [
        { jenis: 'status', waktu: '2026-10-01T05:30:00Z', status_baru: 'baru' },
        { jenis: 'penangan', waktu: '2026-10-01T06:00:00Z', aksi: 'ambil_alih', oleh_nama: 'Sari', dari_nama: 'Budi', alasan: 'cuti' },
        { jenis: 'tanggapan', waktu: '2026-10-01T07:00:00Z', oleh_nama: 'Sari', isi: 'Sudah kami cek', status_baru: 'diproses', lampiran: [{ nama: 'bukti.pdf' }] },
      ] } } });
      tampil();
      expect(await screen.findByText(/Sari mengambil alih dari Budi\. Alasan: cuti/)).toBeTruthy();
      expect(screen.getByText('Sudah kami cek')).toBeTruthy();
      expect(screen.getByText(/Lampiran: bukti\.pdf/)).toBeTruthy();
      expect(screen.getByText(/Tanggapan dari Sari, status menjadi Diproses/)).toBeTruthy();
    });

    it('migrasi belum diterapkan (409): pesan jelas, bukan galat', async () => {
      pasangFetch({ 'GET /api/admin/pengaduan/p-1/linimasa': { status: 409, body: { error: 'x', kode: 'MIGRASI_BELUM_DITERAPKAN' } } });
      tampil();
      expect(await screen.findByText(/Riwayat lengkap belum aktif/)).toBeTruthy();
    });

    it('galat: tampil pesan dan Coba lagi memuat ulang', async () => {
      const f = pasangFetch({ 'GET /api/admin/pengaduan/p-1/linimasa': { status: 500, body: { error: 'Gagal memproses permintaan' } } });
      tampil();
      expect(await screen.findByText(/Gagal memproses permintaan/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
      await waitFor(() => expect(kirimKe(f, 'GET /api/admin/pengaduan/p-1/linimasa')).toHaveLength(2));
    });

    it('kosong: Belum ada riwayat', async () => {
      pasangFetch();
      tampil();
      expect(await screen.findByText('Belum ada riwayat.')).toBeTruthy();
    });
  });

  describe('satu formulir tanggapan dan status', () => {
    it('tidak ada lagi tombol status terpisah atau centang "Selesaikan sekarang"', async () => {
      pasangFetch();
      tampil();
      expect(screen.queryByRole('button', { name: /Verifikasi|Proses$|Selesaikan|^Tolak$/ })).toBeNull();
      expect(screen.queryByText(/Selesaikan sekarang/)).toBeNull();
      expect(screen.getByRole('radio', { name: 'Tetap' })).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Tolak' })).toBeTruthy();
    });

    it('Tetap: tanggapan wajib; mengirim ke rute tanggapan tanpa mengubah status', async () => {
      const f = pasangFetch();
      const { onBerubah, onToast } = tampil();
      const kirim = screen.getByRole('button', { name: 'Kirim tanggapan' }) as HTMLButtonElement;
      expect(kirim.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText(/Tanggapan untuk pelapor/), { target: { value: '  Kami sedang memeriksa  ' } });
      expect(kirim.disabled).toBe(false);
      fireEvent.click(kirim);
      await waitFor(() => expect(kirimKe(f, 'POST /api/admin/pengaduan/p-1/tanggapan')).toHaveLength(1));
      expect(JSON.parse(String(kirimKe(f, 'POST /api/admin/pengaduan/p-1/tanggapan')[0][1]?.body))).toEqual({ isi: 'Kami sedang memeriksa', status: null, kirim_email: true, lampiran: [] });
      await waitFor(() => expect(onBerubah).toHaveBeenCalled());
      expect(onToast).toHaveBeenCalledWith('Tersimpan', 'success');
    });

    it('Verifikasi untuk pengaduan baru: PATCH tanpa tanggapan atau email', async () => {
      const f = pasangFetch();
      const { onBerubah } = tampil();
      fireEvent.click(screen.getByRole('radio', { name: 'Verifikasi' }));
      fireEvent.click(screen.getByRole('button', { name: 'Simpan status' }));
      await waitFor(() => expect(kirimKe(f, 'PATCH /api/admin/pengaduan')).toHaveLength(1));
      expect(JSON.parse(String(kirimKe(f, 'PATCH /api/admin/pengaduan')[0][1]?.body))).toEqual({ id: 'p-1', status: 'diverifikasi' });
      expect(kirimKe(f, 'POST /api/admin/pengaduan/p-1/tanggapan')).toHaveLength(0);
      await waitFor(() => expect(onBerubah).toHaveBeenCalled());
    });

    it('Verifikasi tidak ditawarkan lagi setelah pengaduan diverifikasi', () => {
      pasangFetch();
      tampil({ status: 'diverifikasi' });
      expect(screen.queryByRole('radio', { name: 'Verifikasi' })).toBeNull();
    });

    it('Tolak: alasan wajib, tombol berubah, status ditolak dikirim bersama alasan', async () => {
      const f = pasangFetch();
      tampil();
      fireEvent.click(screen.getByRole('radio', { name: 'Tolak' }));
      const tombol = screen.getByRole('button', { name: 'Tolak pengaduan' }) as HTMLButtonElement;
      expect(tombol.disabled).toBe(true);
      expect(screen.getByLabelText(/Alasan penolakan/)).toBeTruthy();
      expect(screen.getByText(/Alasan ini dikirim ke pelapor/)).toBeTruthy();
      fireEvent.change(screen.getByLabelText(/Alasan penolakan/), { target: { value: 'Bukan kewenangan DPMPTSP' } });
      fireEvent.click(tombol);
      await waitFor(() => expect(kirimKe(f, 'POST /api/admin/pengaduan/p-1/tanggapan')).toHaveLength(1));
      expect(JSON.parse(String(kirimKe(f, 'POST /api/admin/pengaduan/p-1/tanggapan')[0][1]?.body))).toMatchObject({ isi: 'Bukan kewenangan DPMPTSP', status: 'ditolak' });
    });

    it('Diproses tanpa teks: hanya status, lewat PATCH; peringatan server tampil sebagai toast warning', async () => {
      const f = pasangFetch({ 'PATCH /api/admin/pengaduan': { status: 200, body: { ok: true, peringatan: 'Status diperbarui, tetapi riwayat perubahan gagal dicatat.' } } });
      const { onToast } = tampil();
      fireEvent.click(screen.getByRole('radio', { name: 'Diproses' }));
      const tombol = screen.getByRole('button', { name: 'Simpan status' }) as HTMLButtonElement;
      expect(tombol.disabled).toBe(false);
      fireEvent.click(tombol);
      await waitFor(() => expect(kirimKe(f, 'PATCH /api/admin/pengaduan')).toHaveLength(1));
      expect(JSON.parse(String(kirimKe(f, 'PATCH /api/admin/pengaduan')[0][1]?.body))).toEqual({ id: 'p-1', status: 'diproses' });
      expect(kirimKe(f, 'POST /api/admin/pengaduan/p-1/tanggapan')).toHaveLength(0);
      await waitFor(() => expect(onToast).toHaveBeenCalledWith('Status diperbarui, tetapi riwayat perubahan gagal dicatat.', 'warning'));
    });

    it('Selesai dengan teks: tanggapan dan status menjadi satu permintaan', async () => {
      const f = pasangFetch();
      tampil({ status: 'diproses' });
      expect(screen.queryByRole('radio', { name: 'Diproses' })).toBeNull();
      fireEvent.click(screen.getByRole('radio', { name: 'Selesai' }));
      fireEvent.change(screen.getByLabelText(/Tanggapan untuk pelapor/), { target: { value: 'Sudah diperbaiki' } });
      fireEvent.click(screen.getByRole('button', { name: 'Kirim tanggapan' }));
      await waitFor(() => expect(kirimKe(f, 'POST /api/admin/pengaduan/p-1/tanggapan')).toHaveLength(1));
      expect(JSON.parse(String(kirimKe(f, 'POST /api/admin/pengaduan/p-1/tanggapan')[0][1]?.body))).toMatchObject({ isi: 'Sudah diperbaiki', status: 'selesai' });
    });

    it('anonim: kotak email mati dan tidak ada permintaan kirim email', async () => {
      const f = pasangFetch();
      tampil({ anonim: true, bisa_dihubungi: false, pelapor_nama: null });
      const kotak = screen.getByRole('checkbox') as HTMLInputElement;
      expect(kotak.disabled).toBe(true);
      expect(screen.getByText(/tidak tersedia: pelapor anonim atau tanpa email/)).toBeTruthy();
      fireEvent.change(screen.getByLabelText(/Tanggapan untuk pelapor/), { target: { value: 'Terima kasih' } });
      fireEvent.click(screen.getByRole('button', { name: 'Kirim tanggapan' }));
      await waitFor(() => expect(kirimKe(f, 'POST /api/admin/pengaduan/p-1/tanggapan')).toHaveLength(1));
      expect(JSON.parse(String(kirimKe(f, 'POST /api/admin/pengaduan/p-1/tanggapan')[0][1]?.body)).kirim_email).toBe(false);
    });

    it('galat server: pesan lewat toast dan isian tidak hilang', async () => {
      pasangFetch({ 'POST /api/admin/pengaduan/p-1/tanggapan': { status: 500, body: { error: 'Gagal menyimpan tanggapan' } } });
      const { onToast } = tampil();
      fireEvent.change(screen.getByLabelText(/Tanggapan untuk pelapor/), { target: { value: 'Isi saya' } });
      fireEvent.click(screen.getByRole('button', { name: 'Kirim tanggapan' }));
      await waitFor(() => expect(onToast).toHaveBeenCalledWith('Gagal menyimpan tanggapan', 'error'));
      expect((screen.getByLabelText(/Tanggapan untuk pelapor/) as HTMLTextAreaElement).value).toBe('Isi saya');
    });

    it('pengaduan tertutup: hanya "Tetap" (tambah tanggapan), tanpa pilihan status lain', async () => {
      pasangFetch();
      tampil({ status: 'ditolak', terbuka: false });
      expect(screen.getByRole('heading', { name: 'Tambah tanggapan' })).toBeTruthy();
      expect(screen.queryByRole('radio', { name: 'Selesai' })).toBeNull();
    });
  });

  describe('UI-05: riwayat segar setelah tanggapan tanpa perubahan status', () => {
    it('tanggapan berstatus Tetap memuat ulang linimasa meski status dan penangan tidak berubah', async () => {
      const f = pasangFetch();
      tampil();
      await waitFor(() => expect(kirimKe(f, 'GET /api/admin/pengaduan/p-1/linimasa')).toHaveLength(1));
      fireEvent.change(screen.getByLabelText(/Tanggapan untuk pelapor/), { target: { value: 'Sedang kami cek' } });
      fireEvent.click(screen.getByRole('button', { name: 'Kirim tanggapan' }));
      await waitFor(() => expect(kirimKe(f, 'POST /api/admin/pengaduan/p-1/tanggapan')).toHaveLength(1));
      await waitFor(() => expect(kirimKe(f, 'GET /api/admin/pengaduan/p-1/linimasa')).toHaveLength(2));
    });
  });

  describe('UI-04: membuka bukti pelapor dan lampiran tanggapan', () => {
    let buka: ReturnType<typeof vi.fn>;
    let jendela: { location: { href: string }; close: ReturnType<typeof vi.fn>; opener: unknown };
    beforeEach(() => {
      jendela = { location: { href: '' }, close: vi.fn(), opener: 'x' };
      buka = vi.fn(() => jendela);
      vi.stubGlobal('open', buka);
    });
    const LAMPIRAN = 'GET /api/admin/pengaduan/p-1/lampiran';

    it('bukti pelapor: tombol hanya bila ada_bukti; mengambil URL berotorisasi lalu membukanya di tab baru tanpa opener', async () => {
      const f = pasangFetch({ [LAMPIRAN]: { status: 200, body: { url: 'https://r2.example/obj?sig=1', kedaluwarsa_detik: 60 } } });
      tampil({ ada_bukti: true });
      fireEvent.click(await screen.findByRole('button', { name: /Buka bukti dari pelapor/ }));
      await waitFor(() => expect(jendela.location.href).toBe('https://r2.example/obj?sig=1'));
      expect(kirimKe(f, LAMPIRAN)).toHaveLength(1);
      expect(jendela.opener).toBeNull();
    });

    it('tanpa ada_bukti: tidak ada tombol bukti', async () => {
      pasangFetch();
      tampil({ ada_bukti: false });
      await screen.findByText('Riwayat');
      expect(screen.queryByRole('button', { name: /Buka bukti/ })).toBeNull();
    });

    it('bukti gagal dibuka (404): toast galat dan jendela kosong ditutup', async () => {
      pasangFetch({ [LAMPIRAN]: { status: 404, body: { error: 'Bukti tidak ditemukan' } } });
      const { onToast } = tampil({ ada_bukti: true });
      fireEvent.click(await screen.findByRole('button', { name: /Buka bukti dari pelapor/ }));
      await waitFor(() => expect(onToast).toHaveBeenCalledWith('Bukti tidak ditemukan', 'error'));
      expect(jendela.close).toHaveBeenCalled();
    });

    it('lampiran tanggapan dengan id menjadi tombol buka; tanpa id tetap teks nama', async () => {
      const f = pasangFetch({
        'GET /api/admin/pengaduan/p-1/linimasa': { status: 200, body: { entri: [
          { jenis: 'tanggapan', waktu: '2026-10-01T07:00:00Z', oleh_nama: 'Sari', isi: 'Sudah dicek', lampiran: [{ id: 'aaa-1', nama: 'bukti.pdf' }, { nama: 'lama.png' }] },
        ] } },
        [`${LAMPIRAN}?lampiran_id=aaa-1`]: { status: 200, body: { url: 'https://r2.example/tanggapan?sig=2' } },
      });
      tampil();
      fireEvent.click(await screen.findByRole('button', { name: /Buka lampiran bukti\.pdf/ }));
      await waitFor(() => expect(jendela.location.href).toBe('https://r2.example/tanggapan?sig=2'));
      expect(kirimKe(f, `${LAMPIRAN}?lampiran_id=aaa-1`)).toHaveLength(1);
      expect(screen.queryByRole('button', { name: /lama\.png/ })).toBeNull();
      expect(screen.getByText(/lama\.png/)).toBeTruthy();
    });

    it('mode baca (petugas): tidak ada tombol bukti', async () => {
      pasangFetch();
      tampil({ ada_bukti: true }, { mode: 'baca' });
      expect(screen.queryByRole('button', { name: /Buka bukti/ })).toBeNull();
    });
  });
});
