import { describe, it, expect } from 'vitest';
import {
  determineFormType,
  isLayananPendataan,
  canAccessPelayananStaff,
  bolehMulaiTiket,
  bolehSelesaikanTiket,
  bolehAmbilAlihTiket,
  kodeGalatAntrean,
  kodeGalatDariError,
  PESAN_GALAT_ANTREAN,
} from './pelayanan';
import { MutasiError } from '@/lib/supabase/mutate';

describe('determineFormType', () => {
  it('mendeteksi layanan OSS dari nama', () => {
    expect(determineFormType('Helpdesk OSS')).toBe('oss');
    expect(determineFormType('konsultasi OSS')).toBe('oss');
  });

  it('mendeteksi layanan Perizinan dari nama', () => {
    expect(determineFormType('Perizinan DPMPTSP')).toBe('perizinan');
    expect(determineFormType('Non OSS (SiCantik Lampung)')).toBe('perizinan');
  });

  it('mengembalikan null untuk layanan lain', () => {
    expect(determineFormType('Pengaduan')).toBeNull();
    expect(determineFormType('SKM')).toBeNull();
  });
});

describe('isLayananPendataan', () => {
  it('true hanya untuk layanan OSS/Perizinan', () => {
    expect(isLayananPendataan('Helpdesk OSS')).toBe(true);
    expect(isLayananPendataan('Perizinan DPMPTSP')).toBe(true);
    expect(isLayananPendataan('Pengaduan')).toBe(false);
  });
});

describe('canAccessPelayananStaff', () => {
  const tiketLayanan = 'l-oss';

  it('admin dan front_office boleh akses semua layanan', () => {
    expect(canAccessPelayananStaff({ role: 'admin', layanan_id: null }, tiketLayanan)).toBe(true);
    expect(
      canAccessPelayananStaff({ role: 'front_office', layanan_id: 'l-lain' }, tiketLayanan)
    ).toBe(true);
  });

  it('petugas hanya boleh akses tiket pada layanan tempatnya bertugas', () => {
    expect(canAccessPelayananStaff({ role: 'petugas', layanan_id: 'l-oss' }, tiketLayanan)).toBe(
      true
    );
    expect(canAccessPelayananStaff({ role: 'petugas', layanan_id: 'l-lain' }, tiketLayanan)).toBe(
      false
    );
  });

  it('petugas tanpa layanan atau tiket tanpa layanan ditolak', () => {
    expect(canAccessPelayananStaff({ role: 'petugas', layanan_id: null }, tiketLayanan)).toBe(false);
    expect(canAccessPelayananStaff({ role: 'petugas', layanan_id: 'l-oss' }, null)).toBe(false);
  });

  it('role tak dikenal ditolak', () => {
    expect(canAccessPelayananStaff({ role: 'pengunjung', layanan_id: 'l-oss' }, tiketLayanan)).toBe(
      false
    );
  });
});

describe('kepemilikan tiket (migrasi 202610140002)', () => {
  const admin = { id: 'p-admin', role: 'admin', layanan_id: null };
  const petA = { id: 'p-a', role: 'petugas', layanan_id: 'l-a' };
  const petB = { id: 'p-b', role: 'petugas', layanan_id: 'l-b' };
  const fo = { id: 'p-fo', role: 'front_office', layanan_id: null };
  const menunggu = { status: 'menunggu', dilayani_oleh: null, layanan_id: 'l-a' };
  const dilayaniA = { status: 'dilayani', dilayani_oleh: 'p-a', layanan_id: 'l-a' };

  it('bolehMulaiTiket: admin semua layanan, petugas hanya layanannya, FO tidak, hanya status menunggu', () => {
    expect(bolehMulaiTiket(admin, menunggu)).toBe(true);
    expect(bolehMulaiTiket(petA, menunggu)).toBe(true);
    expect(bolehMulaiTiket(petB, menunggu)).toBe(false);
    expect(bolehMulaiTiket(fo, menunggu)).toBe(false);
    expect(bolehMulaiTiket(null, menunggu)).toBe(false);
    expect(bolehMulaiTiket(petA, dilayaniA)).toBe(false);
  });

  it('bolehSelesaikanTiket: hanya pemilik tiket dilayani (admin pun tidak bila bukan pemilik)', () => {
    expect(bolehSelesaikanTiket(petA, dilayaniA)).toBe(true);
    expect(bolehSelesaikanTiket(admin, dilayaniA)).toBe(false);
    expect(bolehSelesaikanTiket(petB, dilayaniA)).toBe(false);
    expect(bolehSelesaikanTiket(fo, { ...dilayaniA, dilayani_oleh: 'p-fo' })).toBe(false);
    expect(bolehSelesaikanTiket(petA, { ...dilayaniA, status: 'selesai' })).toBe(false);
    expect(bolehSelesaikanTiket(petA, { ...dilayaniA, dilayani_oleh: null })).toBe(false);
    expect(bolehSelesaikanTiket({ id: null, role: 'petugas' }, { ...dilayaniA, dilayani_oleh: null })).toBe(false);
    expect(bolehSelesaikanTiket(admin, { ...dilayaniA, dilayani_oleh: 'p-admin' })).toBe(true);
  });

  it('bolehAmbilAlihTiket: hanya admin, tiket dilayani milik orang lain atau tanpa pemilik', () => {
    expect(bolehAmbilAlihTiket(admin, dilayaniA)).toBe(true);
    expect(bolehAmbilAlihTiket(admin, { ...dilayaniA, dilayani_oleh: null })).toBe(true);
    expect(bolehAmbilAlihTiket(admin, { ...dilayaniA, dilayani_oleh: 'p-admin' })).toBe(false);
    expect(bolehAmbilAlihTiket(admin, menunggu)).toBe(false);
    expect(bolehAmbilAlihTiket(petB, dilayaniA)).toBe(false);
    expect(bolehAmbilAlihTiket(fo, dilayaniA)).toBe(false);
  });

  it('kodeGalatAntrean membaca awalan kode dari pesan RPC', () => {
    expect(kodeGalatAntrean('SUDAH_DIAMBIL: tiket sudah ditangani petugas lain')).toBe('SUDAH_DIAMBIL');
    expect(kodeGalatAntrean('BUKAN_PEMILIK: x')).toBe('BUKAN_PEMILIK');
    expect(kodeGalatAntrean('SESI_TIDAK_SAH: x')).toBe('SESI_TIDAK_SAH');
    expect(kodeGalatAntrean('TRANSISI_LEWAT_RPC: gunakan layanan_mulai')).toBe('TRANSISI_LEWAT_RPC');
    expect(kodeGalatAntrean('Forbidden')).toBeNull();
    expect(kodeGalatAntrean('boom')).toBeNull();
    expect(kodeGalatAntrean(undefined)).toBeNull();
  });

  it('kodeGalatDariError: dari MutasiError.asal maupun objek error PostgREST', () => {
    const e = new MutasiError('database', { asal: { message: 'SUDAH_DIAMBIL: tiket sudah ditangani petugas lain', code: 'P0001' } });
    expect(kodeGalatDariError(e)).toBe('SUDAH_DIAMBIL');
    expect(kodeGalatDariError({ message: 'BUKAN_PEMILIK: x' })).toBe('BUKAN_PEMILIK');
    expect(kodeGalatDariError(new MutasiError('tidak_ada_baris'))).toBeNull();
    expect(kodeGalatDariError(null)).toBeNull();
    expect(PESAN_GALAT_ANTREAN.SUDAH_DIAMBIL).toBe('Tiket ini sudah ditangani petugas lain.');
  });
});
