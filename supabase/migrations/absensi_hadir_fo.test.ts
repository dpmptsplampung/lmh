// @vitest-environment node
// Kontrak statis 202611030002: absensi FO dengan nama manual (tabel + RPC fo_catat_hadir_layanan).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const BERKAS = '202611030002_absensi_hadir_fo.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, BERKAS), 'utf8');
const kode = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('202611030002_absensi_hadir_fo', () => {
  it('terdaftar dan tanpa kontrol transaksi', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(BERKAS);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });
  it('tabel: RLS aktif, hanya admin/front_office membaca, tidak ada policy tulis', () => {
    expect(kode).toMatch(/ALTER TABLE public\.absensi_hadir_fo ENABLE ROW LEVEL SECURITY/);
    expect(kode).toMatch(/FOR SELECT TO authenticated\s+USING \(public\.peran_saya\(\) IN \('admin', 'front_office'\)\)/);
    expect(kode).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(kode).toMatch(/REVOKE ALL ON TABLE public\.absensi_hadir_fo FROM PUBLIC, anon, authenticated/);
  });
  it('satu nama sekali per Layanan per hari (indeks unik)', () => {
    expect(kode).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS absensi_hadir_fo_unik/);
  });
  it('RPC: SECURITY DEFINER, hanya admin/front_office, foto bernama Layanan, tidak untuk anon', () => {
    expect(kode).toMatch(/FUNCTION public\.fo_catat_hadir_layanan\(p_layanan_id uuid, p_nama text, p_foto_path text\)[\s\S]*SECURITY DEFINER/);
    expect(kode).toMatch(/NOT IN \('admin', 'front_office'\)/);
    expect(kode).toContain("p_layanan_id::text || '_[0-9]+");
    expect(kode).toMatch(/REVOKE ALL ON FUNCTION public\.fo_catat_hadir_layanan\(uuid, text, text\) FROM PUBLIC, anon, authenticated/);
    expect(kode).toMatch(/GRANT EXECUTE ON FUNCTION public\.fo_catat_hadir_layanan\(uuid, text, text\) TO authenticated;/);
  });
  it('tanpa DROP/TRUNCATE dan tidak menyentuh catat_absensi', () => {
    expect(kode).not.toMatch(/\b(DROP\s+(TABLE|FUNCTION|SCHEMA)|TRUNCATE)\b/i);
    expect(kode).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.catat_absensi/);
  });
});
