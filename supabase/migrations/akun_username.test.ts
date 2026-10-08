// @vitest-environment node
// Kontrak statis migrasi 202610090002 (tidak mengeksekusi SQL). Perilaku: node scripts/test-rbac-akun.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const file = '202610090002_akun_username.sql';
const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
const fn = (name: string) => {
  const m = sql.match(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`, 'i'));
  expect(m, name).not.toBeNull();
  return m![0];
};

describe('202610090002_akun_username', () => {
  it('tanpa kontrol transaksi; rollback ada', () => {
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
    expect(existsSync(join(process.cwd(), 'docs', 'rollback-rbac-tahap2-202610090002.sql'))).toBe(true);
  });
  it('kolom petugas + batasan format username/HP/email; username unik', () => {
    for (const c of ['username', 'no_hp', 'email_notifikasi', 'email_notifikasi_verified_at', 'operator_default', 'wajib_ganti_sandi']) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\s`));
    }
    expect(sql).toMatch(/username ~ '\^\[a-z0-9\]\[a-z0-9-\]\{2,31\}\$'/);
    expect(sql).toMatch(/petugas_username_key UNIQUE \(username\)/);
    expect(sql).toMatch(/petugas_no_hp_format/);
  });
  it('profil sendiri: hanya no_hp/email_notifikasi/operator_default; email baru mereset verifikasi; tak menyentuh role/layanan/aktif/username', () => {
    const b = fn('petugas_ubah_profil');
    expect(b).toMatch(/staf_saya\(\)/);
    expect(b).toMatch(/SET search_path = pg_catalog/);
    const set = b.slice(b.indexOf('UPDATE public.petugas'), b.indexOf('WHERE p.id = v_me'));
    expect(set).toMatch(/email_notifikasi_verified_at/);
    for (const forbidden of ['role =', 'layanan_id =', 'aktif =', 'username =', 'auth_user_id =']) {
      expect(set, forbidden).not.toContain(forbidden);
    }
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.petugas_ubah_profil\(jsonb\) TO authenticated;/);
  });
  it('tabel token: RLS aktif, tanpa akses anon/authenticated; RPC verifikasi + akhiri sesi hanya service_role', () => {
    expect(sql).toMatch(/ALTER TABLE public\.petugas_verif_email ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.petugas_verif_email FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/token_hash\s+text NOT NULL UNIQUE/);
    for (const f of ['petugas_verifikasi_email', 'akun_akhiri_sesi']) {
      expect(fn(f)).toMatch(/auth\.role\(\)[\s\S]*'service_role'/);
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO service_role;`));
    }
    expect(fn('petugas_verifikasi_email')).toMatch(/DELETE FROM public\.petugas_verif_email[\s\S]*kedaluwarsa > /);
  });
  it('akun_daftar: hanya Admin/service_role; email notifikasi tersamar; belum_pernah_login', () => {
    const b = fn('akun_daftar');
    expect(b).toMatch(/me\.role = 'admin'/);
    expect(b).toMatch(/tersamarkan_email\(p\.email_notifikasi\)/);
    expect(b).toMatch(/u\.last_sign_in_at IS NULL/);
    expect(b).not.toMatch(/p\.email_notifikasi,/); // email asli tidak ikut keluar
  });
  it('semua fungsi SECURITY DEFINER: search_path terkunci & EXECUTE tak terbuka untuk anon/PUBLIC', () => {
    const defs = [...sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\(([\s\S]*?)\$\$;/gi)];
    expect(defs.length).toBe(7);
    for (const d of defs) {
      if (/SECURITY\s+DEFINER/i.test(d[0])) expect(d[0], d[1]).toMatch(/SET\s+search_path\s*=\s*pg_catalog/i);
      expect(sql, d[1]).toMatch(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${d[1]}\\([^)]*\\)\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`, 'i'));
    }
  });
  it('penjaga Admin aktif terakhir & operator absensi', () => {
    expect(fn('guard_admin_terakhir')).toMatch(/Admin aktif terakhir/);
    expect(sql).toMatch(/BEFORE UPDATE OF role, aktif ON public\.petugas/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS operator_nama text/);
    expect(sql).toMatch(/BEFORE INSERT ON public\.absensi_petugas/);
    expect(sql).not.toMatch(/FUNCTION public\.catat_absensi/); // tidak menimpa fungsi milik migrasi lain
  });
});
