import { describe, expect, it } from 'vitest';
import { hariKerjaBerikutnya, hitungMode, labelTanggalID, parseJamTutup } from './bot-waktu';

const wib = (iso: string) => new Date(`${iso}+07:00`);
const tanpaLibur = new Set<string>();

describe('parseJamTutup', () => {
  it('"16:00" -> 960; nilai buruk/kosong -> default 16:00', () => {
    expect(parseJamTutup('16:00')).toBe(960);
    expect(parseJamTutup('9:30')).toBe(570);
    expect(parseJamTutup('25:99')).toBe(960);
    expect(parseJamTutup(null)).toBe(960);
  });
});

describe('hitungMode (WIB)', () => {
  it('Rabu 10:00 buka; 15:59 buka; 16:00 tutup (setelah_jam_tutup) -> Kamis', () => {
    expect(hitungMode(wib('2026-08-05T10:00:00'), 960, tanpaLibur).tutup).toBe(false);
    expect(hitungMode(wib('2026-08-05T15:59:00'), 960, tanpaLibur).tutup).toBe(false);
    const m = hitungMode(wib('2026-08-05T16:00:00'), 960, tanpaLibur);
    expect(m).toMatchObject({ tutup: true, alasan: 'setelah_jam_tutup', kerjaBerikutnya: '2026-08-06' });
  });
  it('batas hari memakai WIB, bukan UTC (Rabu 23:30 WIB = Rabu 16:30 UTC)', () => {
    expect(hitungMode(wib('2026-08-05T23:30:00'), 960, tanpaLibur).alasan).toBe('setelah_jam_tutup');
    // Kamis 00:30 WIB masih Rabu 17:30 UTC -> harus dihitung sebagai Kamis (hari kerja, belum 16:00)
    expect(hitungMode(wib('2026-08-06T00:30:00'), 960, tanpaLibur).tutup).toBe(false);
  });
  it('Jumat sore -> Senin; Sabtu/Minggu -> akhir_pekan', () => {
    expect(hitungMode(wib('2026-08-07T17:00:00'), 960, tanpaLibur).kerjaBerikutnya).toBe('2026-08-10');
    expect(hitungMode(wib('2026-08-08T10:00:00'), 960, tanpaLibur)).toMatchObject({ alasan: 'akhir_pekan', kerjaBerikutnya: '2026-08-10' });
  });
  it('hari libur nasional dilewati saat mencari hari kerja berikutnya', () => {
    const libur = new Set(['2026-08-17', '2026-08-18']);
    expect(hitungMode(wib('2026-08-17T10:00:00'), 960, libur)).toMatchObject({ alasan: 'libur_nasional', kerjaBerikutnya: '2026-08-19' });
    expect(hariKerjaBerikutnya('2026-08-14', libur)).toBe('2026-08-19');
  });
  it('jam tutup dapat diatur', () => {
    expect(hitungMode(wib('2026-08-05T10:00:00'), 9 * 60, tanpaLibur).tutup).toBe(true);
  });
  it('label tanggal Indonesia', () => {
    expect(labelTanggalID('2026-08-10')).toBe('Senin, 10 Agustus 2026');
  });
});
