import { describe, expect, it } from 'vitest';
import { KODE_MIGRASI_BELUM, kolomBelumAda, objekBelumAda } from './galat';

describe('kolomBelumAda', () => {
  it('hanya kolom yang belum ada: Postgres 42703 dan PostgREST PGRST204', () => {
    expect(kolomBelumAda({ code: '42703', message: 'column layanan.slug does not exist' })).toBe(true);
    expect(kolomBelumAda({ code: 'PGRST204', message: 'x' })).toBe(true);
  });

  it('tabel/fungsi yang belum ada, izin, dan galat lain bukan "kolom belum ada"', () => {
    for (const code of ['PGRST202', 'PGRST205', '42883', '42P01', '42501', '22023']) {
      expect(kolomBelumAda({ code, message: 'x' })).toBe(false);
    }
    expect(kolomBelumAda(new Error('fetch failed'))).toBe(false);
    expect(kolomBelumAda(null)).toBe(false);
    expect(kolomBelumAda('42703')).toBe(false);
  });
});

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
