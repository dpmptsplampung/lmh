import { describe, expect, it } from 'vitest';
import { namaLayananSaran, nadaReservasi, petunjukTanggal, tampilkanEstimasi } from './tampilanReservasi';

describe('nadaReservasi', () => {
  it.each([
    ['terjadwal', 'info'],
    ['menunggu', 'peringatan'],
    ['dilayani', 'sukses'],
    ['selesai', 'sukses'],
    ['no_show', 'bahaya'],
    ['tidak_terlayani', 'bahaya'],
    ['batal', 'netral'],
    ['entah', 'netral'],
  ])('%s -> %s', (status, nada) => {
    expect(nadaReservasi(status)).toBe(nada);
  });
});

describe('namaLayananSaran', () => {
  const layanan = [{ id: 'l-1', nama: 'Helpdesk OSS' }];
  it('nama dari daftar; id kosong atau tak dikenal -> Loket Layanan', () => {
    expect(namaLayananSaran('l-1', layanan)).toBe('Helpdesk OSS');
    expect(namaLayananSaran(null, layanan)).toBe('Loket Layanan');
    expect(namaLayananSaran('l-9', layanan)).toBe('Loket Layanan');
    expect(namaLayananSaran('l-1', [])).toBe('Loket Layanan');
  });
});

describe('petunjukTanggal', () => {
  it('mengikuti tujuan (A-05)', () => {
    expect(petunjukTanggal('')).toMatch(/mengikuti tujuan kunjungan/);
    expect(petunjukTanggal('loket')).toMatch(/mengikuti jadwal layanan/i);
    expect(petunjukTanggal('loket')).not.toMatch(/hari kerja \(Senin–Jumat\)/);
    expect(petunjukTanggal('bertemu_seseorang')).toMatch(/hanya hari kerja \(Senin–Jumat\)/);
    for (const t of ['', 'loket', 'bertemu_seseorang'] as const) expect(petunjukTanggal(t)).toMatch(/Maksimal 7 hari ke depan\.$/);
  });
});

describe('tampilkanEstimasi', () => {
  it('hanya bila tanggal belum dipilih atau hari ini (A-07)', () => {
    expect(tampilkanEstimasi('', '2026-11-13')).toBe(true);
    expect(tampilkanEstimasi('2026-11-13', '2026-11-13')).toBe(true);
    expect(tampilkanEstimasi('2026-11-14', '2026-11-13')).toBe(false);
  });
});
