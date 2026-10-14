// @vitest-environment node
// Kontrak statis 202610140012_perbaikan_review (perbaikan temuan review atas 0002..0011) beserta rollback dan penjaga
// urutan rollback lain. Tidak mengeksekusi SQL; tidak menyentuh database. Uji perilaku: scripts/test-perbaikan-review.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
import { determineFormType } from '../../src/lib/pelayanan';

const M12 = '202610140012_perbaikan_review.sql';
const RB12 = 'rollback-perbaikan-review-202610140012.sql';

const baca = (nama: string) => readFileSync(join(MIGRATIONS_DIR, nama), 'utf8').replace(/\r\n/g, '\n');
const bacaDocs = (nama: string) =>
  readFileSync(join(MIGRATIONS_DIR, '..', '..', 'docs', nama), 'utf8').replace(/\r\n/g, '\n');
const rapikan = (s: string) => s.replace(/\s+/g, ' ').trim();

function ambilFungsi(sql: string, nama: string): string {
  const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.` + nama + String.raw`\s*\([\s\S]*?\$\$;`, 'gi');
  const hasil = [...sql.matchAll(re)].map((m) => m[0]);
  if (hasil.length !== 1) throw new Error(`fungsi ${nama}: ${hasil.length} definisi`);
  return hasil[0];
}
const kodeGalat = (def: string) => new Set([...def.matchAll(/'([A-Z][A-Z_]{3,}):/g)].map((m) => m[1]));
const kepala = (d: string) => rapikan(d.slice(0, d.indexOf('$$')));
/** Hapus potongan (string persis) dari definisi; gagal bila potongan tidak ada. */
function tanpa(def: string, ...potongan: string[]): string {
  let s = def;
  for (const p of potongan) {
    expect(s, p.slice(0, 60)).toContain(p);
    s = s.replace(p, '');
  }
  return s;
}

const raw = baca(M12);
const sql = stripSqlComments(raw);
const rbRaw = bacaDocs(RB12);
const rb = stripSqlComments(rbRaw);
const S = {
  m4: stripSqlComments(baca('202610140004_fo_rpc.sql')),
  m5: stripSqlComments(baca('202610140005_fo_selaras_antrean.sql')),
  m7: stripSqlComments(baca('202610140007_wp24_akhiri_dual_write.sql')),
  m11: stripSqlComments(baca('202610140011_pendataan_wajib.sql')),
};

const DIUBAH: Array<[string, string]> = [
  ['layanan_selesai', 'm11'],
  ['get_queue_position', 'm5'],
  ['fo_mulai_kunjungan', 'm4'],
  ['layanan_mulai', 'm7'],
  ['admin_alihkan', 'm7'],
  ['reservasi_buat', 'm4'],
  ['rollup_rekap_harian', 'm5'],
  ['tandai_reservasi_no_show', 'm7'],
];
const asal = (nama: string, kunci: string) => ambilFungsi(S[kunci as keyof typeof S], nama);

describe('202610140012: berkas, urutan, prasyarat', () => {
  it('terdaftar, nama valid, sesudah 0011; tanpa kontrol transaksi; perintah dry-run di header', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(M12);
    const semua = listMigrationFiles();
    expect(semua.indexOf(M12)).toBe(semua.indexOf('202610140011_pendataan_wajib.sql') + 1);
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rbRaw)).toBe(false);
    expect(raw).toContain(`apply-migration.mjs supabase/migrations/${M12} --atomic --dry-run`);
    expect(rbRaw).toContain(`apply-migration.mjs docs/${RB12} --atomic --dry-run`);
  });

  it('penjaga prasyarat (DO) sebelum perubahan apa pun: 0011, 0009, 0007, pg_cron', () => {
    const awal = sql.search(/DO \$\$/);
    expect(awal).toBeGreaterThanOrEqual(0);
    expect(awal).toBeLessThan(sql.search(/\b(?:CREATE|ALTER|UPDATE|INSERT|DROP|REVOKE)\b/));
    const blok = sql.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(blok).toMatch(/to_regprocedure\('public\.pendataan_validasi_payload\(text,jsonb\)'\) IS NULL/);
    expect(blok).toMatch(/to_regprocedure\('public\.chat_buat_kunjungan\(uuid,text,date\)'\) IS NULL/);
    expect(blok).toMatch(/to_regprocedure\('public\.visit_arsip_jaga\(\)'\) IS NULL/);
    expect(blok).toMatch(/nspname = 'cron'/);
  });

  it('semua fungsi SECURITY DEFINER memakai search_path terkunci; tanpa DELETE/TRUNCATE/visit', () => {
    for (const m of sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/g)) {
      expect(ambilFungsi(sql, m[1]), m[1]).toMatch(/SET search_path = pg_catalog, public/);
    }
    expect(sql).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b|DROP[^;]*\bCASCADE\b/i);
    expect(sql).not.toMatch(/public\.visit\b/);
  });

  it.each(DIUBAH)('%s: signature/atribut sama dengan versi terakhir; kode galat lama dipertahankan', (nama, kunci) => {
    const baru = ambilFungsi(sql, nama);
    const lama = asal(nama, kunci);
    expect(kepala(baru)).toBe(kepala(lama));
    for (const k of kodeGalat(lama)) expect(kodeGalat(baru).has(k), k).toBe(true);
  });
});

describe('#1 kewajiban Formulir Pendataan per layanan', () => {
  it('kolom layanan.form_pendataan + CHECK, nilai awal dari nama (tanpa menimpa pilihan Admin), trigger isi saat INSERT', () => {
    expect(sql).toMatch(/ALTER TABLE public\.layanan ADD COLUMN IF NOT EXISTS form_pendataan text;/);
    expect(rapikan(sql)).toContain(
      "CHECK (form_pendataan IS NULL OR form_pendataan IN ('oss', 'perizinan'))");
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM public\.layanan AS l WHERE l\.form_pendataan IS NOT NULL\) THEN/);
    expect(sql).toMatch(/CREATE TRIGGER trg_layanan_isi_form_pendataan\s+BEFORE INSERT ON public\.layanan/);
    expect(ambilFungsi(sql, 'layanan_isi_form_pendataan')).toMatch(/IF NEW\.form_pendataan IS NULL THEN/);
    expect(ambilFungsi(sql, 'layanan_isi_form_pendataan')).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.layanan_isi_form_pendataan\(\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.form_pendataan_dari_nama\(text\) FROM PUBLIC, anon, authenticated;/);
  });

  it('form_pendataan_dari_nama = determineFormType klien (urutan: non oss/perizinan -> perizinan, lalu oss)', () => {
    const f = ambilFungsi(sql, 'form_pendataan_dari_nama');
    const iNon = f.indexOf("'non oss'");
    const iPz = f.indexOf("'perizinan') > 0");
    const iOss = f.indexOf("'oss') > 0");
    expect(iNon).toBeGreaterThan(0);
    expect(iPz).toBeGreaterThan(iNon);
    expect(iOss).toBeGreaterThan(iPz);
    expect(f).toMatch(/IMMUTABLE/);
    // Emulasi aturan SQL (substring, huruf kecil) dibandingkan dengan fungsi klien pada nama layanan nyata/sintetis.
    const emulasi = (n: string) => {
      const x = n.toLowerCase();
      if (x.includes('non oss') || x.includes('perizinan')) return 'perizinan';
      if (x.includes('oss')) return 'oss';
      return null;
    };
    for (const n of ['Helpdesk OSS', 'Helpdesk Non OSS', 'Layanan Perizinan', 'Pengaduan', 'P4 Investasi', 'BOSS', 'ZZ-TES-A']) {
      expect(emulasi(n), n).toBe(determineFormType(n));
    }
  });

  it('layanan_selesai = versi 0011 + blok kewajiban form (setelah BUKAN_PEMILIK, sebelum menulis) + audit tanpa pendataan', () => {
    const f12 = ambilFungsi(sql, 'layanan_selesai');
    const f11 = asal('layanan_selesai', 'm11');
    const blokWajib = f12.slice(
      f12.indexOf('  SELECT l.form_pendataan INTO v_form_wajib'),
      f12.indexOf('  SELECT p.id INTO v_p FROM public.penanganan'),
    );
    const blokAudit = f12.slice(f12.indexOf('  IF v_tanpa_pendataan THEN'), f12.indexOf('  RETURN pg_catalog.jsonb_build_object('));
    const sisa = tanpa(f12,
      '  v_form_wajib      text;\n', '  v_tanpa_pendataan boolean := false;\n', blokWajib, blokAudit);
    expect(rapikan(sisa)).toBe(rapikan(f11));

    expect(f12.indexOf('SELECT l.form_pendataan INTO v_form_wajib')).toBeGreaterThan(f12.indexOf("'BUKAN_PEMILIK:"));
    expect(f12.indexOf('SELECT l.form_pendataan INTO v_form_wajib')).toBeLessThan(f12.indexOf('INSERT INTO public.pelayanan_oss'));
    expect(blokWajib).toMatch(/IF v_form_wajib IS NOT NULL AND p_form_type IS DISTINCT FROM v_form_wajib THEN/);
    expect(blokWajib).toMatch(/RAISE EXCEPTION 'INVALID_PAYLOAD:[^;]*USING ERRCODE = '22023'/);
    // Pengecualian sempit: hanya Admin, tanpa form, yang tercatat sebagai pemilik_baru pada audit admin_ambil_alih tiket ini.
    expect(rapikan(blokWajib)).toContain(
      "IF p_form_type IS NULL AND v_me_role = 'admin' AND EXISTS ( SELECT 1 FROM public.audit_log AS a WHERE a.aksi = 'admin_ambil_alih' AND a.entitas = 'tiket_antrean' AND a.entitas_id = p_tiket_id::text AND a.detail ->> 'pemilik_baru' = v_me_id::text) THEN");
    expect(blokAudit).toMatch(/'layanan_selesai_tanpa_pendataan'/);
    expect(kodeGalat(f12)).toEqual(new Set([...kodeGalat(f11), 'INVALID_PAYLOAD']));
    expect(sql).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.layanan_selesai/i);
  });
});

describe('#2 #4 #12 #7 #8 #9 #10 #5 RPC lain', () => {
  it('#2 get_queue_position: cocok dengan qr_token tanpa/dengan tanda hubung, signature uuid & hak anon tetap', () => {
    const f = ambilFungsi(sql, 'get_queue_position');
    expect(f).toMatch(/WHERE k\.qr_token IN \(p_qr_token::text, pg_catalog\.replace\(p_qr_token::text, '-', ''\)\)/);
    expect(rapikan(tanpa(f, "IN (p_qr_token::text, pg_catalog.replace(p_qr_token::text, '-', ''))")))
      .toBe(rapikan(tanpa(asal('get_queue_position', 'm5'), '= p_qr_token::text')));
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_queue_position\(uuid\) FROM PUBLIC;\s+GRANT\s+EXECUTE ON FUNCTION public\.get_queue_position\(uuid\) TO anon, authenticated;/);
  });

  it('#4 fo_mulai_kunjungan: INSERT ... ON CONFLICT (client_request_id) DO NOTHING lalu baca ulang (sudah_ada / IDEMPOTENSI_BENTROK)', () => {
    const f = ambilFungsi(sql, 'fo_mulai_kunjungan');
    expect(rapikan(f)).toContain('ON CONFLICT (client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING RETURNING id INTO v_kid;');
    const iKalah = f.indexOf('IF v_kid IS NULL THEN');
    expect(iKalah).toBeGreaterThan(f.indexOf('ON CONFLICT'));
    expect(iKalah).toBeLessThan(f.indexOf('INSERT INTO public.penanganan'));
    const kalah = f.slice(iKalah, f.indexOf('INSERT INTO public.penanganan'));
    expect(kalah).toMatch(/WHERE k\.client_request_id = p_client_request_id/);
    expect(kalah).toMatch(/IDEMPOTENSI_BENTROK/);
    expect(kalah).toMatch(/'sudah_ada', true/);
    // indeks unik parsial yang menjadi arbiter (0003) tetap ada dan tidak diubah di sini
    expect(baca('202610140003_fo_model_data.sql')).toMatch(/uq_kunjungan_client_request_id\s+ON public\.kunjungan \(client_request_id\) WHERE client_request_id IS NOT NULL/);
  });

  it('#12 fo_mulai_kunjungan: p_pengunjung_id hanya bila punya kunjungan hari ini (DATA_TIDAK_VALID), NOT_FOUND tetap', () => {
    const f = ambilFungsi(sql, 'fo_mulai_kunjungan');
    expect(f).toMatch(/NOT_FOUND: pengunjung tidak ditemukan/);
    expect(rapikan(f)).toContain(
      'NOT EXISTS (SELECT 1 FROM public.kunjungan AS kx WHERE kx.pengunjung_id = p_pengunjung_id AND kx.tanggal = v_tgl)');
    expect(f.indexOf('kx.pengunjung_id = p_pengunjung_id')).toBeLessThan(f.indexOf('INSERT INTO public.kunjungan'));
  });

  it('#7 layanan_mulai: BUKAN_HARI_INI (P0001) sebelum mengunci/mengubah apa pun; sisanya = versi 0007', () => {
    const f = ambilFungsi(sql, 'layanan_mulai');
    const blok = f.slice(f.indexOf('  IF v_t.tanggal IS DISTINCT FROM v_tgl THEN'), f.indexOf('  PERFORM 1 FROM public.kunjungan'));
    expect(blok).toMatch(/RAISE EXCEPTION 'BUKAN_HARI_INI:[^;]*USING ERRCODE = 'P0001'/);
    const sisa = tanpa(f, blok, "  v_tgl        date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;\n", ', t.tanggal INTO v_t');
    expect(rapikan(sisa)).toBe(rapikan(tanpa(asal('layanan_mulai', 'm7'), ' INTO v_t')));
  });

  it('#8 admin_alihkan: LAYANAN_TIDAK_BUKA + LAYANAN_TUTUP seperti fo_eskalasi, sebelum terbit tiket; sisanya = versi 0007', () => {
    const f = ambilFungsi(sql, 'admin_alihkan');
    const blok = f.slice(f.indexOf('  IF NOT public.is_layanan_buka_jadwal(p_layanan_tujuan'), f.indexOf('  SELECT p.* INTO v_p'));
    expect(blok).toMatch(/LAYANAN_TIDAK_BUKA:[^;]*USING ERRCODE = 'P0001'/);
    expect(blok).toMatch(/IF public\.layanan_sudah_tutup\(\) THEN\s+RAISE EXCEPTION 'LAYANAN_TUTUP:/);
    expect(f.indexOf('is_layanan_buka_jadwal')).toBeLessThan(f.indexOf('public.terbit_tiket('));
    expect(rapikan(tanpa(f, blok))).toBe(rapikan(asal('admin_alihkan', 'm7')));
  });

  it('#9 reservasi_buat: kunci advisory dengan tujuan efektif; sisanya = versi 0004', () => {
    const f = ambilFungsi(sql, 'reservasi_buat');
    const kunci = (d: string) => d.match(/PERFORM pg_catalog\.pg_advisory_xact_lock\([\s\S]*?\);/)![0];
    expect(rapikan(kunci(f))).toBe(rapikan(
      "PERFORM pg_catalog.pg_advisory_xact_lock( pg_catalog.hashtext('lmh.reservasi:' || COALESCE(CASE WHEN v_tujuan = 'loket' THEN p_layanan_id::text END, v_tujuan) || ':' || p_tanggal::text));"));
    const lama = asal('reservasi_buat', 'm4');
    expect(rapikan(f.replace(kunci(f), ''))).toBe(rapikan(lama.replace(kunci(lama), '')));
  });

  it('#10 rollup_rekap_harian: hadir = kunjungan berbeda (tanpa dialihkan), durasi hanya tiket selesai; kolom lain identik', () => {
    const f = ambilFungsi(sql, 'rollup_rekap_harian');
    expect(rapikan(f)).toContain("count(DISTINCT t.kunjungan_id) FILTER (WHERE t.status NOT IN ('terjadwal', 'dialihkan')) AS total_hadir");
    expect(rapikan(f)).toContain("FILTER (WHERE t.status = 'selesai' AND t.waktu_selesai IS NOT NULL AND t.waktu_mulai_layan IS NOT NULL) AS rata_durasi_menit");
    const lama = rapikan(asal('rollup_rekap_harian', 'm5'));
    expect(lama).toContain("count(*) FILTER (WHERE t.status NOT IN ('terjadwal', 'dialihkan')) AS total_hadir");
    const normal = (s: string) => rapikan(s)
      .replace("count(DISTINCT t.kunjungan_id) FILTER", 'count(*) FILTER')
      .replace("FILTER (WHERE t.status = 'selesai' AND t.waktu_selesai", 'FILTER (WHERE t.waktu_selesai');
    expect(normal(f)).toBe(lama);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.rollup_rekap_harian\(date\) TO service_role;/);
  });

  it('#5 walk-in terjadwal: gerbang sekali (semua tanggal) + klausa job no-show (tanggal lewat), keduanya diaudit', () => {
    const gerbang = sql.slice(0, sql.indexOf('CREATE OR REPLACE FUNCTION public.tandai_reservasi_no_show'));
    const cte = gerbang.slice(gerbang.lastIndexOf('WITH ditutup AS'));
    expect(rapikan(cte)).toContain("WHERE k.asal = 'walk_in' AND k.status = 'terjadwal' RETURNING");
    expect(cte).toMatch(/SET status = 'batal'/);
    expect(cte).toMatch(/'tutup_walkin_terjadwal'/);
    const f = ambilFungsi(sql, 'tandai_reservasi_no_show');
    expect(rapikan(f)).toContain("WHERE k.asal = 'walk_in' AND k.status = 'terjadwal' AND k.tanggal < v_today");
    expect(f).toMatch(/'tutup_walkin_terjadwal'/);
    // klausa reservasi = versi 0007 apa adanya
    expect(rapikan(f)).toContain(rapikan(`UPDATE public.kunjungan AS k
  SET    status     = 'no_show',
         updated_at = now()
  WHERE  k.asal = 'reservasi'
    AND  k.status = 'terjadwal'
    AND  k.tanggal < v_today;`));
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.tandai_reservasi_no_show\(\)\s+FROM PUBLIC, anon, authenticated;/);
  });
});

describe('#11 tutup_chat_tertinggal', () => {
  const f = ambilFungsi(sql, 'tutup_chat_tertinggal');
  it('definer, hanya service_role; job 23:30 WIB berdasar nama; dijalankan sekali saat migrasi', () => {
    expect(f).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.tutup_chat_tertinggal\(\) FROM PUBLIC, anon, authenticated;\s+GRANT EXECUTE ON FUNCTION public\.tutup_chat_tertinggal\(\) TO service_role;/);
    expect(sql).toMatch(/cron\.unschedule\(job\.jobid\) FROM cron\.job AS job WHERE job\.jobname = 'chat_tutup_otomatis'/);
    expect(sql).toMatch(/cron\.schedule\('chat_tutup_otomatis', '30 16 \* \* \*', 'SELECT public\.tutup_chat_tertinggal\(\)'\)/);
    expect(sql).toMatch(/v_n := public\.tutup_chat_tertinggal\(\);/);
  });

  it('hanya sesi eskalasi/aktif tanpa aktivitas > 24 jam; kunci sesi lalu periksa ulang; urutan kunci chat_sesi -> kunjungan', () => {
    expect(f).toMatch(/WHERE s\.status IN \('eskalasi', 'aktif'\)/);
    expect(f).toMatch(/INTERVAL '24 hours'/);
    expect(f).toMatch(/FROM public\.chat_sesi AS s WHERE s\.id = r\.id FOR NO KEY UPDATE/);
    expect(f.indexOf('FOR NO KEY UPDATE')).toBeLessThan(f.indexOf('FROM public.kunjungan AS k WHERE k.id = v_s.kunjungan_id FOR UPDATE'));
    expect(f).toMatch(/m\.created_at >= v_batas\) THEN\s+CONTINUE;/);
  });

  it('tahap terbuka batal (berjalan: tidak_ditutup, menunggu: tidak_terlayani) + audit; kunjungan selesai/tidak_terlayani; sesi selesai lewat RPC internal', () => {
    expect(f).toMatch(/batal_karena = CASE WHEN q\.status = 'berjalan' THEN 'tidak_ditutup' ELSE 'tidak_terlayani' END/);
    expect(f).toMatch(/'tutup_otomatis_penanganan'/);
    expect(f).toMatch(/SET status = CASE WHEN k\.status = 'dilayani' THEN 'selesai' ELSE 'tidak_terlayani' END/);
    expect(f).toMatch(/PERFORM public\.chat_ubah_sesi\(r\.id, 'selesai', v_s\.ditangani_oleh\);/);
    expect(f).toMatch(/PERFORM public\.chat_pesan_sistem\(r\.id,/);
    // nilai yang tersedia di CHECK 0008
    expect(baca('202610140008_wp24_tutup_otomatis_retensi.sql')).toMatch(/'tidak_terlayani', 'tidak_ditutup'/);
  });
});

describe('rollback 202610140012', () => {
  it.each(DIUBAH)('memulihkan %s PERSIS dari versi sebelumnya', (nama, kunci) => {
    expect(rapikan(ambilFungsi(rb, nama))).toBe(rapikan(asal(nama, kunci)));
  });

  it('hak dipulihkan; objek baru dihapus; kolom dihapus SETELAH layanan_selesai dipulihkan', () => {
    expect(rb).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.get_queue_position\(uuid\) TO anon, authenticated;/);
    expect(rb).toMatch(/GRANT EXECUTE ON FUNCTION public\.rollup_rekap_harian\(date\) TO service_role;/);
    for (const s of [
      "job.jobname = 'chat_tutup_otomatis'",
      'DROP FUNCTION IF EXISTS public.tutup_chat_tertinggal();',
      'DROP TRIGGER IF EXISTS trg_layanan_isi_form_pendataan ON public.layanan;',
      'DROP FUNCTION IF EXISTS public.layanan_isi_form_pendataan();',
      'ALTER TABLE public.layanan DROP CONSTRAINT IF EXISTS layanan_form_pendataan_check;',
      'ALTER TABLE public.layanan DROP COLUMN IF EXISTS form_pendataan;',
      'DROP FUNCTION IF EXISTS public.form_pendataan_dari_nama(text);',
    ]) expect(rb).toContain(s);
    expect(rb.indexOf('FUNCTION public.layanan_selesai')).toBeLessThan(rb.indexOf('DROP COLUMN IF EXISTS form_pendataan'));
    expect(rb).not.toMatch(/SELECT l\.form_pendataan/);
    expect(rb).not.toMatch(/^\s*DELETE\s+FROM/im);
  });

  it('penjaga di awal: 0011 dan 0009 harus masih terpasang', () => {
    const awal = rb.search(/DO \$\$/);
    expect(awal).toBeGreaterThanOrEqual(0);
    expect(awal).toBeLessThan(rb.search(/\b(?:CREATE|DROP|ALTER)\b/));
    expect(rb).toMatch(/to_regprocedure\('public\.pendataan_validasi_payload\(text,jsonb\)'\) IS NULL THEN\s+RAISE EXCEPTION 'ROLLBACK DITOLAK/);
  });
});

describe('#3 penjaga urutan rollback lain', () => {
  const guard12 = /to_regprocedure\('public\.form_pendataan_dari_nama\(text\)'\) IS NOT NULL/;
  it('rollback 0007 menolak bila 0012 atau 0011 masih terpasang (sebelum perubahan apa pun)', () => {
    const r7 = stripSqlComments(bacaDocs('rollback-wp24-akhiri-dual-write-202610140007.sql'));
    const blok = r7.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(r7.search(/DO \$\$/)).toBeLessThan(r7.search(/\b(?:CREATE|DROP|ALTER|GRANT)\b/));
    expect(blok).toMatch(guard12);
    expect(blok).toMatch(/to_regprocedure\('public\.pendataan_validasi_payload\(text,jsonb\)'\) IS NOT NULL THEN\s+RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610140011/);
  });

  it('rollback 0011 dan 0009 menolak bila 0012 masih terpasang', () => {
    for (const nama of ['rollback-pendataan-wajib-202610140011.sql', 'rollback-chat-online-202610140009.sql']) {
      const r = stripSqlComments(bacaDocs(nama));
      expect(r.search(/DO \$\$/), nama).toBeLessThan(r.search(/\b(?:CREATE|DROP|ALTER)\b/));
      expect(r.match(/DO \$\$[\s\S]*?\$\$;/)![0], nama).toMatch(guard12);
    }
  });

  it('runbook: larangan menerapkan ulang 0004/0005 setelah 0007, urutan rollback, ambil alih tiket tanpa pemilik', () => {
    const rb = bacaDocs('RUNBOOK_FO_ESKALASI.md');
    expect(rb).toMatch(/JANGAN menerapkan ulang 202610140004 atau 202610140005/);
    expect(rb).toContain('rollback-perbaikan-review-202610140012.sql');
    expect(rb).toMatch(/dilayani_oleh (?:kosong|NULL)/);
  });
});
