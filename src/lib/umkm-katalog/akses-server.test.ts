// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bolehUnggahDraf, jalurAkun } from './akses-server';
const user = { id: '11111111-1111-4111-8111-111111111111', is_anonymous: false };
function client(staf: unknown = null) {
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const value = { rpc, from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: staf, error: null }) }) }) })) };
  return { rpc, value: value as unknown as Pick<SupabaseClient, 'from' | 'rpc'> };
}
it('jalur akun mengenali penanda klien dan folder akun sendiri', () => {
  expect(jalurAkun('akun/foto.jpg', user.id)).toBe(true);
  expect(jalurAkun(`${user.id}/foto.jpg`, user.id)).toBe(true);
  expect(jalurAkun('22222222-2222-4222-8222-222222222222/foto.jpg', user.id)).toBe(false);
  expect(jalurAkun(undefined, user.id)).toBe(false);
});
it('akun biasa boleh mengunggah ke foldernya sebelum punya profil', async () => {
  const c = client();
  expect(await bolehUnggahDraf(c.value, user, 'akun/foto.jpg')).toBe(true);
  expect(await bolehUnggahDraf(c.value, user, `${user.id}/foto.jpg`)).toBe(true);
  expect(c.rpc).not.toHaveBeenCalled();
});
it('akun anonim ditolak', async () => {
  expect(await bolehUnggahDraf(client().value, { ...user, is_anonymous: true }, 'akun/foto.jpg')).toBe(false);
});
it('folder profil tetap diperiksa dan akun lain ditolak', async () => {
  const c = client();
  expect(await bolehUnggahDraf(c.value, user, '22222222-2222-4222-8222-222222222222/foto.jpg')).toBe(false);
  expect(c.rpc).toHaveBeenCalledWith('umkm_akses_draf_pemilik', { p_profil_id: '22222222-2222-4222-8222-222222222222' });
});
it('petugas modul UMKM boleh unggah walau flag lama false', async () => {
  const c = client({ role: 'petugas', aktif: true, pemeriksa_umkm: false });
  c.rpc.mockImplementation(async (nama?: string) => ({ data: nama === 'staf_modul' ? 'umkm' : true, error: null }) as never);
  expect(await bolehUnggahDraf(c.value, user, 'akun/foto.jpg')).toBe(true);
  expect(c.rpc).toHaveBeenCalledWith('staf_modul');
});
it('petugas modul lain ditolak walau flag lama true', async () => {
  const c = client({ role: 'petugas', aktif: true, pemeriksa_umkm: true });
  c.rpc.mockImplementation(async (nama?: string) => ({ data: nama === 'staf_modul' ? 'investasi' : true, error: null }) as never);
  expect(await bolehUnggahDraf(c.value, user, 'akun/foto.jpg')).toBe(false);
});
it('admin tanpa flag boleh unggah dengan sesi sah', async () => {
  const c = client({ role: 'admin', aktif: true });
  c.rpc.mockResolvedValue({ data: true, error: null } as never);
  expect(await bolehUnggahDraf(c.value, user, 'akun/foto.jpg')).toBe(true);
  expect(c.rpc).not.toHaveBeenCalledWith('staf_modul');
});
it('modul galat/null atau melempar dan sesi tidak sah menolak', async () => {
  for (const hasil of [{ data: null, error: null }, { data: 'umkm', error: { message: 'gagal' } }]) {
    const c = client({ role: 'petugas', aktif: true, pemeriksa_umkm: true });
    c.rpc.mockImplementation(async (nama?: string) => (nama === 'staf_modul' ? hasil : { data: true, error: null }) as never);
    expect(await bolehUnggahDraf(c.value, user, 'akun/foto.jpg')).toBe(false);
  }
  const c = client({ role: 'admin', aktif: true });
  expect(await bolehUnggahDraf(c.value, user, 'akun/foto.jpg')).toBe(false);
  c.rpc.mockRejectedValue(new Error('jaringan'));
  expect(await bolehUnggahDraf(c.value, user, 'akun/foto.jpg')).toBe(false);
});
it('staf nonaktif dan FO tidak menerima hak unggah akun biasa', async () => {
  for (const staf of [{ role: 'petugas', aktif: false }, { role: 'front_office', aktif: true }]) {
    expect(await bolehUnggahDraf(client(staf).value, user, 'akun/foto.jpg')).toBe(false);
  }
});
