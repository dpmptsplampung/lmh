// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const BERKAS = '202611030004_umkm_foto_https.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, BERKAS), 'utf8');
const kode = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('202611030004_umkm_foto_https', () => {
  it('terdaftar, tanpa transaksi, tanpa DROP/TRUNCATE', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(BERKAS);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
    expect(kode).not.toMatch(/\b(DROP|TRUNCATE)\b/i);
  });
  it('CHECK https per elemen, NOT VALID, batas 500', () => {
    expect(kode).toMatch(/ADD CONSTRAINT listing_umkm_foto_https/);
    expect(kode).toContain('^https://');
    expect(kode).toContain('> 500');
    expect(kode).toMatch(/CHECK \(public\.foto_umkm_semua_https\(foto_produk\)\)/);
    expect(kode).toMatch(/NOT VALID/);
  });
});
