// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ pathname: '/admin/antrian', role: 'petugas', flagError: false, throws: false, replace: vi.fn(), select: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
  from: () => ({ select: (columns: string) => { mocks.select(columns); return { eq: () => ({ maybeSingle: async () => {
    if (columns === 'role, aktif') return { data: { role: mocks.role, aktif: true } };
    if (mocks.throws) throw new Error('Tidak tersedia');
    return { data: mocks.flagError ? null : { pemeriksa_umkm: false }, error: mocks.flagError ? { code: '42703' } : null };
  } }) }; } }),
}) }));
import AdminGuard from '@/components/layout/AdminGuard';
import { susunPerintah } from '@/components/layout/PerintahCepat';

beforeEach(() => { mocks.pathname = '/admin/antrian'; mocks.role = 'petugas'; mocks.flagError = false; mocks.throws = false; mocks.replace.mockReset(); mocks.select.mockClear(); });
afterEach(cleanup);
it.each([false, true])('staf tetap membuka halaman lama saat flag gagal, throw=%s', async (throws) => {
  mocks.flagError = true; mocks.throws = throws;
  render(<AdminGuard><p>Pelayanan tetap tersedia</p></AdminGuard>);
  await screen.findByText('Pelayanan tetap tersedia');
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(mocks.select).toHaveBeenCalledWith('role, aktif');
  expect(mocks.select).toHaveBeenCalledWith('pemeriksa_umkm');
});
it.each(['admin', 'petugas'])('halaman tugas %s boleh menjelaskan tanpa izin dari API', async (role) => {
  mocks.pathname = '/admin/umkm-tugas'; mocks.role = role; mocks.flagError = true;
  render(<AdminGuard><p>Tampilan tugas</p></AdminGuard>);
  await screen.findByText('Tampilan tugas');
  expect(mocks.replace).not.toHaveBeenCalled();
});
it('FO tetap ditolak guard', async () => {
  mocks.pathname = '/admin/umkm-tugas'; mocks.role = 'front_office';
  render(<AdminGuard><p>Tampilan tugas</p></AdminGuard>);
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/admin/antrian'));
  expect(screen.queryByText('Tampilan tugas')).toBeNull();
});
it('perintah cepat mengikuti flag dan menolak FO', () => {
  expect(susunPerintah('petugas').some((x) => x.href === '/admin/umkm-tugas')).toBe(false);
  expect(susunPerintah('petugas', { pemeriksa_umkm: true }).some((x) => x.href === '/admin/umkm-tugas')).toBe(true);
  expect(susunPerintah('front_office', { pemeriksa_umkm: true }).some((x) => x.href === '/admin/umkm-tugas')).toBe(false);
});
