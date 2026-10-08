// @vitest-environment node
// Kontrak statis migrasi RBAC Tahap 0 (tidak mengeksekusi SQL).
// Tes PERILAKU: `node scripts/test-rbac-tahap0.mjs --apply <file>` (transaksi + ROLLBACK).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi, mengubahPolicyAtauFungsi } from '../../scripts/lib/sql-txn.mjs';

const read = (f: string) => stripSqlComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
const sql = read('202610080001_rbac_tahap0_keamanan.sql');
const sql2 = read('202610080002_rbac_tahap0_layanan_admin_only.sql');

/** Ambil badan satu fungsi (dari CREATE ... FUNCTION nama sampai penutup $$;). */
function body(src: string, fn: string): string {
  const m = src.match(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?\\$\\$;`, 'i'));
  expect(m, `fungsi ${fn} tidak ditemukan`).not.toBeNull();
  return m![0];
}

describe('S1/S5: helper akses', () => {
  it('staf_saya hanya mengembalikan akun AKTIF, boleh_layanan memakainya', () => {
    expect(body(sql, 'staf_saya')).toMatch(/auth_user_id\s*=\s*auth\.uid\(\)\s+AND\s+staff\.aktif\s*=\s*true/i);
    const b = body(sql, 'boleh_layanan');
    expect(b).toMatch(/public\.staf_saya\(\)/);
    expect(b).toMatch(/'admin',\s*'front_office'/);
    expect(b).toMatch(/me\.layanan_id\s*=\s*p_layanan/);
  });
  it('get_my_layanan_id dan is_ptsp_staff memeriksa aktif', () => {
    expect(body(sql, 'get_my_layanan_id')).toMatch(/staff\.aktif\s*=\s*true/i);
    expect(body(sql, 'is_ptsp_staff')).toMatch(/staff\.aktif\s*=\s*true/i);
  });
  it('semua fungsi SECURITY DEFINER baru: search_path terkunci & EXECUTE tidak terbuka untuk anon/PUBLIC', () => {
    const defs = [...sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\(([\s\S]*?)\$\$;/gi)];
    expect(defs.length).toBeGreaterThanOrEqual(10);
    for (const d of defs) {
      if (!/SECURITY\s+DEFINER/i.test(d[0])) continue;
      expect(d[0], d[1]).toMatch(/SET\s+search_path\s*=\s*pg_catalog/i);
      if (d[1] === 'guard_absensi_tanggal_today') continue; // fungsi trigger, EXECUTE sudah dicabut di 202607200001
      if (['get_my_layanan_id', 'is_ptsp_staff', 'set_user_role_claim'].includes(d[1])) continue; // ACL lama dipertahankan
      expect(sql, d[1]).toMatch(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${d[1]}\\([^)]*\\)\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`, 'i'));
    }
  });
});

describe('S1: petugas_set_nonaktif / aktif', () => {
  it('nonaktif: hanya admin aktif atau service_role; p_actor diturunkan dari sesi', () => {
    const b = body(sql, 'petugas_set_nonaktif');
    expect(b).toMatch(/auth\.role\(\)[\s\S]*'service_role'/i);
    expect(b).toMatch(/me\.role\s*=\s*'admin'/);
    expect(b).not.toMatch(/front_office/); // FO TIDAK boleh
    expect(b).toMatch(/v_target\.id\s*=\s*v_actor/); // tolak diri sendiri
    expect(b).toMatch(/Admin aktif terakhir/);
    expect(b).toMatch(/FOR UPDATE/); // serialisasi cek admin terakhir
    expect(b).toMatch(/nonaktif_oleh\s*=\s*v_actor/); // bukan p_actor
  });
  it('aktifkan: admin aktif ATAU service_role (S11)', () => {
    const b = body(sql, 'petugas_set_aktif');
    expect(b).toMatch(/auth\.role\(\)[\s\S]*<>\s*'service_role'/i);
    expect(b).toMatch(/me\.role\s*=\s*'admin'/);
    expect(b).not.toMatch(/get_my_role\(\)/); // auth.uid() NULL pada service_role
  });
});

describe('S2/S3: absensi & antrean', () => {
  it('catat_absensi: tetap 3 argumen (CREATE OR REPLACE atomik, tanpa DROP/overload), cek sumber per peran', () => {
    // N4: satu-satunya DROP catat_absensi = bentuk 4-argumen LAMA (no-op di produksi); bentuk 3-argumen tidak pernah di-DROP.
    const drops = [...sql.matchAll(/DROP FUNCTION[^;]*catat_absensi[^;]*;/gi)].map((m) => m[0].replace(/\s+/g, ' '));
    expect(drops).toEqual(['DROP FUNCTION IF EXISTS public.catat_absensi(uuid, text, uuid, text);']);
    expect(sql.indexOf('DROP FUNCTION IF EXISTS public.catat_absensi')).toBeLessThan(sql.indexOf('CREATE OR REPLACE FUNCTION public.staf_saya'));
    const b = body(sql, 'catat_absensi');
    expect(b).not.toMatch(/p_foto_url/i);
    expect(b).toMatch(/p_dicatat_oleh uuid DEFAULT NULL\s*\)/i);
    expect(b).toMatch(/p_sumber = 'otomatis'/);
    expect(b).toMatch(/p_sumber = 'fo' AND v_me_role NOT IN \('admin', 'front_office'\)/);
    expect(b).toMatch(/p_sumber = 'petugas_ajukan' AND p_petugas_id IS DISTINCT FROM v_me_id/);
    expect(b).toMatch(/v_dicatat := v_me_id/); // dicatat_oleh dari sesi
    expect(b).toMatch(/aktif = true/); // target harus aktif
    // F4: Admin/FO (sumber 'fo') menaikkan pending/alpa -> approved; ditolak hanya dibalik Admin
    expect(b).toMatch(/v_verif := \(p_sumber = 'fo'\)/);
    expect(b).toMatch(/v_timpa := \(p_sumber = 'fo' AND v_me_role = 'admin'\)/);
    expect(b).toMatch(/status IN \('pending', 'alpa'\) AND v_verif THEN 'approved'/);
    expect(b).toMatch(/status = 'ditolak' AND v_timpa THEN 'approved'/);
    // N1: approved_by hanya ditimpa saat status benar-benar naik
    expect(b).toMatch(/approved_by = CASE\s+WHEN \(public\.absensi_petugas\.status IN \('pending', 'alpa'\) AND v_verif\)\s+OR \(public\.absensi_petugas\.status = 'ditolak' AND v_timpa\) THEN v_me_id/);
    // pengajuan petugas pada 'alpa' menjadi 'pending', bukan 'approved'
    expect(b).toMatch(/WHEN p_sumber = 'petugas_ajukan' THEN 'pending' ELSE 'approved'/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.catat_absensi\(uuid, text, uuid\) TO authenticated, service_role/i);
  });
  it('0001 tidak mendefinisikan foto_url / bucket absensi-foto (dikerjakan Tahap 1)', () => {
    expect(sql).not.toMatch(/foto_url/i);
    expect(sql).not.toMatch(/absensi-foto/i);
    expect(sql).not.toMatch(/storage\./i);
  });
  it('202608310003 dinetralkan: stub no-op tanpa SQL dan tanpa catat_absensi', () => {
    const raw = readFileSync(join(MIGRATIONS_DIR, '202608310003_absensi_foto_fo.sql'), 'utf8');
    expect(raw).not.toMatch(/catat_absensi/i);
    expect(raw).toMatch(/SUPERSEDED/);
    expect(stripSqlComments(raw).trim()).toBe('');
  });
  it('F6: cron absensi_alpa_otomatis dijeda lewat cron.alter_job (bukan unschedule)', () => {
    expect(sql).toMatch(/jobname = 'absensi_alpa_otomatis'/);
    expect(sql).toMatch(/cron\.alter_job\(v_job, active := false\)/);
    expect(sql).toMatch(/ELSE[^;]*RAISE WARNING 'cron job absensi_alpa_otomatis tidak ditemukan/); // N2
    expect(sql).not.toMatch(/cron\.unschedule/i);
  });
  it('catat_pulang: diri sendiri atau admin/FO', () => {
    const b = body(sql, 'catat_pulang');
    expect(b).toMatch(/p_petugas_id IS DISTINCT FROM v_me_id AND v_me_role NOT IN \('admin', 'front_office'\)/);
  });
  it('setujui_absensi: hanya admin/FO aktif, status approved|ditolak', () => {
    const b = body(sql, 'setujui_absensi');
    expect(b).toMatch(/p_status NOT IN \('approved', 'ditolak'\)/);
    expect(b).toMatch(/v_me_role NOT IN \('admin', 'front_office'\)/);
  });
  it('absensi: petugas tidak punya INSERT/UPDATE langsung; hanya admin', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS absensi_insert_own/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS absensi_update_own/i);
    expect(sql).toMatch(/CREATE POLICY absensi_insert_admin[\s\S]*WITH CHECK \(public\.get_my_role\(\) = 'admin'\)/i);
    expect(sql).toMatch(/CREATE POLICY absensi_update_admin[\s\S]*USING \(public\.get_my_role\(\) = 'admin'\)/i);
    expect(sql).not.toMatch(/CREATE POLICY absensi_(insert|update)_own/i);
  });
  it('perbaikan bug guard_absensi_tanggal_today (pg_catalog.CURRENT_DATE tidak valid) memakai WIB', () => {
    const b = body(sql, 'guard_absensi_tanggal_today');
    expect(b).not.toMatch(/pg_catalog\.CURRENT_DATE/i);
    expect(b).toMatch(/AT TIME ZONE 'Asia\/Jakarta'/);
  });
  it('panggil_tiket: staf aktif + boleh_layanan(tiket.layanan_id), service_role lolos', () => {
    const b = body(sql, 'panggil_tiket');
    expect(b).toMatch(/staf_saya\(\)/);
    expect(b).toMatch(/boleh_layanan\(v_layanan_id\)/);
    expect(b).toMatch(/'service_role'/);
  });
  it('fungsi internal dicabut dari anon/authenticated/PUBLIC, tersisa service_role', () => {
    for (const sig of [
      'terbit_tiket\\(uuid, uuid\\)',
      'terbit_nomor_antrean\\(uuid, date\\)',
      'skm_rr_tambah\\(uuid, text\\)',
      'match_dokumen\\(extensions\\.vector, double precision, integer, uuid\\)',
    ]) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon, authenticated`, 'i'));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO service_role`, 'i'));
      expect(sql).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO[^;]*authenticated`, 'i'));
    }
  });
});

describe('S4: policy INSERT kunjungan/tiket_antrean & visit', () => {
  it('menghapus WITH CHECK (true) dan tidak membuat policy INSERT pengganti', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS kunjungan_insert_public ON public\.kunjungan/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS tiket_insert_public ON public\.tiket_antrean/i);
    expect(sql).not.toMatch(/CREATE POLICY \w+ ON public\.(kunjungan|tiket_antrean) FOR INSERT/i);
    expect(sql).not.toMatch(/WITH CHECK \(\s*true\s*\)/i);
  });
  it('visit (pintu check-in) tetap bisa di-INSERT authenticated, status awal dikunci', () => {
    expect(sql).toMatch(/CREATE POLICY visit_insert_walk_in ON public\.visit FOR INSERT TO authenticated/i);
    expect(sql).toMatch(/status IN \('menunggu', 'terjadwal'\)/);
    expect(sql).toMatch(/check_anon_rate\('visit_insert_walk_in', 5, 60\)/);
    expect(sql).toMatch(/CREATE POLICY visit_insert_reservasi ON public\.visit FOR INSERT TO authenticated/i);
    expect(sql).toMatch(/status = 'terjadwal'/);
  });
});

describe('N7: Auth Hook', () => {
  it('hanya memberi role bila petugas.aktif; EXECUTE tidak diubah', () => {
    const b = body(sql, 'set_user_role_claim');
    expect(b).toMatch(/staff\.aktif\s*=\s*true/i);
    expect(b).toMatch(/COALESCE\(user_role, 'pengunjung'\)/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.set_user_role_claim/i);
  });
});

describe('migrasi 0002: S6 + keputusan CEO jadwal = Admin saja (diterapkan setelah UI diganti)', () => {
  it('0001 TIDAK menyentuh policy layanan / jadwal', () => {
    expect(sql).not.toMatch(/layanan_petugas_chatbot_toggle|jadwal_ptsp_write|libur_ptsp_write|cross_service_write|jadwal_standby|jadwal_pengecualian/);
  });
  it('0002 mencabut toggle petugas pada layanan dan jalur jadwal is_ptsp_staff', () => {
    expect(sql2).toMatch(/DROP POLICY IF EXISTS layanan_petugas_chatbot_toggle ON public\.layanan/i);
    expect(sql2).toMatch(/DROP POLICY IF EXISTS jadwal_ptsp_write ON public\.layanan_jadwal/i);
    expect(sql2).toMatch(/DROP POLICY IF EXISTS libur_ptsp_write ON public\.layanan_libur/i);
    expect(sql2).toMatch(/DROP POLICY IF EXISTS hari_libur_staff_write ON public\.hari_libur/i); // F9
  });
  it('0002 menjadikan tulis jadwal/libur/standby/pengecualian ADMIN saja (FO hanya baca)', () => {
    for (const [lama, baru, tabel] of [
      ['layanan_jadwal_cross_service_write', 'layanan_jadwal_admin_write', 'layanan_jadwal'],
      ['layanan_libur_cross_service_write', 'layanan_libur_admin_write', 'layanan_libur'],
      ['jadwal_standby_staff_write', 'jadwal_standby_admin_write', 'jadwal_standby'],
      ['jadwal_pengecualian_staff_write', 'jadwal_pengecualian_admin_write', 'jadwal_pengecualian'],
    ]) {
      expect(sql2).toMatch(new RegExp(`DROP POLICY IF EXISTS ${lama} ON public\\.${tabel}`, 'i'));
      expect(sql2).toMatch(new RegExp(`CREATE POLICY ${baru} ON public\\.${tabel} FOR ALL[\\s\\S]*?USING \\(public\\.get_my_role\\(\\) = 'admin'\\)\\s+WITH CHECK \\(public\\.get_my_role\\(\\) = 'admin'\\)`, 'i'));
    }
    expect(sql2).not.toMatch(/front_office/);
  });
  it('N3: 0002 idempoten, tiap CREATE POLICY *_admin_write didahului DROP POLICY IF EXISTS nama yang sama', () => {
    for (const baru of ['layanan_jadwal_admin_write', 'layanan_libur_admin_write', 'jadwal_standby_admin_write', 'jadwal_pengecualian_admin_write']) {
      expect(sql2).toMatch(new RegExp(`DROP POLICY IF EXISTS ${baru} ON[^;]*;\\s*CREATE POLICY ${baru} ON`, 'i'));
    }
  });
  it('0002 TIDAK menyentuh layanan_hari (Admin+FO, ditulis fungsi definer/cron), layanan_admin_all, atau baca publik', () => {
    expect(sql2).not.toMatch(/layanan_hari/);
    expect(sql2).not.toMatch(/layanan_admin_all/);
    expect(sql2).not.toMatch(/public_read/);
  });
});

describe('F2/F3: berkas migrasi dan rollback aman dibungkus transaksi pembungkus', () => {
  const berkas = [
    ['supabase/migrations/202610080001_rbac_tahap0_keamanan.sql'],
    ['supabase/migrations/202610080002_rbac_tahap0_layanan_admin_only.sql'],
    ['docs/rollback-rbac-tahap0-202610080001.sql'],
    ['docs/rollback-rbac-tahap0-202610080002.sql'],
  ];
  it.each(berkas)('%s tidak memuat BEGIN/COMMIT/END/ROLLBACK/SAVEPOINT/RELEASE tingkat atas', (f) => {
    const isi = readFileSync(join(process.cwd(), f), 'utf8');
    expect(mengandungKontrolTransaksi(isi)).toBe(false);
  });
  it('detektor menangkap kontrol transaksi tetapi tidak salah menandai END IF / BEGIN plpgsql', () => {
    expect(mengandungKontrolTransaksi('BEGIN;\nSELECT 1;\nCOMMIT;')).toBe(true);
    expect(mengandungKontrolTransaksi('SELECT 1;\nEND;')).toBe(true);
    expect(mengandungKontrolTransaksi('SELECT 1;\n  rollback;')).toBe(true);
    expect(mengandungKontrolTransaksi('SAVEPOINT a;')).toBe(true);
    expect(mengandungKontrolTransaksi('RELEASE SAVEPOINT a;')).toBe(true);
    expect(mengandungKontrolTransaksi('START TRANSACTION;')).toBe(true);
    expect(mengandungKontrolTransaksi('BEGIN\n')).toBe(true);
    expect(mengandungKontrolTransaksi('CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$\nBEGIN\n IF x THEN RETURN 1; END IF;\n RETURN 2;\nEND $$;')).toBe(false);
    expect(mengandungKontrolTransaksi("-- BEGIN; COMMIT;\nSELECT 'COMMIT; ROLLBACK;';")).toBe(false);
  });
  it('N6: detektor policy/fungsi menandai 0001/0002/rollback; apply-migration menolak mode lama tanpa --non-atomic', () => {
    for (const [f] of berkas) expect(mengubahPolicyAtauFungsi(readFileSync(join(process.cwd(), f), 'utf8'))).toBe(true);
    expect(mengubahPolicyAtauFungsi('-- CREATE POLICY x;\nSELECT 1;')).toBe(false);
    expect(mengubahPolicyAtauFungsi('INSERT INTO t VALUES (1);')).toBe(false);
    const src = readFileSync(join(process.cwd(), 'scripts', 'apply-migration.mjs'), 'utf8');
    expect(src).toMatch(/!atomic && mengubahPolicyAtauFungsi\(rawSql\) && !nonAtomic/);
    expect(src).toMatch(/--non-atomic/);
  });
  it('apply-migration.mjs punya mode --atomic dengan konfirmasi/--yes, dry-run, dan ROLLBACK saat galat', () => {
    const src = readFileSync(join(process.cwd(), 'scripts', 'apply-migration.mjs'), 'utf8');
    expect(src).toMatch(/args\.includes\('--atomic'\)/);
    expect(src).toMatch(/args\.includes\('--yes'\)/);
    expect(src).toMatch(/args\.includes\('--dry-run'\)/);
    expect(src).toMatch(/'BEGIN'/);
    expect(src).toMatch(/'COMMIT'/);
    expect(src).toMatch(/catch \(err\)[\s\S]*'ROLLBACK'[\s\S]*process\.exitCode = 1/);
    expect(src).toMatch(/Ketik TERAPKAN/);
  });
});

describe('F8: rollback 0001 tidak mengembalikan bug dan tidak menyalakan cron', () => {
  const rb = stripSqlComments(readFileSync(join(process.cwd(), 'docs', 'rollback-rbac-tahap0-202610080001.sql'), 'utf8'));
  it('guard_absensi_tanggal_today tidak didefinisikan ulang (versi benar dipertahankan)', () => {
    expect(rb).not.toMatch(/guard_absensi_tanggal_today/);
    expect(rb).not.toMatch(/pg_catalog\.CURRENT_DATE/i);
  });
  it('cron alpa tidak dinyalakan kembali oleh rollback', () => {
    expect(rb).not.toMatch(/cron\.alter_job/);
  });
  it('rollback memulihkan policy lama dan membuang helper & setujui_absensi', () => {
    expect(rb).toMatch(/CREATE POLICY kunjungan_insert_public ON public\.kunjungan FOR INSERT WITH CHECK \(true\)/);
    expect(rb).toMatch(/CREATE POLICY absensi_insert_own/);
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\.setujui_absensi\(uuid, text\)/);
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\.staf_saya\(\)/);
    expect(rb).not.toMatch(/foto_url/i);
  });
});
