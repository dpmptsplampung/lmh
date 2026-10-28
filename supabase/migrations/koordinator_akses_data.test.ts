// @vitest-environment node
//
// Kontrak statis migrasi 202610290001 (Fase 3: Koordinator, akses data per orang, ambil alih pendataan).
// Hanya membaca teks SQL; tidak ada SQL yang dieksekusi ke database.
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const NAMA_FILE = '202610290001_koordinator_akses_data.sql';
const sql = readFileSync(join(__dirname, NAMA_FILE), 'utf8').replace(/\r\n/g, '\n');
const bare = sql.replace(/--[^\n]*/g, '');

function fungsi(teks: string, nama: string): string {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?\\$\\$;`, 'i');
  return teks.replace(/\r\n/g, '\n').replace(/--[^\n]*/g, '').match(re)?.[0] ?? '';
}

function policy(nama: string): string {
  return bare.match(new RegExp(`CREATE POLICY ${nama} ON [\\s\\S]*?;`, 'i'))?.[0] ?? '';
}

describe('202610290001_koordinator_akses_data migration', () => {
  it('terdaftar di FORWARD_MIGRATION_FILES sesudah 202610280001', () => {
    const daftar = FORWARD_MIGRATION_FILES as readonly string[];
    expect(daftar).toContain(NAMA_FILE);
    expect(daftar.indexOf(NAMA_FILE)).toBeGreaterThan(daftar.indexOf('202610280001_homepage_etalase.sql'));
  });

  it('penjaga prasyarat: Fase 1 dan Fase 2 sudah diterapkan', () => {
    expect(bare).toMatch(/to_regclass\('public\.instansi'\) IS NULL/);
    expect(bare).toMatch(/to_regclass\('public\.homepage_blok'\) IS NULL/);
  });

  it('Koordinator = penanda boolean pada petugas (bukan role baru, B3)', () => {
    expect(bare).toMatch(/ALTER TABLE public\.petugas ADD COLUMN IF NOT EXISTS koordinator boolean NOT NULL DEFAULT false/i);
    expect(bare).not.toMatch(/petugas_role_check/i);
    expect(bare.match(/ADD COLUMN IF NOT EXISTS/gi)).toHaveLength(1);
  });

  it('tidak destruktif (B1): pernyataan tingkat atas tanpa DELETE/TRUNCATE/DROP TABLE/DROP COLUMN/UPDATE', () => {
    const atas = bare
      .replace(/\$\$[\s\S]*?\$\$/g, '')
      .replace(/GRANT[^;]*;/gi, '')
      .replace(/ON DELETE (CASCADE|SET NULL|RESTRICT)/gi, '');
    expect(atas).not.toMatch(/\b(DELETE|TRUNCATE)\b/i);
    expect(atas).not.toMatch(/DROP\s+(TABLE|COLUMN|VIEW|FUNCTION)/i);
    expect(atas).not.toMatch(/\bUPDATE\s+public\./i);
    // DROP hanya untuk policy yang langsung dibuat ulang.
    for (const m of atas.matchAll(/DROP POLICY IF EXISTS (\w+) ON/gi)) {
      expect(atas).toMatch(new RegExp(`CREATE POLICY ${m[1]} ON`));
    }
  });

  it('semua fungsi SECURITY DEFINER memakai search_path tetap dan REVOKE dari PUBLIC/anon/authenticated', () => {
    const defs = [...bare.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([\s\S]*?)\$\$;/gi)];
    expect(defs.length).toBe(13);
    for (const d of defs) {
      expect(d[0]).toMatch(/SECURITY DEFINER/);
      expect(d[0]).toMatch(/SET search_path = pg_catalog, public/);
      expect(bare).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${d[1]}\\([^)]*\\) FROM PUBLIC, anon, authenticated`));
    }
  });

  it('pemicu atomik: setiap perubahan role/layanan_id mencabut penanda Koordinator pada UPDATE yang sama', () => {
    const f = fungsi(sql, 'petugas_cabut_koordinator');
    expect(f).toMatch(/RETURNS trigger/);
    expect(f).toMatch(/IF NEW\.role IS DISTINCT FROM OLD\.role OR NEW\.layanan_id IS DISTINCT FROM OLD\.layanan_id THEN\s+NEW\.koordinator := false;/);
    expect(bare).toMatch(/CREATE TRIGGER trg_petugas_cabut_koordinator\s+BEFORE UPDATE OF role, layanan_id ON public\.petugas\s+FOR EACH ROW EXECUTE FUNCTION public\.petugas_cabut_koordinator\(\);/);
    // Pemicu dibuat SESUDAH kolom ada.
    expect(bare.indexOf('CREATE TRIGGER trg_petugas_cabut_koordinator')).toBeGreaterThan(bare.indexOf('ADD COLUMN IF NOT EXISTS koordinator'));
  });

  it('fo_status_qr: hanya FO/Admin aktif, hanya kategori status (tanpa PII)', () => {
    const f = fungsi(sql, 'fo_status_qr');
    expect(f).toMatch(/RETURNS text/);
    expect(f).toMatch(/v_role NOT IN \('admin', 'front_office'\) THEN\s+RAISE EXCEPTION 'FORBIDDEN:/);
    expect(f).toMatch(/SELECT k\.status, k\.tanggal INTO v_status, v_tgl/);
    expect(f).not.toMatch(/k\.nama|kontak_hp|email|asal_instansi/);
    for (const kat of ['tidak_ditemukan', 'tanggal_lain', 'aktif', 'tidak_berlaku', 'sudah_diproses']) expect(f).toContain(`'${kat}'`);
    expect(bare).toContain('GRANT EXECUTE ON FUNCTION public.fo_status_qr(text) TO authenticated;');
  });

  it('staf_lingkup hanya akun aktif pemanggil', () => {
    const f = fungsi(sql, 'staf_lingkup');
    expect(f).toMatch(/staff\.auth_user_id = auth\.uid\(\) AND staff\.aktif = true/);
    expect(f).toMatch(/staff\.koordinator/);
  });

  it('boleh_data_pelayanan memuat empat cabang lingkup §6.1', () => {
    const f = fungsi(sql, 'boleh_data_pelayanan');
    expect(f).toMatch(/me\.role = 'admin'/);
    expect(f).toMatch(/me\.role = 'front_office' AND me\.koordinator/);
    expect(f).toMatch(/me\.role = 'petugas' AND me\.koordinator[\s\S]*p_peran_tahap = 'layanan' AND p_layanan = me\.layanan_id/);
    expect(f).toMatch(/p_penangan = me\.id/);
  });

  it('jendela operasional = HANYA pekerjaan terbuka (review keamanan: tanpa syarat "hari ini")', () => {
    const f = fungsi(sql, 'kunjungan_operasional');
    // menunggu/dilayani bertanggal >= kemarin WIB; reservasi terjadwal hanya hari ini (check-in FO).
    expect(f).toMatch(/\(k\.status IN \('menunggu', 'dilayani'\)\s+AND k\.tanggal >= \(pg_catalog\.now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::date - 1\)/);
    expect(f).toMatch(/\(k\.status = 'terjadwal'\s+AND k\.tanggal = \(pg_catalog\.now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::date\)/);
    // Kunjungan yang sudah ditutup (selesai/batal/no_show/tidak_terlayani) tidak pernah masuk jendela, termasuk hari ini.
    expect(f).not.toMatch(/'selesai'|'batal'|'no_show'|'tidak_terlayani'/);
    expect(f).not.toMatch(/k\.tanggal = \(pg_catalog\.now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::date\s+OR/);
    expect(f.match(/AND k\.tanggal/g)).toHaveLength(2);
  });

  it('membalik 202610140013: FO tidak lagi membaca semua tahap tanpa syarat', () => {
    const f = fungsi(sql, 'boleh_penanganan');
    expect(f).toMatch(/public\.boleh_data_pelayanan\(p_peran_tahap, p_layanan, p_penangan\)/);
    // Cabang FO 'RETURN true' hanya sesudah penjaga jendela operasional.
    const iPenjaga = f.indexOf("IF NOT (p_status IN ('menunggu', 'berjalan') OR public.kunjungan_operasional(p_kunjungan))");
    const iFo = f.indexOf("IF v_role = 'front_office' THEN");
    expect(iPenjaga).toBeGreaterThan(-1);
    expect(iFo).toBeGreaterThan(iPenjaga);
    expect(bare).toMatch(/COMMENT ON FUNCTION public\.boleh_penanganan\(uuid, text, uuid, uuid, text\) IS\s+'202610290001/);
    // Penanda 0013 tidak boleh ada di COMMENT (penjaga rollback 0012/0013 memakai penanda 0029 sendiri).
    const komentar = bare.match(/COMMENT ON FUNCTION public\.boleh_penanganan[^;]*;/)![0];
    expect(komentar).not.toContain('202610140013');
  });

  it('boleh_kunjungan: Koordinator FO semua, data sendiri, petugas biasa hanya operasional', () => {
    const f = fungsi(sql, 'boleh_kunjungan');
    expect(f).toMatch(/v_role = 'admin' OR \(v_role = 'front_office' AND v_koord\)/);
    for (const t of ['k.dibuat_oleh = v_id', 'p.penangan_id = v_id', 't.dilayani_oleh = v_id', 'o.petugas_id = v_id', 'pz.petugas_id = v_id']) {
      expect(f).toContain(t);
    }
    expect(f).toMatch(/RETURN v_unit AND \(v_koord OR public\.kunjungan_operasional\(p_kunjungan\)\)/);
    expect(f).toMatch(/IF v_role = 'front_office' THEN\s+RETURN public\.kunjungan_operasional\(p_kunjungan\)/);
  });

  it('Pendataan Khusus: baca lewat boleh_baca_pendataan, tulis draf lewat boleh_sunting_pendataan', () => {
    expect(policy('oss_read_staff')).toMatch(/FOR SELECT TO authenticated\s+USING \(public\.boleh_baca_pendataan\(tiket_id, petugas_id\)\)/);
    expect(policy('perizinan_read_staff')).toMatch(/FOR SELECT TO authenticated\s+USING \(public\.boleh_baca_pendataan\(tiket_id, petugas_id\)\)/);
    for (const p of ['oss_insert_staff', 'oss_update_staff', 'perizinan_insert_staff', 'perizinan_update_staff']) {
      const isi = policy(p);
      expect(isi).toMatch(/TO authenticated/);
      expect(isi).toMatch(/public\.boleh_sunting_pendataan\(tiket_id\)/);
      expect(isi).toMatch(/public\.boleh_tiket\(tiket_id\)/);
      expect(isi).not.toMatch(/pemilik_tiket/);
    }
    const baca = fungsi(sql, 'boleh_baca_pendataan');
    expect(baca).toMatch(/v_role = 'petugas' AND v_koord AND v_layanan IS NOT NULL AND v_t\.layanan_id = v_layanan/);
    // Jendela operasional Pendataan: hanya tiket terbuka bertanggal >= kemarin; tiket selesai hari ini TIDAK terbuka.
    expect(baca).toMatch(/IF NOT \(v_t\.status IN \('menunggu', 'dipanggil', 'dilayani'\)\s+AND v_t\.tanggal >= \(pg_catalog\.now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::date - 1\) THEN/);
    expect(baca).not.toMatch(/v_t\.tanggal = /);
    const sunting = fungsi(sql, 'boleh_sunting_pendataan');
    expect(sunting).toMatch(/public\.pemilik_tiket\(p_tiket_id\)/);
    expect(sunting).toMatch(/a\.pemegang_baru = t\.dilayani_oleh/);
    expect(sunting).toMatch(/me\.id = a\.pemegang_lama/);
    expect(sunting).toMatch(/t\.status = 'dilayani'/);
  });

  it('arsip visit: staf hanya admin/Koordinator unit (bukan semua FO lewat boleh_layanan); pengunjung miliknya', () => {
    const p = policy('visit_select_own');
    expect(p).toMatch(/ON public\.visit FOR SELECT TO authenticated/);
    expect(p).toMatch(/pengunjung_id IN \(SELECT p\.id FROM public\.pengunjung AS p WHERE p\.auth_user_id = auth\.uid\(\)\)/);
    expect(p).toMatch(/OR public\.boleh_rekap_lama\(layanan_id\)/);
    expect(p).not.toMatch(/boleh_layanan/);
  });

  it('anti-drift: cabang operasional petugas boleh_penanganan = 202610140009 (kecuali nama helper staf)', () => {
    const potong = (f: string) => {
      const awal = f.indexOf("IF v_role = 'petugas' AND v_layanan IS NOT NULL THEN");
      const akhir = f.indexOf('RETURN false;\nEND', awal);
      return f.slice(awal, akhir).replace(/\s+/g, ' ').trim();
    };
    const asli = potong(fungsi(readFileSync(join(__dirname, '202610140009_chat_online.sql'), 'utf8'), 'boleh_penanganan'));
    const baru = potong(fungsi(sql, 'boleh_penanganan'));
    expect(asli.length).toBeGreaterThan(200);
    expect(baru).toBe(asli);
  });

  it('agregat lama rekap_harian_layanan hanya admin dan Koordinator unitnya', () => {
    expect(policy('rekap_harian_staff_read')).toMatch(/USING \(public\.boleh_rekap_lama\(layanan_id\)\)/);
    const f = fungsi(sql, 'boleh_rekap_lama');
    expect(f).toMatch(/me\.role = 'front_office' AND me\.koordinator/);
    expect(f).toMatch(/me\.role = 'petugas' AND me\.koordinator/);
  });

  it('ambil_alih_pendataan: RLS SELECT saja (admin + pemegang lama/baru), tanpa hak tulis klien', () => {
    expect(bare).toMatch(/CREATE TABLE IF NOT EXISTS public\.ambil_alih_pendataan/);
    expect(bare).toMatch(/ALTER TABLE public\.ambil_alih_pendataan ENABLE ROW LEVEL SECURITY/);
    expect(bare).toMatch(/GRANT SELECT ON TABLE public\.ambil_alih_pendataan TO authenticated;/);
    expect(bare).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*ambil_alih_pendataan TO authenticated/);
    const p = policy('ambil_alih_pendataan_select');
    expect(p).toMatch(/FOR SELECT TO authenticated/);
    expect(p).toMatch(/me\.role = 'admin' OR me\.id = pemegang_lama OR me\.id = pemegang_baru/);
    expect(bare).not.toMatch(/FOR ALL\s+(USING|WITH)/i);
  });

  it('koordinator_ambil_alih_tiket memeriksa peran, penanda, unit, sesi, alasan, status', () => {
    const f = fungsi(sql, 'koordinator_ambil_alih_tiket');
    expect(f).toMatch(/v_me_role IS DISTINCT FROM 'petugas' OR v_me_kd IS NOT TRUE/);
    expect(f).toMatch(/public\.sesi_valid\(\)/);
    for (const kode of ['FORBIDDEN', 'SESI_TIDAK_SAH', 'ALASAN_WAJIB', 'NOT_FOUND', 'INVALID_STATUS', 'BUKAN_SATU_UNIT', 'KANAL_CHAT']) {
      expect(f).toContain(`'${kode}:`);
    }
    expect(f).toMatch(/v_t\.layanan_id IS DISTINCT FROM v_me_lyn/);
    // KANAL_CHAT diperiksa SEBELUM tiket/tahap diubah (sama dengan jalur FO).
    expect(f.indexOf("'KANAL_CHAT:")).toBeLessThan(f.indexOf('UPDATE public.tiket_antrean'));
    expect(f).toMatch(/pc\.status = 'berjalan' AND pc\.saluran = 'chat'/);
    expect(f).toMatch(/'sudah_milik_anda', true/);
    expect(f).toMatch(/INSERT INTO public\.ambil_alih_pendataan/);
    expect(f).toMatch(/'koordinator_ambil_alih', 'tiket_antrean'/);
    expect(f).toMatch(/public\.queue_notifikasi\(\s*v_lama\.auth_user_id/);
    expect(f).toMatch(/'type', 'pendataan_diambil_alih'/);
  });

  it('anti-drift: blok pindah pemilik + tahap sama dengan admin_ambil_alih 0005 (kecuali teks catatan)', () => {
    const potong = (f: string) => {
      const awal = f.indexOf('UPDATE public.tiket_antrean AS t SET dilayani_oleh = v_me_id');
      const akhir = f.indexOf("'berjalan', v_now, v_me_id)", awal);
      return f.slice(awal, akhir).replace(/\s+/g, ' ').trim();
    };
    const asli = potong(fungsi(readFileSync(join(__dirname, '202610140005_fo_selaras_antrean.sql'), 'utf8'), 'admin_ambil_alih'));
    const baru = potong(fungsi(sql, 'koordinator_ambil_alih_tiket'));
    expect(asli.length).toBeGreaterThan(200);
    expect(baru).toBe(asli.replace("'Diambil alih Admin: '", "'Diambil alih Koordinator: '"));
  });

  it('koordinator_ambil_alih_fo: hanya tahap FO berjalan bukan chat, milik FO lain', () => {
    const f = fungsi(sql, 'koordinator_ambil_alih_fo');
    expect(f).toMatch(/v_me_role IS DISTINCT FROM 'front_office' OR v_me_kd IS NOT TRUE/);
    expect(f).toMatch(/v_p\.peran_tahap <> 'fo'/);
    expect(f).toMatch(/v_p\.status <> 'berjalan'/);
    expect(f).toMatch(/'KANAL_CHAT:/);
    expect(f).toMatch(/v_lama\.role IS DISTINCT FROM 'front_office'/);
    expect(f).toMatch(/batal_karena = 'diambil_alih'/);
    expect(f).toMatch(/left\('Diambil alih Koordinator: ' \|\| v_alasan, 200\)/);
    expect(f).toMatch(/'koordinator_ambil_alih', 'penanganan'/);
  });

  it('ambil_alih_tandai_dilihat hanya mengubah baris pemegang lama yang belum dilihat', () => {
    const f = fungsi(sql, 'ambil_alih_tandai_dilihat');
    expect(f).toMatch(/a\.pemegang_lama = v_me_id AND a\.dilihat_at IS NULL/);
  });

  it('RPC tulis hanya untuk authenticated (bukan anon)', () => {
    for (const fn of ['koordinator_ambil_alih_tiket(uuid, text)', 'koordinator_ambil_alih_fo(uuid, text)', 'ambil_alih_tandai_dilihat(uuid)']) {
      expect(bare).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated;`);
    }
    expect(bare).not.toMatch(/TO anon/);
  });
});

describe('rollback 202610290001 / 202610290002 dan penjaga urutan rollback lama', () => {
  const docs = (n: string) => readFileSync(join(__dirname, '..', '..', 'docs', n), 'utf8').replace(/\r\n/g, '\n');
  const rb1 = docs('rollback-koordinator-akses-data-202610290001.sql');
  const rb2 = docs('rollback-rekap-terpadu-202610290002.sql');

  it('rollback 0001 memulihkan boleh_penanganan PERSIS 0013 (+ penanda) dan boleh_kunjungan PERSIS 0009', () => {
    const m13 = readFileSync(join(__dirname, '202610140013_fo_keterbukaan_data.sql'), 'utf8');
    const m09 = readFileSync(join(__dirname, '202610140009_chat_online.sql'), 'utf8');
    expect(fungsi(rb1, 'boleh_penanganan')).toBe(fungsi(m13, 'boleh_penanganan'));
    expect(fungsi(rb1, 'boleh_kunjungan')).toBe(fungsi(m09, 'boleh_kunjungan'));
    expect(rb1).toMatch(/COMMENT ON FUNCTION public\.boleh_penanganan\(uuid, text, uuid, uuid, text\) IS\s+'202610140013:/);
    for (const p of ['oss_read_staff', 'perizinan_read_staff', 'rekap_harian_staff_read', 'visit_select_own']) {
      expect(rb1).toMatch(new RegExp(`CREATE POLICY ${p} ON`));
    }
    expect(rb1.replace(/--[^\n]*/g, '')).not.toMatch(/DROP (TABLE|COLUMN|FUNCTION)|\bDELETE\b/i);
    expect(rb1).toContain('DROP TRIGGER IF EXISTS trg_petugas_cabut_koordinator ON public.petugas;');
    expect(rb1).toContain('REVOKE ALL ON FUNCTION public.fo_status_qr(text) FROM PUBLIC, anon, authenticated;');
  });

  it('rollback 0001: setiap COMMENT lengkap; COMMENT boleh_penanganan identik byte-per-byte dengan 0013', () => {
    // Literal string SQL dengan escape '' (tanpa berhenti di ';' di dalam string).
    const komentar = [...rb1.matchAll(/COMMENT ON FUNCTION [^\n]+ IS\s+(?:NULL|'(?:[^']|'')*');/g)].map((m) => m[0]);
    const semua = rb1.match(/COMMENT ON FUNCTION/g) ?? [];
    expect(komentar).toHaveLength(semua.length);
    for (const k of komentar) expect(k).toMatch(/(?:';|IS NULL;)$/);
    const m13 = readFileSync(join(__dirname, '202610140013_fo_keterbukaan_data.sql'), 'utf8').replace(/\r\n/g, '\n');
    const asal = m13.match(/COMMENT ON FUNCTION public\.boleh_penanganan\(uuid, text, uuid, uuid, text\) IS\s+'(?:[^']|'')*';/)![0];
    expect(komentar).toContain(asal);
  });

  it('rollback 0001 menolak bila 0002 masih ada, sebelum perubahan apa pun', () => {
    const b = rb1.replace(/--[^\n]*/g, '');
    expect(b.search(/DO \$\$/)).toBeLessThan(b.search(/\b(CREATE|DROP|REVOKE|COMMENT)\b/));
    expect(b).toMatch(/rekap_pelayanan_inti\(date,date,text,uuid\)'\) IS NOT NULL THEN\s+RAISE EXCEPTION 'ROLLBACK DITOLAK/);
  });

  it('rollback 0002 menghapus kelima fungsi rekap', () => {
    for (const f of ['rekap_kinerja_petugas', 'rekap_harian_terpadu', 'rekap_data_pelayanan', 'lingkup_data_saya', 'rekap_pelayanan_inti']) {
      expect(rb2).toContain(`DROP FUNCTION IF EXISTS public.${f}(`);
    }
  });

  it('rollback 0012 dan 0013 menolak selama penanda 0029 masih ada (pemeriksaan pertama)', () => {
    for (const n of ['rollback-perbaikan-review-202610140012.sql', 'rollback-fo-keterbukaan-data-202610140013.sql']) {
      const blok = docs(n).replace(/--[^\n]*/g, '').match(/DO \$\$[\s\S]*?\$\$;/)![0];
      const i29 = blok.indexOf("LIKE '%202610290001%' THEN");
      expect(i29, n).toBeGreaterThan(-1);
      expect(blok.indexOf('IF ')).toBeLessThan(i29);
      expect(blok.slice(0, i29).match(/\bIF /g), n).toHaveLength(1);
      expect(blok).toContain('rollback-koordinator-akses-data-202610290001.sql');
    }
  });
});
