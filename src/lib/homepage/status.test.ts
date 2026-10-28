import { describe, expect, it } from 'vitest';
import { ringkasStatus } from './status';

const kamis = [{ hari: 4, jamMulai: '08:00', jamSelesai: '15:30' }];
const senJum = [1, 2, 3, 4, 5].map((hari) => ({ hari, jamMulai: '08:00', jamSelesai: '15:30' }));

describe('ringkasStatus', () => {
  it('buka -> "Buka sekarang"', () => {
    expect(ringkasStatus({ buka: true, liburKeterangan: null, jadwal: senJum })).toEqual({ nada: 'buka', teks: 'Buka sekarang' });
  });
  it('tutup + hanya buka Kamis -> "Tutup saat ini · Buka setiap Kamis"', () => {
    expect(ringkasStatus({ buka: false, liburKeterangan: null, jadwal: kamis })).toEqual({
      nada: 'tutup',
      teks: 'Tutup saat ini · Buka setiap Kamis',
    });
  });
  it('libur nasional menyebut keterangan dan hari buka', () => {
    expect(ringkasStatus({ buka: false, liburKeterangan: 'Idul Fitri', jadwal: senJum })).toEqual({
      nada: 'libur',
      teks: 'Libur: Idul Fitri · Buka Senin–Jumat',
    });
  });
  it('tutup tanpa jadwal sama sekali -> jadwal belum diatur', () => {
    expect(ringkasStatus({ buka: false, liburKeterangan: null, jadwal: [] })?.teks).toBe('Tutup saat ini · Jadwal belum diatur');
  });
  it('status tidak diketahui -> null (tidak ditebak)', () => {
    expect(ringkasStatus(null)).toBeNull();
    expect(ringkasStatus(undefined)).toBeNull();
  });
});
