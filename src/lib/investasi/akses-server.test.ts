// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { requireKelolaInvestasi } from './akses-server';
import { buatSupabaseTiruan } from '@/app/api/admin/ipro/uji-fixture';
let tiruan: ReturnType<typeof buatSupabaseTiruan>;
beforeEach(() => { tiruan = buatSupabaseTiruan(); vi.mocked(createClient).mockResolvedValue(tiruan.sb); });
it('tanpa user menolak 401 sebelum pemeriksaan hak', async () => {
  tiruan.state.user = null;
  expect((await requireKelolaInvestasi('r')).response?.status).toBe(401);
  expect(tiruan.state.rpc).toHaveLength(0);
});
it('akses ditentukan helper database, FO dan modul lain ditolak 403', async () => {
  tiruan.state.boleh = false;
  expect((await requireKelolaInvestasi('r')).response?.status).toBe(403);
  expect(tiruan.state.rpc[0].nama).toBe('boleh_kelola_investasi');
});
it.each([['42501', 403], ['PGRST301', 401], ['PGRST302', 401], ['XX000', 500]])('RPC %s tertutup dengan status %i', async (code, status) => {
  tiruan.state.rpcError = { message: 'internal rahasia', code };
  const hasil = await requireKelolaInvestasi('r');
  expect(hasil.client).toBeUndefined();
  expect(hasil.response?.status).toBe(status);
  expect(await hasil.response?.text()).not.toContain('rahasia');
});
it('jaringan RPC gagal menghasilkan 500 tanpa memberikan klien', async () => {
  vi.spyOn(tiruan.sb, 'rpc').mockRejectedValueOnce(new Error('internal rahasia'));
  const hasil = await requireKelolaInvestasi('r');
  expect(hasil.client).toBeUndefined();
  expect(hasil.response?.status).toBe(500);
  expect(await hasil.response?.text()).not.toContain('rahasia');
});
it('pengelola menerima klien JWT yang sama', async () => expect((await requireKelolaInvestasi('r')).client).toBe(tiruan.sb));
