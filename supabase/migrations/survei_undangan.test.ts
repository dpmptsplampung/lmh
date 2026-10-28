// @vitest-environment node
// Kontrak statis migrasi 202611020001_survei_undangan (survei terpadu Fase A, Task 2): tabel undangan, fungsi
// idempoten ensure_undangan, trigger saat kunjungan selesai, QR staf (ambil_qr_survei), dan view status.
// Tidak mengeksekusi SQL dan tidak menyentuh database. Uji PERILAKU: scripts/lokal/skenario-survei-undangan.mjs
// (PGlite lokal). Rollback: docs/rollback-survei-undangan-202611020001.sql.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi, mengubahPolicyAtauFungsi } from '../../scripts/lib/sql-txn.mjs';
import { pecahPernyataan } from '../../scripts/lib/migration-markers.mjs';

const BERKAS = '202611020001_survei_undangan.sql';
const BERKAS_ROLLBACK = 'rollback-survei-undangan-202611020001.sql';

const baca = (nama: string) => readFileSync(join(MIGRATIONS_DIR, nama), 'utf8').replace(/\r\n/g, '\n');
const bacaDocs = (...bagian: string[]) => readFileSync(join(MIGRATIONS_DIR, '..', '..', 'docs', ...bagian), 'utf8').replace(/\r\n/g, '\n');
const rapikan = (s: string) => s.replace(/\s+/g, ' ').trim();

const raw = baca(BERKAS);
const sql = stripSqlComments(raw);
const pernyataan = pecahPernyataan(sql).map(rapikan);
const rollbackRaw = bacaDocs(BERKAS_ROLLBACK);
const rollback = stripSqlComments(rollbackRaw);
const pernyataanRollback = pecahPernyataan(rollback).map(rapikan);

/** Definisi lengkap `CREATE [OR REPLACE] FUNCTION public.<nama>(...) ... $$;` dari SQL bebas komentar. */
function ambilFungsi(teks: string, nama: string): string {
  const hasil = [...teks.matchAll(new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${nama}\s*\([\s\S]*?\$\$;`, 'gi'))].map((m) => m[0]);
  if (hasil.length !== 1) throw new Error(`fungsi ${nama}: ${hasil.length} definisi`);
  return hasil[0];
}
const badan = (def: string) => def.slice(def.indexOf('$$') + 2, def.lastIndexOf('$$'));

const ENSURE = ambilFungsi(sql, 'ensure_undangan');
const TRIGGER_FN = ambilFungsi(sql, 'kunjungan_selesai_undangan');
const QR = ambilFungsi(sql, 'ambil_qr_survei');
const FUNGSI_DEFINER = { ensure_undangan: ENSURE, kunjungan_selesai_undangan: TRIGGER_FN, ambil_qr_survei: QR };

describe('survei_undangan: berkas, urutan, atomik', () => {
  it('terdaftar di FORWARD_MIGRATION_FILES, bernomor terbesar sampai seri ini, dan nama sesuai pola', () => {
    expect(BERKAS).toMatch(/^\d{12}_[a-z0-9_]+\.sql$/);
    expect(FORWARD_MIGRATION_FILES).toContain(BERKAS);
    expect(listMigrationFiles()).toContain(BERKAS);
    // Urutan daftar = urutan nomor, dan berkas ini mengungguli semua migrasi di luar seri survei terpadu
    // (202611020001-202611020004; Task 3-5 menambah yang lain sesudahnya).
    const daftar = [...FORWARD_MIGRATION_FILES];
    expect(daftar).toEqual([...daftar].sort());
    const luarSeri = listMigrationFiles().filter((nama) => nama !== BERKAS && !/^20261(?:1020|1030)\d{3}_/.test(nama));
    for (const nama of luarSeri) expect(nama < BERKAS).toBe(true);
    // Nomor di atas paket audit (202610260001) agar urutan tetap sah bila kedua cabang digabung.
    expect(BERKAS > '202610260001').toBe(true);
  });

  it('tanpa BEGIN/COMMIT (berkas maupun rollback) dan terdeteksi sebagai perubahan fungsi (wajib --atomic)', () => {
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rollbackRaw)).toBe(false);
    expect(mengubahPolicyAtauFungsi(raw)).toBe(true);
    expect(raw).toMatch(/apply-migration\.mjs supabase\/migrations\/202611020001_survei_undangan\.sql --atomic --dry-run/);
    expect(raw).toMatch(/apply-migration\.mjs supabase\/migrations\/202611020001_survei_undangan\.sql --atomic\s*$/m);
    expect(raw).toContain('docs/rollback-survei-undangan-202611020001.sql');
  });

  it('tidak memuat DML data, tidak mengubah tabel/kolom lain, dan tidak memakai CASCADE', () => {
    expect(sql).not.toMatch(/\bTRUNCATE\b|\bDROP\s+TABLE\b|\bDROP\s+COLUMN\b|\bDROP\s+POLICY\b/i);
    expect(sql.match(/\bCASCADE\b/gi)).toHaveLength(1); // hanya ON DELETE CASCADE pada FK kunjungan_id (di bawah)
    expect(sql).toMatch(/kunjungan_id\s+uuid\s+NOT NULL\s+UNIQUE\s+REFERENCES\s+public\.kunjungan\s*\(id\)\s+ON DELETE CASCADE/i);
    // Hanya tabel baru yang dibuat; ALTER TABLE hanya untuk survei_undangan (ENABLE ROW LEVEL SECURITY).
    const alter = [...sql.matchAll(/ALTER\s+TABLE\s+(?:ONLY\s+)?([\w.]+)/gi)].map((m) => m[1]);
    expect(alter.every((t) => t === 'public.survei_undangan')).toBe(true);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b[^;]*?\bpublic\.(?:kunjungan|layanan|petugas|skm_respons)\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+public\.(?:kunjungan|layanan|petugas|skm_respons)\b/i);
  });

  it('prasyarat dijaga lebih dulu dengan pesan PRASYARAT (kunjungan, kunjungan_layanan_skm, boleh_kunjungan)', () => {
    const awal = raw.indexOf('DO $$');
    expect(awal).toBeGreaterThanOrEqual(0);
    expect(awal).toBeLessThan(raw.indexOf('CREATE TABLE'));
    const guard = raw.slice(awal, raw.indexOf('END $$', awal));
    expect(guard).toMatch(/to_regclass\('public\.kunjungan'\)/);
    expect(guard).toMatch(/to_regprocedure\('public\.kunjungan_layanan_skm\(uuid\)'\)/);
    expect(guard).toMatch(/to_regprocedure\('public\.boleh_kunjungan\(uuid\)'\)/);
    expect(guard).toMatch(/PRASYARAT/);
  });

  it('objek yang dikonsumsi memang didefinisikan migrasi sebelumnya (nama dan tipe cocok)', () => {
    const lama = listMigrationFiles().filter((nama) => nama < BERKAS);
    const semuaLama = lama.map((nama) => stripSqlComments(baca(nama))).join('\n');
    expect(semuaLama).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.kunjungan_layanan_skm\(p_kunjungan_id uuid\)\s+RETURNS uuid/i);
    expect(semuaLama).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.boleh_kunjungan\(p_kunjungan uuid\)\s+RETURNS boolean/i);
    expect(semuaLama).toMatch(/ADD COLUMN IF NOT EXISTS selesai_at\s+timestamptz/i);
    expect(semuaLama).not.toMatch(/survei_undangan/i);
  });
});

describe('survei_undangan: tabel (tanpa akses langsung klien)', () => {
  const tabel = pernyataan.find((p) => /^CREATE TABLE (?:IF NOT EXISTS )?public\.survei_undangan\b/i.test(p));

  it('CREATE TABLE memuat semua kolom, tipe, default, dan constraint persis kontrak', () => {
    expect(tabel).toBeDefined();
    const t = tabel!;
    expect(t).toMatch(/\bid\s+uuid\s+PRIMARY KEY\s+DEFAULT\s+(?:pg_catalog\.)?gen_random_uuid\(\)/i);
    expect(t).toMatch(/\bkunjungan_id\s+uuid\s+NOT NULL\s+UNIQUE\s+REFERENCES\s+public\.kunjungan\s*\(id\)\s+ON DELETE CASCADE/i);
    expect(t).toMatch(/\btoken\s+text\s+NOT NULL\s+UNIQUE\b/i);
    expect(t).toMatch(/\blayanan_id\s+uuid\s+REFERENCES\s+public\.layanan\s*\(id\)\s+ON DELETE SET NULL/i);
    expect(t).toMatch(/\bunit\s+text\s+NOT NULL\s+CHECK\s*\(\s*unit IN \('layanan', 'fo'\)\s*\)/i);
    expect(t).toMatch(/\bdibuat_pada\s+timestamptz\s+NOT NULL\s+DEFAULT\s+(?:pg_catalog\.)?now\(\)/i);
    expect(t).toMatch(/\bkedaluwarsa_pada\s+timestamptz\s+NOT NULL\b(?!\s+DEFAULT)/i);
    expect(t).toMatch(/\bdiisi_pada\s+timestamptz(?!\s+NOT NULL)/i);
    expect(t).toMatch(/\bsaran_dikirim\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i);
    expect(t).toMatch(/\bpengaduan_dikirim\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i);
  });

  it('token dibatasi 64 heksadesimal huruf kecil (CHECK)', () => {
    expect(tabel).toMatch(/CHECK\s*\(\s*token\s*~\s*'\^\[0-9a-f\]\{64\}\$'\s*\)/i);
  });

  it('RLS aktif, TANPA policy apa pun untuk survei_undangan, hak tabel dicabut dari PUBLIC/anon/authenticated', () => {
    expect(pernyataan).toContain('ALTER TABLE public.survei_undangan ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toMatch(/CREATE\s+POLICY[^;]*survei_undangan/i);
    expect(sql).not.toMatch(/\b(?:ALTER|DROP)\s+POLICY\b/i);
    expect(pernyataan).toContain('REVOKE ALL ON TABLE public.survei_undangan FROM PUBLIC, anon, authenticated');
    // Tidak ada GRANT ke tabel itu bagi klien.
    expect(sql).not.toMatch(/GRANT\s+[^;]*\bON\s+(?:TABLE\s+)?public\.survei_undangan\b/i);
    // RLS-nya muncul SEBELUM fungsi/trigger/view yang memakainya.
    expect(sql.indexOf('ENABLE ROW LEVEL SECURITY')).toBeLessThan(sql.indexOf('FUNCTION public.ensure_undangan'));
  });

  it('idempoten: tabel dan constraint memakai IF NOT EXISTS (penerapan ulang aman)', () => {
    expect(tabel).toMatch(/^CREATE TABLE IF NOT EXISTS public\.survei_undangan\b/i);
  });
});

describe('survei_undangan: fungsi SECURITY DEFINER dan hak EXECUTE', () => {
  it.each(Object.entries(FUNGSI_DEFINER))('%s: SECURITY DEFINER dengan SET search_path = pg_catalog, public', (_nama, def) => {
    expect(def).toMatch(/\bSECURITY DEFINER\b/i);
    expect(def).toMatch(/SET search_path = pg_catalog, public/i);
  });

  it.each(Object.keys(FUNGSI_DEFINER))('%s: REVOKE dari PUBLIC, anon, authenticated', (nama) => {
    const revoke = pernyataan.find((p) => new RegExp(`^REVOKE ALL ON FUNCTION public\\.${nama}\\(`, 'i').test(p));
    expect(revoke, nama).toBeDefined();
    expect(revoke).toMatch(/FROM PUBLIC, anon, authenticated$/);
  });

  it('ensure_undangan: EXECUTE hanya service_role; ambil_qr_survei: EXECUTE authenticated; fungsi trigger: tanpa GRANT', () => {
    const grants = pernyataan.filter((p) => /^GRANT\b/i.test(p));
    expect(grants).toContain('GRANT EXECUTE ON FUNCTION public.ensure_undangan(uuid) TO service_role');
    expect(grants).toContain('GRANT EXECUTE ON FUNCTION public.ambil_qr_survei(uuid) TO authenticated');
    expect(grants.some((g) => /kunjungan_selesai_undangan/.test(g))).toBe(false);
    // Penerima GRANT (bagian sesudah " TO "): tidak boleh anon atau PUBLIC.
    expect(grants.some((g) => /\b(?:anon|PUBLIC)\b/.test(g.split(' TO ')[1] ?? ''))).toBe(false);
    // Tidak ada GRANT yang memberi klien hak pada ensure_undangan.
    expect(grants.filter((g) => /ensure_undangan/.test(g))).toHaveLength(1);
  });

  it('REVOKE mendahului GRANT untuk setiap fungsi (tidak ada jendela terbuka)', () => {
    for (const nama of ['ensure_undangan', 'ambil_qr_survei']) {
      const iRevoke = pernyataan.findIndex((p) => p.startsWith(`REVOKE ALL ON FUNCTION public.${nama}(`));
      const iGrant = pernyataan.findIndex((p) => p.startsWith(`GRANT EXECUTE ON FUNCTION public.${nama}(`));
      expect(iRevoke).toBeGreaterThanOrEqual(0);
      expect(iGrant).toBeGreaterThan(iRevoke);
    }
  });
});

describe('survei_undangan: ensure_undangan (idempoten, batas 32 jam tidak bergeser)', () => {
  const isi = badan(ENSURE);

  it('signature: (uuid) RETURNS uuid, VOLATILE', () => {
    expect(rapikan(ENSURE)).toMatch(/^CREATE OR REPLACE FUNCTION public\.ensure_undangan\(p_kunjungan_id uuid\) RETURNS uuid\b/i);
    expect(ENSURE).toMatch(/\bVOLATILE\b/i);
  });

  it('mengembalikan NULL bila kunjungan tidak ada atau belum selesai', () => {
    expect(isi).toMatch(/status[\s\S]{0,80}IS DISTINCT FROM\s+'selesai'|<>\s*'selesai'/i);
    expect(isi).toMatch(/RETURN NULL/i);
  });

  it('INSERT ... ON CONFLICT (kunjungan_id) DO NOTHING; tidak pernah DO UPDATE atau UPDATE (batas tidak bergeser)', () => {
    expect(isi).toMatch(/ON CONFLICT\s*\(\s*kunjungan_id\s*\)\s*DO NOTHING/i);
    expect(isi).not.toMatch(/DO UPDATE/i);
    expect(isi).not.toMatch(/\bUPDATE\s+public\./i);
    expect(isi).not.toMatch(/\bDELETE\b/i);
    // Bila baris sudah ada, id dibaca ulang (bukan dibuat ulang).
    expect(isi).toMatch(/RETURNING\s+id\s+INTO/i);
    expect(isi).toMatch(/SELECT\s+u\.id[\s\S]*?FROM public\.survei_undangan[\s\S]*?kunjungan_id\s*=\s*p_kunjungan_id/i);
  });

  it('kedaluwarsa_pada = COALESCE(selesai_at, now()) + 32 jam (jam database)', () => {
    expect(isi).toMatch(/COALESCE\(\s*v_selesai\s*,\s*(?:pg_catalog\.)?now\(\)\s*\)\s*\+\s*interval '32 hours'/i);
    expect(isi).toMatch(/SELECT\s+k\.status,\s*k\.selesai_at\s+INTO\s+v_status,\s*v_selesai/i);
  });

  it('token = dua gen_random_uuid() digabung tanpa tanda hubung (64 hex), tanpa ekstensi lain', () => {
    expect(isi).toMatch(
      /(?:pg_catalog\.)?replace\(\s*(?:pg_catalog\.)?gen_random_uuid\(\)::text\s*\|\|\s*(?:pg_catalog\.)?gen_random_uuid\(\)::text\s*,\s*'-'\s*,\s*''\s*\)/i,
    );
    expect(isi).not.toMatch(/gen_random_bytes|random\(\)|md5\(/i);
  });

  it("unit 'fo' bila kunjungan_layanan_skm NULL, selain itu 'layanan'; layanan_id dari fungsi yang sama", () => {
    expect(isi).toMatch(/public\.kunjungan_layanan_skm\(\s*p_kunjungan_id\s*\)/i);
    expect(isi).toMatch(/CASE\s+WHEN\s+\w+\s+IS NULL\s+THEN\s+'fo'\s+ELSE\s+'layanan'\s+END/i);
  });
});

describe('survei_undangan: trigger saat kunjungan selesai', () => {
  it("trigger AFTER UPDATE OF status ON kunjungan berklausa WHEN (NEW selesai dan OLD bukan selesai), FOR EACH ROW", () => {
    const trigger = pernyataan.find((p) => /^CREATE TRIGGER trg_kunjungan_selesai_undangan\b/.test(p));
    expect(trigger).toBeDefined();
    expect(trigger).toMatch(/AFTER UPDATE OF status ON public\.kunjungan/);
    expect(trigger).toMatch(/FOR EACH ROW/);
    expect(trigger).toMatch(/WHEN \(NEW\.status = 'selesai' AND OLD\.status IS DISTINCT FROM 'selesai'\)/);
    expect(trigger).toMatch(/EXECUTE FUNCTION public\.kunjungan_selesai_undangan\(\)$/);
  });

  it('idempoten: DROP TRIGGER IF EXISTS tepat sebelum CREATE TRIGGER', () => {
    const iDrop = pernyataan.findIndex((p) => p === 'DROP TRIGGER IF EXISTS trg_kunjungan_selesai_undangan ON public.kunjungan');
    const iCreate = pernyataan.findIndex((p) => p.startsWith('CREATE TRIGGER trg_kunjungan_selesai_undangan'));
    expect(iDrop).toBeGreaterThanOrEqual(0);
    expect(iCreate).toBe(iDrop + 1);
  });

  it('fungsi trigger: RETURNS trigger, memanggil ensure_undangan(NEW.id), tidak mengubah baris kunjungan', () => {
    expect(TRIGGER_FN).toMatch(/RETURNS trigger/i);
    const isi = badan(TRIGGER_FN);
    expect(isi).toMatch(/PERFORM\s+public\.ensure_undangan\(\s*NEW\.id\s*\)/i);
    expect(isi).toMatch(/RETURN NULL/i);
    expect(isi).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);
  });

  it('hanya satu trigger baru dan tidak ada trigger lain yang menyentuh kunjungan', () => {
    const semua = [...sql.matchAll(/CREATE\s+TRIGGER\s+(\w+)\s+[\s\S]*?\bON\s+([\w.]+)/gi)].map((m) => `${m[1]}@${m[2]}`);
    expect(semua).toEqual(['trg_kunjungan_selesai_undangan@public.kunjungan']);
  });
});

describe('survei_undangan: ambil_qr_survei (QR staf)', () => {
  const isi = badan(QR);

  it('signature: (uuid) RETURNS jsonb; EXECUTE hanya authenticated (lihat blok hak)', () => {
    expect(rapikan(QR)).toMatch(/^CREATE OR REPLACE FUNCTION public\.ambil_qr_survei\(p_kunjungan_id uuid\) RETURNS jsonb\b/i);
  });

  it("penjaga boleh_kunjungan: tanpa hak -> RAISE EXCEPTION 'FORBIDDEN: ...' ERRCODE 42501, sebelum tabel dibaca", () => {
    expect(isi).toMatch(/NOT\s+public\.boleh_kunjungan\(\s*p_kunjungan_id\s*\)/i);
    expect(isi).toMatch(/RAISE EXCEPTION\s+'FORBIDDEN:[^']+'\s+USING ERRCODE\s*=\s*'42501'/i);
    expect(isi.indexOf('boleh_kunjungan')).toBeLessThan(isi.indexOf('FROM public.survei_undangan'));
    expect(isi).toMatch(/auth\.uid\(\)\s+IS NULL/i);
  });

  it('empat status kontrak; token hanya pada belum_diisi; kedaluwarsa dibandingkan dengan jam database', () => {
    for (const status of ['belum_diisi', 'sudah_diisi', 'kedaluwarsa', 'tidak_ada']) expect(isi).toContain(`'${status}'`);
    expect(isi).toMatch(/diisi_pada\s+IS NOT NULL/i);
    expect(isi).toMatch(/(?:pg_catalog\.)?now\(\)\s*>=\s*\w+\.kedaluwarsa_pada/i);
    // Kunci hasil sesuai kontrak jsonb.
    for (const kunci of ['status', 'token', 'kedaluwarsa_pada', 'unit', 'layanan_nama']) expect(isi).toContain(`'${kunci}'`);
    // Token hanya dirakit pada cabang belum_diisi, dan hanya di SATU tempat (jalur lain mengembalikan NULL).
    expect(isi).toMatch(/'token',\s*CASE\s+WHEN\s+v_status\s*=\s*'belum_diisi'\s+THEN\s+v_u\.token\s+ELSE\s+NULL\s+END/i);
    expect(isi.match(/v_u\.token\b/g)).toHaveLength(1);
    expect(isi).toMatch(/'status',\s*'tidak_ada',\s*'token',\s*NULL::text/i);
    // sudah_diisi lebih dulu daripada kedaluwarsa (sudah diisi menang).
    expect(isi.indexOf("THEN 'sudah_diisi'")).toBeGreaterThan(0);
    expect(isi.indexOf("THEN 'sudah_diisi'")).toBeLessThan(isi.indexOf("THEN 'kedaluwarsa'"));
  });

  it('hanya membaca (tanpa INSERT/UPDATE/DELETE)', () => {
    expect(isi).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
    expect(QR).toMatch(/\bSTABLE\b/i);
  });
});

describe('survei_undangan: view v_survei_status', () => {
  const view = pernyataan.find((p) => /^CREATE OR REPLACE VIEW public\.v_survei_status\b/i.test(p));

  it('kolom persis enam (tanpa token), dari survei_undangan, disaring boleh_kunjungan', () => {
    expect(view).toBeDefined();
    const v = view!;
    const daftar = v.slice(v.search(/\bSELECT\b/i) + 6, v.search(/\bFROM\b/i));
    expect(daftar).not.toMatch(/\btoken\b/i);
    for (const kolom of ['kunjungan_id', 'status', 'unit', 'layanan_id', 'kedaluwarsa_pada', 'diisi_pada']) {
      expect(daftar).toMatch(new RegExp(`\\b${kolom}\\b`));
    }
    expect(v).toMatch(/FROM public\.survei_undangan AS u/i);
    expect(v).toMatch(/WHERE public\.boleh_kunjungan\(\s*u\.kunjungan_id\s*\)$/i);
  });

  it('status turunan: sudah_diisi menang atas kedaluwarsa; kedaluwarsa bila now() >= kedaluwarsa_pada', () => {
    const v = view!;
    const iDiisi = v.indexOf("'sudah_diisi'");
    const iKdl = v.indexOf("'kedaluwarsa'");
    const iBelum = v.indexOf("'belum_diisi'");
    expect(iDiisi).toBeGreaterThan(0);
    expect(iKdl).toBeGreaterThan(iDiisi);
    expect(iBelum).toBeGreaterThan(iKdl);
    expect(v).toMatch(/diisi_pada IS NOT NULL/i);
    expect(v).toMatch(/now\(\)\s*>=\s*u\.kedaluwarsa_pada/i);
  });

  it('TANPA security_invoker (pola v_skm_petugas); security_barrier menahan pushdown fungsi ke baris yang tersaring', () => {
    expect(view).not.toMatch(/security_invoker/i);
    expect(view).toMatch(/WITH\s*\(\s*security_barrier\s*=\s*true\s*\)/i);
  });

  it('hak: REVOKE dari PUBLIC/anon/authenticated lalu GRANT SELECT hanya authenticated', () => {
    const iRevoke = pernyataan.indexOf('REVOKE ALL ON public.v_survei_status FROM PUBLIC, anon, authenticated');
    const iGrant = pernyataan.indexOf('GRANT SELECT ON public.v_survei_status TO authenticated');
    expect(iRevoke).toBeGreaterThanOrEqual(0);
    expect(iGrant).toBe(iRevoke + 1);
    expect(sql).not.toMatch(/GRANT\s+[^;]*\bON\s+(?:TABLE\s+)?public\.v_survei_status\s+TO\s+[^;]*\b(?:anon|PUBLIC)\b/i);
  });

  it('view dibuat SETELAH semua fungsi yang ia andalkan', () => {
    expect(sql.indexOf('CREATE OR REPLACE VIEW')).toBeGreaterThan(sql.indexOf('CREATE OR REPLACE FUNCTION public.ambil_qr_survei'));
  });
});

describe('survei_undangan: rollback', () => {
  it('penjaga DO di urutan PERTAMA, lalu membatalkan semua objek dalam urutan terbalik (view, QR, trigger, fungsi trigger, ensure, tabel)', () => {
    expect(pernyataanRollback[0]).toMatch(/^DO \$\$/);
    expect(pernyataanRollback.filter((p) => /^DO\b/.test(p))).toHaveLength(1);
    expect(pernyataanRollback.slice(1)).toEqual([
      'DROP VIEW IF EXISTS public.v_survei_status',
      'DROP FUNCTION IF EXISTS public.ambil_qr_survei(uuid)',
      'DROP TRIGGER IF EXISTS trg_kunjungan_selesai_undangan ON public.kunjungan',
      'DROP FUNCTION IF EXISTS public.kunjungan_selesai_undangan()',
      'DROP FUNCTION IF EXISTS public.ensure_undangan(uuid)',
      'DROP TABLE IF EXISTS public.survei_undangan',
    ]);
  });

  it('penjaga: menolak (PRASYARAT ROLLBACK) bila fungsi public lain, selain tiga yang di-DROP, menyebut ensure_undangan/survei_undangan di badannya', () => {
    // Postgres TIDAK mencatat ketergantungan dari badan plpgsql ke fungsi/tabel yang dipanggilnya, jadi DROP tidak
    // menggagalkan pemakai semacam itu; satu-satunya pengaman ialah penjaga ini (dibuktikan di skenario PGlite).
    const awalGuard = rollback.indexOf('DO $$');
    const akhirGuard = rollback.indexOf('END $$;');
    expect(awalGuard).toBeGreaterThanOrEqual(0);
    expect(akhirGuard).toBeGreaterThan(awalGuard);
    expect(awalGuard).toBeLessThan(rollback.search(/\bDROP\b/i)); // penjaga mendahului DROP pertama
    const guard = rapikan(rollback.slice(awalGuard, akhirGuard));
    expect(guard).toMatch(/FROM pg_catalog\.pg_proc AS p JOIN pg_catalog\.pg_namespace AS n ON n\.oid = p\.pronamespace/);
    expect(guard).toMatch(/WHERE n\.nspname = 'public'/);
    // Pengecualian persis tiga fungsi milik migrasi ini (nama dari migrasi, bukan nama task lain).
    const dikecualikan = guard.match(/p\.proname NOT IN \(([^)]*)\)/)?.[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort();
    expect(dikecualikan).toEqual(['ambil_qr_survei', 'ensure_undangan', 'kunjungan_selesai_undangan']);
    expect(guard).toMatch(/p\.prosrc ~\* '\(ensure_undangan\|survei_undangan\)'/);
    expect(guard).toMatch(/RAISE EXCEPTION 'PRASYARAT ROLLBACK: /);
    expect(guard).toMatch(/IF v_fungsi IS NOT NULL THEN RAISE EXCEPTION/);
    // Tidak menyebut nama fungsi/tabel milik task 3-5 (generik).
    expect(guard).not.toMatch(/notify_kunjungan_status|spak|submit_survei|get_survei/i);
  });

  it('header tidak lagi menjanjikan bahwa DROP menolak pemakai plpgsql (premis salah); menjelaskan penjaga', () => {
    expect(rollbackRaw).toMatch(/TIDAK ada ketergantungan tercatat/);
    expect(rollbackRaw).toMatch(/PENJAGA/);
    expect(rollbackRaw).not.toMatch(/DROP gagal dan seluruh rollback batal/);
  });

  it('tanpa CASCADE (ketergantungan yang DICATAT Postgres, mis. view/FK, menggagalkan DROP, bukan menghapus objek lain diam-diam); memperingatkan data hilang', () => {
    expect(rollback).not.toMatch(/\bCASCADE\b/i);
    expect(rollbackRaw).toMatch(/menghapus (?:SEMUA )?data undangan/i);
    expect(rollbackRaw).toMatch(/apply-migration\.mjs docs\/rollback-survei-undangan-202611020001\.sql --atomic --dry-run/);
  });

  it('setiap objek yang dibuat migrasi punya pasangan DROP di rollback', () => {
    const dibuat = [
      ...[...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)/gi)].map((m) => `fn:${m[1]}`),
      ...[...sql.matchAll(/CREATE\s+TRIGGER\s+(\w+)/gi)].map((m) => `trg:${m[1]}`),
      ...[...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.(\w+)/gi)].map((m) => `view:${m[1]}`),
      ...[...sql.matchAll(/CREATE\s+TABLE\s+(?:IF NOT EXISTS\s+)?public\.(\w+)/gi)].map((m) => `tbl:${m[1]}`),
    ].sort();
    const dihapus = [
      ...[...rollback.matchAll(/DROP\s+FUNCTION\s+IF EXISTS\s+public\.(\w+)/gi)].map((m) => `fn:${m[1]}`),
      ...[...rollback.matchAll(/DROP\s+TRIGGER\s+IF EXISTS\s+(\w+)/gi)].map((m) => `trg:${m[1]}`),
      ...[...rollback.matchAll(/DROP\s+VIEW\s+IF EXISTS\s+public\.(\w+)/gi)].map((m) => `view:${m[1]}`),
      ...[...rollback.matchAll(/DROP\s+TABLE\s+IF EXISTS\s+public\.(\w+)/gi)].map((m) => `tbl:${m[1]}`),
    ].sort();
    expect(dihapus).toEqual(dibuat);
  });
});

describe('survei_undangan: pencatatan (docs/ATURAN_MIGRASI.md #4)', () => {
  it('tercatat di MANIFEST.json', () => {
    const manifest = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'MANIFEST.json'), 'utf8'));
    expect(JSON.stringify(manifest)).toContain(BERKAS);
  });

  it('docs/MIGRATIONS.md: bagian "Survei terpadu Fase A" memuat berkas dan rollback, sebelum bagian 0014', () => {
    const md = bacaDocs('MIGRATIONS.md');
    const judul = '## Survei terpadu Fase A (202611020001-202611020004)';
    expect(md).toContain(judul);
    const bagian = md.slice(md.indexOf(judul), md.indexOf('## Data walk-in lengkap (0014)'));
    expect(md.indexOf(judul)).toBeLessThan(md.indexOf('## Data walk-in lengkap (0014)'));
    expect(bagian).toContain(BERKAS);
    expect(bagian).toContain(BERKAS_ROLLBACK);
    expect(bagian).toMatch(/BELUM DITERAPKAN/);
  });

  it('docs/analysis/DB-CHANGES.md: entri baru di AKHIR berkas dengan status DITULIS, BELUM DITERAPKAN dan hasil PGlite', () => {
    const md = bacaDocs('analysis', 'DB-CHANGES.md');
    const i = md.lastIndexOf('202611020001_survei_undangan');
    expect(i).toBeGreaterThan(0);
    const entri = md.slice(md.lastIndexOf('\n### ', i));
    expect(entri).toContain('Status       : DITULIS, BELUM DITERAPKAN');
    expect(entri).toMatch(/PGlite/);
    expect(entri).toContain(BERKAS_ROLLBACK);
    expect(entri).toContain('skenario-survei-undangan.mjs');
    // Entri berikutnya (bila ada) hanya milik seri ini (0002-0004), bukan pekerjaan lain.
    const nomorBerikut = [...entri.slice(5).matchAll(/\n### [^\n]*\(M-(\d{12})_/g)].map((m) => m[1]);
    for (const nomor of nomorBerikut) expect(['202611020002', '202611020003', '202611020004']).toContain(nomor);
  });
});
