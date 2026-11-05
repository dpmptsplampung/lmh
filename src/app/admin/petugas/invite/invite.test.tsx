import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const toast = vi.fn();
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ order: async () => ({ data: [{ id: 'l1', nama: 'Helpdesk OSS' }], error: null }) }),
    }),
  }),
}));

import InvitePetugasPage from './page';

afterEach(cleanup);
beforeEach(() => {
  toast.mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

describe('Tambah Petugas (undang)', () => {
  it('menampilkan form dengan tautan kembali dan semua pilihan role', async () => {
    render(<InvitePetugasPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tambah Petugas' })).toBeTruthy();
    expect((await screen.findAllByRole('link', { name: /Daftar Petugas/ })).length).toBeGreaterThan(0);
    expect(screen.getByRole('radio', { name: 'Petugas' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Admin' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Front Office' })).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'Helpdesk OSS' })).toBeTruthy();
  });

  it('mengirim undangan lalu menampilkan keadaan sukses dan tombol tambah lagi', async () => {
    render(<InvitePetugasPage />);
    await screen.findByRole('option', { name: 'Helpdesk OSS' });
    fireEvent.change(screen.getByLabelText(/^Email Petugas/), { target: { value: 'baru@lmh.go.id' } });
    fireEvent.change(screen.getByLabelText(/^Nama Petugas/), { target: { value: 'Petugas Baru' } });
    fireEvent.change(screen.getByLabelText(/^Layanan/), { target: { value: 'l1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Petugas' }));
    expect(await screen.findByText('Akun Berhasil Dibuat')).toBeTruthy();
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ email: 'baru@lmh.go.id', nama: 'Petugas Baru', layanan_id: 'l1', role: 'petugas' });
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Petugas Lain' }));
    await waitFor(() => expect(screen.getByLabelText(/^Email Petugas/)).toBeTruthy());
  });

  it('Front Office tidak mengirim layanan', async () => {
    render(<InvitePetugasPage />);
    await screen.findByRole('option', { name: 'Helpdesk OSS' });
    fireEvent.click(screen.getByRole('radio', { name: 'Front Office' }));
    fireEvent.change(screen.getByLabelText(/^Email Petugas/), { target: { value: 'fo@lmh.go.id' } });
    fireEvent.change(screen.getByLabelText(/^Nama Petugas/), { target: { value: 'FO Baru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Petugas' }));
    await screen.findByText('Akun Berhasil Dibuat');
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body).layanan_id).toBeNull();
  });

  it('galat server tampil sebagai toast galat dan form tetap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Email sudah terdaftar' }) })));
    render(<InvitePetugasPage />);
    await screen.findByRole('option', { name: 'Helpdesk OSS' });
    fireEvent.change(screen.getByLabelText(/^Email Petugas/), { target: { value: 'a@lmh.go.id' } });
    fireEvent.change(screen.getByLabelText(/^Nama Petugas/), { target: { value: 'Aa' } });
    fireEvent.change(screen.getByLabelText(/^Layanan/), { target: { value: 'l1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Petugas' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Email sudah terdaftar', 'error'));
    expect(screen.queryByText('Akun Berhasil Dibuat')).toBeNull();
  });
});
