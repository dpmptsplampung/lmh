// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ search: '', updateUser: vi.fn(), toast: vi.fn() }));

vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(h.search) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { updateUser: h.updateUser } }) }));

import ProfilPage from './page';

const profil = {
  id: 'p1', nama: 'Helpdesk OSS', username: 'helpdesk-oss', role: 'petugas', layanan_nama: 'OSS',
  no_hp: '+6281', email_notifikasi: 'a@b.go.id', email_notifikasi_terverifikasi: false,
  operator_default: null, operator_aktif: false, wajib_ganti_sandi: false,
};

let fetchMock: ReturnType<typeof vi.fn>;
const jawab = (ok: boolean, body: unknown, status = ok ? 200 : 400) =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
const pasang = (opsi: { profil?: Record<string, unknown>; patch?: () => Promise<unknown> } = {}) => {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
    init?.method === 'PATCH'
      ? (opsi.patch ?? (() => jawab(true, { ok: true, verifikasi_dikirim: false, profil: { ...profil, ...opsi.profil } })))()
      : jawab(true, { profil: { ...profil, ...opsi.profil } }));
};
const patchBody = () => JSON.parse(fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')![1].body);
const adaPatch = () => fetchMock.mock.calls.some((c) => c[1]?.method === 'PATCH');
const bagian = async (nama: string) => within(await screen.findByRole('form', { name: nama }));

beforeEach(() => {
  h.search = '';
  h.toast.mockClear();
  fetchMock = vi.fn();
  pasang();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(cleanup);

describe('profil staf: tampilan', () => {
  it('kepala halaman memuat nama, nama pengguna, role, layanan tanpa em dash', async () => {
    const { container } = render(<ProfilPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Helpdesk OSS' })).toBeTruthy();
    expect(screen.getByText('helpdesk-oss')).toBeTruthy();
    expect(screen.getByText('Petugas')).toBeTruthy();
    expect(screen.getByText('OSS')).toBeTruthy();
    expect(container.textContent).not.toMatch(/—/);
  });

  it('memuat: status dapat dibaca pembaca layar', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(<ProfilPage />);
    expect(screen.getByRole('status', { name: 'Memuat profil' })).toBeTruthy();
  });

  it('galat memuat: pesan dan tombol Coba lagi yang memuat ulang', async () => {
    fetchMock.mockImplementation(() => jawab(false, { error: 'Akses ditolak' }, 403));
    render(<ProfilPage />);
    expect(await screen.findByText('Akses ditolak')).toBeTruthy();
    pasang();
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Helpdesk OSS' })).toBeTruthy();
  });

  it('tanpa koneksi saat memuat: pesan offline yang jelas', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<ProfilPage />);
    expect(await screen.findByText(/Tidak ada koneksi/)).toBeTruthy();
  });

  it('email belum terverifikasi: lencana, keterangan fungsi email, dan tombol kirim ulang di bagian Email', async () => {
    render(<ProfilPage />);
    const f = await bagian('Email notifikasi');
    expect(f.getByText('Belum terverifikasi')).toBeTruthy();
    expect(f.getByText(/Bukan untuk masuk/)).toBeTruthy();
    expect(f.getByRole('button', { name: /Kirim ulang verifikasi/ })).toBeTruthy();
  });

  it('email terverifikasi: lencana Terverifikasi tanpa tombol kirim ulang', async () => {
    pasang({ profil: { email_notifikasi_terverifikasi: true } });
    render(<ProfilPage />);
    const f = await bagian('Email notifikasi');
    expect(f.getByText('Terverifikasi')).toBeTruthy();
    expect(f.queryByRole('button', { name: /Kirim ulang verifikasi/ })).toBeNull();
  });

  it('isian operator tersembunyi untuk akun individu dan tampil bila Admin mengaktifkannya', async () => {
    const { unmount } = render(<ProfilPage />);
    await screen.findByRole('form', { name: 'Data diri' });
    expect(screen.queryByLabelText(/bertugas hari ini/)).toBeNull();
    unmount();
    pasang({ profil: { operator_aktif: true, operator_default: 'Budi' } });
    render(<ProfilPage />);
    expect((await screen.findByLabelText(/bertugas hari ini/) as HTMLInputElement).value).toBe('Budi');
  });

  it('wajib ganti sandi: bagian Keamanan paling atas dan isiannya mendapat fokus', async () => {
    pasang({ profil: { wajib_ganti_sandi: true } });
    render(<ProfilPage />);
    const forms = await screen.findAllByRole('form');
    expect(forms[0].getAttribute('aria-label') ?? forms[0].getAttribute('aria-labelledby')).toBeTruthy();
    expect(within(forms[0]).getByLabelText(/Kata sandi lama/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(forms[0]).getByLabelText(/Kata sandi lama/)));
  });
});

describe('profil staf: Data diri', () => {
  it('Simpan nonaktif sampai ada perubahan', async () => {
    render(<ProfilPage />);
    const f = await bagian('Data diri');
    const simpan = f.getByRole('button', { name: /Simpan/ }) as HTMLButtonElement;
    expect(simpan.disabled).toBe(true);
    fireEvent.change(f.getByLabelText('Nama'), { target: { value: 'Nama Baru' } });
    expect(simpan.disabled).toBe(false);
  });

  it('PATCH hanya memuat field yang berubah, nomor HP dinormalisasi, tanpa field terlarang', async () => {
    render(<ProfilPage />);
    const f = await bagian('Data diri');
    fireEvent.change(f.getByLabelText('Nama'), { target: { value: '  Nama Baru  ' } });
    fireEvent.change(f.getByLabelText('Nomor HP'), { target: { value: '0812 3456 7890' } });
    fireEvent.click(f.getByRole('button', { name: /Simpan/ }));
    await waitFor(() => expect(adaPatch()).toBe(true));
    const body = patchBody();
    expect(body).toEqual({ nama: 'Nama Baru', no_hp: '+6281234567890' });
    for (const k of ['role', 'username', 'layanan_id', 'aktif', 'operator_aktif']) expect(body).not.toHaveProperty(k);
  });

  it('nomor HP dikosongkan dikirim sebagai null', async () => {
    render(<ProfilPage />);
    const f = await bagian('Data diri');
    fireEvent.change(f.getByLabelText('Nomor HP'), { target: { value: '' } });
    fireEvent.click(f.getByRole('button', { name: /Simpan/ }));
    await waitFor(() => expect(adaPatch()).toBe(true));
    expect(patchBody()).toEqual({ no_hp: null });
  });

  it.each([
    ['terlalu pendek', 'A'],
    ['diawali rumus', '=cmd'],
    ['kosong', '   '],
  ])('nama %s ditolak di klien dengan galat di bawah isian', async (_n, nilai) => {
    render(<ProfilPage />);
    const f = await bagian('Data diri');
    const input = f.getByLabelText('Nama');
    fireEvent.change(input, { target: { value: nilai } });
    fireEvent.click(f.getByRole('button', { name: /Simpan/ }));
    expect(await f.findByRole('alert')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(adaPatch()).toBe(false);
  });

  it('nomor HP tidak valid ditolak di klien', async () => {
    render(<ProfilPage />);
    const f = await bagian('Data diri');
    fireEvent.change(f.getByLabelText('Nomor HP'), { target: { value: 'abc' } });
    fireEvent.click(f.getByRole('button', { name: /Simpan/ }));
    expect(await f.findByText(/Nomor HP tidak valid/)).toBeTruthy();
    expect(adaPatch()).toBe(false);
  });

  it('galat server dengan field nama tampil di bawah isian Nama', async () => {
    pasang({ patch: () => jawab(false, { error: 'Nama tidak boleh diawali tanda rumus.', field: 'nama' }, 400) });
    render(<ProfilPage />);
    const f = await bagian('Data diri');
    fireEvent.change(f.getByLabelText('Nama'), { target: { value: 'Nama Baru' } });
    fireEvent.click(f.getByRole('button', { name: /Simpan/ }));
    expect(await f.findByText('Nama tidak boleh diawali tanda rumus.')).toBeTruthy();
    expect(f.getByLabelText('Nama').getAttribute('aria-invalid')).toBe('true');
  });

  it('409 migrasi belum diterapkan: pesan server tampil di bagian itu', async () => {
    pasang({ patch: () => jawab(false, { kode: 'MIGRASI_BELUM_DITERAPKAN', error: 'Fitur ganti nama belum aktif.' }, 409) });
    render(<ProfilPage />);
    const f = await bagian('Data diri');
    fireEvent.change(f.getByLabelText('Nama'), { target: { value: 'Nama Baru' } });
    fireEvent.click(f.getByRole('button', { name: /Simpan/ }));
    expect(await f.findByText('Fitur ganti nama belum aktif.')).toBeTruthy();
  });

  it('berhasil: konfirmasi di tempat dan nilai terbaru dari server', async () => {
    pasang({ patch: () => jawab(true, { ok: true, verifikasi_dikirim: false, profil: { ...profil, nama: 'Nama Baru' } }) });
    render(<ProfilPage />);
    const f = await bagian('Data diri');
    fireEvent.change(f.getByLabelText('Nama'), { target: { value: 'Nama Baru' } });
    fireEvent.click(f.getByRole('button', { name: /Simpan/ }));
    expect(await f.findByText('Data diri tersimpan.')).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 2, name: 'Nama Baru' })).toBeTruthy();
  });
});

describe('profil staf: Email notifikasi', () => {
  it('alamat sintetis akun ditolak di klien', async () => {
    render(<ProfilPage />);
    const f = await bagian('Email notifikasi');
    fireEvent.change(f.getByLabelText('Alamat email'), { target: { value: 'helpdesk-oss@staf.lmh.internal' } });
    fireEvent.click(f.getByRole('button', { name: /Simpan/ }));
    expect(await f.findByRole('alert')).toBeTruthy();
    expect(adaPatch()).toBe(false);
  });

  it('format email salah ditolak di klien', async () => {
    render(<ProfilPage />);
    const f = await bagian('Email notifikasi');
    fireEvent.change(f.getByLabelText('Alamat email'), { target: { value: 'bukan-email' } });
    fireEvent.click(f.getByRole('button', { name: /Simpan/ }));
    expect(await f.findByRole('alert')).toBeTruthy();
    expect(adaPatch()).toBe(false);
  });

  it('tersimpan dan tautan terkirim: pesan menyebut alamat dan masa berlaku', async () => {
    pasang({
      patch: () => jawab(true, { ok: true, verifikasi_dikirim: true, profil: { ...profil, email_notifikasi: 'baru@lampungprov.go.id' } }),
    });
    render(<ProfilPage />);
    const f = await bagian('Email notifikasi');
    fireEvent.change(f.getByLabelText('Alamat email'), { target: { value: ' Baru@Lampungprov.go.id ' } });
    fireEvent.click(f.getByRole('button', { name: /Simpan/ }));
    expect(await f.findByText(/Tautan verifikasi dikirim ke baru@lampungprov\.go\.id/)).toBeTruthy();
    expect(patchBody()).toEqual({ email_notifikasi: 'baru@lampungprov.go.id' });
  });

  it('tersimpan tetapi tautan gagal terkirim: dikatakan jujur, bukan "disimpan" saja', async () => {
    pasang({
      patch: () => jawab(true, { ok: true, verifikasi_dikirim: false, profil: { ...profil, email_notifikasi: 'baru@lampungprov.go.id' } }),
    });
    render(<ProfilPage />);
    const f = await bagian('Email notifikasi');
    fireEvent.change(f.getByLabelText('Alamat email'), { target: { value: 'baru@lampungprov.go.id' } });
    fireEvent.click(f.getByRole('button', { name: /Simpan/ }));
    expect(await f.findByText(/tetapi tautan verifikasi belum terkirim/)).toBeTruthy();
    expect(f.getByRole('button', { name: /Kirim ulang verifikasi/ })).toBeTruthy();
  });

  it('mengosongkan email dikirim sebagai null', async () => {
    render(<ProfilPage />);
    const f = await bagian('Email notifikasi');
    fireEvent.change(f.getByLabelText('Alamat email'), { target: { value: '' } });
    fireEvent.click(f.getByRole('button', { name: /Simpan/ }));
    await waitFor(() => expect(adaPatch()).toBe(true));
    expect(patchBody()).toEqual({ email_notifikasi: null });
  });

  it('kirim ulang memanggil /api/me/email-verifikasi', async () => {
    render(<ProfilPage />);
    const f = await bagian('Email notifikasi');
    fireEvent.click(f.getByRole('button', { name: /Kirim ulang verifikasi/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/api/me/email-verifikasi')).toBe(true));
  });

  it('hasil verifikasi dari tautan (?email_verif=ok) tampil sebagai status', async () => {
    h.search = 'email_verif=ok';
    render(<ProfilPage />);
    expect(await screen.findByText(/berhasil diverifikasi/)).toBeTruthy();
  });
});

describe('profil staf: Operator harian', () => {
  it('PATCH operator_default hanya saat berubah', async () => {
    pasang({ profil: { operator_aktif: true, operator_default: 'Budi' } });
    render(<ProfilPage />);
    const f = await bagian('Operator harian');
    const simpan = f.getByRole('button', { name: /Simpan/ }) as HTMLButtonElement;
    expect(simpan.disabled).toBe(true);
    fireEvent.change(f.getByLabelText(/bertugas hari ini/), { target: { value: 'Sari' } });
    fireEvent.click(simpan);
    await waitFor(() => expect(adaPatch()).toBe(true));
    expect(patchBody()).toEqual({ operator_default: 'Sari' });
  });
});

describe('profil staf: Keamanan', () => {
  it('ganti sandi memanggil /api/me/sandi dengan sandi lama', async () => {
    render(<ProfilPage />);
    fireEvent.change(await screen.findByLabelText(/Kata sandi lama/), { target: { value: 'lama-lama-123' } });
    fireEvent.change(screen.getByLabelText(/^Kata sandi baru/), { target: { value: 'baru-baru-1234' } });
    fireEvent.change(screen.getByLabelText(/Ulangi kata sandi baru/), { target: { value: 'baru-baru-1234' } });
    fireEvent.click(screen.getByRole('button', { name: /Ganti Kata Sandi/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/api/me/sandi')).toBe(true));
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/me/sandi')!;
    expect(JSON.parse(call[1].body)).toEqual({
      sandi_lama: 'lama-lama-123', sandi_baru: 'baru-baru-1234', keluarkan_perangkat_lain: true,
    });
  });

  it('menolak sandi baru pendek tanpa memanggil server', async () => {
    render(<ProfilPage />);
    fireEvent.change(await screen.findByLabelText(/Kata sandi lama/), { target: { value: 'lama' } });
    fireEvent.change(screen.getByLabelText(/^Kata sandi baru/), { target: { value: 'pendek' } });
    fireEvent.change(screen.getByLabelText(/Ulangi kata sandi baru/), { target: { value: 'pendek' } });
    fireEvent.submit(screen.getByRole('button', { name: /Ganti Kata Sandi/ }).closest('form')!);
    expect(await screen.findByText('Kata sandi baru 8 sampai 72 karakter.')).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/me/sandi')).toBe(false);
  });

  it('sesi pemulihan: setelah updateUser berhasil memanggil /api/me/sandi-selesai', async () => {
    h.search = 'wajib=1';
    h.updateUser.mockResolvedValue({ error: null });
    render(<ProfilPage />);
    fireEvent.change(await screen.findByLabelText(/^Kata sandi baru/), { target: { value: 'baru-baru-1234' } });
    fireEvent.change(screen.getByLabelText(/Ulangi kata sandi baru/), { target: { value: 'baru-baru-1234' } });
    fireEvent.click(screen.getByRole('button', { name: /Ganti Kata Sandi/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/api/me/sandi-selesai')).toBe(true));
    expect(h.updateUser).toHaveBeenCalledWith({ password: 'baru-baru-1234' });
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/me/sandi')).toBe(false);
  });

  // Sandi SUDAH berubah tetapi flag wajib_ganti_sandi gagal dibersihkan: pengguna masih login dengan sandi baru.
  describe('flag wajib-ganti gagal dibersihkan', () => {
    const isi = async (lama = true) => {
      if (lama) fireEvent.change(await screen.findByLabelText(/Kata sandi lama/), { target: { value: 'lama-lama-123' } });
      else await screen.findByLabelText(/^Kata sandi baru/);
      fireEvent.change(screen.getByLabelText(/^Kata sandi baru/), { target: { value: 'baru-baru-1234' } });
      fireEvent.change(screen.getByLabelText(/Ulangi kata sandi baru/), { target: { value: 'baru-baru-1234' } });
      fireEvent.click(screen.getByRole('button', { name: /Ganti Kata Sandi/ }));
    };

    it('server mengirim kode SANDI_BERUBAH_FLAG_GAGAL: field dikosongkan, pesan jelas bahwa sandi baru berlaku, tanpa saran "masuk dengan sandi baru"', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) =>
        Promise.resolve(
          url === '/api/me/sandi'
            ? { ok: false, status: 500, json: () => Promise.resolve({ error: 'Sandi sudah berubah dan sandi baru Anda sudah berlaku, tetapi status wajib-ganti belum bersih. Muat ulang halaman; bila masih diminta mengganti sandi, hubungi Admin.', kode: 'SANDI_BERUBAH_FLAG_GAGAL' }) }
            : { ok: true, json: () => Promise.resolve(init?.method === 'PATCH' ? { ok: true } : { profil }) },
        ));
      render(<ProfilPage />);
      await isi();
      const alert = await screen.findByText(/sudah berlaku/);
      expect(alert.textContent).not.toMatch(/masuk dengan sandi baru/i);
      expect((screen.getByLabelText(/Kata sandi lama/) as HTMLInputElement).value).toBe('');
      expect((screen.getByLabelText(/^Kata sandi baru/) as HTMLInputElement).value).toBe('');
      expect((screen.getByLabelText(/Ulangi kata sandi baru/) as HTMLInputElement).value).toBe('');
      expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/sudah berlaku/), 'warning');
      expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
    });

    it('kegagalan sandi biasa (tanpa kode) tetap memakai pesan error dan TIDAK mengosongkan field', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) =>
        Promise.resolve(
          url === '/api/me/sandi'
            ? { ok: false, status: 400, json: () => Promise.resolve({ error: 'Sandi lama salah' }) }
            : { ok: true, json: () => Promise.resolve(init?.method === 'PATCH' ? { ok: true } : { profil }) },
        ));
      render(<ProfilPage />);
      await isi();
      expect(await screen.findByText('Sandi lama salah')).toBeTruthy();
      expect((screen.getByLabelText(/^Kata sandi baru/) as HTMLInputElement).value).toBe('baru-baru-1234');
    });

    it('sesi pemulihan: updateUser berhasil tetapi /api/me/sandi-selesai gagal -> field dikosongkan dan pesan sandi sudah berlaku', async () => {
      h.search = 'wajib=1';
      h.updateUser.mockResolvedValue({ error: null });
      fetchMock.mockImplementation((url: string, init?: RequestInit) =>
        Promise.resolve(
          url === '/api/me/sandi-selesai'
            ? { ok: false, status: 500, json: () => Promise.resolve({ error: 'Gagal memperbarui status' }) }
            : { ok: true, json: () => Promise.resolve(init?.method === 'PATCH' ? { ok: true } : { profil }) },
        ));
      render(<ProfilPage />);
      await isi(false);
      expect(await screen.findByText(/sudah berlaku/)).toBeTruthy();
      expect((screen.getByLabelText(/^Kata sandi baru/) as HTMLInputElement).value).toBe('');
      expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/sudah berlaku/), 'warning');
    });
  });
});

describe('tautan menu Profil Saya', () => {
  it.each(['admin', 'petugas', 'front_office'] as const)('%s melihat tautan Profil Saya dan boleh membuka halamannya', async (role) => {
    const { buildNavTree, canAccessAdminPath } = await import('@/lib/admin-nav');
    const hrefs = JSON.stringify(buildNavTree(role));
    expect(hrefs).toContain('/admin/profil');
    expect(hrefs).toContain('Profil Saya');
    expect(canAccessAdminPath(role, '/admin/profil')).toBe(true);
  });
});
