import { describe, it, expect } from 'vitest';
import { MutasiError } from '@/lib/supabase/mutate';
import {
  awalHariWIBIso,
  BATAS_CATATAN_FO,
  formatJamWIB,
  formatLama,
  galatPerluMuatUlang,
  galatSesiTidakSah,
  kodeGalatFo,
  labelSaluran,
  pesanGalatFo,
  PESAN_GALAT_FO,
  satu,
  validasiTopikCatatan,
} from './fo-penanganan';

describe('kodeGalatFo (kontrak: kode di awal pesan)', () => {
  it('membaca kode di awal pesan galat PostgREST', () => {
    expect(kodeGalatFo({ message: 'SUDAH_DIAMBIL: penanganan sudah diambil' })).toBe('SUDAH_DIAMBIL');
    expect(kodeGalatFo({ message: 'LAYANAN_TUTUP' })).toBe('LAYANAN_TUTUP');
  });

  it('membaca kode dari MutasiError lewat galat asal', () => {
    const e = new MutasiError('database', { asal: { message: 'CATATAN_WAJIB: catatan kosong', code: '22023' } });
    expect(kodeGalatFo(e)).toBe('CATATAN_WAJIB');
  });

  it('kode yang dibungkus prefiks tetap ditemukan sebagai kata utuh', () => {
    expect(kodeGalatFo({ message: 'rpc gagal: BUKAN_PEMILIK: bukan penangan' })).toBe('BUKAN_PEMILIK');
  });

  it('bukan kode FO / bukan galat -> null (tidak menebak dari substring)', () => {
    expect(kodeGalatFo({ message: 'TypeError: Failed to fetch' })).toBeNull();
    expect(kodeGalatFo({ message: 'XNOT_FOUNDX' })).toBeNull();
    expect(kodeGalatFo(null)).toBeNull();
    expect(kodeGalatFo(undefined)).toBeNull();
    expect(kodeGalatFo(42)).toBeNull();
  });

  it('semua kode kontrak memiliki pesan Indonesia tidak kosong tanpa nama kode teknis', () => {
    for (const [kode, pesan] of Object.entries(PESAN_GALAT_FO)) {
      expect(pesan.length).toBeGreaterThan(10);
      expect(pesan).not.toContain(kode);
      expect(kodeGalatFo({ message: `${kode}: x` })).toBe(kode);
    }
  });
});

describe('pesanGalatFo / klasifikasi', () => {
  it('kode dikenal -> pesan terpetakan', () => {
    expect(pesanGalatFo({ message: 'SUDAH_DIAMBIL: x' })).toBe(PESAN_GALAT_FO.SUDAH_DIAMBIL);
  });

  it('MutasiError tanpa kode FO -> pesan helper mutasi (jaringan), tidak membocorkan pesan teknis', () => {
    const e = new MutasiError('jaringan', { asal: { message: 'Failed to fetch' } });
    expect(pesanGalatFo(e)).toMatch(/Koneksi bermasalah/);
  });

  it('error asing -> fallback', () => {
    expect(pesanGalatFo(new Error('aneh'), 'Gagal.')).toBe('Gagal.');
  });

  it('galatPerluMuatUlang: hanya galat yang menandakan tampilan basi', () => {
    expect(galatPerluMuatUlang({ message: 'SUDAH_DIAMBIL: x' })).toBe(true);
    expect(galatPerluMuatUlang({ message: 'INVALID_STATUS: x' })).toBe(true);
    expect(galatPerluMuatUlang({ message: 'CATATAN_WAJIB: x' })).toBe(false);
    expect(galatPerluMuatUlang({ message: 'LAYANAN_TUTUP: x' })).toBe(false);
  });

  it('galatSesiTidakSah', () => {
    expect(galatSesiTidakSah({ message: 'SESI_TIDAK_SAH: x' })).toBe(true);
    expect(galatSesiTidakSah({ message: 'FORBIDDEN: x' })).toBe(false);
  });
});

describe('validasiTopikCatatan (cermin aturan DB)', () => {
  it('topik wajib, catatan wajib (spasi saja = kosong), maksimal 200', () => {
    expect(validasiTopikCatatan('', 'ada')).toBe(PESAN_GALAT_FO.TOPIK_WAJIB);
    expect(validasiTopikCatatan('t', '   ')).toBe(PESAN_GALAT_FO.CATATAN_WAJIB);
    expect(validasiTopikCatatan('t', 'a'.repeat(BATAS_CATATAN_FO + 1))).toBe(PESAN_GALAT_FO.CATATAN_TERLALU_PANJANG);
    expect(validasiTopikCatatan('t', 'a'.repeat(BATAS_CATATAN_FO))).toBeNull();
    expect(validasiTopikCatatan('t', ' ringkas ')).toBeNull();
  });
});

describe('helper tampilan', () => {
  it('awalHariWIBIso = 00:00 WIB (17:00 UTC hari sebelumnya)', () => {
    expect(awalHariWIBIso()).toMatch(/^\d{4}-\d{2}-\d{2}T17:00:00\.000Z$/);
  });

  it('formatJamWIB memakai zona WIB, bukan zona mesin', () => {
    expect(formatJamWIB('2026-10-13T02:30:00.000Z')).toBe('09.30');
    expect(formatJamWIB('2026-10-13T17:05:00.000Z')).toBe('00.05'); // lewat tengah malam WIB
    expect(formatJamWIB(null)).toBe('-');
    expect(formatJamWIB('bukan tanggal')).toBe('-');
  });

  it('formatLama', () => {
    const sekarang = new Date('2026-10-13T03:00:00.000Z');
    expect(formatLama('2026-10-13T02:59:40.000Z', sekarang)).toBe('baru saja');
    expect(formatLama('2026-10-13T02:55:00.000Z', sekarang)).toBe('5 menit');
    expect(formatLama('2026-10-13T01:50:00.000Z', sekarang)).toBe('1 jam 10 menit');
    expect(formatLama('2026-10-13T01:00:00.000Z', sekarang)).toBe('2 jam');
    expect(formatLama(null, sekarang)).toBe('-');
  });

  it('labelSaluran dan satu()', () => {
    expect(labelSaluran('walk_in')).toBe('Walk-in');
    expect(labelSaluran('qr')).toBe('Reservasi (QR)');
    expect(labelSaluran('chat')).toBe('Chat');
    expect(satu([{ a: 1 }])).toEqual({ a: 1 });
    expect(satu({ a: 2 })).toEqual({ a: 2 });
    expect(satu(null)).toBeNull();
    expect(satu([])).toBeNull();
  });
});
