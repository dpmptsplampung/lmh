// @vitest-environment node
// Kontrak statis 202611030007_public_url_dpmptsp: domain publik benar (lmh.dpmptsp.web.id) dan hanya nilai kosong/domain lama
// yang diganti. Tidak mengeksekusi SQL.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const baca = (...p: string[]) => readFileSync(join(MIGRATIONS_DIR, ...p), 'utf8').replace(/\r\n/g, '\n');
const sql = stripSqlComments(baca('202611030007_public_url_dpmptsp.sql'));

describe('202611030007 public_url', () => {
  it('menetapkan domain dpmptsp dan tanpa kontrol transaksi', () => {
    expect(sql).toContain("'https://lmh.dpmptsp.web.id'");
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });
  it('hanya menimpa nilai kosong atau domain lama', () => {
    expect(sql).toMatch(/ON CONFLICT \(key\) DO UPDATE/i);
    expect(sql).toMatch(/WHERE[\s\S]*IS NULL[\s\S]*btrim\([^)]*\)\s*=\s*''[\s\S]*lampungprov/i);
  });
  it('seed.sql memakai domain yang benar', () => {
    const seed = readFileSync(join(MIGRATIONS_DIR, '..', 'seed.sql'), 'utf8');
    expect(seed).toContain("('public_url', 'https://lmh.dpmptsp.web.id')");
    expect(seed).not.toMatch(/'public_url',\s*'https:\/\/lmh\.lampungprov/);
  });
});
