// @vitest-environment node
// Kontrak statis migrasi 202610270004_survei_notifikasi (survei terpadu Fase A, Task 5): notify_kunjungan_status() diganti
// dengan CREATE OR REPLACE penuh dari versi 202610140007; HANYA cabang status = 'selesai' yang berubah (memanggil
// ensure_undangan(NEW.id), membaca token undangan, dan memakai <public_url>/survei/<token> pada isi email, isi push, dan
// payload.url, bukan tautan lama berbasis qr_token). Cabang lain, signature, atribut, hak, dan trigger tidak berubah.
// Tidak mengeksekusi SQL dan tidak menyentuh database. Fungsi ini TIDAK bisa dijalankan di stub PGlite (scripts/lokal tidak
// memuat queue_notifikasi, notifikasi, site_settings, pengunjung, maupun trigger-nya), jadi tidak ada skenario PGlite untuk
// migrasi ini: perilakunya dijaga di sini lewat perbandingan teks dengan versi 0007, dan dry-run oleh pemilik.
// Rollback: docs/rollback-survei-notifikasi-202610270004.sql (memulihkan fungsi 0007 PERSIS).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi, mengubahPolicyAtauFungsi } from '../../scripts/lib/sql-txn.mjs';
import { pecahPernyataan } from '../../scripts/lib/migration-markers.mjs';

const BERKAS = '202610270004_survei_notifikasi.sql';
const BERKAS_ASLI = '202610140007_wp24_akhiri_dual_write.sql';
const BERKAS_UNDANGAN = '202610270001_survei_undangan.sql';
const BERKAS_RPC = '202610270003_survei_rpc.sql';
const BERKAS_ROLLBACK = 'rollback-survei-notifikasi-202610270004.sql';

const baca = (nama: string) => readFileSync(join(MIGRATIONS_DIR, nama), 'utf8').replace(/\r\n/g, '\n');
const bacaDocs = (...bagian: string[]) => readFileSync(join(MIGRATIONS_DIR, '..', '..', 'docs', ...bagian), 'utf8').replace(/\r\n/g, '\n');
const rapikan = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Definisi lengkap `CREATE [OR REPLACE] FUNCTION public.<nama>(...) ... $$;` dari teks SQL (tepat satu). */
function ambilFungsi(teks: string, nama: string): string {
  const hasil = [...teks.matchAll(new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${nama}\s*\([\s\S]*?\$\$;`, 'gi'))].map((m) => m[0]);
  if (hasil.length !== 1) throw new Error(`fungsi ${nama}: ${hasil.length} definisi`);
  return hasil[0];
}
const badan = (def: string) => def.slice(def.indexOf('$$') + 2, def.lastIndexOf('$$'));
/** Teks tanpa definisi notify_kunjungan_status (untuk memeriksa isi TINGKAT-ATAS saja). */
const luarFungsi = (teks: string) => teks.replace(ambilFungsi(teks, 'notify_kunjungan_status'), '');

const raw = baca(BERKAS);
const sql = stripSqlComments(raw);
const pernyataan = pecahPernyataan(sql).map(rapikan);
const rollbackRaw = bacaDocs(BERKAS_ROLLBACK);
const rollback = stripSqlComments(rollbackRaw);
const pernyataanRollback = pecahPernyataan(rollback).map(rapikan);
const asliRaw = baca(BERKAS_ASLI);
const asli = stripSqlComments(asliRaw);

const BARU = ambilFungsi(sql, 'notify_kunjungan_status');
const BARU_MENTAH = ambilFungsi(raw, 'notify_kunjungan_status');
const LAMA = ambilFungsi(asli, 'notify_kunjungan_status');
const LAMA_MENTAH = ambilFungsi(asliRaw, 'notify_kunjungan_status');
const ROLLBACK_MENTAH = ambilFungsi(rollbackRaw, 'notify_kunjungan_status');

const AWAL_SELESAI = "IF NEW.status = 'selesai' THEN";
const AWAL_RESERVASI = "ELSIF NEW.asal = 'reservasi'";

/** Pecah badan fungsi: kepala, deklarasi, bagian sebelum cabang selesai, cabang selesai, dan bagian sesudahnya (ELSIF ... END). */
function pecah(def: string) {
  const b = badan(def);
  const iDeclare = b.indexOf('DECLARE');
  const iBegin = b.indexOf('BEGIN');
  const iSelesai = b.indexOf(AWAL_SELESAI);
  const iReservasi = b.indexOf(AWAL_RESERVASI);
  if (iDeclare < 0 || iBegin < iDeclare || iSelesai < iBegin || iReservasi < iSelesai) throw new Error('kerangka fungsi tidak dikenali');
  return {
    kepala: rapikan(def.slice(0, def.indexOf('$$'))),
    deklarasi: b.slice(iDeclare + 'DECLARE'.length, iBegin).split(';').map(rapikan).filter(Boolean),
    sebelum: rapikan(b.slice(iBegin, iSelesai)),
    selesai: rapikan(b.slice(iSelesai, iReservasi)),
    sesudah: rapikan(b.slice(iReservasi)),
  };
}

const f = pecah(BARU);
const l = pecah(LAMA);

const REVOKE = 'REVOKE ALL ON FUNCTION public.notify_kunjungan_status() FROM PUBLIC, anon, authenticated';

describe('survei_notifikasi: berkas, urutan, atomik, aditif', () => {
  it('terdaftar di FORWARD_MIGRATION_FILES tepat setelah migrasi RPC, paling akhir dalam seri, nomor di atas semua migrasi lain', () => {
    expect(BERKAS).toMatch(/^\d{12}_[a-z0-9_]+\.sql$/);
    expect(FORWARD_MIGRATION_FILES).toContain(BERKAS);
    expect(listMigrationFiles()).toContain(BERKAS);
    const daftar = [...FORWARD_MIGRATION_FILES];
    expect(daftar).toEqual([...daftar].sort());
    expect(daftar.indexOf(BERKAS)).toBe(daftar.indexOf(BERKAS_RPC) + 1);
    for (const nama of listMigrationFiles().filter((n) => n !== BERKAS)) expect(nama < BERKAS).toBe(true);
    expect(BERKAS > '202610260001').toBe(true);
  });

  it('tanpa BEGIN/COMMIT (berkas maupun rollback) dan terdeteksi sebagai perubahan fungsi (wajib --atomic)', () => {
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rollbackRaw)).toBe(false);
    expect(mengubahPolicyAtauFungsi(raw)).toBe(true);
    expect(mengubahPolicyAtauFungsi(rollbackRaw)).toBe(true);
    expect(raw).toMatch(/apply-migration\.mjs supabase\/migrations\/202610270004_survei_notifikasi\.sql --atomic --dry-run/);
    expect(raw).toMatch(/apply-migration\.mjs supabase\/migrations\/202610270004_survei_notifikasi\.sql --atomic\s*$/m);
    expect(raw).toContain('docs/rollback-survei-notifikasi-202610270004.sql');
    expect(rollbackRaw).toMatch(/apply-migration\.mjs docs\/rollback-survei-notifikasi-202610270004\.sql --atomic --dry-run/);
    expect(raw).toMatch(/BELUM DITERAPKAN/);
  });

  it('isi persis tiga pernyataan berurutan: DO penjaga, CREATE OR REPLACE FUNCTION notify_kunjungan_status(), REVOKE; tanpa tabel, kolom, policy, trigger, view, DROP, GRANT, atau DML tingkat-atas', () => {
    expect(pernyataan).toHaveLength(3);
    expect(pernyataan[0]).toMatch(/^DO \$\$/);
    expect(pernyataan[1]).toMatch(/^CREATE OR REPLACE FUNCTION public\.notify_kunjungan_status\(\) RETURNS trigger /);
    expect(pernyataan[2]).toBe(REVOKE);
    const tingkatAtas = luarFungsi(sql);
    expect(tingkatAtas).not.toMatch(/\bDROP\b|\bALTER\b|\bTRUNCATE\b|\bCASCADE\b|\bGRANT\b/i);
    expect(tingkatAtas).not.toMatch(/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|TRIGGER|POLICY|INDEX|SEQUENCE)\b/i);
    expect(pernyataan.filter((p) => /^(INSERT|UPDATE|DELETE)\b/i.test(p))).toEqual([]);
  });

  it('trigger trg_notify_kunjungan_status TIDAK dibuat ulang atau diubah (CREATE OR REPLACE FUNCTION mempertahankan trigger yang menunjuknya)', () => {
    expect(sql).not.toContain('trg_notify_kunjungan_status');
    expect(rollback).not.toContain('trg_notify_kunjungan_status');
    // Trigger itu memang sudah dibuat 0007 pada kunjungan dan menunjuk fungsi yang sama.
    expect(asli).toMatch(/CREATE TRIGGER trg_notify_kunjungan_status\s+AFTER UPDATE OF status ON public\.kunjungan\s+FOR EACH ROW EXECUTE FUNCTION public\.notify_kunjungan_status\(\);/);
  });

  it('berkas dibuka penjaga PRASYARAT (to_regprocedure untuk notify_kunjungan_status() dan ensure_undangan(uuid)), mendahului CREATE OR REPLACE', () => {
    const awal = raw.indexOf('DO $$');
    expect(awal).toBeGreaterThanOrEqual(0);
    expect(awal).toBeLessThan(raw.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(pernyataan.findIndex((p) => /^DO\b/.test(p))).toBe(0);
    const guard = rapikan(raw.slice(awal, raw.indexOf('END $$', awal)));
    expect(guard).toMatch(/IF pg_catalog\.to_regprocedure\('public\.notify_kunjungan_status\(\)'\) IS NULL THEN RAISE EXCEPTION 'PRASYARAT: [^']*202610140007_wp24_akhiri_dual_write/);
    expect(guard).toMatch(/IF pg_catalog\.to_regprocedure\('public\.ensure_undangan\(uuid\)'\) IS NULL THEN RAISE EXCEPTION 'PRASYARAT: [^']*202610270001_survei_undangan/);
    expect(guard.match(/RAISE EXCEPTION 'PRASYARAT: /g)).toHaveLength(2);
  });

  it('objek yang dikonsumsi didefinisikan migrasi sebelumnya; satu-satunya definisi lama fungsi ini adalah 0007 (yang disalin), tidak ada migrasi lain di antaranya', () => {
    const pendefinisi = listMigrationFiles().filter((nama) => /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.notify_kunjungan_status\s*\(/i.test(stripSqlComments(baca(nama))));
    expect(pendefinisi).toEqual([BERKAS_ASLI, BERKAS]);
    const undangan = stripSqlComments(baca(BERKAS_UNDANGAN));
    expect(undangan).toMatch(/CREATE OR REPLACE FUNCTION public\.ensure_undangan\(p_kunjungan_id uuid\)\s+RETURNS uuid/);
    // Tabel undangan memang punya kolom id dan token yang dibaca fungsi ini.
    const tabel = undangan.match(/CREATE TABLE IF NOT EXISTS public\.survei_undangan \(([\s\S]*?)\n\);/)?.[1] ?? '';
    for (const kolom of ['id', 'token']) expect(tabel, `survei_undangan.${kolom}`).toMatch(new RegExp(String.raw`^\s*${kolom}\s`, 'm'));
  });

  it('ensure_undangan hanya bisa dipanggil pemilik/service_role, jadi pemanggilnya HARUS SECURITY DEFINER (pemilik); hak fungsi ini tidak diubah (REVOKE sama persis dengan 0007, tanpa GRANT)', () => {
    const undangan = stripSqlComments(baca(BERKAS_UNDANGAN));
    expect(undangan).toMatch(/REVOKE ALL ON FUNCTION public\.ensure_undangan\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(undangan).toMatch(/GRANT EXECUTE ON FUNCTION public\.ensure_undangan\(uuid\) TO service_role;/);
    expect(BARU).toMatch(/SECURITY DEFINER/);
    expect(asli).toContain(`${REVOKE};`);
    expect(pernyataan[2]).toBe(rapikan(asli.match(/REVOKE ALL ON FUNCTION public\.notify_kunjungan_status\(\)[^;]*/)![0]));
  });
});

describe('survei_notifikasi: signature dan atribut identik dengan 0007', () => {
  it('kepala fungsi (nama, RETURNS trigger, LANGUAGE plpgsql, SECURITY DEFINER, search_path tetap, tanpa VOLATILE/STABLE/IMMUTABLE eksplisit) sama persis', () => {
    expect(f.kepala).toBe(l.kepala);
    expect(f.kepala).toBe('CREATE OR REPLACE FUNCTION public.notify_kunjungan_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS');
  });

  it('jumlah SECURITY DEFINER = jumlah CREATE FUNCTION = 1', () => {
    expect([...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi)]).toHaveLength(1);
    expect([...sql.matchAll(/\bSECURITY\s+DEFINER\b/gi)]).toHaveLength(1);
    expect(sql).toMatch(/SET search_path = pg_catalog, public/);
  });
});

describe('survei_notifikasi: hanya cabang selesai yang berubah', () => {
  it('kerangka ditemukan di kedua versi; cabang selesai berisi persis dua queue_notifikasi (email dan web_push); seluruh fungsi punya empat panggilan di kedua versi', () => {
    for (const x of [f, l]) {
      expect([...x.selesai.matchAll(/PERFORM public\.queue_notifikasi\(/g)]).toHaveLength(2);
      expect(x.selesai).toMatch(/'email'/);
      expect(x.selesai).toMatch(/'web_push'/);
    }
    expect([...badan(BARU).matchAll(/PERFORM public\.queue_notifikasi\(/g)]).toHaveLength(4);
    expect([...badan(LAMA).matchAll(/PERFORM public\.queue_notifikasi\(/g)]).toHaveLength(4);
  });

  it('DECLARE: semua deklarasi 0007 tetap (urutan sama) dan hanya v_undangan uuid dan v_token text ditambahkan', () => {
    expect(f.deklarasi.slice(0, l.deklarasi.length)).toEqual(l.deklarasi);
    expect(f.deklarasi.slice(l.deklarasi.length)).toEqual(['v_undangan uuid', 'v_token text']);
  });

  it('bagian SEBELUM cabang selesai (BEGIN, cek status berubah, baca pengunjung) identik dengan 0007', () => {
    expect(f.sebelum).toBe(l.sebelum);
    expect(f.sebelum).toMatch(/IF NEW\.status IS NOT DISTINCT FROM OLD\.status THEN RETURN NULL; END IF;/);
    expect(f.sebelum).toMatch(/FROM public\.pengunjung AS visitor WHERE visitor\.id = NEW\.pengunjung_id/);
  });

  it('bagian SESUDAH cabang selesai (reservasi dikonfirmasi, RETURN NULL, END) identik dengan 0007 dan tidak menyentuh undangan', () => {
    expect(f.sesudah).toBe(l.sesudah);
    expect(f.sesudah).not.toMatch(/ensure_undangan|survei_undangan|v_token|v_undangan/);
    expect(f.sesudah).toMatch(/'reservasi_confirmed'/);
    expect(f.sesudah).toMatch(/'reservasi_confirmed_email'/);
  });

  it('cabang selesai = cabang 0007 dengan TEPAT tiga perubahan: cek qr_token diganti ensure_undangan + baca token + cek token, dan dua tautan lama berbasis qr_token menjadi /survei/<token>', () => {
    const penjagaQr = rapikan('IF NEW.qr_token IS NULL THEN RETURN NULL; END IF;');
    const penjagaToken = rapikan(`
      v_undangan := public.ensure_undangan(NEW.id);
      SELECT u.token INTO v_token FROM public.survei_undangan AS u WHERE u.id = v_undangan;
      IF v_token IS NULL THEN
        RETURN NULL;
      END IF;`);
    const tautanLama = "'/skm?token=' || NEW.qr_token";
    const tautanBaru = "'/survei/' || v_token";
    // Premis tentang sumber (0007): tepat satu cek qr_token dan tepat dua tautan lama.
    expect(l.selesai.split(penjagaQr)).toHaveLength(2);
    expect(l.selesai.split(tautanLama)).toHaveLength(3);
    const diharapkan = l.selesai.replace(penjagaQr, penjagaToken).split(tautanLama).join(tautanBaru);
    expect(f.selesai).toBe(diharapkan);
  });
});

describe('survei_notifikasi: perilaku cabang selesai (properti)', () => {
  it('ensure_undangan(NEW.id) dipanggil SEKALI di fungsi, di cabang selesai, SEBELUM token dibaca dan SEBELUM queue_notifikasi pertama', () => {
    expect([...badan(BARU).matchAll(/ensure_undangan/g)]).toHaveLength(1);
    const iEnsure = f.selesai.indexOf('public.ensure_undangan(NEW.id)');
    const iToken = f.selesai.indexOf('FROM public.survei_undangan');
    const iQueue = f.selesai.indexOf('PERFORM public.queue_notifikasi(');
    expect(iEnsure).toBeGreaterThan(-1);
    expect(iToken).toBeGreaterThan(iEnsure);
    expect(iQueue).toBeGreaterThan(iToken);
  });

  it('token dibaca dari survei_undangan lewat id yang dikembalikan ensure_undangan; tanpa token (undangan tidak terbit) tidak ada notifikasi sama sekali', () => {
    expect(f.selesai).toMatch(/v_undangan := public\.ensure_undangan\(NEW\.id\);/);
    expect(f.selesai).toMatch(/SELECT u\.token INTO v_token FROM public\.survei_undangan AS u WHERE u\.id = v_undangan;/);
    // Penjaga NULL mendahului queue_notifikasi pertama dan keluar dengan RETURN NULL (trigger AFTER: tidak membatalkan status).
    const penjaga = f.selesai.match(/IF v_token IS NULL THEN RETURN NULL; END IF;/);
    expect(penjaga).not.toBeNull();
    expect(f.selesai.indexOf(penjaga![0])).toBeLessThan(f.selesai.indexOf('PERFORM public.queue_notifikasi('));
  });

  it('tidak ada lagi tautan lama: tanpa /skm dan tanpa qr_token di seluruh fungsi (termasuk komentar), supaya penjaga rollback bisa membedakan versi', () => {
    expect(BARU_MENTAH).not.toContain('/skm?token=');
    expect(BARU_MENTAH).not.toMatch(/\/skm\b/);
    expect(BARU_MENTAH).not.toMatch(/qr_token/);
    // Versi 0007 memang memakainya (kontras yang dipakai penjaga rollback).
    expect(LAMA_MENTAH).toContain('/skm?token=');
    expect(LAMA).toMatch(/qr_token/);
  });

  it('tautan survei: email dan push memakai v_skm = <public_url>/survei/<token>; payload.url memakai jalur relatif /survei/<token>', () => {
    expect(f.selesai).toMatch(/SELECT setting\.value INTO v_publik FROM public\.site_settings AS setting WHERE setting\.key = 'public_url';/);
    expect(f.selesai).toMatch(/v_skm := COALESCE\(v_publik, 'https:\/\/lmh\.lampungprov\.go\.id'\) \|\| '\/survei\/' \|\| v_token;/);
    // Isi email dan isi push (keduanya) memuat v_skm.
    expect([...f.selesai.matchAll(/'Layanan Anda telah selesai\. Mohon isi survei: ' \|\| v_skm/g)]).toHaveLength(2);
    // payload.url relatif (tanpa host), hanya pada push.
    expect(f.selesai).toMatch(/'url', '\/survei\/' \|\| v_token\)/);
    expect([...f.selesai.matchAll(/\/survei\//g)]).toHaveLength(2);
    const email = f.selesai.slice(f.selesai.indexOf("'email'"), f.selesai.indexOf("'web_push'"));
    expect(email).not.toMatch(/'url'/);
    expect(email).toMatch(/'type', 'skm_survey'\)/);
  });

  it('jenis notifikasi, judul, dan penerima tidak berubah (idempotensi queue_notifikasi per kunjungan+type tetap)', () => {
    for (const potongan of ["'type', 'skm_survey'", "'type', 'skm_survey_push'", "'Survei Kepuasan Masyarakat - DPMPTSP Lampung'", "'Layanan Selesai - Isi Survei SKM'", "NULL, v_email, 'email'", "v_user_id, NULL, 'web_push'"]) {
      expect(f.selesai, potongan).toContain(potongan);
      expect(l.selesai, potongan).toContain(potongan);
    }
    // Email walk-in FO tanpa akun (dari NEW.email) tetap menjadi jalur kontak: baris COALESCE/NULLIF tidak berubah.
    expect(f.selesai).toContain("v_email := COALESCE(NULLIF(pg_catalog.btrim(v_email), ''), NULLIF(pg_catalog.btrim(NEW.email), ''));");
  });
});

describe('survei_notifikasi: rollback', () => {
  it('urutan: penjaga DO PERTAMA dan satu-satunya, lalu CREATE OR REPLACE FUNCTION, lalu REVOKE; tanpa DROP/CASCADE/trigger/DML/tabel', () => {
    expect(pernyataanRollback).toHaveLength(3);
    expect(pernyataanRollback[0]).toMatch(/^DO \$\$/);
    expect(pernyataanRollback[1]).toMatch(/^CREATE OR REPLACE FUNCTION public\.notify_kunjungan_status\(\)/);
    expect(pernyataanRollback[2]).toBe(REVOKE);
    expect(rollback.indexOf('DO $$')).toBeLessThan(rollback.indexOf('CREATE OR REPLACE FUNCTION'));
    // Trigger memakai fungsi ini (ketergantungan tercatat), jadi DROP FUNCTION akan gagal dan tidak pernah dipakai di sini.
    const tingkatAtas = luarFungsi(rollback);
    expect(tingkatAtas).not.toMatch(/\bDROP\b|\bCASCADE\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b|\bALTER\b|\bINSERT\b|\bGRANT\b|\bTABLE\b/i);
    expect(tingkatAtas).not.toMatch(/\b(?:CREATE|DROP|ALTER)\s+(?:OR\s+REPLACE\s+)?TRIGGER\b/i);
  });

  it('fungsi yang dipulihkan SAMA PERSIS (karakter demi karakter, bukan hanya setelah spasi dinormalkan) dengan definisi 0007', () => {
    expect(ROLLBACK_MENTAH).toBe(LAMA_MENTAH);
    expect(rapikan(ambilFungsi(rollback, 'notify_kunjungan_status'))).toBe(rapikan(LAMA));
    // Dan berbeda dari versi baru (bukan salinan tak sengaja dari 0004).
    expect(ROLLBACK_MENTAH).not.toBe(BARU_MENTAH);
    expect(rapikan(ambilFungsi(rollback, 'notify_kunjungan_status'))).not.toBe(rapikan(BARU));
  });

  it('penjaga: fungsi harus ada; hanya versi 0004 (ensure_undangan + /survei/) atau versi 0007 yang sudah pulih (/skm?token= tanpa ensure_undangan) diterima; selain itu PRASYARAT ROLLBACK', () => {
    const awal = rollback.indexOf('DO $$');
    const akhir = rollback.indexOf('END $$;');
    expect(akhir).toBeGreaterThan(awal);
    const guard = rapikan(rollback.slice(awal, akhir));
    expect(guard).toMatch(/pg_catalog\.to_regprocedure\('public\.notify_kunjungan_status\(\)'\)/);
    expect(guard).toMatch(/IF v_src IS NULL THEN RAISE EXCEPTION 'PRASYARAT ROLLBACK: /);
    expect(guard).toContain("pg_catalog.strpos(v_src, 'ensure_undangan') > 0");
    expect(guard).toContain("pg_catalog.strpos(v_src, '/survei/') > 0");
    expect(guard).toContain("pg_catalog.strpos(v_src, '/skm?token=') > 0");
    expect(guard.match(/RAISE EXCEPTION 'PRASYARAT ROLLBACK: /g)).toHaveLength(2);
    // Penanda yang dipakai penjaga memang membedakan kedua versi PADA TEKS SEBENARNYA (badan fungsi, komentar ikut dihitung).
    const bBaru = badan(BARU_MENTAH);
    const bLama = badan(LAMA_MENTAH);
    expect(bBaru).toContain('ensure_undangan');
    expect(bBaru).toContain('/survei/');
    expect(bBaru).not.toContain('/skm?token=');
    expect(bLama).toContain('/skm?token=');
    expect(bLama).not.toContain('ensure_undangan');
    expect(bLama).not.toContain('/survei/');
  });

  it('logika penjaga (diterjemahkan ke JS dari teks SQL-nya) menerima versi 0004 dan 0007 dan menolak isi lain, isi campuran, dan penanda sebagian', () => {
    const guard = rapikan(rollback.slice(rollback.indexOf('DO $$'), rollback.indexOf('END $$;')));
    const kondisi = guard.match(/IF NOT \((.*)\) THEN RAISE EXCEPTION 'PRASYARAT ROLLBACK: isi/)?.[1];
    expect(kondisi).toBeDefined();
    const js = kondisi!
      .replace(/pg_catalog\.strpos\(v_src, '([^']+)'\) > 0/g, (_, s: string) => `v_src.includes(${JSON.stringify(s)})`)
      .replace(/pg_catalog\.strpos\(v_src, '([^']+)'\) = 0/g, (_, s: string) => `!v_src.includes(${JSON.stringify(s)})`)
      .replace(/\bAND\b/g, '&&')
      .replace(/\bOR\b/g, '||');
    expect(js).not.toMatch(/pg_catalog|strpos/); // seluruh ungkapan berhasil diterjemahkan
    const diterima = new Function('v_src', `return (${js});`) as (s: string) => boolean;
    const bBaru = badan(BARU_MENTAH);
    const bLama = badan(LAMA_MENTAH);
    expect(diterima(bBaru)).toBe(true); // versi 0004 terpasang: boleh dipulihkan
    expect(diterima(bLama)).toBe(true); // sudah versi 0007: pemulihan ulang aman (idempoten)
    expect(diterima('BEGIN RETURN NULL; END')).toBe(false); // isi asing
    expect(diterima('')).toBe(false);
    expect(diterima('ensure_undangan')).toBe(false); // penanda 0004 sebagian (tanpa /survei/)
    expect(diterima('/survei/')).toBe(false);
    expect(diterima(`${bBaru} /skm?token=`)).toBe(false); // campuran 0004 + tautan lama
    expect(diterima(`${bLama} ensure_undangan /survei/`)).toBe(false); // campuran 0007 + penanda 0004
    expect(diterima(`${bLama} ensure_undangan`)).toBe(false);
  });

  it('header menjelaskan urutan (PERTAMA dalam seri, SEBELUM rollback 0003/0002/0001), penjaga, dan akibatnya (email/push kembali memuat tautan lama)', () => {
    const header = rollbackRaw.replace(/\n--\s*/g, ' ');
    expect(header).toMatch(/PENJAGA/);
    expect(header).toMatch(/PERINGATAN/);
    expect(header).toMatch(/PERTAMA dalam seri/);
    expect(header).toMatch(/SEBELUM rollback 202610270003, 202610270002, dan 202610270001/);
    expect(header).toMatch(/kembali memuat tautan lama/);
  });
});

describe('survei_notifikasi: pencatatan (docs/ATURAN_MIGRASI.md #4)', () => {
  it('tercatat di MANIFEST.json', () => {
    const manifest = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'MANIFEST.json'), 'utf8'));
    expect(JSON.stringify(manifest)).toContain(BERKAS);
  });

  it('docs/MIGRATIONS.md: bagian "Survei terpadu Fase A" memuat baris 0004 (sesudah baris 0003, sebelum bagian 0014) dengan berkas, rollback, dan status BELUM DITERAPKAN', () => {
    const md = bacaDocs('MIGRATIONS.md');
    const judul = '## Survei terpadu Fase A (202610270001-202610270004)';
    expect(md).toContain(judul);
    expect(md.indexOf(judul)).toBeLessThan(md.indexOf('## Data walk-in lengkap (0014)'));
    const bagian = md.slice(md.indexOf(judul), md.indexOf('## Data walk-in lengkap (0014)'));
    const baris = bagian.split('\n').filter((x) => x.startsWith('| 20261027'));
    const b4 = baris.find((x) => x.startsWith('| 202610270004 |'));
    expect(b4).toBeDefined();
    expect(b4!).toContain(BERKAS);
    expect(b4!).toContain(BERKAS_ROLLBACK);
    expect(b4!).toMatch(/BELUM DITERAPKAN/);
    expect(baris.indexOf(b4!)).toBeGreaterThan(baris.findIndex((x) => x.startsWith('| 202610270003 |')));
  });

  it('docs/analysis/DB-CHANGES.md: entri 0004 adalah entri TERAKHIR, status DITULIS, BELUM DITERAPKAN, menyatakan fungsi tidak bisa dijalankan di PGlite dan verifikasi statis/dry-run pemilik, memuat rollback', () => {
    const md = bacaDocs('analysis', 'DB-CHANGES.md');
    const i = md.lastIndexOf('202610270004_survei_notifikasi');
    expect(i).toBeGreaterThan(md.lastIndexOf('202610270003_survei_rpc'));
    const entri = md.slice(md.lastIndexOf('\n### ', i));
    expect(md.lastIndexOf('\n### ')).toBe(md.lastIndexOf('\n### ', i)); // tidak ada entri lain sesudahnya
    expect(entri).toContain('Status       : DITULIS, BELUM DITERAPKAN');
    expect(entri).toContain(BERKAS_ROLLBACK);
    expect(entri).toMatch(/tidak (?:bisa|dapat) dijalankan di (?:stub )?PGlite/);
    expect(entri).toMatch(/dry-run/);
    expect(entri).toContain('survei_notifikasi.test.ts');
  });
});
