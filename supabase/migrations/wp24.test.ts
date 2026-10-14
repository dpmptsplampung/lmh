// @vitest-environment node
// Kontrak statis WP-24 (B-DB2): 202610140007_wp24_akhiri_dual_write + 202610140008_wp24_tutup_otomatis_retensi beserta
// rollback-nya. Tidak mengeksekusi SQL; tidak menyentuh database. Uji perilaku DB: scripts/test-wp24.mjs (transaksi
// SELALU di-ROLLBACK). Checklist sumber: docs/analysis/ANTREAN-ARAH-TULIS.md §6.2.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi, mengubahPolicyAtauFungsi } from '../../scripts/lib/sql-txn.mjs';

const M7 = '202610140007_wp24_akhiri_dual_write.sql';
const M8 = '202610140008_wp24_tutup_otomatis_retensi.sql';
const RB7 = 'rollback-wp24-akhiri-dual-write-202610140007.sql';
const RB8 = 'rollback-wp24-tutup-otomatis-retensi-202610140008.sql';

const baca = (nama: string) => readFileSync(join(MIGRATIONS_DIR, nama), 'utf8').replace(/\r\n/g, '\n');
const bacaDocs = (...bagian: string[]) =>
  readFileSync(join(MIGRATIONS_DIR, '..', '..', 'docs', ...bagian), 'utf8').replace(/\r\n/g, '\n');
const rapikan = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Semua definisi `CREATE [OR REPLACE] FUNCTION public.<nama>(...) ... $$;` (urutan kemunculan). */
function semuaFungsi(sql: string, nama: string): string[] {
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${nama}\\s*\\([\\s\\S]*?\\$\\$;`, 'gi');
  return [...sql.matchAll(re)].map((m) => m[0]);
}
function ambilFungsi(sql: string, nama: string): string {
  const d = semuaFungsi(sql, nama);
  if (d.length !== 1) throw new Error(`fungsi ${nama}: ${d.length} definisi`);
  return d[0];
}
/** Kepala definisi (signature + atribut) sampai `AS $$`, dinormalkan. */
const kepala = (def: string) => rapikan(def.slice(0, def.indexOf('$$')).replace(/^CREATE\s+FUNCTION/i, 'CREATE OR REPLACE FUNCTION'));
/** Kode galat di awal pesan RAISE ('KODE: ...'). */
const kodeGalat = (def: string) => new Set([...def.matchAll(/'([A-Z][A-Z_]{3,}):/g)].map((m) => m[1]));
/** Badan tanpa komentar dan tanpa isi string. */
const tanpaString = (s: string) => s.replace(/'(?:[^']|'')*'/g, "''");

const raw7 = baca(M7);
const raw8 = baca(M8);
const sql7 = stripSqlComments(raw7);
const sql8 = stripSqlComments(raw8);
const rbRaw7 = bacaDocs(RB7);
const rbRaw8 = bacaDocs(RB8);
const rb7 = stripSqlComments(rbRaw7);
const rb8 = stripSqlComments(rbRaw8);

const F2 = stripSqlComments(baca('202610140002_tiket_kepemilikan.sql'));
const F4 = stripSqlComments(baca('202610140004_fo_rpc.sql'));
const F5 = stripSqlComments(baca('202610140005_fo_selaras_antrean.sql'));
const B4 = stripSqlComments(baca('202607140004_security_and_automation.sql'));
const B5 = stripSqlComments(baca('202607140005_views_and_jobs.sql'));
const W12 = stripSqlComments(baca('202607290012_layanan_kontak_notifikasi.sql'));
const W16 = stripSqlComments(baca('202607300016_wp22_views_tiket_antrean.sql'));

// Fungsi yang ditulis ulang 0007 -> sumber definisi sebelumnya (dipulihkan rollback).
const DITULIS_ULANG: [string, string][] = [
  ['layanan_mulai', F5], ['layanan_selesai', F5], ['tandai_tidak_terlayani_akhir_hari', F5], ['tandai_reservasi_no_show', F5],
  ['fo_checkin_reservasi', F4], ['fo_tolak_reservasi', F4], ['fo_selesai', F4], ['fo_eskalasi', F4],
  ['fo_ambil_dari_kotak_masuk', F4], ['layanan_kembalikan', F4], ['admin_alihkan', F4], ['reservasi_batalkan', F4],
  ['get_skm_context', B4], ['submit_skm_response', B4], ['queue_notifikasi', B4],
  ['jumlah_terdaftar', W12], ['metrik_kepatuhan', W12],
];
const RPC_TANPA_VISIT = DITULIS_ULANG.slice(0, 12).map(([n]) => n);
const FUNGSI_BARU_7 = ['visit_arsip_jaga', 'kunjungan_layanan_skm', 'notify_kunjungan_status', 'notify_tiket_antrean', 'kunjungan_selesai_rr'];
const TRIGGER_BARU_7: [string, string][] = [
  ['trg_visit_arsip', 'visit'], ['trg_notify_kunjungan_status', 'kunjungan'], ['trg_kunjungan_selesai_rr', 'kunjungan'],
  ['trg_audit_kunjungan_status', 'kunjungan'], ['trg_notify_tiket_antrean', 'tiket_antrean'], ['trg_audit_tiket_status', 'tiket_antrean'],
];
const TRIGGER_VISIT_DIMATIKAN = [
  'trg_visit_dual_write', 'trg_notify_visit_selesai', 'trg_notify_reservasi_confirmed', 'trg_visit_selesai_rr',
  'trg_audit_visit_status', 'trg_log_visit_insert', 'trg_guard_visit_layanan_buka', 'trg_visit_qr_hangus',
];
const PENULIS_VISIT = /\b(?:UPDATE\s+public\.visit|INSERT\s+INTO\s+public\.visit|DELETE\s+FROM\s+public\.visit)\b/i;

describe('WP-24: berkas, urutan, penjaga', () => {
  it('tanpa BEGIN/COMMIT, wajib --atomic, perintah penerapan tertulis', () => {
    for (const s of [raw7, raw8, rbRaw7, rbRaw8]) expect(mengandungKontrolTransaksi(s)).toBe(false);
    expect(mengubahPolicyAtauFungsi(raw7)).toBe(true);
    expect(mengubahPolicyAtauFungsi(raw8)).toBe(true);
    expect(raw7).toContain(`apply-migration.mjs supabase/migrations/${M7} --atomic --dry-run`);
    expect(raw8).toContain(`apply-migration.mjs supabase/migrations/${M8} --atomic --dry-run`);
    expect(rbRaw7).toContain(`apply-migration.mjs docs/${RB7} --atomic --dry-run`);
    expect(rbRaw8).toContain(`apply-migration.mjs docs/${RB8} --atomic --dry-run`);
  });

  it('terdaftar, berpola benar, tepat setelah 202610140006 dan berurutan 0007 -> 0008', () => {
    const semua = listMigrationFiles();
    for (const f of [M7, M8]) {
      expect(FORWARD_MIGRATION_FILES).toContain(f);
      expect(f).toMatch(/^\d{12}_[a-z0-9_]+\.sql$/);
    }
    const i6 = semua.indexOf('202610140006_pernyataan_kebenaran.sql');
    expect(semua.indexOf(M7)).toBe(i6 + 1);
    expect(semua.indexOf(M8)).toBe(i6 + 2);
  });

  it('penjaga DO di awal: prasyarat 0003..0006 dan ANTREAN KOSONG (tiket menunggu/dipanggil hari ini)', () => {
    const awal = sql7.search(/DO \$\$/);
    expect(awal).toBeGreaterThanOrEqual(0);
    expect(awal).toBeLessThan(sql7.search(/\b(?:CREATE|ALTER|UPDATE|INSERT|DROP|REVOKE)\b/));
    const blok = sql7.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(blok).toMatch(/to_regprocedure\('public\.layanan_selesai\(uuid,text,jsonb,uuid,text\)'\)/);
    expect(blok).toMatch(/to_regprocedure\('public\.ubah_nama_pengunjung\(uuid,text,text\)'\)/);
    expect(blok).toMatch(/to_regclass\('public\.penanganan'\)/);
    expect(blok).toMatch(/status IN \('menunggu', 'dipanggil'\) AND t\.tanggal = v_hari_ini/);
    expect(blok).toMatch(/RAISE EXCEPTION 'CUTOVER_DITOLAK/);
    const blok8 = sql8.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(sql8.search(/DO \$\$/)).toBeLessThan(sql8.search(/\b(?:CREATE|ALTER|UPDATE|INSERT)\b/));
    expect(blok8).toMatch(/to_regprocedure\('public\.visit_arsip_jaga\(\)'\)/);
  });
});

describe('WP-24 (a): visit menjadi arsip', () => {
  it('8 trigger efek visit DINONAKTIFKAN (bukan di-DROP); sync_visit_dual_write tidak diubah', () => {
    const daftar = sql7.match(/FOREACH v_nama IN ARRAY ARRAY\[([\s\S]*?)\]/)![1];
    for (const t of TRIGGER_VISIT_DIMATIKAN) expect(daftar).toContain(`'${t}'`);
    expect(sql7).toMatch(/ALTER TABLE public\.visit DISABLE TRIGGER %I/);
    expect(sql7).not.toMatch(/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?trg_visit_dual_write/i);
    expect(sql7).not.toMatch(/FUNCTION\s+public\.sync_visit_dual_write/i);
    expect(sql7).not.toMatch(/DISABLE TRIGGER (?:ALL|USER)/i);
  });

  it('penjaga transisi A3 dihapus; penjaga arsip menolak semua tulis kecuali flag anonimisasi dan FK SET NULL', () => {
    expect(sql7).toMatch(/DROP TRIGGER IF EXISTS trg_guard_visit_transisi_layanan ON public\.visit;/);
    expect(sql7).toMatch(/DROP FUNCTION IF EXISTS public\.guard_visit_transisi_layanan\(\);/);
    expect(sql7).not.toMatch(/lmh\.antrean_rpc/);
    const f = ambilFungsi(sql7, 'visit_arsip_jaga');
    expect(f).toMatch(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    expect(f).toMatch(/current_setting\('lmh\.visit_arsip', true\), ''\) = 'on'/);
    expect(f).toMatch(/OLD\.pengunjung_id IS NOT NULL AND NEW\.pengunjung_id IS NULL/);
    expect(f).toMatch(/to_jsonb\(NEW\) - 'pengunjung_id' - 'updated_at'\)\s*= \(pg_catalog\.to_jsonb\(OLD\) - 'pengunjung_id' - 'updated_at'\)/);
    expect(f).toMatch(/RAISE EXCEPTION 'VISIT_ARSIP:[\s\S]*ERRCODE = '42501'/);
    expect(sql7).toMatch(/CREATE TRIGGER trg_visit_arsip\s+BEFORE INSERT OR UPDATE OR DELETE ON public\.visit\s+FOR EACH ROW EXECUTE FUNCTION public\.visit_arsip_jaga\(\);/);
    expect(sql7).toMatch(/REVOKE ALL ON FUNCTION public\.visit_arsip_jaga\(\) FROM PUBLIC, anon, authenticated;/);
  });

  it('jalur tulis klien dicabut (policy + hak), baca arsip tetap', () => {
    for (const p of ['visit_insert_walk_in', 'visit_insert_reservasi', 'visit_update_staff']) {
      expect(sql7).toMatch(new RegExp(`DROP POLICY IF EXISTS ${p} ON public\\.visit;`));
    }
    expect(sql7).toMatch(/REVOKE INSERT, UPDATE, DELETE ON TABLE public\.visit FROM anon, authenticated;/);
    expect(sql7).not.toMatch(/visit_select_own/);
    expect(sql7).not.toMatch(/CREATE POLICY[^;]*ON public\.visit/i);
  });

  it('TIDAK ada fungsi di 0007 yang menulis visit, memakai flag A3, atau memanggil fo_sinkron_visit', () => {
    for (const def of [...sql7.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION[\s\S]*?\$\$;/gi)].map((m) => m[0])) {
      expect(def).not.toMatch(PENULIS_VISIT);
      expect(def).not.toMatch(/fo_sinkron_visit/);
      expect(def).not.toMatch(/FROM public\.visit AS v WHERE[^;]*FOR UPDATE/i);
    }
    expect(sql7).toMatch(/DROP FUNCTION IF EXISTS public\.fo_sinkron_visit\(uuid\);/);
    // satu-satunya acuan visit di fungsi 0007: cadangan arsip SKM (baca saja)
    for (const n of RPC_TANPA_VISIT) expect(ambilFungsi(sql7, n)).not.toMatch(/public\.visit\b/);
  });

  it('reservasi lama: loket dilengkapi dari visit, bertemu_seseorang >= hari ini dibuatkan kunjungan (idempoten)', () => {
    expect(sql7).toMatch(/UPDATE public\.kunjungan AS k\s+SET tujuan\s+= COALESCE\(k\.tujuan, v\.tujuan\)/);
    expect(sql7).toMatch(/layanan_saran_id\s+= COALESCE\(k\.layanan_saran_id, v\.layanan_id\)/);
    expect(sql7).toMatch(/AND k\.status = 'terjadwal'\s+AND k\.tujuan IS NULL/);
    const ins = sql7.match(/INSERT INTO public\.kunjungan \([\s\S]*?ON CONFLICT DO NOTHING;/)![0];
    expect(ins).toMatch(/v\.tujuan = 'bertemu_seseorang'/);
    expect(ins).toMatch(/v\.status = 'terjadwal'/);
    expect(ins).toMatch(/v\.tanggal_rencana >= \(pg_catalog\.now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::date/);
    expect(ins).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.kunjungan AS x WHERE x\.legacy_visit_id = v\.id\)/);
    expect(ins).toMatch(/v\.qr_token/);
  });
});

describe('WP-24 (a): RPC tanpa visit, kontrak tetap', () => {
  it.each(DITULIS_ULANG)('%s: signature + atribut SAMA dengan definisi sebelumnya', (nama, sumber) => {
    const lama = semuaFungsi(sumber, nama).at(-1)!;
    expect(kepala(ambilFungsi(sql7, nama))).toBe(kepala(lama));
  });

  it.each(RPC_TANPA_VISIT)('%s: kode galat sama (kecuali DIVERGENSI visit di layanan_mulai)', (nama) => {
    const sumber = DITULIS_ULANG.find(([n]) => n === nama)![1];
    const lama = kodeGalat(semuaFungsi(sumber, nama).at(-1)!);
    if (nama === 'layanan_mulai') lama.delete('DIVERGENSI');
    expect([...kodeGalat(ambilFungsi(sql7, nama))].sort()).toEqual([...lama].sort());
  });

  it('urutan kunci: kunjungan dikunci sebelum tiket/penanganan ditulis', () => {
    for (const n of ['layanan_mulai', 'layanan_selesai', 'fo_selesai', 'fo_eskalasi', 'fo_ambil_dari_kotak_masuk',
      'layanan_kembalikan', 'admin_alihkan', 'fo_checkin_reservasi', 'fo_tolak_reservasi', 'reservasi_batalkan']) {
      const f = ambilFungsi(sql7, n);
      const kunci = f.search(/FROM public\.kunjungan AS k WHERE k\.id = [a-z_.]+ FOR UPDATE/);
      expect(kunci, n).toBeGreaterThan(0);
      const tulis = f.search(/\b(?:UPDATE public\.(?:tiket_antrean|penanganan|kunjungan)|INSERT INTO public\.penanganan)\b/);
      expect(kunci, n).toBeLessThan(tulis);
    }
  });

  it('tiket lama menggerakkan kunjungan langsung (dulu lewat dual-write)', () => {
    const mulai = ambilFungsi(sql7, 'layanan_mulai');
    expect(mulai).toMatch(/UPDATE public\.kunjungan AS k SET status = 'dilayani', updated_at = v_now\s+WHERE k\.id = v_t\.kunjungan_id AND k\.status IS DISTINCT FROM 'dilayani';/);
    const selesai = ambilFungsi(sql7, 'layanan_selesai');
    const upd = selesai.match(/UPDATE public\.kunjungan AS k SET status = 'selesai'[\s\S]*?;/)![0];
    expect(upd).not.toMatch(/IF v_p\.id/);
    expect(upd).toMatch(/x\.status IN \('menunggu', 'berjalan'\)/);
    expect(upd).toMatch(/y\.status IN \('menunggu', 'dipanggil', 'dilayani'\)/);
    // guard atomik pemilik tetap
    expect(selesai).toMatch(/WHERE t\.id = p_tiket_id AND t\.status = 'dilayani' AND t\.dilayani_oleh = v_me_id;/);
    expect(mulai).toMatch(/t\.status IN \('menunggu', 'dipanggil'\) AND t\.dilayani_oleh IS NULL/);
  });

  it('fo_checkin_reservasi membaca data reservasi dari kunjungan saja, balasan sama', () => {
    const f = ambilFungsi(sql7, 'fo_checkin_reservasi');
    for (const k of ['ok', 'kunjungan_id', 'penanganan_id', 'nama', 'tanggal', 'tujuan', 'layanan_saran_id',
      'layanan_saran_nama', 'nama_yang_ditemui', 'keperluan', 'mulai_at']) expect(f).toContain(`'${k}'`);
    expect(f).toMatch(/'tujuan', v_k\.tujuan/);
  });

  it('job akhir hari dan no-show hanya menulis kunjungan/tiket/penanganan (tiket lama ikut)', () => {
    const a = ambilFungsi(sql7, 'tandai_tidak_terlayani_akhir_hari');
    expect(a).not.toMatch(/legacy_visit_id IS NULL/);
    expect(a).toMatch(/t\.status IN \('menunggu', 'dipanggil'\) AND t\.tanggal <= v_today/);
    expect(a).toMatch(/batal_karena = 'tidak_terlayani'/);
    expect(a).not.toMatch(/'berjalan'\)?\s*->/);
    const n = ambilFungsi(sql7, 'tandai_reservasi_no_show');
    expect(n).toMatch(/k\.asal = 'reservasi'\s+AND\s+k\.status = 'terjadwal'\s+AND\s+k\.tanggal < v_today/);
    expect(n).not.toMatch(/legacy_visit_id/);
    expect(n).toMatch(/RETURN v_count;/);
  });
});

describe('WP-24 (b): pembaca visit dipindah', () => {
  it('SKM: kolom kunjungan_id unik parsial + backfill; konteks/submit via kunjungan.qr_token dengan cadangan arsip', () => {
    expect(sql7).toMatch(/ADD COLUMN IF NOT EXISTS kunjungan_id uuid REFERENCES public\.kunjungan\(id\) ON DELETE SET NULL/);
    expect(sql7).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS skm_respons_kunjungan_id_uniq\s+ON public\.skm_respons \(kunjungan_id\) WHERE kunjungan_id IS NOT NULL;/);
    expect(sql7).toMatch(/SET kunjungan_id = k\.id\s+FROM public\.kunjungan AS k\s+WHERE k\.legacy_visit_id = s\.visit_id/);
    const ctx = ambilFungsi(sql7, 'get_skm_context');
    expect(ctx).toMatch(/k\.status = 'selesai' AS eligible/);
    expect(ctx).toMatch(/WHERE k\.qr_token = p_token\s+UNION ALL/);
    expect(ctx).toMatch(/AND NOT EXISTS \(SELECT 1 FROM public\.kunjungan AS k2 WHERE k2\.qr_token = p_token\)/);
    const sub = ambilFungsi(sql7, 'submit_skm_response');
    for (const s of ['invalid', 'not_found', 'not_completed', 'duplicate', 'submitted']) expect(sub).toContain(`RETURN '${s}'`);
    expect(sub).toMatch(/FROM public\.kunjungan AS k WHERE k\.qr_token = p_token\s+FOR UPDATE/);
    expect(sub).toMatch(/v_legacy, v_kid, v_layanan,/);
    expect(sub).toMatch(/EXCEPTION WHEN unique_violation THEN\s+RETURN 'duplicate'/);
    const lyn = ambilFungsi(sql7, 'kunjungan_layanan_skm');
    expect(lyn).toMatch(/t\.status = 'selesai'/);
    expect(sql7).toMatch(/REVOKE ALL ON FUNCTION public\.kunjungan_layanan_skm\(uuid\) FROM PUBLIC, anon, authenticated;/);
  });

  it('notifikasi: pindah ke trigger kunjungan/tiket, idempoten per kunjungan, tanpa nama pengunjung', () => {
    const q = ambilFungsi(sql7, 'queue_notifikasi');
    const qLama = ambilFungsi(B4, 'queue_notifikasi');
    // cabang lama dipertahankan persis
    for (const baris of qLama.match(/WHEN p_payload \? '(?:visit_id|listing_id)'[^\n]*/g)!) expect(q).toContain(baris.trim());
    expect(q).toMatch(/WHEN p_payload \? 'kunjungan_id' THEN 'kunjungan:'/);
    const nk = ambilFungsi(sql7, 'notify_kunjungan_status');
    expect(nk).toMatch(/IF NEW\.status = 'selesai' THEN/);
    expect(nk).toMatch(/skm_survey/);
    expect(nk).toMatch(/NULLIF\(pg_catalog\.btrim\(NEW\.email\), ''\)/);
    expect(nk).toMatch(/NEW\.asal = 'reservasi' AND OLD\.status = 'terjadwal' AND NEW\.status IN \('dilayani', 'menunggu'\)/);
    const nt = ambilFungsi(sql7, 'notify_tiket_antrean');
    expect(nt).toMatch(/tiket_menunggu/);
    expect(nt).toMatch(/tiket_dilayani/);
    for (const f of [nk, nt]) {
      expect(f).not.toMatch(/NEW\.nama\b|k\.nama\b/);
      expect(f).toMatch(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    }
    expect(sql7).toMatch(/CREATE TRIGGER trg_notify_kunjungan_status\s+AFTER UPDATE OF status ON public\.kunjungan/);
    expect(sql7).toMatch(/CREATE TRIGGER trg_notify_tiket_antrean\s+AFTER INSERT OR UPDATE OF status ON public\.tiket_antrean/);
  });

  it('response rate dan audit pindah ke kunjungan/tiket', () => {
    const rr = ambilFungsi(sql7, 'kunjungan_selesai_rr');
    expect(rr).toMatch(/skm_rr_tambah\(public\.kunjungan_layanan_skm\(NEW\.id\), 'dilayani'\)/);
    expect(sql7).toMatch(/CREATE TRIGGER trg_kunjungan_selesai_rr\s+AFTER UPDATE OF status ON public\.kunjungan/);
    for (const [t, tabel] of [['trg_audit_kunjungan_status', 'kunjungan'], ['trg_audit_tiket_status', 'tiket_antrean']]) {
      expect(sql7).toMatch(new RegExp(`CREATE TRIGGER ${t}\\s+AFTER UPDATE OF status ON public\\.${tabel}\\s+FOR EACH ROW WHEN \\(OLD\\.status IS DISTINCT FROM NEW\\.status\\)\\s+EXECUTE FUNCTION public\\.audit_change\\('update_status'\\);`));
    }
  });

  it('estimasi: MV dari tiket_antrean dengan kolom sama; v_antrian_loket PERSIS 202607300016', () => {
    const mv = sql7.match(/CREATE MATERIALIZED VIEW public\.mv_estimasi_layanan AS[\s\S]*?;/)![0];
    const mvLama = B5.match(/CREATE MATERIALIZED VIEW public\.mv_estimasi_layanan AS[\s\S]*?;/)![0];
    const kolom = (s: string) => [...s.matchAll(/\bAS (layanan_id|jam_slot|avg_durasi_menit|sample_count)\b/g)].map((m) => m[1]);
    expect(kolom(mv)).toEqual(kolom(mvLama));
    expect(mv).toMatch(/FROM public\.tiket_antrean AS t/);
    expect(mv).not.toMatch(/visit/);
    expect(rapikan(mv.replace(/\bt\./g, 'visit.').replace('public.tiket_antrean AS t', 'public.visit AS visit')))
      .toBe(rapikan(mvLama));
    expect(sql7).toMatch(/CREATE UNIQUE INDEX idx_mv_estimasi_layanan_key\s+ON public\.mv_estimasi_layanan\(layanan_id, jam_slot\);/);
    const v = sql7.match(/CREATE OR REPLACE VIEW public\.v_antrian_loket AS[\s\S]*?GRANT SELECT ON public\.v_antrian_loket TO anon, authenticated;/)![0];
    const vLama = W16.match(/CREATE OR REPLACE VIEW public\.v_antrian_loket AS[\s\S]*?GRANT SELECT ON public\.v_antrian_loket TO anon, authenticated;/)![0];
    expect(rapikan(v)).toBe(rapikan(vLama));
    expect(sql7.indexOf('DROP VIEW IF EXISTS public.v_antrian_loket')).toBeLessThan(sql7.indexOf('DROP MATERIALIZED VIEW IF EXISTS public.mv_estimasi_layanan'));
  });

  it('pengingat H-1/H-0 dan metrik kepatuhan tidak membaca visit; atribut keamanan tidak berubah', () => {
    for (const n of ['jumlah_terdaftar', 'metrik_kepatuhan']) {
      const f = ambilFungsi(sql7, n);
      expect(f).not.toMatch(/public\.visit\b/);
      expect(f).not.toMatch(/SECURITY DEFINER/);
    }
    expect(ambilFungsi(sql7, 'jumlah_terdaftar')).toMatch(/k\.layanan_saran_id = p_layanan_id/);
    expect(ambilFungsi(sql7, 'metrik_kepatuhan')).toMatch(/tk\.status='tidak_terlayani'/);
  });

  it('fungsi definer baru: search_path terkunci dan EXECUTE dicabut dari klien', () => {
    for (const n of FUNGSI_BARU_7) {
      const f = ambilFungsi(sql7, n);
      expect(f, n).toMatch(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
      expect(sql7, n).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${n}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
    }
  });
});

describe('WP-24 (c)(d): 202610140008', () => {
  it('batal_karena += tidak_ditutup (nilai lama tetap)', () => {
    expect(sql8).toMatch(/pg_get_constraintdef\(c\.oid\) ~ 'diambil_alih'/);
    expect(sql8).toMatch(/ADD CONSTRAINT penanganan_batal_karena_check\s+CHECK \(batal_karena IN \('dialihkan', 'diambil_alih', 'tidak_terlayani', 'tidak_ditutup'\)\);/);
  });

  it('tutup_penanganan_tertinggal: tahap berjalan non-chat -> batal/tidak_ditutup, tiket selesai tanpa waktu_selesai, kunjungan selesai, audit', () => {
    const f = ambilFungsi(sql8, 'tutup_penanganan_tertinggal');
    expect(f).toMatch(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    expect(f).toMatch(/SET status = 'batal', batal_karena = 'tidak_ditutup', selesai_at = v_now/);
    expect(f).toMatch(/q\.saluran <> 'chat'/);
    const tiket = f.match(/UPDATE public\.tiket_antrean AS t[\s\S]*?;/)![0];
    expect(tiket).toMatch(/SET status = 'selesai', updated_at = v_now/);
    expect(tiket).not.toMatch(/waktu_selesai/);
    expect(f).toMatch(/UPDATE public\.kunjungan AS k\s+SET status = 'selesai'[\s\S]*?k\.status = 'dilayani'/);
    expect(f).toMatch(/'tutup_otomatis_penanganan'/);
    expect(f).not.toMatch(PENULIS_VISIT);
    expect(sql8).toMatch(/REVOKE ALL ON FUNCTION public\.tutup_penanganan_tertinggal\(\) FROM PUBLIC, anon, authenticated;/);
    expect(sql8).toMatch(/cron\.schedule\('penanganan_tutup_otomatis', '0 16 \* \* \*', 'SELECT public\.tutup_penanganan_tertinggal\(\)'\)/);
    expect(sql8).toMatch(/cron\.unschedule\(job\.jobid\) FROM cron\.job AS job WHERE job\.jobname = 'penanganan_tutup_otomatis'/);
  });

  it('anonimisasi 730 hari: perilaku pengunjung lama persis + kunjungan, penanganan.catatan, arsip visit (flag)', () => {
    const f = ambilFungsi(sql8, 'anonymize_inactive_pengunjung');
    const lama = ambilFungsi(B4, 'anonymize_inactive_pengunjung');
    const intiLama = rapikan(lama.slice(lama.indexOf('$$') + 2, lama.lastIndexOf('$$')));
    expect(rapikan(f)).toContain(intiLama);
    expect(f).toMatch(/v_batas date := \(pg_catalog\.now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::date - 730/);
    for (const k of ['kontak_hp = NULL', 'email = NULL', 'asal_instansi = NULL', 'nama_yang_ditemui = NULL', 'keperluan = NULL']) {
      expect(f.match(/UPDATE public\.kunjungan AS k[\s\S]*?;/)![0]).toContain(k);
    }
    expect(f).toMatch(/UPDATE public\.penanganan AS p\s+SET catatan = '\[anonim\]'/);
    expect(f).toMatch(/set_config\('lmh\.visit_arsip', 'on', true\);\s+UPDATE public\.visit AS v[\s\S]*?set_config\('lmh\.visit_arsip', 'off', true\);/);
    expect(f).toMatch(/catatan_petugas = NULL/);
    expect(sql8).toMatch(/REVOKE EXECUTE ON FUNCTION public\.anonymize_inactive_pengunjung\(\) FROM PUBLIC, anon, authenticated;/);
  });
});

describe('WP-24: rollback', () => {
  it('rollback 0007 memulihkan setiap fungsi yang ditulis ulang PERSIS dari sumbernya', () => {
    for (const [nama, sumber] of DITULIS_ULANG) {
      const asli = semuaFungsi(sumber, nama).at(-1)!.replace(/^CREATE\s+FUNCTION/i, 'CREATE OR REPLACE FUNCTION');
      expect(rapikan(ambilFungsi(rb7, nama)), nama).toBe(rapikan(asli));
    }
    const sinkron = ambilFungsi(rb7, 'fo_sinkron_visit');
    expect(rapikan(sinkron)).toBe(rapikan(ambilFungsi(F4, 'fo_sinkron_visit')));
    expect(rb7).toMatch(/REVOKE ALL ON FUNCTION public\.fo_sinkron_visit\(uuid\) FROM PUBLIC, anon, authenticated;\s+GRANT EXECUTE ON FUNCTION public\.fo_sinkron_visit\(uuid\) TO service_role;/);
    expect(rapikan(ambilFungsi(rb7, 'guard_visit_transisi_layanan'))).toBe(rapikan(ambilFungsi(F2, 'guard_visit_transisi_layanan')));
    expect(rb7).toMatch(/CREATE TRIGGER trg_guard_visit_transisi_layanan\s+BEFORE UPDATE ON public\.visit\s+FOR EACH ROW EXECUTE FUNCTION public\.guard_visit_transisi_layanan\(\);/);
  });

  it('rollback 0007 menghapus semua objek baru dan menyalakan kembali 8 trigger', () => {
    for (const n of FUNGSI_BARU_7) expect(rb7).toMatch(new RegExp(`DROP FUNCTION IF EXISTS public\\.${n}\\(`));
    for (const [t, tabel] of TRIGGER_BARU_7) expect(rb7).toMatch(new RegExp(`DROP TRIGGER IF EXISTS ${t} ON public\\.${tabel};`));
    const daftar = rb7.match(/FOREACH v_nama IN ARRAY ARRAY\[([\s\S]*?)\]/)![1];
    for (const t of TRIGGER_VISIT_DIMATIKAN) expect(daftar).toContain(`'${t}'`);
    expect(rb7).toMatch(/ALTER TABLE public\.visit ENABLE TRIGGER %I/);
    expect(rb7).toMatch(/ALTER TABLE public\.skm_respons DROP COLUMN IF EXISTS kunjungan_id;/);
    expect(rb7).toMatch(/GRANT INSERT, UPDATE, DELETE ON TABLE public\.visit TO anon, authenticated;/);
    expect(rb7).toMatch(/COMMENT ON TABLE public\.visit IS 'Unified final visit spine for walk-in and reservation flows\.';/);
    // urutan: fungsi pemakai dipulihkan sebelum helper dihapus
    expect(rb7.indexOf('FUNCTION public.get_skm_context')).toBeLessThan(rb7.indexOf('DROP FUNCTION IF EXISTS public.kunjungan_layanan_skm'));
    expect(rb7.indexOf('FUNCTION public.fo_sinkron_visit')).toBeLessThan(rb7.indexOf('FUNCTION public.fo_checkin_reservasi'));
    expect(rb7).toMatch(/to_regprocedure\('public\.tutup_penanganan_tertinggal\(\)'\) IS NOT NULL THEN\s+RAISE EXCEPTION 'ROLLBACK DITOLAK/);
  });

  it('rollback 0007 memulihkan policy visit PERSIS dan MV/view dari sumbernya', () => {
    const R8 = stripSqlComments(baca('202610080001_rbac_tahap0_keamanan.sql'));
    const R9 = stripSqlComments(baca('202610090001_rbac_tahap1.sql'));
    const pol = (s: string, n: string) => rapikan(s.match(new RegExp(`CREATE POLICY ${n} ON public\\.visit[\\s\\S]*?;`))![0]);
    expect(pol(rb7, 'visit_insert_walk_in')).toBe(pol(R8, 'visit_insert_walk_in'));
    expect(pol(rb7, 'visit_insert_reservasi')).toBe(pol(R8, 'visit_insert_reservasi'));
    expect(pol(rb7, 'visit_update_staff')).toBe(pol(R9, 'visit_update_staff'));
    const mv = (s: string) => rapikan(s.match(/CREATE MATERIALIZED VIEW public\.mv_estimasi_layanan AS[\s\S]*?;/)![0]);
    expect(mv(rb7)).toBe(mv(B5));
    const v = (s: string) => rapikan(s.match(/CREATE OR REPLACE VIEW public\.v_antrian_loket AS[\s\S]*?GRANT SELECT ON public\.v_antrian_loket TO anon, authenticated;/)![0]);
    expect(v(rb7)).toBe(v(W16));
  });

  it('rollback 0008: job dihapus, anonimisasi persis baseline, CHECK lama, data tidak_ditutup dijaga flag', () => {
    expect(rb8).toMatch(/cron\.unschedule\(job\.jobid\) FROM cron\.job AS job WHERE job\.jobname = 'penanganan_tutup_otomatis'/);
    expect(rb8).toMatch(/DROP FUNCTION IF EXISTS public\.tutup_penanganan_tertinggal\(\);/);
    const asli = ambilFungsi(B4, 'anonymize_inactive_pengunjung').replace(/^CREATE\s+FUNCTION/i, 'CREATE OR REPLACE FUNCTION');
    expect(rapikan(ambilFungsi(rb8, 'anonymize_inactive_pengunjung'))).toBe(rapikan(asli));
    expect(rb8).toMatch(/ADD CONSTRAINT penanganan_batal_karena_check\s+CHECK \(batal_karena IN \('dialihkan', 'diambil_alih', 'tidak_terlayani'\)\);/);
    expect(rb8).toMatch(/lmh\.rollback_paksa/);
    expect(tanpaString(rb8)).not.toMatch(/visit/i);
  });
});
