// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  signIn: vi.fn(),
  push: vi.fn(),
  petugas: { role: 'petugas', wajib_ganti_sandi: false } as Record<string, unknown> | null,
}));

vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signInWithPassword: h.signIn, signInWithOAuth: vi.fn() },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: h.petugas }) }) }) }),
  }),
}));

import LoginPage from './page';

function bukaFormStaf() {
  render(<LoginPage />);
  fireEvent.click(screen.getByRole('button', { name: /Akses Operator/ }));
  return {
    user: screen.getByLabelText(/Nama pengguna atau email/) as HTMLInputElement,
    pw: screen.queryByLabelText(/Kata sandi/) as HTMLInputElement | null,
  };
}

describe('login staf: username', () => {
  beforeEach(() => {
    h.signIn.mockReset();
    h.push.mockReset();
    h.petugas = { role: 'petugas', wajib_ganti_sandi: false };
  });
  afterEach(cleanup);

  it('username dipetakan lewat resolveLoginEmail ke email sintetis', async () => {
    h.signIn.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const { user, pw } = bukaFormStaf();
    fireEvent.change(user, { target: { value: ' Helpdesk-OSS ' } });
    fireEvent.change(pw!, { target: { value: 'rahasia-panjang' } });
    fireEvent.click(screen.getByRole('button', { name: 'Masuk Operator' }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/admin'));
    expect(h.signIn).toHaveBeenCalledWith({ email: 'helpdesk-oss@staf.lmh.internal', password: 'rahasia-panjang' });
  });

  it('input berisi @ dipakai apa adanya (jalur lama)', async () => {
    h.signIn.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const { user, pw } = bukaFormStaf();
    fireEvent.change(user, { target: { value: 'Budi@Lampung.go.id' } });
    fireEvent.change(pw!, { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Masuk Operator' }));
    await waitFor(() => expect(h.signIn).toHaveBeenCalled());
    expect(h.signIn.mock.calls[0][0].email).toBe('budi@lampung.go.id');
  });

  it('semua galat memakai pesan seragam, tanpa pesan mentah Supabase', async () => {
    h.signIn.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials: user not found' } });
    const { user, pw } = bukaFormStaf();
    fireEvent.change(user, { target: { value: 'tidak-ada' } });
    fireEvent.change(pw!, { target: { value: 'salah' } });
    fireEvent.click(screen.getByRole('button', { name: 'Masuk Operator' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nama pengguna atau kata sandi salah');
    expect(alert.textContent).not.toMatch(/not found|Invalid login/);
  });

  it('wajib_ganti_sandi mengarahkan ke halaman ganti sandi', async () => {
    h.signIn.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    h.petugas = { role: 'petugas', wajib_ganti_sandi: true };
    const { user, pw } = bukaFormStaf();
    fireEvent.change(user, { target: { value: 'helpdesk-oss' } });
    fireEvent.change(pw!, { target: { value: 'sementara' } });
    fireEvent.click(screen.getByRole('button', { name: 'Masuk Operator' }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/admin/profil?ganti=1'));
  });

  it('lupa sandi: POST username dan jawaban seragam', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { user } = bukaFormStaf();
    fireEvent.click(screen.getByRole('button', { name: 'Lupa kata sandi?' }));
    fireEvent.change(user, { target: { value: 'Helpdesk-OSS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim Tautan Pemulihan' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/Jika akun tersebut/);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/lupa-sandi', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ username: 'helpdesk-oss' }),
    }));
  });
});
