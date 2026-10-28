import { describe, expect, it } from 'vitest';
import { KODE_MIGRASI_BELUM, objekBelumAda } from './galat';

describe('objekBelumAda', () => {
  it('mengenali fungsi/kolom/tabel yang belum ada (PostgREST dan Postgres)', () => {
    for (const code of ['PGRST202', 'PGRST204', 'PGRST205', '42883', '42703', '42P01']) {
      expect(objekBelumAda({ code, message: 'x' })).toBe(true);
    }
  });

  it('galat lain (izin, validasi, jaringan) bukan "belum ada"', () => {
    expect(objekBelumAda({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(objekBelumAda({ code: '22023', message: 'RENTANG_TIDAK_VALID: x' })).toBe(false);
    expect(objekBelumAda(new Error('fetch failed'))).toBe(false);
    expect(objekBelumAda(null)).toBe(false);
  });

  it('kode respons tetap', () => {
    expect(KODE_MIGRASI_BELUM).toBe('MIGRASI_BELUM_DITERAPKAN');
  });
});
