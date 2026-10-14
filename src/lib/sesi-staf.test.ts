import { describe, it, expect, vi } from 'vitest';
import {
  daftarkanSesiStaf,
  keluarDariSesi,
  parseAlasanSesi,
  uraiHasilPing,
  apakahPeranStaf,
} from './sesi-staf';

type Rpc = ReturnType<typeof vi.fn>;
const klien = (rpc: Rpc, signOut: Rpc = vi.fn().mockResolvedValue({ error: null })) =>
  ({ rpc, auth: { signOut } }) as never;

describe('parseAlasanSesi / apakahPeranStaf', () => {
  it('hanya menerima alasan yang dikenal (input URL tak tepercaya)', () => {
    expect(parseAlasanSesi('digantikan')).toBe('digantikan');
    expect(parseAlasanSesi('tutup')).toBe('tutup');
    expect(parseAlasanSesi('<script>')).toBeNull();
    expect(parseAlasanSesi(null)).toBeNull();
  });
  it('peran staf = admin/petugas/front_office', () => {
    expect(['admin', 'petugas', 'front_office'].every(apakahPeranStaf)).toBe(true);
    expect(apakahPeranStaf('pengunjung')).toBe(false);
    expect(apakahPeranStaf(undefined)).toBe(false);
  });
});

describe('uraiHasilPing', () => {
  it('valid, tidak valid, dan bentuk di luar kontrak', () => {
    expect(uraiHasilPing({ valid: true, status: 'ok', tutup: true })).toEqual({ jenis: 'valid', status: 'ok', tutup: true });
    expect(uraiHasilPing({ valid: false, status: 'idle', alasan: 'idle' })).toEqual({ jenis: 'tidak_valid', alasan: 'idle' });
    expect(uraiHasilPing({ valid: false, status: 'aneh', alasan: 'aneh' })).toEqual({ jenis: 'tak_dikenal' });
    expect(uraiHasilPing(null)).toEqual({ jenis: 'tak_dikenal' });
    expect(uraiHasilPing('ok')).toEqual({ jenis: 'tak_dikenal' });
  });
});

describe('daftarkanSesiStaf', () => {
  it('sukses', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    expect(await daftarkanSesiStaf(klien(rpc))).toEqual({ status: 'terdaftar' });
    expect(rpc).toHaveBeenCalledWith('daftarkan_sesi');
  });
  it('FORBIDDEN (bukan staf) bukan galat', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'FORBIDDEN: sesi tunggal hanya untuk staf', code: '42501' } });
    expect(await daftarkanSesiStaf(klien(rpc))).toEqual({ status: 'bukan_staf' });
  });
  it('SESI_TANPA_KLAIM dilaporkan sebagai gagal khusus', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'SESI_TANPA_KLAIM: JWT tidak memuat', code: '22023' } });
    expect(await daftarkanSesiStaf(klien(rpc))).toEqual({ status: 'gagal', kode: 'tanpa_klaim' });
  });
  it('galat lain atau jaringan = gagal (tidak diloloskan)', async () => {
    expect(await daftarkanSesiStaf(klien(vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }))))
      .toEqual({ status: 'gagal', kode: 'lainnya' });
    expect(await daftarkanSesiStaf(klien(vi.fn().mockRejectedValue(new TypeError('fetch failed')))))
      .toEqual({ status: 'gagal', kode: 'lainnya' });
  });
});

describe('keluarDariSesi', () => {
  it('akhiri_sesi dulu, lalu signOut hanya sesi ini', async () => {
    const urutan: string[] = [];
    const rpc = vi.fn(async () => { urutan.push('rpc'); return { data: { ok: true }, error: null }; });
    const signOut = vi.fn(async () => { urutan.push('signOut'); return { error: null }; });
    await keluarDariSesi(klien(rpc, signOut));
    expect(rpc).toHaveBeenCalledWith('akhiri_sesi');
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(urutan).toEqual(['rpc', 'signOut']);
  });
  it('kegagalan akhiri_sesi (error maupun menolak) tidak menghalangi signOut', async () => {
    for (const rpc of [
      vi.fn().mockResolvedValue({ data: null, error: { message: 'down' } }),
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    ]) {
      const signOut = vi.fn().mockResolvedValue({ error: null });
      await keluarDariSesi(klien(rpc, signOut));
      expect(signOut).toHaveBeenCalledTimes(1);
    }
  });
  it('akhiri:false melewati akhiri_sesi (sesi sudah dinyatakan tak sah)', async () => {
    const rpc = vi.fn();
    const signOut = vi.fn().mockResolvedValue({ error: null });
    await keluarDariSesi(klien(rpc, signOut), { akhiri: false });
    expect(rpc).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
  });
});
