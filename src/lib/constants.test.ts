// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KATEGORI_PENGUNJUNG, type KategoriPengunjung } from './constants';

describe('KATEGORI_PENGUNJUNG', () => {
  const coreSql = readFileSync(
    join(process.cwd(), 'supabase/migrations/202607140002_core_schema.sql'),
    'utf8',
  );

  it('matches the pengunjung.kategori CHECK constraint exactly', () => {
    const check = coreSql.match(
      /kategori\s+text\s+CHECK\s*\(\s*kategori\s+IN\s*\(([^)]+)\)\s*\)/i,
    );
    expect(check).not.toBeNull();
    const dbValues = [...check![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(Object.keys(KATEGORI_PENGUNJUNG).sort()).toEqual([...dbValues].sort());
    expect(Object.keys(KATEGORI_PENGUNJUNG)).toEqual(
      expect.arrayContaining(['Umum', 'UMKM', 'Investor', 'Instansi']),
    );
  });

  it('does not include akademisi or lowercase aliases', () => {
    const keys = Object.keys(KATEGORI_PENGUNJUNG);
    expect(keys).not.toContain('akademisi');
    expect(keys).not.toContain('umum');
    expect(keys).not.toContain('umkm');
    expect(keys).not.toContain('investor');
    expect(keys).not.toContain('instansi');
  });

  it('exposes human-readable labels for every canonical value', () => {
    const sample: KategoriPengunjung = 'Umum';
    expect(KATEGORI_PENGUNJUNG[sample]).toMatch(/Umum|Masyarakat/i);
    expect(KATEGORI_PENGUNJUNG.UMKM).toBeTruthy();
    expect(KATEGORI_PENGUNJUNG.Investor).toBeTruthy();
    expect(KATEGORI_PENGUNJUNG.Instansi).toBeTruthy();
  });
});

describe('status tiket/kunjungan baru (kontrak FO §1.3/§1.4)', () => {
  it('STATUS_TIKET memuat dikembalikan & dialihkan; setiap status punya label', async () => {
    const { STATUS_TIKET, LABEL_STATUS_TIKET } = await import('./constants');
    expect(Object.values(STATUS_TIKET)).toEqual(expect.arrayContaining(['dikembalikan', 'dialihkan']));
    for (const s of Object.values(STATUS_TIKET)) expect(LABEL_STATUS_TIKET[s]).toBeTruthy();
  });

  it("ASAL_KUNJUNGAN memuat 'online' dan setiap asal punya label; status kunjungan lengkap", async () => {
    const { ASAL_KUNJUNGAN, LABEL_ASAL_KUNJUNGAN, STATUS_KUNJUNGAN_DB } = await import('./constants');
    expect(Object.values(ASAL_KUNJUNGAN).sort()).toEqual(['online', 'reservasi', 'walk_in']);
    for (const a of Object.values(ASAL_KUNJUNGAN)) expect(LABEL_ASAL_KUNJUNGAN[a]).toBeTruthy();
    expect(Object.values(STATUS_KUNJUNGAN_DB).sort()).toEqual(
      ['batal', 'dilayani', 'menunggu', 'no_show', 'selesai', 'terjadwal', 'tidak_terlayani'],
    );
  });
});
