import { describe, expect, it } from 'vitest';
import { barisJadwalMingguan, teksBukaSetiap, teksJadwalMingguan, type JadwalHari } from './jadwal-teks';

const j = (hari: number, a = '08:00', b = '15:30'): JadwalHari => ({ hari, jamMulai: a, jamSelesai: b });

describe('teksJadwalMingguan', () => {
  it('menggabungkan hari berurutan dengan jam sama', () => {
    expect(teksJadwalMingguan([j(1), j(2), j(3), j(4), j(5)])).toBe('Senin–Jumat 08.00–15.30');
  });
  it('memisahkan kelompok berbeda jam', () => {
    expect(teksJadwalMingguan([j(1), j(2), j(6, '08:00:00', '12:00:00')])).toBe('Senin–Selasa 08.00–15.30; Sabtu 08.00–12.00');
  });
  it('kosong bila tidak ada jadwal valid', () => {
    expect(teksJadwalMingguan([])).toBe('');
    expect(teksJadwalMingguan([{ hari: 9, jamMulai: '08:00', jamSelesai: '09:00' }])).toBe('');
  });
});

describe('teksBukaSetiap', () => {
  it('satu hari -> "setiap Kamis"', () => {
    expect(teksBukaSetiap([j(4)])).toBe('setiap Kamis');
  });
  it('rentang -> "Senin–Jumat"', () => {
    expect(teksBukaSetiap([j(1), j(2), j(3), j(4), j(5)])).toBe('Senin–Jumat');
  });
  it('beberapa hari terpisah -> "setiap Senin dan Kamis"', () => {
    expect(teksBukaSetiap([j(1), j(4)])).toBe('setiap Senin dan Kamis');
  });
  it('rentang + hari tunggal -> "Senin–Rabu dan Jumat"', () => {
    expect(teksBukaSetiap([j(1), j(2), j(3), j(5)])).toBe('Senin–Rabu dan Jumat');
  });
  it('tidak ada jadwal -> kosong', () => {
    expect(teksBukaSetiap([])).toBe('');
  });
});

describe('barisJadwalMingguan', () => {
  it('selalu tujuh baris; hari tanpa jadwal berjam null', () => {
    const baris = barisJadwalMingguan([j(1), j(3, '09:00', '12:00')]);
    expect(baris).toHaveLength(7);
    expect(baris[0]).toEqual({ hari: 1, nama: 'Senin', jam: '08.00–15.30' });
    expect(baris[1].jam).toBeNull();
    expect(baris[2].jam).toBe('09.00–12.00');
    expect(baris[6].nama).toBe('Minggu');
  });
});
