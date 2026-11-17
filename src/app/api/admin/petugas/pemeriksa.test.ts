// @vitest-environment node
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/akun/server', () => ({ requireAdmin: vi.fn(), json: (b: unknown, status = 200) => Response.json(b, { status }), audit: vi.fn(), generateTempPassword: vi.fn() }));
import { requireAdmin } from '@/lib/akun/server';
import { GET } from './route';
it('daftar akun tidak membaca atau memancarkan saklar pemeriksa UMKM usang', async () => {
  const select = vi.fn(async (columns: string) => {
    if (columns.includes('pemeriksa_umkm')) throw new Error('Kolom usang tidak boleh dibaca');
    return { data: [{ id: 'p1', koordinator: false, operator_aktif: true }], error: null };
  });
  vi.mocked(requireAdmin).mockResolvedValue({
    actor: { id: 'p1', role: 'admin', aktif: true, auth_user_id: 'u1' },
    service: { rpc: async () => ({ data: [{ id: 'p1', nama: 'Petugas' }], error: null }), from: () => ({ select }) },
  } as unknown as Awaited<ReturnType<typeof requireAdmin>>);
  const res = await GET();
  expect(res.status).toBe(200);
  const hasil = await res.json();
  expect(hasil).toMatchObject({ akun: [{ id: 'p1', operator_aktif: true }] });
  expect(hasil).not.toHaveProperty('pemeriksa_umkm_tersedia');
  expect(hasil.akun[0]).not.toHaveProperty('pemeriksa_umkm');
});
