// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { GET, PATCH } from './route';

const me = { id: 'staff-1', nama: 'Lama', username: 'petugas-1', role: 'petugas', aktif: true,
  no_hp: null, email_notifikasi: null, email_notifikasi_verified_at: null, operator_default: 'Operator Lama', layanan: null };
let flag: { data: { operator_aktif: boolean } | null; error: { code: string } | null };
let rpc: ReturnType<typeof vi.fn>;
let currentMe = { ...me };
let user: { id: string } | null;
const req = (body: unknown) => new Request('http://localhost/api/me/profil', {
  method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
}) as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  flag = { data: { operator_aktif: false }, error: null };
  user = { id: 'auth-1' };
  currentMe = { ...me };
  rpc = vi.fn(async (_name: string, args: { p_patch: Record<string, unknown> }) => {
    currentMe = { ...currentMe, ...args.p_patch };
    return { error: null };
  });
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }) },
    rpc, from: () => ({ select: (columns: string) => ({ eq: () => ({ maybeSingle: async () =>
      columns === 'operator_aktif' ? flag : { data: currentMe, error: null } }) }) }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
});

describe('Profil sendiri', () => {
  it('nama dapat diperbarui melalui RPC sesi sendiri', async () => {
    const res = await PATCH(req({ nama: '  Nama Baru  ' }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('petugas_ubah_profil', { p_patch: { nama: 'Nama Baru' } });
    expect(await res.json()).toMatchObject({ ok: true, verifikasi_dikirim: false, profil: { nama: 'Nama Baru', operator_aktif: false } });
  });
  it('email dinormalisasi sebelum RPC; alamat yang sama boleh dipakai akun lain', async () => {
    const res = await PATCH(req({ email_notifikasi: '  WARGA@EXAMPLE.COM  ' }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('petugas_ubah_profil', { p_patch: { email_notifikasi: 'warga@example.com' } });
  });
  it.each(['', 'A', 'A'.repeat(101), '=SUM(A1)', '+Nama', '-Nama', '@Nama', 'Nama\nBaru', '\tNama', '\u200bNama', null, 42])(
    'nama tidak sah ditolak dengan field nama: %s', async (nama) => {
      const res = await PATCH(req({ nama }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ field: 'nama' });
      expect(rpc).not.toHaveBeenCalled();
    });
  it.each(['Tidak berlaku', 'petugas@staf.lmh.internal', 'petugas@lain.internal'])('email pengganti ditolak: %s', async (email_notifikasi) => {
    const res = await PATCH(req({ email_notifikasi }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'email_notifikasi' });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{}, { nama: 'Baik', role: 'admin' }, { operator_aktif: true }])('patch kosong/kolom terlarang ditolak', async (patch) => {
    expect((await PATCH(req(patch))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('HP ternormalisasi dan kosong dapat dihapus', async () => {
    expect((await PATCH(req({ no_hp: '0812 3456 7890' }))).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith('petugas_ubah_profil', { p_patch: { no_hp: '+6281234567890' } });
    expect((await PATCH(req({ no_hp: '  ' }))).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith('petugas_ubah_profil', { p_patch: { no_hp: null } });
    const res = await PATCH(req({ no_hp: 'bukan nomor' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'no_hp' });
  });
  it('sebelum migrasi: GET flag false, PATCH nama 409, HP/email lama tetap berjalan', async () => {
    flag = { data: null, error: { code: '42703' } };
    expect(await (await GET()).json()).toMatchObject({ profil: { operator_aktif: false } });
    const res = await PATCH(req({ nama: 'Nama Baru' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ kode: 'MIGRASI_BELUM_DITERAPKAN' });
    expect(rpc).not.toHaveBeenCalled();
    expect((await PATCH(req({ no_hp: null, email_notifikasi: null }))).status).toBe(200);
  });
  it('operator lama tersembunyi dan perubahan ditolak sampai diaktifkan Admin', async () => {
    expect(await (await GET()).json()).toMatchObject({ profil: { operator_default: 'Operator Lama', operator_aktif: false } });
    expect((await PATCH(req({ operator_default: 'Operator Baru' }))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    flag.data = { operator_aktif: true };
    const res = await PATCH(req({ operator_default: 'Operator Baru' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ profil: { operator_default: 'Operator Baru', operator_aktif: true } });
  });
  it('galat baca flag selain objek belum ada menolak perubahan', async () => {
    flag = { data: null, error: { code: 'XX000' } };
    expect((await GET()).status).toBe(500);
    expect((await PATCH(req({ no_hp: null }))).status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([['42501', 403], ['22023', 400], ['PGRST202', 409], ['XX000', 500]])('galat RPC %s menjadi HTTP %s', async (code, status) => {
    rpc.mockResolvedValue({ error: { code } });
    expect((await PATCH(req({ nama: 'Nama Baru' }))).status).toBe(status);
  });
  it('sesi tidak ada tidak dapat membaca atau menulis profil', async () => {
    user = null;
    expect((await GET()).status).toBe(401);
    expect((await PATCH(req({ nama: 'Nama Baru' }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('galat validasi email dari DB diteruskan ke isian email tanpa membocorkan detail teknis', async () => {
    rpc.mockResolvedValue({ error: { code: '22023', details: 'email_notifikasi', message: 'MASUKAN_TIDAK_VALID: email nyata' } });
    const res = await PATCH(req({ email_notifikasi: 'orang@example.com' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'email_notifikasi', error: 'Gunakan alamat email notifikasi yang nyata' });
  });
});
