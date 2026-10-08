// @vitest-environment node
// Kontrak statis migrasi 202610090003 (tidak mengeksekusi SQL). Dry-run nyata: apply-migration.mjs --atomic --dry-run.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const file = '202610090003_konsol_pengaturan.sql';
const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
const fn = (name: string) => {
  const m = sql.match(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`, 'i'));
  expect(m, name).not.toBeNull();
  return m![0];
};

describe('202610090003_konsol_pengaturan', () => {
  it('tanpa kontrol transaksi; rollback ada', () => {
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
    expect(existsSync(join(process.cwd(), 'docs', 'rollback-rbac-konsol-202610090003.sql'))).toBe(true);
  });
  it('tabel: RLS aktif TANPA policy, semua hak dicabut dari anon/authenticated, hanya service_role', () => {
    for (const t of ['rahasia_pengaturan', 'pengaturan_sistem', 'pengaturan_riwayat']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${t}\\s+FROM PUBLIC, anon, authenticated`));
      expect(sql).toMatch(new RegExp(`GRANT ALL ON TABLE public\\.${t}\\s+TO service_role`));
    }
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
  it('rahasia hanya ciphertext/iv/tag/key_id/last4 (tanpa kolom plaintext); last4 maksimal 4 karakter', () => {
    const t = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public.rahasia_pengaturan'), sql.indexOf('CREATE TABLE IF NOT EXISTS public.pengaturan_sistem'));
    for (const c of ['ciphertext', 'iv', 'tag', 'key_id', 'last4']) expect(t).toMatch(new RegExp(`\\b${c}\\s+(text|smallint) NOT NULL`));
    expect(t).not.toMatch(/\b(plain|nilai|kunci_api|secret)\b/);
    expect(t).toMatch(/char_length\(last4\) <= 4/);
  });
  it('pengaturan: versi unik per kunci, satu aktif & satu draf per kunci, status terbatas', () => {
    expect(sql).toMatch(/UNIQUE \(kunci, versi\)/);
    expect(sql).toMatch(/uq_pengaturan_aktif ON public\.pengaturan_sistem \(kunci\) WHERE status = 'aktif'/);
    expect(sql).toMatch(/uq_pengaturan_draf\s+ON public\.pengaturan_sistem \(kunci\) WHERE status = 'draf'/);
    expect(sql).toMatch(/status\s+text NOT NULL CHECK \(status IN \('draf', 'aktif', 'arsip'\)\)/);
  });
  it('RPC: SECURITY DEFINER + search_path pg_catalog; hanya service_role; audit_log + riwayat tanpa rahasia', () => {
    for (const name of ['simpan_draf_pengaturan', 'aktifkan_pengaturan', 'rollback_pengaturan', 'match_dokumen_layanan']) {
      const b = fn(name);
      expect(b, name).toMatch(/SECURITY DEFINER/);
      expect(b, name).toMatch(/SET search_path = pg_catalog/);
      expect(sql, name).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated`));
      expect(sql, name).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO service_role`));
    }
    for (const name of ['simpan_draf_pengaturan', 'aktifkan_pengaturan', 'rollback_pengaturan']) {
      const b = fn(name);
      expect(b).toMatch(/INSERT INTO public\.audit_log/);
      expect(b).toMatch(/INSERT INTO public\.pengaturan_riwayat/);
      expect(b).not.toMatch(/rahasia_pengaturan/);
    }
  });
  it('aktivasi: wajib lulus uji untuk entri aktif, atau tanpa_uji + alasan; rollback butuh alasan & hanya arsip', () => {
    const a = fn('aktifkan_pengaturan');
    expect(a).toMatch(/BELUM_DIUJI/);
    expect(a).toMatch(/ALASAN_WAJIB/);
    expect(a).toMatch(/BUKAN_DRAF/);
    expect(a).toMatch(/status = 'arsip'/);
    const r = fn('rollback_pengaturan');
    expect(r).toMatch(/ALASAN_WAJIB/);
    expect(r).toMatch(/BUKAN_ARSIP/);
    expect(r).toMatch(/MAX\(s\.versi\) \+ 1/); // sejarah tidak ditimpa: salin ke versi baru
  });
  it('match_dokumen_layanan: dimensi vektor tak dikunci, dokumen umum (layanan NULL) ikut, hanya status berlaku', () => {
    const b = fn('match_dokumen_layanan');
    expect(b).toMatch(/p_embedding\s+extensions\.vector,/);
    expect(b).not.toMatch(/vector\(\d+\)/);
    expect(b).toMatch(/dok\.layanan_id IS NULL/);
    expect(b).toMatch(/dok\.status = 'berlaku'/);
  });
  it('tidak bergantung pada fungsi RBAC yang belum diterapkan', () => {
    expect(sql).not.toMatch(/staf_saya|peran_saya|boleh_layanan|get_my_role/);
  });
});
