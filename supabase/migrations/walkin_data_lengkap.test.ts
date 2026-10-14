// @vitest-environment node
// Kontrak statis 202610140014_walkin_data_lengkap (permintaan CEO 2026-10-14: walk-in FO semua field wajib + tervalidasi)
// beserta rollback. Tidak mengeksekusi SQL; tidak menyentuh database. Uji perilaku: scripts/test-walkin-data.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const M14 = '202610140014_walkin_data_lengkap.sql';
const RB14 = 'rollback-walkin-data-lengkap-202610140014.sql';
const SIG = 'public.fo_mulai_kunjungan(text, text, text, text, text, text, uuid, uuid, uuid)';

const baca = (nama: string) => readFileSync(join(MIGRATIONS_DIR, nama), 'utf8').replace(/\r\n/g, '\n');
const docsPath = (...p: string[]) => join(MIGRATIONS_DIR, '..', '..', 'docs', ...p);
const bacaDocs = (...p: string[]) => readFileSync(docsPath(...p), 'utf8').replace(/\r\n/g, '\n');
const rapikan = (s: string) => s.replace(/\s+/g, ' ').trim();

function ambilFungsi(sql: string, nama: string): string {
  const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.` + nama + String.raw`\s*\([\s\S]*?\$\$;`, 'gi');
  const hasil = [...sql.matchAll(re)].map((m) => m[0]);
  if (hasil.length !== 1) throw new Error(`fungsi ${nama}: ${hasil.length} definisi`);
  return hasil[0];
}
const kepala = (d: string) => rapikan(d.slice(0, d.indexOf('$$')));
const kodeGalat = (def: string) => new Set([...def.matchAll(/'([A-Z][A-Z_]{3,}):/g)].map((m) => m[1]));
/** Potongan def dari `dari` (inklusif) sampai `sampai` (eksklusif); gagal bila salah satu tidak ada. */
function potong(def: string, dari: string, sampai?: string): string {
  const a = def.indexOf(dari);
  expect(a, dari).toBeGreaterThanOrEqual(0);
  if (sampai === undefined) return def.slice(a);
  const b = def.indexOf(sampai, a);
  expect(b, sampai).toBeGreaterThan(a);
  return def.slice(a, b);
}

const raw = baca(M14);
const sql = stripSqlComments(raw);
const rbRaw = bacaDocs(RB14);
const rb = stripSqlComments(rbRaw);
const m12 = stripSqlComments(baca('202610140012_perbaikan_review.sql'));
const f14 = ambilFungsi(sql, 'fo_mulai_kunjungan');
const f12 = ambilFungsi(m12, 'fo_mulai_kunjungan');

/** Pola regex SQL (literal '...' dengan '' = ') yang mengikuti `v_x !~ `. */
function polaSql(def: string, variabel: string): string {
  const m = new RegExp(String.raw`${variabel} !~ '((?:[^']|'')*)'`).exec(def);
  if (!m) throw new Error(`pola ${variabel} tidak ditemukan`);
  return m[1].replace(/''/g, "'");
}

describe('202610140014: berkas, urutan, prasyarat', () => {
  it('terdaftar, nama valid, sesudah 0013; tanpa kontrol transaksi; perintah dry-run di header', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(M14);
    const semua = listMigrationFiles();
    expect(semua.indexOf(M14)).toBe(semua.indexOf('202610140013_fo_keterbukaan_data.sql') + 1);
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rbRaw)).toBe(false);
    expect(raw).toContain(`apply-migration.mjs supabase/migrations/${M14} --atomic --dry-run`);
    expect(rbRaw).toContain(`apply-migration.mjs docs/${RB14} --atomic --dry-run`);
  });

  it('penjaga prasyarat (DO) sebelum perubahan apa pun: fo_mulai_kunjungan, 0012, penanda 0013', () => {
    const awal = sql.search(/DO \$\$/);
    expect(awal).toBeGreaterThanOrEqual(0);
    expect(awal).toBeLessThan(sql.search(/\b(?:CREATE|ALTER|UPDATE|INSERT|DROP|REVOKE|GRANT|COMMENT)\b/));
    const blok = sql.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(blok).toMatch(/to_regprocedure\('public\.fo_mulai_kunjungan\(text,text,text,text,text,text,uuid,uuid,uuid\)'\) IS NULL/);
    expect(blok).toMatch(/to_regprocedure\('public\.hari_tanpa_layanan\(date\)'\) IS NULL/);
    expect(rapikan(blok)).toContain(
      "COALESCE(pg_catalog.obj_description( pg_catalog.to_regprocedure('public.boleh_penanganan(uuid,text,uuid,uuid,text)'), 'pg_proc'), '') NOT LIKE '%202610140013%' THEN RAISE EXCEPTION 'PRASYARAT: 202610140013");
    // penanda yang diperiksa memang ditulis 0013
    expect(baca('202610140013_fo_keterbukaan_data.sql')).toMatch(/IS\s+'202610140013:/);
  });

  it('hanya mengganti fo_mulai_kunjungan: tanpa GRANT/REVOKE, policy, DML, ALTER TABLE', () => {
    expect([...sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/g)].map((m) => m[1])).toEqual(['fo_mulai_kunjungan']);
    expect(sql).not.toMatch(/\bGRANT\b|\bREVOKE\b/i);
    expect(sql).not.toMatch(/\b(?:CREATE|DROP|ALTER)\s+POLICY\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+public\.|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bALTER\s+TABLE\b|\bDROP\b/i);
    // INSERT hanya di dalam fungsi (kunjungan + penanganan), tidak ada DML tingkat atas
    expect(sql.replace(f14, '')).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).toMatch(new RegExp(String.raw`COMMENT ON FUNCTION ${SIG.replace(/[.()]/g, '\\$&')} IS\s+'202610140014:`));
  });

  it('hak EXECUTE tidak berubah: GRANT terakhir fo_mulai_kunjungan tetap 0004 (authenticated saja)', () => {
    const pemberi = listMigrationFiles().filter((f) =>
      /(?:GRANT|REVOKE)[^;]*FUNCTION\s+public\.fo_mulai_kunjungan\b/i.test(stripSqlComments(baca(f))));
    expect(pemberi).toEqual(['202610140004_fo_rpc.sql']);
    const m4 = stripSqlComments(baca('202610140004_fo_rpc.sql'));
    expect(m4).toContain(`REVOKE ALL ON FUNCTION ${SIG} FROM PUBLIC, anon, authenticated;`);
    expect(m4).toContain(`GRANT EXECUTE ON FUNCTION ${SIG} TO authenticated;`);
  });
});

describe('fo_mulai_kunjungan versi 0014: yang TIDAK berubah dari 0012', () => {
  it('signature, RETURNS, atribut identik (VOLATILE, SECURITY DEFINER, search_path terkunci)', () => {
    expect(kepala(f14)).toBe(kepala(f12));
    expect(f14).toMatch(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
  });

  it('semua kode galat 0012 dipertahankan; tidak ada kode baru', () => {
    expect(kodeGalat(f14)).toEqual(kodeGalat(f12));
  });

  it('variabel lain, penjaga sesi, jalur idempotensi cepat identik', () => {
    expect(rapikan(potong(f14, 'AS $$', 'v_nama'))).toBe(rapikan(potong(f12, 'AS $$', 'v_nama')));
    expect(rapikan(potong(f14, 'v_ada      record;', 'IF pg_catalog.char_length(v_nama)')))
      .toBe(rapikan(potong(f12, 'v_ada      record;', 'IF pg_catalog.char_length(v_nama)')));
  });

  it('layanan saran, p_pengunjung_id (#12), jam tutup, INSERT, ON CONFLICT, balasan identik', () => {
    expect(rapikan(potong(f14, 'IF p_layanan_saran_id IS NOT NULL'))).toBe(rapikan(potong(f12, 'IF p_layanan_saran_id IS NOT NULL')));
  });

  it('urutan: sesi -> idempotensi cepat -> validasi -> layanan saran -> pengunjung -> jam tutup -> INSERT', () => {
    const i = (s: string) => f14.indexOf(s);
    const urutan = [
      'public.staf_wajib_sesi(',
      'WHERE k.client_request_id = p_client_request_id',
      'IF pg_catalog.char_length(v_nama)',
      "DETAIL = 'kontak_hp'",
      "DETAIL = 'keperluan'",
      'IF p_layanan_saran_id IS NOT NULL',
      'NOT_FOUND: pengunjung',
      'public.layanan_sudah_tutup()',
      'INSERT INTO public.kunjungan',
    ].map(i);
    for (const p of urutan) expect(p).toBeGreaterThan(0);
    expect([...urutan].sort((a, b) => a - b)).toEqual(urutan);
  });
});

describe('fo_mulai_kunjungan versi 0014: aturan validasi (kontrak klien)', () => {
  it('normalisasi: nama spasi dirapatkan + trim; field lain trim [[:space:]]; email huruf kecil; HP digit saja', () => {
    expect(f14).toContain("v_nama     text := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_nama, ''), '[[:space:]]+', ' ', 'g'));");
    for (const [v, p] of [['v_instansi', 'p_asal_instansi'], ['v_kep', 'p_keperluan'], ['v_kat', 'p_kategori']]) {
      expect(f14).toMatch(new RegExp(String.raw`${v}\s+text := pg_catalog\.regexp_replace\(COALESCE\(${p}, ''\), '\^\[\[:space:\]\]\+\|\[\[:space:\]\]\+\$', '', 'g'\);`));
    }
    expect(f14).toContain("v_email    text := pg_catalog.lower(pg_catalog.regexp_replace(COALESCE(p_email, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'));");
    expect(f14).toContain("v_hp       text := pg_catalog.regexp_replace(COALESCE(p_kontak_hp, ''), '[^0-9]', '', 'g');");
    expect(rapikan(f14)).toContain("IF pg_catalog.left(v_hp, 2) = '62' THEN v_hp := '0' || pg_catalog.substr(v_hp, 3); END IF;");
  });

  it('semua field (kecuali layanan saran) WAJIB: tidak ada lagi cabang "IS NOT NULL AND" untuk HP/kategori/email/keperluan', () => {
    expect(f14).not.toMatch(/v_(?:hp|kat|email|kep) IS NOT NULL/);
    expect(f14).not.toMatch(/NULLIF\(/);
  });

  it('batas dan pola persis', () => {
    const r = rapikan(f14);
    expect(r).toContain("IF pg_catalog.char_length(v_nama) NOT BETWEEN 3 AND 100 THEN");
    expect(polaSql(f14, 'v_nama')).toBe("^[[:alpha:]][[:alpha:] .,'’-]*$");
    expect(r).toContain("IF pg_catalog.char_length(pg_catalog.regexp_replace(v_nama, '[^[:alpha:]]', '', 'g')) < 3 THEN");
    expect(r).toContain(
      "IF pg_catalog.char_length(v_instansi) NOT BETWEEN 3 AND 120 OR pg_catalog.char_length(pg_catalog.regexp_replace(v_instansi, '[[:space:]]', '', 'g')) < 3 THEN");
    expect(polaSql(f14, 'v_hp')).toBe('^08[1-9][0-9]{7,10}$');
    expect(r).toContain("IF v_kat NOT IN ('Umum', 'UMKM', 'Investor', 'Instansi') THEN");
    expect(r).toContain('IF pg_catalog.char_length(v_email) > 254');
    expect(polaSql(f14, 'v_email')).toBe(String.raw`^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$`);
    expect(r).toContain(
      "IF pg_catalog.char_length(v_kep) NOT BETWEEN 10 AND 500 OR pg_catalog.char_length(pg_catalog.regexp_replace(v_kep, '[[:space:]]', '', 'g')) < 10 THEN");
  });

  it('kategori = nilai CHECK kunjungan_kategori_check (0003)', () => {
    const m3 = rapikan(stripSqlComments(baca('202610140003_fo_model_data.sql')));
    expect(m3).toContain("CHECK (kategori IS NULL OR kategori IN ('UMKM', 'Umum', 'Instansi', 'Investor'))");
  });

  it('setiap penolakan field = DATA_TIDAK_VALID (22023) + DETAIL nama field klien', () => {
    for (const kol of ['nama', 'asal_instansi', 'kontak_hp', 'kategori', 'email', 'keperluan']) {
      expect(f14, kol).toMatch(new RegExp(String.raw`RAISE EXCEPTION 'DATA_TIDAK_VALID: [^']+'\s+USING ERRCODE = '22023', DETAIL = '${kol}';`));
    }
    expect([...f14.matchAll(/DETAIL = 'nama'/g)]).toHaveLength(3);
  });

  it('layanan saran tetap opsional (NULL = belum tahu); bila diisi wajib aktif (LAYANAN_TIDAK_VALID)', () => {
    expect(rapikan(f14)).toContain(
      'IF p_layanan_saran_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = p_layanan_saran_id AND l.aktif) THEN');
    expect(f14).not.toMatch(/p_layanan_saran_id IS NULL/);
  });

  // Pola SQL diterjemahkan ke JS (kelas POSIX -> Unicode) untuk contoh kontrak klien. Perilaku nyata di Postgres
  // (termasuk huruf beraksen pada locale DB) diuji scripts/test-walkin-data.mjs.
  describe('contoh kontrak (pola SQL dijalankan sebagai regex JS)', () => {
    const keJs = (p: string) => new RegExp(p.replace(/\[:alpha:\]/g, String.raw`\p{L}`), 'u');
    const reNama = keJs(polaSql(f14, 'v_nama'));
    const reHp = new RegExp(polaSql(f14, 'v_hp'));
    const reEmail = new RegExp(polaSql(f14, 'v_email'));
    const hpKanonik = (s: string) => { const d = s.replace(/[^0-9]/g, ''); return d.startsWith('62') ? '0' + d.slice(2) : d; };

    it.each(["Siti Nur'aini", 'José Ramírez', 'Ni Made Ayu', 'Andi B. Saputra, S.T.', 'O’Neil-Smith'])('nama sah: %s', (n) => {
      expect(reNama.test(n)).toBe(true);
    });
    it.each(['Budi2', '-Budi', ' Budi', 'Budi_', '12345', '.Ani'])('nama ditolak: %s', (n) => {
      expect(reNama.test(n)).toBe(false);
    });
    it.each([
      ['081234567890', '081234567890'], ['+62 812-3456-7890', '081234567890'], ['6281234567', '081234567'],
      ['0812 345 678', '0812345678'], ['(+62) 812.3456.789', '08123456789'],
    ])('HP %s -> %s', (masuk, kanon) => {
      expect(hpKanonik(masuk)).toBe(kanon);
    });
    it.each(['0812345678', '0812345678901', '08123456789', '085712345678'])('HP sah: %s', (h) => expect(reHp.test(h)).toBe(true));
    it.each(['081234567', '08123456789012', '0712345678', '0802345678', '021555666', ''])('HP ditolak: %s', (h) =>
      expect(reHp.test(h)).toBe(false));
    it.each(['a@b.co', 'nama.saya+x@dinas.lampungprov.go.id', 'a_b%c@x-y.id'])('email sah: %s', (e) =>
      expect(reEmail.test(e)).toBe(true));
    it.each(['a@b', 'a@@b.co', 'a b@c.id', '@b.co', 'a@b.c', 'a@-.c0', 'a@b..co', 'A@B.CO'])('email ditolak: %s', (e) =>
      expect(reEmail.test(e)).toBe(false));
  });
});

describe('rollback 202610140014', () => {
  it('memulihkan fo_mulai_kunjungan PERSIS dari 0012; komentar dihapus; tanpa GRANT/REVOKE/DROP', () => {
    expect(rapikan(ambilFungsi(rb, 'fo_mulai_kunjungan'))).toBe(rapikan(f12));
    // salinan byte-per-byte (bukan hanya setara spasi)
    expect(rbRaw).toContain(ambilFungsi(baca('202610140012_perbaikan_review.sql'), 'fo_mulai_kunjungan'));
    expect(rb).toContain(`COMMENT ON FUNCTION ${SIG} IS NULL;`);
    expect(rb).not.toMatch(/\bGRANT\b|\bREVOKE\b|\bDROP\b|\bDELETE\b|\bUPDATE\s+public\./i);
    expect([...rb.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/g)].map((m) => m[1])).toEqual(['fo_mulai_kunjungan']);
  });

  it('penjaga di awal: fungsi ada, 0012 terpasang, helper versi 0012 ada', () => {
    const awal = rb.search(/DO \$\$/);
    expect(awal).toBeGreaterThanOrEqual(0);
    expect(awal).toBeLessThan(rb.search(/\b(?:CREATE|ALTER|COMMENT)\b/));
    const blok = rb.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(blok).toMatch(/to_regprocedure\('public\.fo_mulai_kunjungan\(text,text,text,text,text,text,uuid,uuid,uuid\)'\) IS NULL THEN\s+RAISE EXCEPTION 'ROLLBACK DITOLAK/);
    expect(blok).toMatch(/to_regprocedure\('public\.hari_tanpa_layanan\(date\)'\) IS NULL THEN\s+RAISE EXCEPTION 'ROLLBACK DITOLAK/);
    expect(blok).toMatch(/to_regprocedure\('public\.staf_wajib_sesi\(text\[\]\)'\) IS NULL/);
  });
});

describe('dokumen', () => {
  it('MIGRATIONS.md, DB-CHANGES.md dan kontrak RPC mencatat 0014 + aturan', () => {
    const migrasiDoc = bacaDocs('MIGRATIONS.md');
    const dbChanges = bacaDocs('analysis', 'DB-CHANGES.md');
    expect(migrasiDoc).toContain('202610140014');
    expect(dbChanges).toContain('202610140014_walkin_data_lengkap');
    const kontrak = bacaDocs('analysis', 'FO-ESKALASI-KONTRAK-RPC.md');
    expect(kontrak).toContain('202610140014');
    expect(kontrak).toContain('^08[1-9][0-9]{7,10}$');
  });
});
