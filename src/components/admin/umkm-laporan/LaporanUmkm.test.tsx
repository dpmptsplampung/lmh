// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaporanStatistik } from '@/lib/umkm-katalog/types';
import LaporanUmkm from './LaporanUmkm';

const staff = vi.hoisted(() => ({ role: 'petugas', aktif: true }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'staf-uji' } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: staff }) }) }) }),
}) }));
const report: LaporanStatistik = {
  telemetri_opsional_aktif: false, versi_naskah: null, aktif_pada: null,
  profil: { diajukan: 2, terbit: 4, disembunyikan: 1, ditolak: 0 },
  suka: 1500, dilihat: null, tanpa_hasil: null,
  pesan: { baru: 3, ditangani: 5 }, laporan: { baru: 2, ditangani: 1 },
  profil_statistik: [{ id: 'profil-1', nama: 'Kopi Lampung', suka: 1500, dilihat: null, klik_formulir: null }],
  kelompok_tanpa_hasil: [], next_cursor: 'halaman-kedua',
};
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data })));
let request: ReturnType<typeof vi.fn>;

beforeEach(() => {
  staff.role = 'petugas'; staff.aktif = true;
  request = vi.fn(() => ok(report));
  vi.stubGlobal('fetch', request);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('laporan UMKM', () => {
  it('ringkasan menampilkan waktu aktif sakelar dalam WIB', async () => {
    request.mockImplementation(() => ok({ ...report,
      telemetri_opsional_aktif: true, aktif_pada: '2026-11-08T18:30:00Z',
    }));
    render(<LaporanUmkm />);
    const summary = await screen.findByRole('region', { name: 'Ringkasan' });
    const coverage = within(summary).getByText(/Waktu aktif sakelar:/);
    expect(coverage).toHaveTextContent('Waktu aktif sakelar: 2026-11-09 01:30 WIB');
    expect(coverage.querySelector('time')).toHaveAttribute('dateTime', '2026-11-08T18:30:00Z');
  });

  it('ringkasan dan tabel menampilkan belum dicatat saat mati, tanpa sakelar bagi petugas', async () => {
    render(<LaporanUmkm />);
    expect(screen.getByRole('status')).toHaveTextContent('Memuat laporan UMKM');
    expect(await screen.findByRole('heading', { name: 'Ringkasan' })).toBeTruthy();
    expect(screen.getAllByText('belum dicatat')).toHaveLength(5);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'Kopi Lampung' })).toBeTruthy();
    expect(within(table).getByRole('cell', { name: '1.500' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Pesan dan laporan dalam masa simpan 180 hari' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Versi naskah kebijakan' })).toBeNull();
  });

  it('paginasi mengirim cursor dan awal daftar membuang cursor', async () => {
    request.mockImplementation((url: string) => url.includes('cursor=') ? ok({
      ...report, next_cursor: null,
      profil_statistik: [{ id: 'profil-2', nama: 'Keripik Pisang', suka: 7, dilihat: null, klik_formulir: null }],
    }) : ok(report));
    render(<LaporanUmkm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Halaman berikutnya' }));
    expect(await screen.findByRole('rowheader', { name: 'Keripik Pisang' })).toBeTruthy();
    expect(request.mock.calls.at(-1)?.[0]).toBe('/api/admin/umkm-laporan?cursor=halaman-kedua');
    fireEvent.click(screen.getByRole('button', { name: 'Ke awal daftar' }));
    expect(await screen.findByRole('rowheader', { name: 'Kopi Lampung' })).toBeTruthy();
    expect(request.mock.calls.at(-1)?.[0]).toBe('/api/admin/umkm-laporan');
  });

  it('saat aktif menampilkan nol serta kelompok tanpa kata pencarian dan kontak', async () => {
    request.mockImplementation(() => ok({ ...report, telemetri_opsional_aktif: true, dilihat: 0, tanpa_hasil: 2,
      profil_statistik: [{ ...report.profil_statistik[0], dilihat: 0, klik_formulir: 0 }],
      kelompok_tanpa_hasil: [{ hari: '2026-11-09', kategori: '', kabupaten_kota: '', jumlah: 2 }],
    }));
    render(<LaporanUmkm />);
    expect(await screen.findByRole('cell', { name: 'Semua kategori' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Semua wilayah' })).toBeTruthy();
    expect(screen.queryByText('belum dicatat')).toBeNull();
    expect(screen.getAllByRole('cell', { name: '0' })).toHaveLength(2);
    expect(screen.queryByText(/Nomor kontak|Kata kunci/)).toBeNull();
  });

  it('profil dan kelompok kosong mempunyai penjelasan', async () => {
    request.mockImplementation(() => ok({ ...report, telemetri_opsional_aktif: true,
      dilihat: 0, tanpa_hasil: 0, profil_statistik: [], next_cursor: null }));
    render(<LaporanUmkm />);
    expect(await screen.findByText('Belum ada profil untuk ditampilkan.')).toBeTruthy();
    expect(screen.getByText('Belum ada pencarian tanpa hasil.')).toBeTruthy();
  });

  it.each([[503, 'MODUL_BELUM_TERSEDIA'], [403, 'DILARANG'], [401, 'LOGIN_DIPERLUKAN']])(
    'status %s dijelaskan dengan tenang tanpa angka atau rincian internal', async (status, code) => {
      request.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
        error: { code, message: 'SQL internal rahasia' },
      }), { status: Number(status) })));
      render(<LaporanUmkm />);
      expect(await screen.findByRole('note')).toHaveTextContent(Number(status) === 503
        ? 'Laporan UMKM belum tersedia' : 'admin dan pemeriksa UMKM');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('table')).toBeNull();
      expect(document.body.textContent).not.toContain('SQL internal');
    },
  );

  it('jaringan gagal menyediakan tombol coba lagi', async () => {
    request.mockRejectedValueOnce(new TypeError('offline'));
    render(<LaporanUmkm />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Koneksi terputus');
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByRole('heading', { name: 'Ringkasan' })).toBeTruthy();
  });

  it('unduh CSV memanggil satu route ekspor tanpa cursor', async () => {
    request.mockImplementation((url: string) => url.endsWith('/export')
      ? Promise.resolve(new Response('jenis,nama,jumlah\nprofil,Kopi Lampung,1500', {
        headers: { 'Content-Type': 'text/csv' },
      })) : ok(report));
    const create = vi.fn(() => 'blob:laporan-uji');
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<LaporanUmkm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Unduh CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(request.mock.calls.filter(([url]) => url.includes('/export')).map(([url]) => url))
      .toEqual(['/api/admin/umkm-laporan/export']);
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:laporan-uji');
  });

  it('kegagalan CSV tetap di layar laporan', async () => {
    request.mockImplementation((url: string) => url.endsWith('/export')
      ? Promise.resolve(new Response(JSON.stringify({ error: { code: 'MODUL_BELUM_TERSEDIA' } }), { status: 503 }))
      : ok(report));
    render(<LaporanUmkm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Unduh CSV' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Laporan UMKM belum tersedia');
    expect(screen.getByRole('table')).toBeTruthy();
  });
});

describe('sakelar statistik', () => {
  it('hanya admin aktif mendapat sakelar dan aktivasi memerlukan versi serta konfirmasi', async () => {
    staff.role = 'admin';
    request.mockImplementation((_url: string, init?: RequestInit) => init?.method === 'POST'
      ? ok({ telemetri_opsional_aktif: true, versi_naskah: 'UMKM-2026-11', aktif_pada: '2026-11-09T08:00:00Z' })
      : ok(report));
    render(<LaporanUmkm />);
    const button = await screen.findByRole('button', { name: 'Aktifkan pencatatan opsional' });
    expect(screen.getByRole('textbox', { name: 'Versi naskah kebijakan' })).toHaveAttribute('maxLength', '100');
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Versi naskah kebijakan' }), {
      target: { value: 'UMKM-2026-11' },
    });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Saya memastikan kebijakan privasi sudah terbit/ }));
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const [url, init] = request.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(url).toBe('/api/admin/umkm-laporan');
    expect(JSON.parse(init.body)).toEqual({ aktif: true, versi_naskah: 'UMKM-2026-11', kebijakan_terbit: true });
    expect(await screen.findByText('Pengaturan pencatatan disimpan.')).toBeTruthy();
  });

  it('admin dapat mematikan dan kegagalan tidak mengubah laporan', async () => {
    staff.role = 'admin';
    request.mockImplementation((_url: string, init?: RequestInit) => init?.method === 'POST'
      ? Promise.resolve(new Response(JSON.stringify({ error: { code: 'DILARANG' } }), { status: 403 }))
      : ok({ ...report, telemetri_opsional_aktif: true, versi_naskah: 'versi-terbit' }));
    render(<LaporanUmkm />);
    const button = await screen.findByRole('button', { name: 'Matikan pencatatan opsional' });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('admin dan pemeriksa UMKM');
    const [, init] = request.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(JSON.parse(init.body)).toEqual({ aktif: false, versi_naskah: 'versi-terbit', kebijakan_terbit: false });
    expect(screen.getByRole('button', { name: 'Matikan pencatatan opsional' })).toBeTruthy();
  });

  it('admin tidak aktif tidak mendapat sakelar', async () => {
    staff.role = 'admin'; staff.aktif = false;
    render(<LaporanUmkm />);
    await screen.findByRole('heading', { name: 'Ringkasan' });
    expect(screen.queryByRole('textbox', { name: 'Versi naskah kebijakan' })).toBeNull();
  });
});
