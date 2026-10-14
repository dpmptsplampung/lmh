// @vitest-environment node
// Test pemeriksa sinkronisasi node_modules vs package-lock.json (scripts/check-deps-sync.mjs).
// Berada di src/test/ karena vitest.config.ts hanya mengambil src/** dan supabase/migrations/** (lihat check-audit.test.ts).
import { describe, expect, it } from 'vitest';
import {
  PAKET_DIPANTAU,
  formatLaporan,
  periksaSinkronDependensi,
  versiDariLock,
} from '../../scripts/check-deps-sync.mjs';

describe('periksaSinkronDependensi', () => {
  it('memantau next, sharp, dan eslint-config-next', () => {
    expect(PAKET_DIPANTAU).toEqual(['next', 'sharp', 'eslint-config-next']);
  });

  it('LOLOS: semua versi terpasang sama dengan lockfile', () => {
    const r = periksaSinkronDependensi({
      terpasang: { next: '16.3.8', sharp: '0.35.5', 'eslint-config-next': '16.4.0' },
      lock: { next: '16.3.8', sharp: '0.35.5', 'eslint-config-next': '16.4.0' },
    });
    expect(r.ok).toBe(true);
    expect(r.masalah).toEqual([]);
    expect(r.hasil.map((h) => h.status)).toEqual(['sama', 'sama', 'sama']);
    expect(formatLaporan(r).join('\n')).toContain('LOLOS');
  });

  it('GAGAL: versi terpasang berbeda dari lockfile (kasus audit: next 16.2.12 vs 16.3.6)', () => {
    const r = periksaSinkronDependensi({
      terpasang: { next: '16.2.12', sharp: '0.35.5', 'eslint-config-next': '16.4.0' },
      lock: { next: '16.3.6', sharp: '0.35.5', 'eslint-config-next': '16.4.0' },
    });
    expect(r.ok).toBe(false);
    expect(r.hasil[0]).toEqual({ paket: 'next', terpasang: '16.2.12', lock: '16.3.6', status: 'beda' });
    expect(r.masalah).toHaveLength(1);
    const laporan = formatLaporan(r).join('\n');
    expect(laporan).toContain('GAGAL');
    expect(laporan).toContain('16.2.12');
    expect(laporan).toContain('16.3.6');
    expect(laporan).toContain('`npm ci`');
  });

  it('GAGAL: sharp berbeda saja sudah cukup untuk menggagalkan', () => {
    const r = periksaSinkronDependensi({
      terpasang: { next: '16.3.8', sharp: '0.35.3', 'eslint-config-next': '16.4.0' },
      lock: { next: '16.3.8', sharp: '0.35.4', 'eslint-config-next': '16.4.0' },
    });
    expect(r.ok).toBe(false);
    expect(r.hasil.filter((h) => h.status === 'beda').map((h) => h.paket)).toEqual(['sharp']);
  });

  it('GAGAL: paket tidak terpasang di node_modules', () => {
    const r = periksaSinkronDependensi({
      terpasang: { next: '16.3.8', sharp: null },
      lock: { next: '16.3.8', sharp: '0.35.5', 'eslint-config-next': '16.4.0' },
    });
    expect(r.ok).toBe(false);
    const statusDari = (p: string) => r.hasil.find((h) => h.paket === p)?.status;
    expect(statusDari('sharp')).toBe('tidak_terpasang');
    // eslint-config-next tidak disebut sama sekali di `terpasang` = tidak terpasang
    expect(statusDari('eslint-config-next')).toBe('tidak_terpasang');
    expect(formatLaporan(r).join('\n')).toContain('npm ci');
  });

  it('GAGAL: paket terpasang tetapi tidak ada di lockfile', () => {
    const r = periksaSinkronDependensi({
      terpasang: { next: '16.3.8' },
      lock: { next: null },
      paket: ['next'],
    });
    expect(r.ok).toBe(false);
    expect(r.hasil[0].status).toBe('tidak_di_lockfile');
  });

  it('paket yang dipantau dapat ditentukan penelepon', () => {
    const r = periksaSinkronDependensi({ terpasang: { zod: '4.4.3' }, lock: { zod: '4.4.3' }, paket: ['zod'] });
    expect(r.ok).toBe(true);
    expect(r.hasil).toHaveLength(1);
  });
});

describe('versiDariLock', () => {
  const lock = {
    lockfileVersion: 3,
    packages: {
      '': { name: 'lampung-maju-hub' },
      'node_modules/next': { version: '16.3.8' },
      'node_modules/sharp': { version: '0.35.5' },
      'node_modules/pustaka/node_modules/next': { version: '9.9.9' },
    },
  };

  it('membaca versi dari packages["node_modules/<nama>"]', () => {
    expect(versiDariLock(lock, 'next')).toBe('16.3.8');
    expect(versiDariLock(lock, 'sharp')).toBe('0.35.5');
  });

  it('null bila tidak ada, dan tidak tertukar dengan salinan bersarang', () => {
    expect(versiDariLock(lock, 'eslint-config-next')).toBeNull();
    expect(versiDariLock({}, 'next')).toBeNull();
    expect(versiDariLock(null, 'next')).toBeNull();
  });
});
