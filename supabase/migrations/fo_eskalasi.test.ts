// @vitest-environment node
// Kontrak statis migrasi Tahap B (B-DB1): 202610140003_fo_model_data, 202610140004_fo_rpc, 202610140005_fo_selaras_antrean.
// Tidak mengeksekusi SQL; tidak menyentuh database. Uji perilaku DB: scripts/test-fo-eskalasi.mjs (transaksi di-ROLLBACK).
// Kontrak untuk UI: docs/analysis/FO-ESKALASI-KONTRAK-RPC.md (ikut diperiksa di sini agar tidak menyimpang dari SQL).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi, mengubahPolicyAtauFungsi } from '../../scripts/lib/sql-txn.mjs';

const M3 = '202610140003_fo_model_data.sql';
const M4 = '202610140004_fo_rpc.sql';
const M5 = '202610140005_fo_selaras_antrean.sql';
const RB3 = 'rollback-fo-model-data-202610140003.sql';
const RB4 = 'rollback-fo-rpc-202610140004.sql';
const RB5 = 'rollback-fo-selaras-antrean-202610140005.sql';

const baca = (nama: string) => readFileSync(join(MIGRATIONS_DIR, nama), 'utf8');
const bacaDocs = (...bagian: string[]) => readFileSync(join(MIGRATIONS_DIR, '..', '..', 'docs', ...bagian), 'utf8');
const rapikan = (s: string) => s.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();

function ambilFungsi(sql: string, nama: string): string {
  const m = sql.match(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${nama}\\s*\\([\\s\\S]*?\\$\\$;`, 'i'));
  if (!m) throw new Error(`fungsi ${nama} tidak ditemukan`);
  return m[0];
}
function ambilHak(sql: string, kata: 'REVOKE' | 'GRANT', fungsi: string): string[] {
  return [...sql.matchAll(new RegExp(`${kata}\\s[^;]*public\\.${fungsi}\\s*\\([^;]*;`, 'gi'))].map((m) => m[0]);
}
/** Indeks kemunculan pertama (setelah posisi awal) atau -1. */
const posisi = (s: string, re: RegExp) => s.search(re);

const raw3 = baca(M3);
const raw4 = baca(M4);
const raw5 = baca(M5);
const sql3 = stripSqlComments(raw3);
const sql4 = stripSqlComments(raw4);
const sql5 = stripSqlComments(raw5);
const rbRaw3 = bacaDocs(RB3);
const rbRaw4 = bacaDocs(RB4);
const rbRaw5 = bacaDocs(RB5);
const rb3 = stripSqlComments(rbRaw3);
const rb4 = stripSqlComments(rbRaw4);
const rb5 = stripSqlComments(rbRaw5);
const kontrak = bacaDocs('analysis', 'FO-ESKALASI-KONTRAK-RPC.md');

// RPC klien 202610140004: [nama, argumen identitas, peran yang diizinkan (null = pengunjung)]
const RPC_KLIEN = [
  ['fo_mulai_kunjungan', 'text, text, text, text, text, text, uuid, uuid, uuid', ['front_office', 'admin']],
  ['fo_checkin_reservasi', 'text', ['front_office', 'admin']],
  ['fo_tolak_reservasi', 'text, text', ['front_office', 'admin']],
  ['fo_selesai', 'uuid, uuid, text', ['front_office', 'admin']],
  ['fo_eskalasi', 'uuid, uuid, uuid, text', ['front_office', 'admin']],
  ['fo_ambil_dari_kotak_masuk', 'uuid', ['front_office', 'admin']],
  ['layanan_kembalikan', 'uuid, text, uuid', ['admin', 'petugas']],
  ['admin_alihkan', 'uuid, uuid, text', ['admin']],
  ['reservasi_buat', 'text, date, uuid, text, text, time', null],
  ['reservasi_batalkan', 'uuid', null],
] as const;
const INTERNAL_4 = [
  ['staf_wajib_sesi', 'text[]'],
  ['fo_validasi_topik', 'uuid, uuid'],
  ['fo_validasi_catatan', 'text, integer'],
  ['fo_sinkron_visit', 'uuid'],
  ['fo_notifikasi_tiket', 'uuid, text'],
] as const;

// Cermin JS prefiks_antrean_usul + pola backfill (harus sama dengan SQL).
const POLA_KODE: [RegExp, string][] = [
  [/^\s*helpdesk\s+oss/i, 'OS'], [/^\s*non[\s-]*oss/i, 'NO'], [/^\s*balmon/i, 'BM'], [/^\s*bank\s+lampung/i, 'BL'],
  [/^\s*bpjs/i, 'BP'], [/^\s*investment\s+gallery/i, 'IG'], [/jasa\s+industri/i, 'JI'], [/^\s*matchmaking/i, 'MU'],
  [/^\s*sertifikasi\s+halal/i, 'SH'], [/^\s*sertifikasi\s+mutu/i, 'SM'],
];
function usul(nama: string, dipakai: Set<string>): string {
  const bersih = nama.toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
  const kandidat: string[] = [];
  if (bersih) {
    const kata = bersih.split(' ');
    const huruf = bersih.replace(/ /g, '');
    if (kata.length >= 2) kandidat.push(kata[0][0] + kata[1][0]);
    kandidat.push(kata[0].slice(0, 2));
    for (let j = 1; j < huruf.length; j++) kandidat.push(huruf[0] + huruf[j]);
  }
  for (const k of kandidat) if (/^[A-Z]{2}$/.test(k) && !dipakai.has(k)) return k;
  for (let i = 65; i <= 90; i++) for (let j = 65; j <= 90; j++) {
    const k = String.fromCharCode(i) + String.fromCharCode(j);
    if (!dipakai.has(k)) return k;
  }
  throw new Error('PREFIKS_HABIS');
}
const LAYANAN_PRODUKSI = [
  'Helpdesk OSS', 'Non OSS (SiCantik Lampung)', 'BALMON', 'Bank Lampung', 'BPJS Kesehatan', 'Investment Gallery',
  'Layanan Jasa Industri', 'Matchmaking UMKM', 'Sertifikasi Halal', 'Sertifikasi Mutu Keamanan Hasil Perikanan',
];

describe('B-DB1: berkas, urutan, pendaftaran', () => {
  it.each([[M3, raw3, rbRaw3], [M4, raw4, rbRaw4], [M5, raw5, rbRaw5]])(
    '%s: tanpa BEGIN/COMMIT (migrasi & rollback), wajib --atomic, perintah dry-run di header', (nama, raw, rb) => {
      expect(mengandungKontrolTransaksi(raw)).toBe(false);
      expect(mengandungKontrolTransaksi(rb)).toBe(false);
      expect(mengubahPolicyAtauFungsi(raw)).toBe(true);
      expect(raw).toContain(`apply-migration.mjs supabase/migrations/${nama} --atomic --dry-run`);
      expect(rb).toMatch(/--atomic --dry-run/);
    });

  it('terdaftar di FORWARD_MIGRATION_FILES dan berurutan setelah 202610140002_tiket_kepemilikan', () => {
    const semua = listMigrationFiles();
    for (const f of [M3, M4, M5]) {
      expect(FORWARD_MIGRATION_FILES).toContain(f);
      expect(f).toMatch(/^\d{12}_[a-z0-9_]+\.sql$/);
    }
    const i2 = semua.indexOf('202610140002_tiket_kepemilikan.sql');
    expect(semua.indexOf(M3)).toBe(i2 + 1);
    expect(semua.indexOf(M4)).toBe(i2 + 2);
    expect(semua.indexOf(M5)).toBe(i2 + 3);
  });

  it('penjaga prasyarat (DO) di awal setiap berkas, sebelum CREATE/ALTER apa pun', () => {
    for (const s of [sql3, sql4, sql5]) {
      const pertamaDo = posisi(s, /DO \$\$/);
      expect(pertamaDo).toBeGreaterThanOrEqual(0);
      expect(pertamaDo).toBeLessThan(posisi(s, /CREATE|ALTER|UPDATE|INSERT/));
    }
    expect(sql3).toMatch(/to_regprocedure\('public\.layanan_mulai\(uuid\)'\)/);
    expect(sql4).toMatch(/to_regclass\('public\.penanganan'\)/);
    expect(sql5).toMatch(/to_regprocedure\('public\.fo_sinkron_visit\(uuid\)'\)/);
  });

  it('tidak menyentuh trigger dual-write, panggil_tiket, antrean_broadcast; tidak INSERT ke visit', () => {
    for (const s of [sql3, sql4, sql5]) {
      expect(s).not.toMatch(/sync_visit_dual_write|trg_visit_dual_write|panggil_tiket|antrean_broadcast/);
      expect(s).not.toMatch(/INSERT\s+INTO\s+public\.visit/i);
      expect(s).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b|DROP[^;]*\bCASCADE\b/i);
    }
  });

  it('semua fungsi baru/diubah SECURITY DEFINER dengan search_path terkunci', () => {
    for (const s of [sql3, sql4, sql5]) {
      for (const m of s.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/g)) {
        const f = ambilFungsi(s, m[1]);
        expect(f, m[1]).toMatch(/SECURITY DEFINER/);
        expect(f, m[1]).toMatch(/SET search_path = pg_catalog, public/);
      }
      expect(s).not.toMatch(/CREATE\s+FUNCTION/);
    }
  });
});

describe('202610140003: prefiks antrean 2 huruf', () => {
  it('CHECK ^[A-Z]{2}$, NOT NULL, UNIQUE penuh (indeks parsial lama diganti)', () => {
    expect(sql3).toMatch(/ADD CONSTRAINT layanan_prefiks_antrean_format CHECK \(prefiks_antrean ~ '\^\[A-Z\]\{2\}\$'\)/);
    expect(sql3).toMatch(/ALTER COLUMN prefiks_antrean SET NOT NULL/);
    expect(sql3).toMatch(/DROP INDEX IF EXISTS public\.uq_layanan_prefiks;/);
    expect(sql3).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_layanan_prefiks_antrean ON public\.layanan \(prefiks_antrean\);/);
  });

  it('backfill sebelum trigger auto-generate; NOT NULL setelah backfill', () => {
    const backfill = posisi(sql3, /Lintasan|FOR r IN\s+SELECT l\.id, l\.nama FROM public\.layanan/);
    const trigger = posisi(sql3, /CREATE TRIGGER trg_layanan_isi_prefiks/);
    expect(backfill).toBeGreaterThan(0);
    expect(trigger).toBeGreaterThan(backfill);
    expect(posisi(sql3, /SET NOT NULL/)).toBeGreaterThan(trigger);
    expect(sql3).toMatch(/BEFORE INSERT OR UPDATE OF prefiks_antrean ON public\.layanan/);
    expect(ambilFungsi(sql3, 'layanan_isi_prefiks')).toMatch(/pg_advisory_xact_lock/);
  });

  it('tabel kode dokumen topik tercermin persis di SQL (10 kode, pola nama)', () => {
    for (const [, kode] of POLA_KODE) expect(sql3).toMatch(new RegExp(`THEN '${kode}'`));
    expect(sql3).toMatch(/IF v_kode IS NOT NULL AND NOT EXISTS \(SELECT 1 FROM public\.layanan AS x WHERE x\.prefiks_antrean = v_kode\)/);
  });

  it('cermin: 10 layanan produksi memetakan ke kode unik dokumen; layanan baru bentrok dapat kode berikutnya', () => {
    const hasil = LAYANAN_PRODUKSI.map((n) => POLA_KODE.filter(([re]) => re.test(n)).map(([, k]) => k));
    for (const h of hasil) expect(h).toHaveLength(1);
    expect(hasil.flat()).toEqual(['OS', 'NO', 'BM', 'BL', 'BP', 'IG', 'JI', 'MU', 'SH', 'SM']);
    const dipakai = new Set(hasil.flat());
    expect(usul('Bank Lampung Syariah', dipakai)).toBe('BA');
    expect(usul('Helpdesk Online', dipakai)).toBe('HO');
    expect(usul('Helpdesk Online', new Set([...dipakai, 'HO']))).toBe('HE');
    expect(usul('', dipakai)).toBe('AA');
    expect(usul('O', new Set(['OS']))).toBe('AA');
  });

  it('terbit_tiket: tanggal = hari ini WIB, format <KODE>-<nnn> tanpa pemotongan >= 1000, hak service_role saja', () => {
    const f = ambilFungsi(sql3, 'terbit_tiket');
    expect(f).toMatch(/v_tanggal\s+date := \(pg_catalog\.now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::date/);
    expect(f).toMatch(/public\.terbit_nomor_antrean\(p_layanan_id, v_tanggal\)/);
    expect(f).toMatch(/CASE WHEN v_nomor < 1000 THEN pg_catalog\.lpad\(v_nomor::text, 3, '0'\) ELSE v_nomor::text END/);
    expect(f).not.toMatch(/SELECT tanggal INTO/);
    expect(ambilHak(sql3, 'GRANT', 'terbit_tiket')).toEqual([
      'GRANT EXECUTE ON FUNCTION public.terbit_tiket(uuid, uuid) TO service_role;']);
  });
});

describe('202610140003: kunjungan, tiket_antrean, policy', () => {
  it("kunjungan.asal += 'online'; kolom baru chat_sesi_id (FK), selesai_at, data pengunjung, idempotensi", () => {
    expect(sql3).toMatch(/ADD CONSTRAINT kunjungan_asal_check CHECK \(asal IN \('walk_in', 'reservasi', 'online'\)\)/);
    for (const kol of ['chat_sesi_id', 'selesai_at', 'asal_instansi', 'kategori', 'email', 'keperluan', 'tujuan',
      'layanan_saran_id', 'nama_yang_ditemui', 'jam_rencana', 'client_request_id', 'dibuat_oleh']) {
      expect(sql3).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${kol}\\s`));
    }
    expect(sql3).toMatch(/chat_sesi_id\s+uuid REFERENCES public\.chat_sesi\(id\)/);
    expect(sql3).toMatch(/uq_kunjungan_client_request_id[\s\S]*WHERE client_request_id IS NOT NULL/);
  });

  it('selesai_at diisi trigger dari jam server saat masuk status akhir, tidak bisa disetel klien', () => {
    const f = ambilFungsi(sql3, 'kunjungan_isi_selesai_at');
    expect(f).toMatch(/NEW\.status IN \('selesai', 'batal', 'no_show', 'tidak_terlayani'\)/);
    expect(f).toMatch(/NEW\.selesai_at := pg_catalog\.now\(\)/);
    expect(f).toMatch(/NEW\.selesai_at := OLD\.selesai_at/);
    expect(f).toMatch(/NEW\.selesai_at := NULL/);
    expect(sql3).toMatch(/BEFORE INSERT OR UPDATE ON public\.kunjungan/);
  });

  it('tulis klien dicabut: kunjungan_staff_update, *_insert_public; tidak ada CREATE POLICY pada kunjungan/tiket; penjaga gagal-tertutup', () => {
    expect(sql3).toMatch(/DROP POLICY IF EXISTS kunjungan_staff_update ON public\.kunjungan;/);
    expect(sql3).toMatch(/DROP POLICY IF EXISTS kunjungan_insert_public ON public\.kunjungan;/);
    expect(sql3).toMatch(/DROP POLICY IF EXISTS tiket_insert_public ON public\.tiket_antrean;/);
    expect(sql3).not.toMatch(/CREATE POLICY \w+ ON public\.(?:kunjungan|tiket_antrean)\b/);
    expect(sql3).toMatch(/pol\.cmd IN \('INSERT', 'UPDATE', 'DELETE', 'ALL'\)[\s\S]*RAISE EXCEPTION 'PENJAGA/);
  });

  it("tiket_antrean: status += dikembalikan, dialihkan (status lama tetap); penanganan_asal_id, dialihkan_ke", () => {
    const m = sql3.match(/ADD CONSTRAINT tiket_antrean_status_check\s+CHECK \(status IN \(([^)]*)\)\)/)!;
    const st = m[1].split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(st.sort()).toEqual(['batal', 'dialihkan', 'dikembalikan', 'dilayani', 'dipanggil', 'menunggu', 'no_show',
      'selesai', 'tidak_terlayani'].sort());
    expect(sql3).toMatch(/penanganan_asal_id uuid REFERENCES public\.penanganan\(id\) ON DELETE SET NULL/);
    expect(sql3).toMatch(/dialihkan_ke\s+uuid REFERENCES public\.tiket_antrean\(id\)/);
  });
});

describe('202610140003: penanganan dan topik_penanganan', () => {
  const tabel = sql3.match(/CREATE TABLE IF NOT EXISTS public\.penanganan \([\s\S]*?\n\);/)![0];

  it('kolom §4.2 lengkap', () => {
    for (const kol of ['id', 'kunjungan_id', 'tahap_ke', 'peran_tahap', 'layanan_id', 'saluran', 'penangan_id',
      'tiket_id', 'topik', 'hasil', 'catatan', 'status', 'mulai_at', 'selesai_at', 'chat_sesi_id']) {
      expect(tabel).toMatch(new RegExp(`\\n\\s+${kol}\\s`));
    }
    expect(tabel).toMatch(/peran_tahap IN \('fo', 'layanan'\)/);
    expect(tabel).toMatch(/saluran IN \('walk_in', 'qr', 'chat'\)/);
    expect(tabel).toMatch(/hasil IN \('selesai', 'dieskalasi', 'dikembalikan'\)/);
    expect(tabel).toMatch(/status IN \('menunggu', 'berjalan', 'selesai', 'batal'\)/);
    expect(tabel).toMatch(/penangan_id\s+uuid\s+REFERENCES public\.petugas\(id\)/);
  });

  it('CHECK konsistensi: selesai butuh penangan, waktu, hasil, catatan; topik wajib kecuali dikembalikan; FO <= 200', () => {
    expect(tabel).toMatch(/status = 'selesai' AND penangan_id IS NOT NULL AND mulai_at IS NOT NULL AND selesai_at IS NOT NULL/);
    expect(tabel).toMatch(/catatan IS NOT NULL AND btrim\(catatan\) <> ''/);
    expect(tabel).toMatch(/hasil = 'dikembalikan' OR \(topik IS NOT NULL/);
    expect(tabel).toMatch(/status = 'menunggu' AND penangan_id IS NULL AND mulai_at IS NULL/);
    expect(tabel).toMatch(/CASE WHEN peran_tahap = 'fo' THEN 200 ELSE 1000 END/);
    expect(tabel).toMatch(/UNIQUE \(kunjungan_id, tahap_ke\)/);
  });

  it('satu tahap terbuka per kunjungan dan per tiket (indeks unik parsial)', () => {
    expect(sql3).toMatch(/uq_penanganan_terbuka_per_kunjungan\s+ON public\.penanganan \(kunjungan_id\) WHERE status IN \('menunggu', 'berjalan'\)/);
    expect(sql3).toMatch(/uq_penanganan_terbuka_per_tiket\s+ON public\.penanganan \(tiket_id\) WHERE tiket_id IS NOT NULL AND status IN \('menunggu', 'berjalan'\)/);
  });

  it('RLS: hanya SELECT (boleh_penanganan), REVOKE tulis dari klien', () => {
    expect(sql3).toMatch(/ALTER TABLE public\.penanganan ENABLE ROW LEVEL SECURITY/);
    expect(sql3).toMatch(/REVOKE ALL ON TABLE public\.penanganan FROM PUBLIC, anon, authenticated;\s*GRANT SELECT ON TABLE public\.penanganan TO authenticated;/);
    const policy = [...sql3.matchAll(/CREATE POLICY (\w+) ON public\.penanganan FOR (\w+)/g)];
    expect(policy.map((m) => `${m[1]}:${m[2]}`)).toEqual(['penanganan_staf_select:SELECT']);
    const f = ambilFungsi(sql3, 'boleh_penanganan');
    expect(f).toMatch(/v_role = 'admin' THEN\s+RETURN true/);
    expect(f).toMatch(/p_peran_tahap = 'fo' AND p_status = 'menunggu'/);
    expect(f).toMatch(/p_layanan = v_layanan/);
  });

  it('topik_penanganan: baca semua staf, tulis Admin; seed FO 7 topik dan 10 layanan (masing-masing ada Lainnya), idempoten', () => {
    expect(sql3).toMatch(/topik_penanganan_staf_select ON public\.topik_penanganan FOR SELECT TO authenticated\s+USING \(public\.peran_saya\(\) IN \('admin', 'petugas', 'front_office'\)\)/);
    expect(sql3).toMatch(/topik_penanganan_admin_tulis ON public\.topik_penanganan FOR ALL TO authenticated\s+USING \(public\.peran_saya\(\) = 'admin'\)\s+WITH CHECK \(public\.peran_saya\(\) = 'admin'\)/);
    const fo = sql3.match(/SELECT NULL, s\.nama, s\.urut\s+FROM \(VALUES([\s\S]*?)\) AS s/)![1];
    expect([...fo.matchAll(/\('([^']+)', \d+\)/g)].map((m) => m[1])).toHaveLength(7);
    expect(fo).toContain("('Lainnya', 99)");
    const lyn = sql3.match(/SELECT l\.id, s\.nama, s\.urut\s+FROM \(VALUES([\s\S]*?)\) AS s \(pola/)![1];
    const baris = [...lyn.matchAll(/\('([^']+)', '([^']+)', (\d+)\)/g)];
    const pola = new Set(baris.map((m) => m[1]));
    expect(pola.size).toBe(10);
    for (const p of pola) expect(baris.some((m) => m[1] === p && m[2] === 'Lainnya')).toBe(true);
    expect([...sql3.matchAll(/WHERE NOT EXISTS \(\s*SELECT 1 FROM public\.topik_penanganan/g)]).toHaveLength(2);
  });
});

describe('202610140004: RPC klien', () => {
  it.each(RPC_KLIEN)('%s(%s): REVOKE PUBLIC/anon/authenticated lalu GRANT authenticated saja', (nama, arg) => {
    expect(ambilHak(sql4, 'REVOKE', nama)).toEqual([
      `REVOKE ALL ON FUNCTION public.${nama}(${arg}) FROM PUBLIC, anon, authenticated;`]);
    expect(ambilHak(sql4, 'GRANT', nama)).toEqual([`GRANT EXECUTE ON FUNCTION public.${nama}(${arg}) TO authenticated;`]);
  });

  it.each(RPC_KLIEN)('%s: peran dan sesi_valid', (nama, _arg, peran) => {
    const f = ambilFungsi(sql4, nama);
    if (peran) {
      const daftar = peran.map((p) => `'${p}'`).join(', ');
      expect(f).toContain(`public.staf_wajib_sesi(ARRAY[${daftar}])`);
    } else {
      expect(f).toMatch(/auth\.uid\(\)/);
      expect(f).toMatch(/FROM public\.pengunjung AS p WHERE p\.auth_user_id = v_uid/);
    }
    if (nama === 'reservasi_buat') expect(f).toMatch(/public\.sesi_valid\(\)/);
  });

  it.each(INTERNAL_4)('internal %s(%s): tidak dapat dipanggil anon/authenticated', (nama, arg) => {
    expect(ambilHak(sql4, 'REVOKE', nama)).toEqual([
      `REVOKE ALL ON FUNCTION public.${nama}(${arg}) FROM PUBLIC, anon, authenticated;`]);
    for (const g of ambilHak(sql4, 'GRANT', nama)) expect(g).not.toMatch(/anon|authenticated/);
  });

  it('staf_wajib_sesi: staf aktif (staf_saya) + peran, FORBIDDEN 42501; sesi_valid -> SESI_TIDAK_SAH 42501', () => {
    const f = ambilFungsi(sql4, 'staf_wajib_sesi');
    expect(f).toMatch(/FROM public\.staf_saya\(\)/);
    expect(f).toMatch(/'FORBIDDEN:[^']*' USING ERRCODE = '42501'/);
    expect(f).toMatch(/IF NOT public\.sesi_valid\(\) THEN\s+RAISE EXCEPTION 'SESI_TIDAK_SAH:[^']*' USING ERRCODE = '42501'/);
  });

  it('tidak ada parameter waktu dari klien (S9): semua *_at / waktu_* dari now()', () => {
    for (const [nama] of RPC_KLIEN) {
      const header = ambilFungsi(sql4, nama).split(/RETURNS/)[0];
      expect(header, nama).not.toMatch(/p_\w*(?:_at|waktu)\w*/);
    }
    expect(sql4).not.toMatch(/clock_timestamp|statement_timestamp/);
  });

  it('urutan kunci visit -> kunjungan -> penanganan/tiket sebelum UPDATE pertama (RPC staf yang mengubah kunjungan)', () => {
    for (const nama of ['fo_checkin_reservasi', 'fo_tolak_reservasi', 'fo_selesai', 'fo_eskalasi', 'fo_ambil_dari_kotak_masuk',
      'layanan_kembalikan', 'admin_alihkan', 'reservasi_batalkan']) {
      const f = ambilFungsi(sql4, nama);
      const visit = posisi(f, /FROM public\.visit AS v WHERE v\.id = \w+ FOR UPDATE/);
      const kunj = posisi(f, /FROM public\.kunjungan AS k WHERE k\.id = \w+ FOR UPDATE/);
      const update = posisi(f, /\bUPDATE public\./);
      expect(visit, nama).toBeGreaterThan(0);
      expect(kunj, nama).toBeGreaterThan(visit);
      expect(update, nama).toBeGreaterThan(kunj);
    }
  });

  it('fo_mulai_kunjungan: walk-in dilayani + tahap 1 FO berjalan, TANPA tiket; idempoten client_request_id; jam tutup', () => {
    const f = ambilFungsi(sql4, 'fo_mulai_kunjungan');
    expect(f).toMatch(/'walk_in', v_qr, v_tgl, v_now, 'dilayani'/);
    expect(f).toMatch(/VALUES \(v_kid, 1, 'fo', 'walk_in', v_me_id, 'berjalan', v_now, v_me_id\)/);
    expect(f).not.toMatch(/terbit_tiket|tiket_antrean/);
    expect(f).toMatch(/IDEMPOTENSI_BENTROK/);
    expect(f).toMatch(/public\.layanan_sudah_tutup\(\)[\s\S]*LAYANAN_TUTUP/);
  });

  it('fo_checkin_reservasi: kedaluwarsa/no_show ditolak (pola trg_visit_qr_hangus), hanya hari ini, sinkron visit lama', () => {
    const f = ambilFungsi(sql4, 'fo_checkin_reservasi');
    expect(f).toMatch(/v_k\.status = 'no_show' OR \(v_k\.status = 'terjadwal' AND v_k\.tanggal < v_tgl\)[\s\S]*QR_KEDALUWARSA/);
    expect(f).toMatch(/v_k\.tanggal > v_tgl[\s\S]*BUKAN_HARI_INI/);
    expect(f).toMatch(/'fo', 'qr', v_me_id, 'berjalan'/);
    expect(f).toMatch(/public\.fo_sinkron_visit\(v_kid\)/);
    expect(f).not.toMatch(/terbit_tiket/);
  });

  it('fo_selesai / fo_eskalasi: hanya penangan tahap FO berjalan; topik FO + catatan <= 200 wajib', () => {
    for (const nama of ['fo_selesai', 'fo_eskalasi']) {
      const f = ambilFungsi(sql4, nama);
      expect(f).toMatch(/v_p\.penangan_id IS DISTINCT FROM v_me_id THEN\s+RAISE EXCEPTION 'BUKAN_PEMILIK/);
      expect(f).toMatch(/public\.fo_validasi_topik\(p_topik_id, NULL\)/);
      expect(f).toMatch(/public\.fo_validasi_catatan\(p_catatan, 200\)/);
      expect(f).toMatch(/SALURAN_CHAT/);
    }
  });

  it('fo_eskalasi: cek layanan (aktif, antrean, jadwal, jam tutup) lalu tutup FO dieskalasi, terbit tiket, tahap layanan menunggu, notifikasi', () => {
    const f = ambilFungsi(sql4, 'fo_eskalasi');
    const cek = posisi(f, /is_layanan_buka_jadwal/);
    const tutup = posisi(f, /hasil = 'dieskalasi'/);
    const tiket = posisi(f, /public\.terbit_tiket\(v_kid, p_layanan_id\)/);
    const tahap = posisi(f, /'layanan', p_layanan_id, v_p\.saluran, v_tiket, 'menunggu'/);
    expect(cek).toBeGreaterThan(0);
    expect(tutup).toBeGreaterThan(cek);
    expect(tiket).toBeGreaterThan(tutup);
    expect(tahap).toBeGreaterThan(tiket);
    expect(f).toMatch(/SET penanganan_asal_id = p_penanganan_id/);
    expect(f).toMatch(/SET status = 'menunggu'/);
    expect(f).toMatch(/public\.fo_notifikasi_tiket\(v_tiket, 'eskalasi'\)/);
    expect(f).toMatch(/NOT v_l\.punya_antrean/);
  });

  it('fo_notifikasi_tiket: lewat queue_notifikasi web_push ke petugas aktif layanan tiket, tanpa nama pengunjung', () => {
    const f = ambilFungsi(sql4, 'fo_notifikasi_tiket');
    expect(f).toMatch(/p\.layanan_id = v_t\.layanan_id AND p\.role = 'petugas' AND p\.aktif = true/);
    expect(f).toMatch(/public\.queue_notifikasi\(\s+r\.auth_user_id, NULL, 'web_push'/);
    expect(f).not.toMatch(/kunjungan|pengunjung|nama_pemohon/);
  });

  it("fo_ambil_dari_kotak_masuk: UPDATE atomik WHERE status = 'menunggu' AND peran fo; kalah = SUDAH_DIAMBIL", () => {
    const f = ambilFungsi(sql4, 'fo_ambil_dari_kotak_masuk');
    expect(f).toMatch(/WHERE p\.id = p_penanganan_id AND p\.status = 'menunggu' AND p\.peran_tahap = 'fo'/);
    expect(f).toMatch(/IF NOT FOUND THEN/);
    expect(f).toMatch(/sudah_milik_anda', true/);
    expect(f).toMatch(/SUDAH_DIAMBIL/);
  });

  it('layanan_kembalikan: hanya pemilik tiket dilayani; tiket dikembalikan; tahap FO menunggu; tiket lama ditolak', () => {
    const f = ambilFungsi(sql4, 'layanan_kembalikan');
    expect(f).toMatch(/v_t\.dilayani_oleh IS DISTINCT FROM v_me_id THEN\s+RAISE EXCEPTION 'BUKAN_PEMILIK/);
    expect(f).toMatch(/TIKET_LAMA/);
    expect(f).toMatch(/SET status = 'dikembalikan', waktu_selesai = v_now/);
    expect(f).toMatch(/VALUES \(v_kid, v_tahap, 'fo', v_p\.saluran, 'menunggu', v_me_id\)/);
    expect(f).toMatch(/public\.fo_validasi_catatan\(p_catatan, 1000\)/);
  });

  it('admin_alihkan: hanya Admin, alasan wajib, tiket lama dialihkan -> tiket baru, tahap lama batal, audit_log', () => {
    const f = ambilFungsi(sql4, 'admin_alihkan');
    expect(f).toMatch(/ALASAN_WAJIB/);
    expect(f).toMatch(/LAYANAN_SAMA/);
    expect(f).toMatch(/public\.terbit_tiket\(v_kid, p_layanan_tujuan\)/);
    expect(f).toMatch(/SET status = 'dialihkan', waktu_selesai = v_now, updated_at = v_now, dialihkan_ke = v_baru/);
    expect(f).toMatch(/batal_karena = 'dialihkan'/);
    expect(f).toMatch(/INSERT INTO public\.audit_log[\s\S]*'admin_alihkan', 'tiket_antrean'/);
  });

  it('reservasi_buat: tanggal 0..7 hari, tanpa akhir pekan, jadwal layanan, kuota (serial), ganda; tanpa visit/tiket', () => {
    const f = ambilFungsi(sql4, 'reservasi_buat');
    expect(f).toMatch(/p_tanggal < v_tgl OR p_tanggal > v_tgl \+ 7/);
    expect(f).toMatch(/ISODOW FROM p_tanggal\) IN \(6, 7\)/);
    expect(f).toMatch(/public\.is_layanan_buka_jadwal\(p_layanan_id, p_tanggal, NULL\)/);
    expect(f).toMatch(/pg_advisory_xact_lock/);
    expect(posisi(f, /KUOTA_PENUH/)).toBeGreaterThan(posisi(f, /pg_advisory_xact_lock/));
    expect(f).toMatch(/RESERVASI_GANDA/);
    expect(f).toMatch(/'reservasi', v_qr, p_tanggal, v_now, 'terjadwal'/);
    expect(f).not.toMatch(/terbit_tiket|public\.visit/);
  });

  it('fo_sinkron_visit: hanya kunjungan legacy, status dilayani/selesai/batal/tidak_terlayani, lewat flag lmh.antrean_rpc lokal', () => {
    const f = ambilFungsi(sql4, 'fo_sinkron_visit');
    expect(f).toMatch(/v_legacy IS NULL OR v_status NOT IN \('dilayani', 'selesai', 'batal', 'tidak_terlayani'\)/);
    expect(f).toMatch(/set_config\('lmh\.antrean_rpc', 'on', true\)[\s\S]*UPDATE public\.visit[\s\S]*set_config\('lmh\.antrean_rpc', 'off', true\)/);
    expect(f).not.toMatch(/waktu_mulai_layan/);
  });
});

describe('202610140005: penyelarasan A3 dan fungsi penyaring status', () => {
  const a3 = stripSqlComments(baca('202610140002_tiket_kepemilikan.sql'));

  it('layanan_selesai: bentuk 3-argumen di-DROP, bentuk 5-argumen ber-DEFAULT, GRANT authenticated', () => {
    expect(sql5).toMatch(/DROP FUNCTION IF EXISTS public\.layanan_selesai\(uuid, text, jsonb\);/);
    const f = ambilFungsi(sql5, 'layanan_selesai');
    expect(rapikan(f)).toMatch(/p_tiket_id uuid, p_form_type text DEFAULT NULL, p_payload jsonb DEFAULT NULL, p_topik_id uuid DEFAULT NULL, p_catatan text DEFAULT NULL \)/);
    expect(ambilHak(sql5, 'GRANT', 'layanan_selesai')).toEqual([
      'GRANT EXECUTE ON FUNCTION public.layanan_selesai(uuid, text, jsonb, uuid, text) TO authenticated;']);
  });

  it('layanan_selesai: aturan A3 dipertahankan; topik/catatan divalidasi SEBELUM pendataan ditulis', () => {
    const f = ambilFungsi(sql5, 'layanan_selesai');
    expect(f).toMatch(/v_t\.dilayani_oleh IS DISTINCT FROM v_me_id/);
    expect(f).toMatch(/FORBIDDEN: Front Office tidak menyelesaikan tiket layanan/);
    expect(f).toMatch(/public\.sesi_valid\(\)/);
    const validasi = posisi(f, /fo_validasi_topik\(p_topik_id, v_t\.layanan_id\)/);
    expect(validasi).toBeGreaterThan(0);
    expect(validasi).toBeLessThan(posisi(f, /INSERT INTO public\.pelayanan_oss/));
    expect(f).toMatch(/fo_validasi_catatan\(p_catatan, 1000\)/);
    // sinkron visit tiket lama (A3) tetap ada
    expect(f).toMatch(/WHERE v\.id = v_t\.legacy_visit_id AND v\.status = 'dilayani'/);
    // blok pendataan identik dengan A3
    const potong = (s: string) => rapikan(s.slice(s.indexOf("IF p_form_type = 'oss' THEN"), s.indexOf('UPDATE public.tiket_antrean AS t')));
    expect(potong(f)).toBe(potong(ambilFungsi(a3, 'layanan_selesai')));
  });

  it('layanan_mulai: identik A3 + tahap penanganan menunggu -> berjalan setelah guard tiket menang', () => {
    const f = ambilFungsi(sql5, 'layanan_mulai');
    const tanpaTambahan = rapikan(f.replace(/UPDATE public\.penanganan AS p[\s\S]*?END IF;/, ''));
    expect(tanpaTambahan).toBe(rapikan(ambilFungsi(a3, 'layanan_mulai')));
    expect(posisi(f, /UPDATE public\.penanganan/)).toBeGreaterThan(posisi(f, /t\.dilayani_oleh IS NULL/));
    expect(f).toMatch(/SET status = 'berjalan', penangan_id = v_me_id, mulai_at = v_now/);
  });

  it('admin_ambil_alih: kunci kunjungan sebelum tiket; tahap lama batal diambil_alih, tahap Admin berjalan; audit A3 tetap', () => {
    const f = ambilFungsi(sql5, 'admin_ambil_alih');
    expect(posisi(f, /public\.kunjungan AS k WHERE k\.id = v_kunj FOR UPDATE/)).toBeLessThan(
      posisi(f, /FROM public\.tiket_antrean AS t WHERE t\.id = p_tiket_id FOR UPDATE/));
    expect(f).toMatch(/batal_karena = 'diambil_alih'/);
    expect(f).toMatch(/'berjalan', v_now, v_me_id\)/);
    expect(f).toMatch(/'admin_ambil_alih', 'tiket_antrean'/);
  });

  it('get_queue_position: memilih tiket menunggu terbaru (bukan LIMIT 1 acak)', () => {
    expect(ambilFungsi(sql5, 'get_queue_position')).toMatch(/ORDER BY \(t\.status = 'menunggu'\) DESC, t\.waktu_terbit DESC, t\.id\s+LIMIT 1/);
  });

  it('tandai_tidak_terlayani_akhir_hari: jalur visit lama identik + tiket eskalasi/kotak masuk FO, tahap berjalan tak disentuh', () => {
    const f = ambilFungsi(sql5, 'tandai_tidak_terlayani_akhir_hari');
    const lama = ambilFungsi(stripSqlComments(baca('202607300017_wp23_akhir_hari_panggil.sql')), 'tandai_tidak_terlayani_akhir_hari');
    const blokVisit = (s: string) => rapikan(s.match(/UPDATE public\.visit AS v[\s\S]*?v\.status\s+= 'menunggu';/)![0]);
    expect(blokVisit(f)).toBe(blokVisit(lama));
    expect(f).toMatch(/t\.legacy_visit_id IS NULL AND t\.status IN \('menunggu', 'dipanggil'\) AND t\.tanggal <= v_today/);
    expect(f).toMatch(/batal_karena = 'tidak_terlayani'/);
    expect(f).not.toMatch(/status = 'berjalan'/);
    expect(f).toMatch(/public\.fo_sinkron_visit\(r\.kunjungan_id\)/);
  });

  it("rollup_rekap_harian: hanya total_hadir berubah (tanpa 'dialihkan')", () => {
    const baru = rapikan(ambilFungsi(sql5, 'rollup_rekap_harian'));
    const lama = rapikan(ambilFungsi(stripSqlComments(baca('202607300020_wp30_rekap_harian.sql')), 'rollup_rekap_harian'));
    expect(baru).toBe(lama.replace("FILTER (WHERE t.status <> 'terjadwal')", "FILTER (WHERE t.status NOT IN ('terjadwal', 'dialihkan'))"));
  });
});

describe('202610140005: job no-show mencakup reservasi baru', () => {
  it('tandai_reservasi_no_show: blok visit lama identik + kunjungan reservasi tanpa visit yang tanggalnya lewat', () => {
    const f = ambilFungsi(sql5, 'tandai_reservasi_no_show');
    const lama = ambilFungsi(stripSqlComments(baca('202608310002_reservasi_no_show.sql')), 'tandai_reservasi_no_show');
    const blok = (s: string) => rapikan(s.match(/UPDATE public\.visit[\s\S]*?tanggal_rencana < v_today;/)![0]);
    expect(blok(f)).toBe(blok(lama));
    expect(f).toMatch(/k\.asal = 'reservasi'\s+AND\s+k\.status = 'terjadwal'\s+AND\s+k\.legacy_visit_id IS NULL\s+AND\s+k\.tanggal < v_today/);
    expect(f).toMatch(/RETURN v_count \+ v_baru/);
  });
});

describe('Rollback B-DB1', () => {
  it('urutan dijaga: rollback 0004 menolak bila fungsi lain masih memanggil fungsi 0004; rollback 0003 menolak bila 0004 masih ada / ada data', () => {
    expect(posisi(rb4, /DO \$\$/)).toBeLessThan(posisi(rb4, /DROP FUNCTION/));
    expect(rb4).toMatch(/ROLLBACK DITOLAK/);
    expect(posisi(rb3, /DO \$\$/)).toBeLessThan(posisi(rb3, /DROP |ALTER TABLE/));
    expect(rb3).toMatch(/to_regprocedure\('public\.fo_sinkron_visit\(uuid\)'\) IS NOT NULL/);
    expect(rb3).toMatch(/EXISTS \(SELECT 1 FROM public\.penanganan\)/);
    expect(rb3).toMatch(/lmh\.rollback_paksa/);
  });

  it('rollback 0004 menghapus TEPAT semua fungsi yang dibuat 0004', () => {
    const dibuat = [...sql4.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]).sort();
    const dihapus = [...rb4.matchAll(/DROP FUNCTION IF EXISTS public\.(\w+)\(/g)].map((m) => m[1]).sort();
    expect(dihapus).toEqual(dibuat);
  });

  it('rollback 0005 memulihkan PERSIS versi A3 / WP-22 / WP-23 / WP-30', () => {
    const sumber: [string, string][] = [
      ['layanan_mulai', '202610140002_tiket_kepemilikan.sql'],
      ['layanan_selesai', '202610140002_tiket_kepemilikan.sql'],
      ['admin_ambil_alih', '202610140002_tiket_kepemilikan.sql'],
      ['get_queue_position', '202607300016_wp22_views_tiket_antrean.sql'],
      ['tandai_tidak_terlayani_akhir_hari', '202607300017_wp23_akhir_hari_panggil.sql'],
      ['rollup_rekap_harian', '202607300020_wp30_rekap_harian.sql'],
      ['tandai_reservasi_no_show', '202608310002_reservasi_no_show.sql'],
    ];
    for (const [f, berkas] of sumber) {
      expect(rapikan(ambilFungsi(rb5, f)), f).toBe(rapikan(ambilFungsi(stripSqlComments(baca(berkas)), f)));
    }
    expect(rb5).toMatch(/DROP FUNCTION IF EXISTS public\.layanan_selesai\(uuid, text, jsonb, uuid, text\);/);
    expect(rb5).toMatch(/GRANT EXECUTE ON FUNCTION public\.layanan_selesai\(uuid, text, jsonb\) TO authenticated;/);
  });

  it('rollback 0003: terbit_tiket dan kunjungan_staff_update PERSIS; CHECK lama; indeks parsial lama; tanpa CASCADE', () => {
    expect(rapikan(ambilFungsi(rb3, 'terbit_tiket'))).toBe(
      rapikan(ambilFungsi(stripSqlComments(baca('202607290013_kunjungan_tiket.sql')), 'terbit_tiket')));
    const pol = (s: string) => rapikan(s.match(/CREATE POLICY kunjungan_staff_update ON[\s\S]*?;/)![0]);
    expect(pol(rb3)).toBe(pol(stripSqlComments(baca('202610090001_rbac_tahap1.sql'))));
    expect(rb3).toMatch(/CHECK \(status IN \('menunggu','dipanggil','dilayani','selesai','batal','no_show','tidak_terlayani'\)\)/);
    expect(rb3).toMatch(/CHECK \(asal IN \('walk_in','reservasi'\)\)/);
    expect(rb3).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_layanan_prefiks\s+ON public\.layanan\(prefiks_antrean\)\s+WHERE prefiks_antrean IS NOT NULL;/);
    expect(rb3).not.toMatch(/\bCASCADE\b/);
    expect(rb3).not.toMatch(/kunjungan_insert_public|tiket_insert_public/);
    for (const kol of ['chat_sesi_id', 'selesai_at', 'client_request_id', 'dibuat_oleh']) {
      expect(rb3).toContain(`ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS ${kol};`);
    }
  });
});

describe('Kontrak UI (docs/analysis/FO-ESKALASI-KONTRAK-RPC.md) selaras dengan SQL', () => {
  it('memuat signature setiap RPC klien + layanan_selesai/layanan_mulai/admin_ambil_alih', () => {
    for (const [nama] of RPC_KLIEN) expect(kontrak).toContain(`${nama}(`);
    for (const nama of ['layanan_mulai(', 'layanan_selesai(', 'admin_ambil_alih(']) expect(kontrak).toContain(nama);
  });

  it('memuat setiap kode galat yang dilempar RPC baru', () => {
    const kode = new Set<string>();
    for (const s of [sql4, sql5]) {
      for (const m of s.matchAll(/RAISE EXCEPTION '([A-Z_]+):/g)) if (m[1] !== 'PRASYARAT') kode.add(m[1]);
    }
    expect(kode.size).toBeGreaterThan(20);
    for (const k of kode) expect(kontrak, k).toContain(k);
  });

  it('memuat status baru tiket dan penanganan', () => {
    for (const s of ['dikembalikan', 'dialihkan', 'menunggu', 'berjalan', 'batal', 'diambil_alih', 'tidak_terlayani']) {
      expect(kontrak).toContain(s);
    }
  });
});
