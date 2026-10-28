import { describe, expect, it } from 'vitest';
import { kodeGalatKhusus, PESAN_GALAT_KHUSUS } from './galat';

describe('kodeGalatKhusus', () => {
  it('mengenali kode dari pesan error RPC/mutasi', () => {
    expect(kodeGalatKhusus({ message: 'KHUSUS_WAJIB: isian "X" wajib diisi' })).toBe('KHUSUS_WAJIB');
    expect(kodeGalatKhusus({ asal: { message: 'JENIS_TERKUNCI: jenis' } })).toBe('JENIS_TERKUNCI');
    expect(kodeGalatKhusus({ message: 'SUDAH_DIISI: x' })).toBe('SUDAH_DIISI');
    expect(kodeGalatKhusus({ message: 'KHUSUS_TIDAK_BERLAKU: x' })).toBe('KHUSUS_TIDAK_BERLAKU');
    expect(kodeGalatKhusus({ message: 'DATA_TIDAK_VALID: email' })).toBe('DATA_TIDAK_VALID');
  });
  it('null untuk galat lain', () => {
    expect(kodeGalatKhusus({ message: 'boom' })).toBeNull();
    expect(kodeGalatKhusus(null)).toBeNull();
  });
  it('setiap kode punya pesan Indonesia', () => {
    for (const p of Object.values(PESAN_GALAT_KHUSUS)) expect(p.length).toBeGreaterThan(10);
  });
});
