// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/layout/PageHeader', () => ({ default: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [{ id: 'l1', nama: 'OSS' }] }) }) }) }),
}));

import AdminPetugasPage from './page';

const akun = (o: Record<string, unknown>) => ({
  id: 'x', auth_user_id: 'a', nama: 'X', username: 'x', role: 'petugas', layanan_id: 'l1', layanan_nama: 'OSS',
  no_hp: null, aktif: true, email_notifikasi_tersamar: null, email_notifikasi_terverifikasi: false,
  last_sign_in_at: '2026-10-01T03:00:00Z', belum_pernah_login: false, ...o,
});

const DAFTAR = [
  akun({ id: 'me', nama: 'Admin Satu', username: 'admin-satu', role: 'admin', layanan_id: null, layanan_nama: null }),
  akun({ id: 'u2', nama: 'Helpdesk OSS', username: 'helpdesk-oss', belum_pernah_login: true, last_sign_in_at: null }),
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const ok = (b: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(b) });
    if (url === '/api/admin/petugas' && init?.method === 'POST') return ok({ ok: true, id: 'n1', username: 'helpdesk-baru', sandi_sementara: 'Baru-7qT4mZ', wajib_ganti_sandi: true });
    if (url === '/api/admin/petugas') return ok({ akun: DAFTAR });
    if (url === '/api/me/profil') return ok({ profil: { id: 'me' } });
    if (url.endsWith('/reset-password')) return ok({ ok: true, sandi_sementara: 'Sementara-9xK2', wajib_ganti_sandi: true });
    return ok({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(cleanup);

describe('kelola akun', () => {
  it('menampilkan username dan badge "Belum pernah login"', async () => {
    render(<AdminPetugasPage />);
    expect(await screen.findByText('helpdesk-oss')).toBeTruthy();
    expect(screen.getAllByText('Belum pernah login')).toHaveLength(1);
  });

  it('guard UI: tidak bisa menonaktifkan/reset diri sendiri; admin terakhir terkunci', async () => {
    render(<AdminPetugasPage />);
    await screen.findByText('helpdesk-oss');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Nonaktifkan Admin Satu' }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Reset sandi Admin Satu' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Nonaktifkan Helpdesk OSS' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reset sandi menampilkan sandi sementara sekali, hilang setelah ditutup', async () => {
    render(<AdminPetugasPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reset sandi Helpdesk OSS' }));
    fireEvent.click(screen.getByRole('button', { name: /Buat sandi sementara/ }));
    const input = (await screen.findByLabelText('Sandi sementara')) as HTMLInputElement;
    expect(input.value).toBe('Sementara-9xK2');
    expect(screen.getByText(/hanya ditampilkan sekali/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    expect(screen.queryByDisplayValue('Sementara-9xK2')).toBeNull();
  });

  it('nonaktifkan wajib alasan', async () => {
    render(<AdminPetugasPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nonaktifkan Helpdesk OSS' }));
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

  it('buat akun layanan: kirim data, sandi sementara tampil sekali lalu hilang', async () => {
    render(<AdminPetugasPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Buat Akun Layanan/ }));
    fireEvent.change(screen.getByLabelText(/^Nama$/), { target: { value: 'Helpdesk Baru' } });
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
    fireEvent.change(screen.getByLabelText(/^Nama$/), { target: { value: 'Helpdesk Baru' } });
    fireEvent.change(screen.getByLabelText(/Nama pengguna/), { target: { value: 'helpdesk-baru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buat akun' }));
    expect(await screen.findByText('Petugas wajib memiliki layanan.')).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });
});
