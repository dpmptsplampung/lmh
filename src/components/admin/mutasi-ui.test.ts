import { describe, it, expect } from 'vitest';
import { MutasiError } from '@/lib/supabase/mutate';
import { perluMuatUlang } from './mutasi-ui';

describe('perluMuatUlang', () => {
  it.each(['ditolak', 'tidak_ada_baris'] as const)('%s -> true (tampilan klien kemungkinan basi)', (kode) => {
    expect(perluMuatUlang(new MutasiError(kode))).toBe(true);
  });

  it.each(['jaringan', 'database'] as const)('%s -> false (data tidak basi, cukup coba lagi)', (kode) => {
    expect(perluMuatUlang(new MutasiError(kode))).toBe(false);
  });

  it('error biasa / nilai asing -> false', () => {
    expect(perluMuatUlang(new Error('x'))).toBe(false);
    expect(perluMuatUlang(null)).toBe(false);
    expect(perluMuatUlang('ditolak')).toBe(false);
  });
});
