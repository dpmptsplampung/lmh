// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const BERKAS = '202611030005_chat_lampiran.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, BERKAS), 'utf8');
const kode = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('202611030005_chat_lampiran', () => {
  it('terdaftar, tanpa transaksi, tanpa DROP/TRUNCATE', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(BERKAS);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
    expect(kode).not.toMatch(/\b(DROP|TRUNCATE)\b/i);
  });
  it('empat kolom, semua-atau-tidak-sama-sekali, batas 5 MB dan tiga tipe gambar', () => {
    for (const k of ['lampiran_kunci', 'lampiran_mime', 'lampiran_ukuran', 'lampiran_nama']) expect(kode).toContain(`ADD COLUMN IF NOT EXISTS ${k}`);
    expect(kode).toContain('5242880');
    expect(kode).toContain("IN ('image/jpeg', 'image/png', 'image/webp')");
    expect(kode).not.toMatch(/CREATE POLICY/);
  });
});
