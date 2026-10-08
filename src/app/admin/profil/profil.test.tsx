// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ search: '', updateUser: vi.fn() }));

vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(h.search) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { updateUser: h.updateUser } }) }));

import ProfilPage from './page';

const profil = {
  id: 'p1', nama: 'Helpdesk OSS', username: 'helpdesk-oss', role: 'petugas', layanan_nama: 'OSS',
  no_hp: '+6281', email_notifikasi: 'a@b.go.id', email_notifikasi_terverifikasi: false,
  operator_default: null, wajib_ganti_sandi: false,
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  h.search = '';
  fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(init?.method === 'PATCH' ? { ok: true, verifikasi_dikirim: false } : { profil }),
    }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(cleanup);

describe('profil staf', () => {
  it('menampilkan banner email belum terverifikasi', async () => {
    render(<ProfilPage />);
    expect(await screen.findByText(/belum terverifikasi\. Notifikasi/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Kirim ulang verifikasi/ })).toBeTruthy();
  });

  it('PATCH hanya berisi field yang berubah dan tidak pernah memuat field terlarang', async () => {
    render(<ProfilPage />);
    const hp = (await screen.findByLabelText('Nomor HP')) as HTMLInputElement;
    fireEvent.change(hp, { target: { value: '08123' } });
    fireEvent.click(screen.getByRole('button', { name: /Simpan/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')![1].body);
    expect(body).toEqual({ no_hp: '08123' });
    for (const k of ['role', 'nama', 'username', 'layanan_id', 'aktif']) expect(body).not.toHaveProperty(k);
  });

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
    expect(await screen.findByText('Kata sandi baru 10 sampai 72 karakter.')).toBeTruthy();
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
});
