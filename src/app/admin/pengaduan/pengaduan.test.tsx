// @vitest-environment jsdom
// Dashboard pengaduan: akses per role, ringkasan sebagai filter, tabel kerja, SLA hari kerja dari server, penangan, panel rincian.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ role: 'petugas' as string, toast: vi.fn(), replace: vi.fn(), query: '' }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(h.query),
  useRouter: () => ({ replace: h.replace }),
}));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'saya', role: h.role } }) }),
      }),
    }),
  }),
}));

import AdminPengaduanPage from './page';

type Baris = Record<string, unknown>;
const row = (o: Baris = {}): Baris => ({
  id: 'id-1', nomor_tiket: 'PGD-001', jalur: 'layanan', layanan_id: 'l1', layanan_nama: 'Helpdesk OSS', status: 'baru',
  batas_verifikasi: '2099-01-01', batas_penanganan: '2099-01-02', batas_aktif: '2099-01-01', sisa_hari_kerja: 3, sla_status: 'aman',
  terbuka: true, anonim: false, pelapor_nama: 'Sari', bisa_dihubungi: true, penangan_id: null, penangan_nama: null, penangan_sejak: null,
  created_at: '2026-10-01T05:30:00Z', isi: 'Pelayanan loket lambat sekali pagi ini', ...o,
});
const RINGKASAN = { baru: 4, diproses: 3, mendekati: 2, terlambat: 1, selesai: 9, ditolak: 2 };

function pasangFetch(opsi: { rows?: Baris[]; ringkasan?: unknown; fitur?: boolean; status?: number; linimasa?: unknown[]; aksi?: (url: string, init?: RequestInit) => { status: number; body: unknown } } = {}) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const balas = (status: number, body: unknown) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    const aksi = opsi.aksi?.(url, init);
    if (aksi) return balas(aksi.status, aksi.body);
    if (url.includes('/linimasa')) return balas(200, { entri: opsi.linimasa ?? [] });
    if (url.startsWith('/api/admin/pengaduan?') && init?.method === undefined) {
      if (opsi.status && opsi.status >= 400) return balas(opsi.status, { error: 'Gagal memuat pengaduan' });
      return balas(200, { rows: opsi.rows ?? [row()], total: (opsi.rows ?? [row()]).length, ringkasan: opsi.ringkasan === undefined ? RINGKASAN : opsi.ringkasan, fitur: { kerja: opsi.fitur !== false } });
    }
    return balas(200, { ok: true });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const panggilan = (fn: ReturnType<typeof vi.fn>, cocok: RegExp, method?: string) =>
  fn.mock.calls.filter((c) => cocok.test(String(c[0])) && (method ? c[1]?.method === method : true));

describe('admin pengaduan', () => {
  beforeEach(() => { h.toast.mockClear(); h.replace.mockClear(); h.query = ''; });
  afterEach(cleanup);

  describe('akses per role', () => {
    it('petugas: hanya lihat, tanpa ringkasan, tanpa tab integritas, tanpa kolom pelapor/penangan', async () => {
      h.role = 'petugas';
      pasangFetch({ ringkasan: null, fitur: false });
      render(<AdminPengaduanPage />);
      expect(await screen.findByText(/Anda hanya dapat melihat pengaduan layanan Anda/)).toBeTruthy();
      await screen.findByText('PGD-001');
      expect(screen.queryByRole('tab', { name: /Integritas/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Butuh tindakan' })).toBeNull();
      expect(screen.queryByRole('columnheader', { name: 'Penangan' })).toBeNull();
      expect(screen.queryByRole('columnheader', { name: 'Pelapor' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Tangani' })).toBeNull();
    });

    it('petugas: panel rincian hanya membaca, tanpa formulir, tanpa riwayat, tanpa pemanggilan linimasa', async () => {
      h.role = 'petugas';
      const f = pasangFetch({ ringkasan: null, fitur: false });
      render(<AdminPengaduanPage />);
      fireEvent.click(await screen.findByRole('button', { name: /Buka rincian pengaduan PGD-001/ }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Pelayanan loket lambat sekali pagi ini')).toBeTruthy();
      expect(within(dialog).queryByRole('form', { name: 'Tanggapi pelapor' })).toBeNull();
      expect(within(dialog).queryByText('Riwayat')).toBeNull();
      expect(panggilan(f, /linimasa/)).toHaveLength(0);
    });

    it('front office: ringkasan dan Tangani tersedia, tanpa tab integritas', async () => {
      h.role = 'front_office';
      pasangFetch();
      render(<AdminPengaduanPage />);
      expect(await screen.findByRole('button', { name: 'Tangani' })).toBeTruthy();
      expect(screen.queryByRole('tab', { name: /Integritas/ })).toBeNull();
      expect(screen.queryByText(/Anda hanya dapat melihat/)).toBeNull();
    });

    it('admin: tab integritas tersedia dan memuat jalur integritas', async () => {
      h.role = 'admin';
      const f = pasangFetch();
      render(<AdminPengaduanPage />);
      fireEvent.click(await screen.findByRole('tab', { name: /Integritas/ }));
      await waitFor(() => expect(panggilan(f, /jalur=integritas&filter=aktif/)).toHaveLength(1));
    });
  });

  describe('ringkasan sebagai filter', () => {
    it('menampilkan angka dari server dan mengirim filter yang dipilih', async () => {
      h.role = 'front_office';
      const f = pasangFetch();
      render(<AdminPengaduanPage />);
      const kelompok = await screen.findByRole('group', { name: /Ringkasan pengaduan/ });
      expect(within(kelompok).getByRole('button', { name: /Butuh tindakan\s*7/ })).toBeTruthy();
      expect(within(kelompok).getByRole('button', { name: /Mendekati batas\s*2/ })).toBeTruthy();
      expect(within(kelompok).getByRole('button', { name: /Terlambat\s*1/ })).toBeTruthy();
      expect(within(kelompok).getByRole('button', { name: /Selesai\s*11/ })).toBeTruthy();
      expect(panggilan(f, /filter=aktif/)).toHaveLength(1);
      fireEvent.click(within(kelompok).getByRole('button', { name: /Terlambat/ }));
      await waitFor(() => expect(panggilan(f, /filter=terlambat&page=0/)).toHaveLength(1));
      expect(screen.getByRole('button', { name: /Terlambat/ }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByText(/melewati batas hari kerja/i)).toBeTruthy();
    });

    it('tanpa ringkasan server: chip tanpa angka dan tanpa chip SLA, dengan catatan fitur belum aktif', async () => {
      h.role = 'admin';
      pasangFetch({ ringkasan: null, fitur: false });
      render(<AdminPengaduanPage />);
      expect(await screen.findByText(/belum aktif karena pembaruan basis data belum diterapkan/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Mendekati batas/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Tangani' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Baru' })).toBeTruthy();
    });
  });

  describe('tabel kerja', () => {
    it('kolom: nomor, layanan, ringkasan isi, pelapor, penangan; anonim tampil "Anonim"', async () => {
      h.role = 'admin';
      pasangFetch({ rows: [row({ anonim: true, pelapor_nama: null, bisa_dihubungi: false, penangan_id: 'p9', penangan_nama: 'Budi' })] });
      render(<AdminPengaduanPage />);
      await screen.findByText('PGD-001');
      expect(screen.getByText('Helpdesk OSS')).toBeTruthy();
      expect(screen.getByText('Anonim')).toBeTruthy();
      expect(screen.getByText(/Budi/)).toBeTruthy();
      expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Nomor', 'Layanan', 'Isi', 'Pelapor', 'Masuk', 'Batas', 'Status', 'Penangan']);
    });

    it('penangan saya tampil "Anda"', async () => {
      h.role = 'front_office';
      pasangFetch({ rows: [row({ penangan_id: 'saya', penangan_nama: 'Sari' })] });
      render(<AdminPengaduanPage />);
      expect(await screen.findByText(/Anda$/)).toBeTruthy();
    });

    it('SLA dari server: terlambat memakai teks hari kerja; yang sudah selesai tidak menampilkan batas', async () => {
      h.role = 'admin';
      pasangFetch({ rows: [
        row({ id: 'a', nomor_tiket: 'PGD-A', sla_status: 'terlambat', sisa_hari_kerja: -2, batas_aktif: '2026-10-05' }),
        row({ id: 'b', nomor_tiket: 'PGD-B', status: 'selesai', terbuka: false, sla_status: null, sisa_hari_kerja: null, batas_aktif: null }),
      ] });
      render(<AdminPengaduanPage />);
      await screen.findByText('PGD-A');
      expect(screen.getByText('Terlambat 2 hari kerja')).toBeTruthy();
      const barisB = screen.getByText('PGD-B').closest('tr') as HTMLElement;
      expect(within(barisB).queryByText(/hari kerja|Terlambat|Lewat/)).toBeNull();
      expect(within(barisB).getByText('Selesai')).toBeTruthy();
    });

    it('waktu laporan anonim = tanggal saja; tidak anonim = tanggal dan jam WIB', async () => {
      h.role = 'admin';
      pasangFetch({ rows: [
        row({ id: 'a', nomor_tiket: 'PGD-A', anonim: true, created_at: '2026-10-01T17:00:00Z' }),
        row({ id: 'b', nomor_tiket: 'PGD-B', anonim: false, created_at: '2026-10-01T05:30:00Z' }),
      ] });
      render(<AdminPengaduanPage />);
      await screen.findByText('PGD-A');
      expect(screen.getByText('2 Oktober 2026')).toBeTruthy();
      expect(screen.queryByText(/2 Oktober 2026.*00[.:]00/)).toBeNull();
      expect(screen.getByText(/1 Oktober 2026.*12[.:]30/)).toBeTruthy();
    });

    it('tombol Tangani pada baris memanggil rute tangani', async () => {
      h.role = 'front_office';
      const f = pasangFetch();
      render(<AdminPengaduanPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Tangani' }));
      await waitFor(() => expect(panggilan(f, /\/id-1\/tangani$/, 'POST')).toHaveLength(1));
      await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Anda sekarang menangani pengaduan ini', 'success'));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('Tangani bentrok: pesan menyebut penangan yang sudah ada', async () => {
      h.role = 'front_office';
      pasangFetch({ aksi: (url, init) => init?.method === 'POST' && url.endsWith('/tangani') ? { status: 409, body: { error: 'x', kode: 'PENANGAN_SUDAH_ADA', penangan_nama: 'Budi' } } : undefined as never });
      render(<AdminPengaduanPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Tangani' }));
      await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Pengaduan ini sudah ditangani Budi.', 'error'));
    });
  });

  describe('state', () => {
    it('kosong pada filter bawaan', async () => {
      h.role = 'admin';
      pasangFetch({ rows: [] });
      render(<AdminPengaduanPage />);
      expect(await screen.findByText('Belum ada pengaduan yang perlu ditindaklanjuti.')).toBeTruthy();
    });

    it('galat: pesan jelas dan tombol Coba lagi memuat ulang', async () => {
      h.role = 'admin';
      const f = pasangFetch({ status: 500 });
      render(<AdminPengaduanPage />);
      expect(await screen.findByRole('alert')).toBeTruthy();
      pasangFetch();
      fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
      expect(await screen.findByText('PGD-001')).toBeTruthy();
      expect(f).toBeDefined();
    });

    it('tanpa izin (403)', async () => {
      h.role = 'admin';
      pasangFetch({ status: 403 });
      render(<AdminPengaduanPage />);
      expect(await screen.findByText(/tidak memiliki izin/)).toBeTruthy();
    });

    it('memuat: pesan status tampil', async () => {
      h.role = 'admin';
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
      render(<AdminPengaduanPage />);
      expect(await screen.findByRole('status')).toBeTruthy();
    });
  });

  describe('UI-06: respons usang tidak menimpa filter terbaru', () => {
    it('respons Baru yang datang terlambat dibuang bila filter sudah berpindah ke Selesai', async () => {
      h.role = 'front_office';
      const tahan: Record<string, (v: unknown) => void> = {};
      const balas = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
      const paket = (r: Baris[]) => ({ rows: r, total: r.length, ringkasan: RINGKASAN, fitur: { kerja: true } });
      vi.stubGlobal('fetch', vi.fn((url: string) => {
        if (url.includes('filter=baru')) return new Promise((ok) => { tahan.baru = () => ok(balas(paket([row({ id: 'b', nomor_tiket: 'PGD-BARU' })]))); });
        if (url.includes('filter=arsip')) return Promise.resolve(balas(paket([row({ id: 'a', nomor_tiket: 'PGD-ARSIP', status: 'selesai' })])));
        return Promise.resolve(balas(paket([row()])));
      }));
      render(<AdminPengaduanPage />);
      await screen.findByText('PGD-001');
      fireEvent.click(screen.getByRole('button', { name: /^Baru/ }));
      fireEvent.click(screen.getByRole('button', { name: /^Selesai/ }));
      await screen.findByText('PGD-ARSIP');
      tahan.baru(undefined);
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.getByText('PGD-ARSIP')).toBeTruthy();
      expect(screen.queryByText('PGD-BARU')).toBeNull();
      expect(screen.getByRole('button', { name: /^Selesai/ }).getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('UI-09: jaringan putus saat Tangani dari tabel', () => {
    it('fetch ditolak: toast galat jaringan, tombol pulih, dan daftar dimuat ulang', async () => {
      h.role = 'front_office';
      let putus = false;
      const dasar = pasangFetch();
      vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') { putus = true; return Promise.reject(new TypeError('Failed to fetch')); }
        return dasar(url, init);
      }));
      render(<AdminPengaduanPage />);
      const tombol = await screen.findByRole('button', { name: 'Tangani' });
      const sebelum = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
      fireEvent.click(tombol);
      await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/jaringan/i), 'error'));
      expect(putus).toBe(true);
      await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(sebelum + 1));
      expect((screen.getByRole('button', { name: 'Tangani' }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('A13: saringan di URL', () => {
    it('membaca filter dan halaman dari URL lalu memuat dengan nilai itu', async () => {
      h.role = 'front_office';
      h.query = 'filter=terlambat&halaman=3';
      const f = pasangFetch();
      render(<AdminPengaduanPage />);
      await screen.findByText('PGD-001');
      expect(panggilan(f, /filter=terlambat&page=2/)).toHaveLength(1);
      expect(screen.getByRole('button', { name: /Terlambat/ }).getAttribute('aria-pressed')).toBe('true');
    });

    it('mengikuti perubahan URL tanpa memasang ulang halaman', async () => {
      h.role = 'front_office';
      const f = pasangFetch();
      const halaman = render(<AdminPengaduanPage />);
      await screen.findByText('PGD-001');
      h.query = 'filter=terlambat&halaman=2';
      halaman.rerender(<AdminPengaduanPage />);
      await waitFor(() => expect(panggilan(f, /filter=terlambat&page=1/)).toHaveLength(1));
      expect(screen.getByRole('button', { name: /Terlambat/ })).toHaveAttribute('aria-pressed', 'true');
    });

    it('menjaga parameter lain saat filter dan halaman diubah', async () => {
      h.role = 'front_office';
      h.query = 'asal=rekap&halaman=3';
      pasangFetch();
      render(<AdminPengaduanPage />);
      await screen.findByText('PGD-001');
      fireEvent.click(screen.getByRole('button', { name: /Terlambat/ }));
      const tujuan = new URL(String(h.replace.mock.calls.at(-1)?.[0]), 'https://contoh.test');
      expect(tujuan.searchParams.get('asal')).toBe('rekap');
      expect(tujuan.searchParams.get('filter')).toBe('terlambat');
      expect(tujuan.searchParams.has('halaman')).toBe(false);
    });

    it('filter tak dikenal di URL jatuh ke bawaan', async () => {
      h.role = 'front_office';
      h.query = 'filter=ngawur';
      const f = pasangFetch();
      render(<AdminPengaduanPage />);
      await screen.findByText('PGD-001');
      expect(panggilan(f, /filter=aktif&page=0/)).toHaveLength(1);
    });

    it('mengganti filter menulis URL lewat router.replace, dan filter bawaan menghapus parameter', async () => {
      h.role = 'front_office';
      pasangFetch();
      render(<AdminPengaduanPage />);
      await screen.findByText('PGD-001');
      fireEvent.click(screen.getByRole('button', { name: /Terlambat/ }));
      expect(h.replace).toHaveBeenLastCalledWith(expect.stringContaining('?filter=terlambat'), { scroll: false });
      fireEvent.click(screen.getByRole('button', { name: /Butuh tindakan/ }));
      const url = String(h.replace.mock.calls.at(-1)?.[0]);
      expect(url).not.toContain('filter=');
    });
  });

  describe('lencana SLA bertulisan', () => {
    it('mendekati batas memakai teks hari kerja, bukan hanya warna', async () => {
      h.role = 'admin';
      pasangFetch({ rows: [row({ sla_status: 'mendekati', sisa_hari_kerja: 1 })] });
      render(<AdminPengaduanPage />);
      await screen.findByText('PGD-001');
      expect(screen.getByText('1 hari kerja lagi')).toBeTruthy();
    });
  });
});
