// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('@/components/layout/PageHeader', () => ({ default: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));
const toastMock = vi.hoisted(() => vi.fn());
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [{ id: 'l1', nama: 'Helpdesk OSS' }] }) }) }) }),
}));

import AdminPetugasPage from './page';

const akun = (o: Record<string, unknown>) => ({
  id: 'x', auth_user_id: 'a', nama: 'X', username: 'x', role: 'petugas', layanan_id: 'l1', layanan_nama: 'Helpdesk OSS',
  no_hp: null, aktif: true, email_notifikasi_tersamar: null, email_notifikasi_terverifikasi: false,
  last_sign_in_at: '2026-10-01T03:00:00Z', belum_pernah_login: false, ...o,
});

const DAFTAR = [
  akun({ id: 'me', nama: 'Admin Satu', username: 'admin-satu', role: 'admin', layanan_id: null, layanan_nama: null }),
  akun({ id: 'u2', nama: 'Petugas OSS', username: 'petugas-oss', belum_pernah_login: true, last_sign_in_at: null,
    no_hp: '081234567890', email_notifikasi_tersamar: 'pe***@lampungprov.go.id', email_notifikasi_terverifikasi: true }),
];

const DAFTAR_RAMAI = [
  ...DAFTAR,
  akun({ id: 'u3', nama: 'Koord FO', username: 'koord-fo', role: 'front_office', layanan_id: null, layanan_nama: null, koordinator: true }),
  akun({ id: 'u4', nama: 'Budi FO', username: 'budi-fo', role: 'front_office', layanan_id: null, layanan_nama: null, aktif: false }),
  akun({ id: 'u5', nama: 'Sari Perizinan', username: 'sari-izin', layanan_id: 'l2', layanan_nama: 'Non OSS (SiCantik Lampung)' }),
];

let fetchMock: ReturnType<typeof vi.fn>;
const ok = (b: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(b) });

const pasangDaftar = (akunList: unknown[], koordinatorTersedia: boolean) => {
  const asli = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<unknown>;
  fetchMock.mockImplementation((url: string, init?: RequestInit) =>
    url === '/api/admin/petugas' && init?.method === 'GET'
      ? ok({ koordinator_tersedia: koordinatorTersedia, akun: akunList })
      : asli(url, init));
};

beforeEach(() => {
  toastMock.mockClear();
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/admin/petugas' && init?.method === 'POST') return ok({ ok: true, id: 'n1', username: 'helpdesk-baru', sandi_sementara: 'Baru-7qT4mZ', wajib_ganti_sandi: true });
    if (url === '/api/admin/petugas') return ok({ akun: DAFTAR });
    if (url === '/api/me/profil') return ok({ profil: { id: 'me' } });
    if (url.endsWith('/reset-password')) return ok({ ok: true, sandi_sementara: 'Sementara-9xK2', wajib_ganti_sandi: true });
    return ok({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(cleanup);

const bukaKelola = async (nama: string) => {
  fireEvent.click(await screen.findByRole('button', { name: `Kelola ${nama}` }));
  return screen.getByRole('dialog');
};

describe('daftar berkelompok', () => {
  it('aksi esensial langsung tersedia di baris tanpa membuka Kelola', async () => {
    render(<AdminPetugasPage />);
    await screen.findByText('petugas-oss');
    expect(screen.queryByRole('dialog')).toBeNull();
    for (const nama of ['Ubah Petugas OSS', 'Reset sandi Petugas OSS', 'Nonaktifkan Petugas OSS']) {
      expect(screen.getByRole('button', { name: nama })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Nonaktifkan Admin Satu' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Reset sandi Admin Satu' })).toHaveProperty('disabled', true);
  });

  it('mengelompokkan akun: Admin, Front Office, lalu satu bagian per Layanan, dengan jumlah', async () => {
    pasangDaftar(DAFTAR_RAMAI, true);
    render(<AdminPetugasPage />);
    await screen.findByText('koord-fo');
    const judul = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(judul).toEqual([
      expect.stringMatching(/^Admin\s*1$/),
      expect.stringMatching(/^Front Office\s*2$/),
      expect.stringMatching(/^Helpdesk OSS\s*1$/),
      expect.stringMatching(/^Non OSS \(SiCantik Lampung\)\s*1$/),
    ]);
    const bagianFo = screen.getByRole('region', { name: /^Front Office/ });
    expect(within(bagianFo).getByText('budi-fo')).toBeTruthy();
    expect(within(bagianFo).queryByText('petugas-oss')).toBeNull();
  });

  it('daftar tidak memuat nomor HP maupun email; keduanya hanya di dialog Kelola', async () => {
    render(<AdminPetugasPage />);
    await screen.findByText('petugas-oss');
    expect(screen.queryByText(/081234567890/)).toBeNull();
    expect(screen.queryByText(/lampungprov\.go\.id/)).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /HP/i })).toBeNull();
    const dialog = await bukaKelola('Petugas OSS');
    expect(within(dialog).getByText('081234567890')).toBeTruthy();
    expect(within(dialog).getByText(/pe\*\*\*@lampungprov\.go\.id/)).toBeTruthy();
    expect(within(dialog).getByText(/terverifikasi/)).toBeTruthy();
  });

  it('menampilkan "Belum pernah login" dan username', async () => {
    render(<AdminPetugasPage />);
    expect(await screen.findByText('petugas-oss')).toBeTruthy();
    expect(screen.getAllByText('Belum pernah login')).toHaveLength(1);
  });

  it('cari menurut nama atau username menyembunyikan bagian yang kosong', async () => {
    pasangDaftar(DAFTAR_RAMAI, true);
    render(<AdminPetugasPage />);
    await screen.findByText('koord-fo');
    fireEvent.change(screen.getByRole('searchbox', { name: /Cari akun/ }), { target: { value: 'sari' } });
    expect(screen.getByText('sari-izin')).toBeTruthy();
    expect(screen.queryByText('koord-fo')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: /^Front Office/ })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: /Cari akun/ }), { target: { value: 'tidak-ada-orang-ini' } });
    expect(screen.getByText(/Tidak ada akun yang cocok/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Hapus pencarian/ }));
    expect(screen.getByText('koord-fo')).toBeTruthy();
  });

  it('filter status Nonaktif hanya menampilkan akun nonaktif', async () => {
    pasangDaftar(DAFTAR_RAMAI, true);
    render(<AdminPetugasPage />);
    await screen.findByText('koord-fo');
    fireEvent.click(screen.getByRole('button', { name: 'Nonaktif' }));
    expect(screen.getByText('budi-fo')).toBeTruthy();
    expect(screen.queryByText('koord-fo')).toBeNull();
    expect(screen.getByRole('button', { name: 'Nonaktif' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('penanda Koordinator', () => {
  it('tanpa migrasi (koordinator_tersedia false): saklar tidak tampil', async () => {
    render(<AdminPetugasPage />);
    await screen.findByText('petugas-oss');
    expect(screen.queryByRole('button', { name: /^Koordinator/ })).toBeNull();
  });

  it('saklar bertuliskan "Koordinator", ber-aria-pressed, tidak ada untuk Admin; menyalakan langsung PATCH', async () => {
    pasangDaftar(DAFTAR_RAMAI, true);
    render(<AdminPetugasPage />);
    await screen.findByText('koord-fo');
    expect(screen.queryByRole('button', { name: 'Koordinator Admin Satu' })).toBeNull();
    const nyala = screen.getByRole('button', { name: 'Koordinator Koord FO' });
    expect(nyala.textContent?.trim()).toBe('Koordinator');
    expect(nyala.getAttribute('aria-pressed')).toBe('true');
    const mati = screen.getByRole('button', { name: 'Koordinator Petugas OSS' });
    expect(mati.getAttribute('aria-pressed')).toBe('false');
    expect(nyala.className).not.toBe(mati.className);
    fireEvent.click(mati);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/petugas/u2/koordinator', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ koordinator: true }),
    })));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Petugas OSS kini Koordinator.', 'success'));
  });

  it('mencabut Koordinator meminta konfirmasi dulu; Batal tidak mengirim apa pun', async () => {
    pasangDaftar(DAFTAR_RAMAI, true);
    render(<AdminPetugasPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Koordinator Koord FO' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Koord FO/)).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/koordinator'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/koordinator'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Koordinator Koord FO' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cabut Koordinator' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/petugas/u3/koordinator', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ koordinator: false }),
    })));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/Koord FO.*dicabut/), 'success'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('respons Koordinator yang tertunda tidak menutup dialog Ubah data akun lain', async () => {
    pasangDaftar(DAFTAR_RAMAI, true);
    let selesai!: () => void;
    const tertunda = new Promise((r) => { selesai = () => r({ ok: true, json: () => Promise.resolve({ ok: true }) }); });
    const dasar = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<unknown>;
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url === '/api/admin/petugas/u2/koordinator' ? tertunda : dasar(url, init));
    render(<AdminPetugasPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Koordinator Petugas OSS' }));
    const kelola = await bukaKelola('Budi FO');
    fireEvent.click(within(kelola).getByRole('button', { name: 'Ubah data' }));
    const nama = await screen.findByLabelText(/^Nama( \*)?$/);
    fireEvent.change(nama, { target: { value: 'Koreksi Budi' } });

    selesai();
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Petugas OSS kini Koordinator.', 'success'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Koordinator Petugas OSS' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByLabelText(/^Nama( \*)?$/) as HTMLInputElement).value).toBe('Koreksi Budi');
  });
});

describe('kelola akun', () => {
  it('guard UI di dialog Kelola: tidak bisa menonaktifkan/reset diri sendiri; admin terakhir terkunci', async () => {
    render(<AdminPetugasPage />);
    const dialogAdmin = await bukaKelola('Admin Satu');
    expect((within(dialogAdmin).getByRole('button', { name: 'Nonaktifkan' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialogAdmin).getByRole('button', { name: 'Reset sandi' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialogAdmin).getByRole('button', { name: 'Tutup dialog' }));
    const dialogLain = await bukaKelola('Petugas OSS');
    expect((within(dialogLain).getByRole('button', { name: 'Nonaktifkan' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reset sandi menampilkan sandi sementara sekali, hilang setelah ditutup', async () => {
    render(<AdminPetugasPage />);
    const kelola = await bukaKelola('Petugas OSS');
    fireEvent.click(within(kelola).getByRole('button', { name: 'Reset sandi' }));
    fireEvent.click(screen.getByRole('button', { name: /Buat sandi sementara/ }));
    const input = (await screen.findByLabelText('Sandi sementara')) as HTMLInputElement;
    expect(input.value).toBe('Sementara-9xK2');
    expect(screen.getByText(/hanya ditampilkan sekali/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    expect(screen.queryByDisplayValue('Sementara-9xK2')).toBeNull();
  });

  it('nonaktifkan wajib alasan', async () => {
    render(<AdminPetugasPage />);
    const kelola = await bukaKelola('Petugas OSS');
    fireEvent.click(within(kelola).getByRole('button', { name: 'Nonaktifkan' }));
    const dialog = screen.getByRole('dialog');
    const konfirmasi = () => Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Nonaktifkan')!;
    fireEvent.click(konfirmasi());
    expect(await screen.findByText('Alasan wajib diisi.')).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/admin/petugas/status')).toBe(false);
    fireEvent.change(screen.getByLabelText(/Alasan/), { target: { value: 'pindah tugas' } });
    fireEvent.click(konfirmasi());
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/api/admin/petugas/status')).toBe(true));
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/admin/petugas/status')!;
    expect(JSON.parse(call[1].body)).toEqual({ aksi: 'nonaktifkan', petugas_id: 'u2', alasan: 'pindah tugas' });
  });

  it('akun nonaktif bisa diaktifkan kembali dari dialog Kelola', async () => {
    pasangDaftar(DAFTAR_RAMAI, true);
    render(<AdminPetugasPage />);
    const kelola = await bukaKelola('Budi FO');
    fireEvent.click(within(kelola).getByRole('button', { name: 'Aktifkan' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Aktifkan')!);
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/api/admin/petugas/status')).toBe(true));
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/admin/petugas/status')!;
    expect(JSON.parse(call[1].body)).toEqual({ aksi: 'aktifkan', petugas_id: 'u4' });
  });

  it('buat akun layanan: kirim data, sandi sementara tampil sekali lalu hilang', async () => {
    render(<AdminPetugasPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Buat Akun Layanan/ }));
    fireEvent.change(screen.getByLabelText(/^Nama( \*)?$/), { target: { value: 'Helpdesk Baru' } });
    fireEvent.change(screen.getByLabelText(/Nama pengguna/), { target: { value: 'helpdesk-baru' } });
    fireEvent.change(await screen.findByLabelText(/^Layanan/), { target: { value: 'l1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buat akun' }));
    const input = (await screen.findByLabelText('Sandi sementara')) as HTMLInputElement;
    expect(input.value).toBe('Baru-7qT4mZ');
    const post = fetchMock.mock.calls.find((c) => c[0] === '/api/admin/petugas' && c[1]?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toEqual({ username: 'helpdesk-baru', nama: 'Helpdesk Baru', role: 'petugas', layanan_id: 'l1' });
    expect(screen.getByText(/hanya ditampilkan sekali/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    expect(screen.queryByDisplayValue('Baru-7qT4mZ')).toBeNull();
  });

  it('buat akun petugas tanpa layanan ditolak di klien', async () => {
    render(<AdminPetugasPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Buat Akun Layanan/ }));
    fireEvent.change(screen.getByLabelText(/^Nama( \*)?$/), { target: { value: 'Helpdesk Baru' } });
    fireEvent.change(screen.getByLabelText(/Nama pengguna/), { target: { value: 'helpdesk-baru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buat akun' }));
    expect(await screen.findByText('Petugas wajib memiliki layanan.')).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });

  // Server membalas ok + `peringatan` bila perubahan SUDAH tersimpan tetapi langkah lanjutan (sesi/blokir/notifikasi) gagal.
  // Tanpa menampilkannya, Admin mengira akun yang dinonaktifkan benar-benar terkunci.
  describe('peringatan dari server', () => {
    const PERINGATAN = 'Akun nonaktif, tetapi blokir/sesi Auth gagal; role sudah dicabut.';
    const balas = (urlCocok: (u: string, i?: RequestInit) => boolean, body: unknown) => {
      const asli = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<unknown>;
      fetchMock.mockImplementation((url: string, init?: RequestInit) =>
        urlCocok(url, init) ? Promise.resolve({ ok: true, json: () => Promise.resolve(body) }) : asli(url, init));
    };

    it('nonaktifkan: toast sukses DAN toast peringatan (warning) ditampilkan', async () => {
      balas((u) => u === '/api/admin/petugas/status', { ok: true, peringatan: PERINGATAN });
      render(<AdminPetugasPage />);
      const kelola = await bukaKelola('Petugas OSS');
      fireEvent.click(within(kelola).getByRole('button', { name: 'Nonaktifkan' }));
      fireEvent.change(screen.getByLabelText(/Alasan/), { target: { value: 'pindah tugas' } });
      const dialog = screen.getByRole('dialog');
      fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Nonaktifkan')!);
      await waitFor(() => expect(toastMock).toHaveBeenCalledWith(PERINGATAN, 'warning'));
      expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/dinonaktifkan/), 'success');
    });

    it('nonaktifkan tanpa peringatan: tidak ada toast warning', async () => {
      render(<AdminPetugasPage />);
      const kelola = await bukaKelola('Petugas OSS');
      fireEvent.click(within(kelola).getByRole('button', { name: 'Nonaktifkan' }));
      fireEvent.change(screen.getByLabelText(/Alasan/), { target: { value: 'pindah tugas' } });
      const dialog = screen.getByRole('dialog');
      fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Nonaktifkan')!);
      await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/dinonaktifkan/), 'success'));
      expect(toastMock.mock.calls.some((c) => c[1] === 'warning')).toBe(false);
    });

    it('ubah akun (PATCH) dengan sesiGagal: toast peringatan ditampilkan bersama toast sukses', async () => {
      const SESI = 'Perubahan tersimpan, tetapi sesi lama akun ini gagal diakhiri. Minta pengguna keluar, atau atur ulang sandinya.';
      balas((u, i) => u.startsWith('/api/admin/petugas/u2') && i?.method === 'PATCH', { ok: true, peringatan: SESI });
      render(<AdminPetugasPage />);
      const kelola = await bukaKelola('Petugas OSS');
      fireEvent.click(within(kelola).getByRole('button', { name: 'Ubah data' }));
      fireEvent.change(await screen.findByLabelText(/^Nama( \*)?$/), { target: { value: 'Petugas OSS Baru' } });
      fireEvent.click(screen.getByRole('button', { name: /Simpan/ }));
      await waitFor(() => expect(toastMock).toHaveBeenCalledWith(SESI, 'warning'));
      expect(toastMock).toHaveBeenCalledWith('Akun diperbarui.', 'success');
    });
  });
});

describe('saklar Operator harian (Admin)', () => {
  const pasangOperator = (tersedia: boolean) => {
    const asli = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<unknown>;
    const daftar = DAFTAR.map((a) => ({ ...a, operator_aktif: false }));
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/admin/petugas' && init?.method === 'GET') return ok({ operator_aktif_tersedia: tersedia, akun: daftar });
      if (url === '/api/admin/petugas/u2' && init?.method === 'PATCH') {
        const b = JSON.parse(String(init.body));
        daftar[1] = { ...daftar[1], operator_aktif: b.operator_aktif };
        return ok({ ok: true, operator_aktif: b.operator_aktif });
      }
      return asli(url, init);
    });
  };

  it('tanpa migrasi (operator_aktif_tersedia false): saklar tidak tampil', async () => {
    pasangOperator(false);
    render(<AdminPetugasPage />);
    const dialog = await bukaKelola('Petugas OSS');
    expect(within(dialog).queryByRole('switch', { name: /Operator harian/ })).toBeNull();
  });

  it('saklar ber-aria-checked, mengirim body khusus {operator_aktif} dan berubah setelah dimuat ulang', async () => {
    pasangOperator(true);
    render(<AdminPetugasPage />);
    const dialog = await bukaKelola('Petugas OSS');
    const saklar = within(dialog).getByRole('switch', { name: /Operator harian/ });
    expect(saklar.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(saklar);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/petugas/u2', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ operator_aktif: true }),
    })));
    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getByRole('switch', { name: /Operator harian/ }).getAttribute('aria-checked')).toBe('true'));
    expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/Operator harian/), 'success');
  });

  it('galat server tampil di dalam dialog dan saklar tidak berubah', async () => {
    pasangOperator(true);
    const dasar = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<unknown>;
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url === '/api/admin/petugas/u2' && init?.method === 'PATCH'
        ? Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: 'Migrasi belum diterapkan.' }) })
        : dasar(url, init));
    render(<AdminPetugasPage />);
    const dialog = await bukaKelola('Petugas OSS');
    fireEvent.click(within(dialog).getByRole('switch', { name: /Operator harian/ }));
    expect(await within(dialog).findByText('Migrasi belum diterapkan.')).toBeTruthy();
    expect(within(dialog).getByRole('switch', { name: /Operator harian/ }).getAttribute('aria-checked')).toBe('false');
  });
});
