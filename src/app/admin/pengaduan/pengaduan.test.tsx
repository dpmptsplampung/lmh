// @vitest-environment jsdom
// RBAC Tahap 1: Petugas hanya lihat; tab integritas Admin saja; FO menindaklanjuti jalur layanan.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({ role: 'petugas' as string }));

vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: { role: h.role } }) }),
      }),
    }),
  }),
}));

import AdminPengaduanPage from './page';

const row = (jalur: 'layanan' | 'integritas') => ({
  id: `id-${jalur}`, nomor_tiket: `PGD-${jalur}`, jalur, layanan_id: 'l1', status: 'baru',
  batas_verifikasi: '2099-01-01', batas_penanganan: '2099-01-02', anonim: false,
  created_at: '2026-10-01T00:00:00Z', isi: 'isi pengaduan',
});

describe('admin pengaduan: akses per role', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: [row('layanan')], total: 1 }) })));
  });
  afterEach(cleanup);

  it('petugas: hanya lihat, tanpa tab integritas dan tanpa aksi ubah status', async () => {
    h.role = 'petugas';
    render(<AdminPengaduanPage />);
    expect(await screen.findByText(/Anda hanya dapat melihat pengaduan layanan Anda/)).toBeTruthy();
    await screen.findByText('PGD-layanan');
    expect(screen.queryByRole('button', { name: /Integritas/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Verifikasi|Proses|Selesaikan|Tolak/ })).toBeNull();
  });

  it('front office: punya aksi pada jalur layanan, tanpa tab integritas', async () => {
    h.role = 'front_office';
    render(<AdminPengaduanPage />);
    expect(await screen.findByRole('button', { name: 'Verifikasi' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Integritas/ })).toBeNull();
    expect(screen.queryByText(/Anda hanya dapat melihat/)).toBeNull();
  });

  it('admin: tab integritas dan aksi tersedia', async () => {
    h.role = 'admin';
    render(<AdminPengaduanPage />);
    expect(await screen.findByRole('button', { name: /Integritas/ })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Verifikasi' })).toBeTruthy();
  });
});
