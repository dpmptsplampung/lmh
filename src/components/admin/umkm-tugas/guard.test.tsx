// @vitest-environment jsdom
// AdminGuard (lapisan UX; penegakan server ada di proxy.ts) dan akses menu modul UMKM.
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  pathname: '/petugas/antrean', role: 'petugas', modul: null as unknown, modulError: false, modulThrows: false,
  replace: vi.fn(), select: vi.fn(), rpc: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
  from: () => ({ select: (columns: string) => { mocks.select(columns); return { eq: () => ({
    maybeSingle: async () => ({ data: { role: mocks.role, aktif: true } }),
  }) }; } }),
  rpc: async (nama: string) => {
    mocks.rpc(nama);
    if (mocks.modulThrows) throw new Error('Tidak tersedia');
    return mocks.modulError ? { data: null, error: { code: '42883' } } : { data: mocks.modul, error: null };
  },
}) }));
import AdminGuard from '@/components/layout/AdminGuard';
import { susunPerintah } from '@/components/layout/PerintahCepat';

beforeEach(() => {
  mocks.pathname = '/petugas/antrean'; mocks.role = 'petugas'; mocks.modul = null; mocks.modulError = false; mocks.modulThrows = false;
  mocks.replace.mockReset(); mocks.select.mockClear(); mocks.rpc.mockClear();
});
afterEach(cleanup);

it('petugas membuka halaman biasa tanpa memanggil staf_modul', async () => {
  render(<AdminGuard><p>Pelayanan tetap tersedia</p></AdminGuard>);
  await screen.findByText('Pelayanan tetap tersedia');
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(mocks.select).toHaveBeenCalledWith('role, aktif');
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(['/petugas/umkm/tugas', '/petugas/umkm/laporan'])('petugas bermodul umkm lolos di %s', async (path) => {
  mocks.pathname = path; mocks.modul = 'umkm';
  render(<AdminGuard><p>Tampilan tugas</p></AdminGuard>);
  await screen.findByText('Tampilan tugas');
  expect(mocks.rpc).toHaveBeenCalledWith('staf_modul');
  expect(mocks.replace).not.toHaveBeenCalled();
});
it.each([
  ['tanpa modul', { modul: null }],
  ['modul investasi', { modul: 'investasi' }],
  ['nilai asing', { modul: 'lain' }],
  ['RPC galat (migrasi belum ada)', { modulError: true }],
  ['RPC melempar', { modulThrows: true }],
] as const)('petugas %s ditolak di halaman modul UMKM (fail-closed)', async (_nama, kondisi) => {
  mocks.pathname = '/petugas/umkm/tugas';
  Object.assign(mocks, kondisi);
  render(<AdminGuard><p>Tampilan tugas</p></AdminGuard>);
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/petugas/antrean'));
  expect(screen.queryByText('Tampilan tugas')).toBeNull();
});
it('halaman tugas /admin: admin lolos lewat role, tanpa modul', async () => {
  mocks.pathname = '/admin/umkm-tugas'; mocks.role = 'admin';
  render(<AdminGuard><p>Tampilan tugas</p></AdminGuard>);
  await screen.findByText('Tampilan tugas');
  expect(mocks.replace).not.toHaveBeenCalled();
});
it('FO tetap ditolak guard di halaman UMKM petugas', async () => {
  mocks.pathname = '/admin/umkm-tugas'; mocks.role = 'front_office';
  render(<AdminGuard><p>Tampilan tugas</p></AdminGuard>);
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/admin/antrian'));
  expect(screen.queryByText('Tampilan tugas')).toBeNull();
});
it('petugas yang membuka /admin/* dipantulkan ke area petugas; admin/FO di /petugas/* ke area admin', async () => {
  mocks.pathname = '/admin/antrian'; mocks.role = 'petugas';
  render(<AdminGuard><p>Isi</p></AdminGuard>);
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/petugas/antrean'));
  cleanup(); mocks.replace.mockReset();
  mocks.pathname = '/petugas/antrean'; mocks.role = 'front_office';
  render(<AdminGuard><p>Isi</p></AdminGuard>);
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/admin/antrian'));
});
it('perintah cepat mengikuti modul dan menolak FO', () => {
  expect(susunPerintah('petugas').some((x) => x.href === '/petugas/umkm/tugas')).toBe(false);
  expect(susunPerintah('petugas', { modul: 'umkm' }).some((x) => x.href === '/petugas/umkm/tugas')).toBe(true);
  expect(susunPerintah('petugas', { modul: 'umkm' }).some((x) => x.href.startsWith('/admin'))).toBe(false);
  expect(susunPerintah('front_office', { modul: 'umkm' }).some((x) => x.href === '/admin/umkm-tugas')).toBe(false);
});
